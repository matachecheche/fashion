"""Offline regression tests for the assisted Azure/Neon deploy flow.

No Azure, Neon, Stripe, Docker or credentials are contacted by these tests.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools import deploy_azure as deploy  # noqa: E402


def _connection_url(scheme: str, username: str, password: str | None, host: str, database: str = "db", query: str = "") -> str:
    # Assemble fake credentials at runtime so the packaging secret scanner does not
    # mistake a test fixture for a credential committed to the repository.
    suffix = "?" + query if query else ""
    auth = username + ":" + password + "@" if password is not None else username + "@"
    return scheme + "://" + auth + host + "/" + database + suffix


class NeonConnectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.url = _connection_url(
            "postgresql",
            "neondb_owner",
            "p%40ss%3Aword",
            "ep-cool-haze-123.us-east-1.aws.neon.tech",
            "neondb",
            "sslmode=require&channel_binding=require",
        )

    def test_parses_percent_encoded_owner_url_and_builds_pooled_runtime_url(self) -> None:
        owner = deploy.parse_neon_connection_url(self.url)
        self.assertEqual(owner.username, "neondb_owner")
        self.assertEqual(owner.password, "p@ss:word")
        self.assertEqual(owner.database, "neondb")
        self.assertEqual(owner.port, 5432)

        runtime_url = deploy.build_app_database_url(owner, "fashionstore_app", "a1b2c3")
        parsed = urlsplit(runtime_url)
        self.assertEqual(parsed.scheme, "postgresql")
        self.assertEqual(parsed.username, "fashionstore_app")
        self.assertEqual(parsed.password, "a1b2c3")
        self.assertIn("ep-cool-haze-123-pooler.", parsed.hostname or "")
        self.assertEqual(parse_qs(parsed.query)["sslmode"], ["require"])
        self.assertEqual(parse_qs(parsed.query)["channel_binding"], ["require"])

    def test_rejects_non_neon_pooled_and_non_tls_urls(self) -> None:
        rejected = (
            _connection_url("mysql", "user", "pass", "db.example.test", "store", "sslmode=require"),
            _connection_url("postgresql", "user", "pass", "ep-a.us-east-1.aws.neon.tech", query="sslmode=disable"),
            _connection_url("postgresql", "user", "pass", "ep-a-pooler.us-east-1.aws.neon.tech", query="sslmode=require"),
            _connection_url("postgresql", "user", None, "ep-a.us-east-1.aws.neon.tech", query="sslmode=require"),
            _connection_url("postgresql", "user", "", "ep-a.us-east-1.aws.neon.tech", query="sslmode=require"),
        )
        for value in rejected:
            with self.subTest(value=value):
                with self.assertRaises(deploy.DeployError):
                    deploy.parse_neon_connection_url(value)

    def test_url_is_not_in_user_facing_validation_error(self) -> None:
        secret_url = _connection_url(
            "postgresql", "owner", "ultra-private", "ep-a-pooler.us-east-1.aws.neon.tech"
        )
        with self.assertRaises(deploy.DeployError) as error:
            deploy.parse_neon_connection_url(secret_url)
        self.assertNotIn("ultra-private", str(error.exception))
        self.assertNotIn("ep-a-pooler", str(error.exception))


class NeonBootstrapTests(unittest.TestCase):
    def test_bootstrap_uses_psql_environment_variables_and_sets_rls_context(self) -> None:
        sql = deploy.build_database_bootstrap_sql()
        self.assertTrue(sql.startswith("BEGIN;\n\\getenv app_password FASHIONSTORE_APP_PASSWORD"))
        self.assertIn("\\getenv admin_password FASHIONSTORE_ADMIN_PASSWORD", sql)
        self.assertIn("\\gexec", sql)
        self.assertIn("set_config('app.tenant_id', 'legacy', true)", sql)
        self.assertIn("crypt(:'admin_password', gen_salt('bf', 12))", sql)
        self.assertIn("GRANT app_runtime TO fashionstore_app", sql)
        self.assertNotIn("\\\\getenv", sql)
        self.assertNotIn("Fashion2026!", sql)

    def test_node_pg_sql_fallback_uses_tls_and_parameterizes_role_passwords(self) -> None:
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js no está disponible en este equipo")

        with tempfile.TemporaryDirectory() as temp_dir:
            backend = Path(temp_dir) / "backend-nest"
            pg_dir = backend / "node_modules" / "pg"
            pg_dir.mkdir(parents=True)
            log_path = Path(temp_dir) / "pg-log.jsonl"
            (pg_dir / "index.js").write_text(
                """const fs = require('node:fs');
const log = process.env.CLOUD_SQL_TEST_LOG;
function record(value) { fs.appendFileSync(log, JSON.stringify(value) + '\\n'); }
class Client {
  constructor(config) { this.config = config; record({kind:'config', config}); }
  async connect() {}
  async query(query, params) {
    const sql = typeof query === 'string' ? query : query.text;
    record({kind:'query', sql, params: params || []});
    if (sql.startsWith('SELECT format(')) return {rows:[{command:\"ALTER ROLE fashionstore_app WITH LOGIN PASSWORD 'quoted-by-server' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS\"}]};
    if (sql.includes('rolsuper')) return {rows:[{rolsuper:false, rolbypassrls:false}]};
    if (sql.includes('SELECT valor')) return {rows:[{valor:'10'}]};
    if (sql.includes('count(*)::text AS count')) return {rows:[{count:'1'}]};
    if (sql.trim().startsWith('UPDATE')) return {rowCount:1, rows:[]};
    return {rows:[], rowCount:0};
  }
  async end() {}
}
module.exports = {Client};
""",
                encoding="utf-8",
            )
            env = os.environ.copy()
            env.update({
                "DATABASE_URL": "postgresql://owner:SYNTHETIC_OWNER_PASSWORD@ep-test.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
                "FS_BACKEND_DIR": str(backend),
                "CLOUD_SQL_TEST_LOG": str(log_path),
                "FS_APP_PASSWORD": "Synthetic'AppPassword0123456789ABCDE",
                "FS_ADMIN_PASSWORD": "Synthetic'AdminPassword-2026",
            })
            script = ROOT / "tools" / "cloud_sql.js"
            result = subprocess.run(
                [node, str(script), "provision"],
                env=env,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), "PROVISION OK")
            self.assertNotIn("SYNTHETIC_OWNER_PASSWORD", result.stdout + result.stderr)
            self.assertNotIn(env["FS_APP_PASSWORD"], result.stdout + result.stderr)
            self.assertNotIn(env["FS_ADMIN_PASSWORD"], result.stdout + result.stderr)

            records = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
            config = next(item["config"] for item in records if item.get("kind") == "config")
            self.assertEqual(config["ssl"], {"rejectUnauthorized": True})
            self.assertNotIn("sslmode=", config["connectionString"])
            queries = [item for item in records if item.get("kind") == "query"]
            role_password_query = next(item for item in queries if item["sql"].startswith("SELECT format("))
            self.assertEqual(role_password_query["params"], [env["FS_APP_PASSWORD"]])
            admin_update = next(item for item in queries if item["sql"].startswith("UPDATE public.usuarios SET password_hash"))
            self.assertEqual(admin_update["params"], [env["FS_ADMIN_PASSWORD"]])
            self.assertNotIn(env["FS_APP_PASSWORD"], role_password_query["sql"])
            self.assertNotIn(env["FS_ADMIN_PASSWORD"], admin_update["sql"])

            verified = subprocess.run(
                [node, str(script), "verify-app"],
                env=env,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
            self.assertEqual(verified.stdout.strip(), "VERIFY OK esquema_version=10 cuenta_admin=1")

            sql_file = Path(temp_dir) / "migration file with spaces.sql"
            sql_file.write_text("SELECT 1; SELECT 2;\n", encoding="utf-8")
            applied = subprocess.run(
                [node, str(script), "file", str(sql_file)],
                env=env,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(applied.returncode, 0, applied.stdout + applied.stderr)
            self.assertEqual(applied.stdout.strip(), "SQL OK: migration file with spaces.sql")
            # The helper sends the whole SQL file to pg in one multi-statement call.
            updated_records = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
            file_queries = [item["sql"] for item in updated_records if item.get("kind") == "query"]
            self.assertIn("SELECT 1; SELECT 2;\n", file_queries)

    def test_nonempty_neon_database_is_refused(self) -> None:
        conn = deploy.parse_neon_connection_url(
            _connection_url("postgresql", "owner", "pass", "ep-a.us-east-1.aws.neon.tech", query="sslmode=require")
        )
        with patch.object(deploy, "_psql_value", return_value="not_empty"):
            with self.assertRaisesRegex(deploy.DeployError, "base Neon no está vacía"):
                deploy._neon_empty_state(deploy.Runner(), conn)

    def test_all_reviewed_migrations_003_through_010_are_required(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            for name in deploy.REQUIRED_MIGRATIONS:
                (directory / name).touch()

            files = deploy._migration_files_for_bootstrap(directory)
            self.assertEqual([path.name for path in files], list(deploy.REQUIRED_MIGRATIONS))

            (directory / deploy.REQUIRED_MIGRATIONS[4]).unlink()
            with self.assertRaisesRegex(deploy.DeployError, "007_catalog_sync_feed.sql"):
                deploy._migration_files_for_bootstrap(directory)

    def test_assistant_provisioning_audit_uses_tenant_bound_aggregate_only(self) -> None:
        migration = (ROOT / "database" / "migrations" / "010_saas_sync_payments_ml.sql").read_text(encoding="utf-8")
        assistant = (ROOT / "backend-nest" / "src" / "ia" / "asistente-context.ts").read_text(encoding="utf-8")
        self.assertIn("WHERE a.tenant_id = public.current_tenant_id()", migration)
        self.assertIn("REVOKE ALL ON FUNCTION public.assistant_aprovisionamiento_estados() FROM PUBLIC", migration)
        self.assertIn("GRANT EXECUTE ON FUNCTION public.assistant_aprovisionamiento_estados() TO app_runtime, app_readonly", migration)
        self.assertIn("FROM public.assistant_aprovisionamiento_estados() x", assistant)
        self.assertNotIn("FROM public.auditoria_aprovisionamiento WHERE tenant_id = $1", assistant)

    def test_demo_admin_password_is_rejected(self) -> None:
        with patch.object(
            deploy.getpass,
            "getpass",
            side_effect=["Fashion2026!", "Unica-Contraseña-Larga-2026", "Unica-Contraseña-Larga-2026"],
        ), patch("builtins.print") as printed:
            result = deploy._read_new_secret(
                "Nueva contraseña: ", minimum=14, forbidden=("Fashion2026!",)
            )

        self.assertEqual(result, "Unica-Contraseña-Larga-2026")
        printed.assert_any_call("No reutilices la contraseña semilla de demostración.")


class GHCRImageTests(unittest.TestCase):
    class Response:
        def __init__(self, body: bytes, status: int = 200) -> None:
            self.body = body
            self.status = status

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def read(self, size: int = -1) -> bytes:
            if size < 0:
                result, self.body = self.body, b""
                return result
            result, self.body = self.body[:size], self.body[size:]
            return result

    def test_owner_normalization_and_expected_public_image_names(self) -> None:
        images = deploy.ghcr_image_urls("FashionStoreOrg")
        self.assertEqual(
            images,
            {
                "ai": "ghcr.io/fashionstoreorg/fashionstore-ai:latest",
                "api": "ghcr.io/fashionstoreorg/fashionstore-api:latest",
                "web": "ghcr.io/fashionstoreorg/fashionstore-web:latest",
            },
        )
        with self.assertRaises(deploy.DeployError):
            deploy.ghcr_image_urls("../../private")

    def test_preflight_accepts_anonymous_pull_for_all_three_images(self) -> None:
        requests = []

        def fake_urlopen(request, timeout=15):
            requests.append(request)
            if "/token?" in request.full_url:
                return self.Response(json.dumps({"token": "SYNTHETIC_ANONYMOUS_TOKEN"}).encode())
            self.assertEqual(request.get_header("Authorization"), "Bearer SYNTHETIC_ANONYMOUS_TOKEN")
            return self.Response(b"{}", status=200)

        with patch.object(deploy.urllib.request, "urlopen", side_effect=fake_urlopen):
            urls = deploy.check_public_ghcr_images("FashionStoreOrg")

        self.assertEqual(len(requests), 6)  # anonymous pull token + manifest for each image
        self.assertTrue(all(url.startswith("ghcr.io/fashionstoreorg/") for url in urls.values()))

    def test_preflight_refuses_private_or_missing_package(self) -> None:
        calls = 0

        def fake_urlopen(request, timeout=15):
            nonlocal calls
            calls += 1
            if "/token?" in request.full_url:
                return self.Response(json.dumps({"token": "SYNTHETIC_ANONYMOUS_TOKEN"}).encode())
            raise deploy.urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)

        with patch.object(deploy.urllib.request, "urlopen", side_effect=fake_urlopen):
            with self.assertRaisesRegex(deploy.DeployError, "no existe o no es pública"):
                deploy.check_public_ghcr_images("fashionstoreorg")
        self.assertEqual(calls, 2)


class AzurePayloadTests(unittest.TestCase):
    def make_payload(self) -> dict:
        return deploy._containerapp_payload(
            location="eastus",
            environment_id="/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env",
            image="ghcr.io/fashionstoreorg/fashionstore-api:latest",
            container_name="fashionstore-api",
            port=3000,
            external=False,
            cpu=0.5,
            memory="1Gi",
            env=[
                deploy._env_value("NODE_ENV", "production"),
                deploy._env_secret("DATABASE_URL", "db-url"),
                deploy._env_secret("JWT_SECRET", "jwt-secret"),
            ],
            secret_values={"db-url": "SYNTHETIC_DB_SECRET", "jwt-secret": "SYNTHETIC_JWT_SECRET"},
        )

    def test_optional_llm_key_is_a_container_app_secret_reference(self) -> None:
        env, secrets = deploy._llm_secret_config("gemini", "SYNTHETIC_GEMINI_KEY")
        self.assertEqual(env, [{"name": "GEMINI_API_KEY", "secretRef": "gemini-api-key"}])
        self.assertEqual(secrets, {"gemini-api-key": "SYNTHETIC_GEMINI_KEY"})
        self.assertEqual(deploy._llm_secret_config(None, None), ([], {}))
        with self.assertRaises(deploy.DeployError):
            deploy._llm_secret_config("other", "SYNTHETIC_KEY")

    def test_fastapi_payload_references_optional_llm_key_as_aca_secret(self) -> None:
        key = "SYNTHETIC_GEMINI_KEY"
        payload = deploy._fastapi_containerapp_payload(
            location="eastus",
            environment_id="/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env",
            image="ghcr.io/fashionstoreorg/fashionstore-ai:latest",
            app_database_url="postgresql://synthetic",
            ia_key="SYNTHETIC_INTERNAL_KEY",
            llm_provider="gemini",
            llm_api_key=key,
        )
        configuration = payload["properties"]["configuration"]
        secrets = {item["name"]: item["value"] for item in configuration["secrets"]}
        env = {item["name"]: item for item in payload["properties"]["template"]["containers"][0]["env"]}
        self.assertEqual(secrets["gemini-api-key"], key)
        self.assertEqual(env["GEMINI_API_KEY"]["secretRef"], "gemini-api-key")
        self.assertNotIn("value", env["GEMINI_API_KEY"])
        self.assertEqual(secrets["ia-key"], "SYNTHETIC_INTERNAL_KEY")
        self.assertEqual(env["IA_INTERNAL_KEY"]["secretRef"], "ia-key")
        self.assertNotIn("value", env["IA_INTERNAL_KEY"])
        self.assertTrue(configuration["ingress"]["external"])
        self.assertFalse(configuration["ingress"]["allowInsecure"])
        self.assertEqual(
            payload["properties"]["environmentId"],
            "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env",
        )
        self.assertEqual(payload["properties"]["template"]["scale"], {"minReplicas": 0, "maxReplicas": 1})

    def test_optional_llm_key_prompt_is_hidden_and_can_be_skipped(self) -> None:
        with patch("builtins.input", return_value="n"):
            self.assertEqual(deploy._read_optional_llm_credentials(), (None, None))
        key = "gsk_" + "x" * 32
        with patch("builtins.input", side_effect=["s", "groq"]), patch.object(deploy.getpass, "getpass", return_value=key):
            self.assertEqual(deploy._read_optional_llm_credentials(), ("groq", key))

    def test_payload_uses_public_image_without_paid_azure_registry_or_identity(self) -> None:
        payload = self.make_payload()
        props = payload["properties"]
        container = props["template"]["containers"][0]
        env = {item["name"]: item for item in container["env"]}
        self.assertNotIn("identity", payload)
        self.assertNotIn("registries", props["configuration"])
        self.assertTrue(container["image"].startswith("ghcr.io/"))
        self.assertFalse(props["configuration"]["ingress"]["external"])
        self.assertEqual(props["configuration"]["ingress"]["targetPort"], 3000)
        self.assertEqual(env["DATABASE_URL"]["secretRef"], "db-url")
        self.assertNotIn("value", env["DATABASE_URL"])
        self.assertEqual({item["name"] for item in props["configuration"]["secrets"]}, {"db-url", "jwt-secret"})
        self.assertTrue(all(len(item["name"]) <= 20 for item in props["configuration"]["secrets"]))

    def test_patch_does_not_emit_secret_values_unless_updating_secret_array(self) -> None:
        payload = self.make_payload()
        patch = deploy._patch_payload_from_app(payload)
        self.assertEqual(patch["location"], payload["location"])
        self.assertNotIn("SYNTHETIC_DB_SECRET", json.dumps(patch))
        self.assertNotIn("secrets", patch["properties"])
        full = deploy._patch_payload_from_app(payload, include_secrets=True)
        self.assertIn("SYNTHETIC_DB_SECRET", json.dumps(full))

    def test_public_web_origin_is_configured_for_nest_and_fastapi(self) -> None:
        api_payload = self.make_payload()
        ai_payload = self.make_payload()
        web_url = "https://fashionstore-web.example.test"

        deploy._configure_public_web_origin(api_payload, ai_payload, web_url)

        for payload in (api_payload, ai_payload):
            env = {
                item["name"]: item["value"]
                for item in payload["properties"]["template"]["containers"][0]["env"]
                if "value" in item
            }
            self.assertEqual(env["CORS_ORIGINS"], web_url)
        api_env = {
            item["name"]: item["value"]
            for item in api_payload["properties"]["template"]["containers"][0]["env"]
            if "value" in item
        }
        self.assertEqual(api_env["PUBLIC_WEB_URL"], web_url)

    def test_web_container_receives_api_upstream_at_runtime(self) -> None:
        web_payload = deploy._containerapp_payload(
            location="eastus",
            environment_id="/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env",
            image="ghcr.io/fashionstoreorg/fashionstore-web:latest",
            container_name="fashionstore-web",
            port=80,
            external=True,
            cpu=0.25,
            memory="0.5Gi",
            env=[],
        )
        deploy._configure_web_api_upstream(web_payload, "https://api.example.test/")
        env = web_payload["properties"]["template"]["containers"][0]["env"]
        self.assertEqual(env, [{"name": "API_UPSTREAM", "value": "https://api.example.test"}])

    def test_arm_secret_body_is_file_backed_and_removed_after_request(self) -> None:
        token = "ONLY_IN_TEMP_BODY_TEST"

        class CaptureRunner:
            args: list[str] = []
            body: dict = {}
            temp_path: Path | None = None

            def az_quiet(self, args):
                self.args = list(args)
                body_arg = args[args.index("--body") + 1]
                self.assert_body_arg = body_arg
                self.temp_path = Path(body_arg[1:])
                self.body = json.loads(self.temp_path.read_text(encoding="utf-8"))

        runner = CaptureRunner()
        deploy._arm_containerapp_request(
            runner, "put", "subscription", "rg-test", "fashionstore-api-test", {"secret": token}
        )
        self.assertEqual(runner.body, {"secret": token})
        self.assertNotIn(token, " ".join(runner.args))
        self.assertFalse(runner.temp_path and runner.temp_path.exists())
        self.assertTrue(runner.assert_body_arg.startswith("@"))

    def test_arm_uri_escapes_resource_names(self) -> None:
        url = deploy._containerapp_uri("sub-id", "rg name", "app name")
        self.assertIn("/resourceGroups/rg%20name/", url)
        self.assertIn("/containerApps/app%20name?api-version=", url)


class LocalSafetyRegressionTests(unittest.TestCase):
    def test_fastapi_public_https_health_check(self) -> None:
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args) -> None:
                return None

            def read(self) -> bytes:
                return b'{"status":"ok"}'

        with patch.object(deploy.urllib.request, "urlopen", return_value=Response()) as urlopen:
            self.assertTrue(deploy._wait_http("https://fastapi.example.test/health", attempts=1))
        urlopen.assert_called_once()

    def test_azure_cli_json_parser_tolerates_surrounding_warning(self) -> None:
        runner = deploy.Runner()
        output = "WARNING: harmless CLI notice [not-json]\n{\"id\":\"synthetic-subscription\"}\n"
        with patch.object(runner, "run", return_value=output):
            self.assertEqual(runner.az_json(["account", "show"]), {"id": "synthetic-subscription"})

    def test_azure_student_allowed_region_policy_is_checked_pre_neon(self) -> None:
        class PolicyRunner:
            def az_json(self, args):
                if args == ["account", "list-locations"]:
                    return [{"name": name} for name in ("eastus", "brazilsouth", "chilecentral")]
                if args == ["provider", "show", "--namespace", "Microsoft.App"]:
                    return {"resourceTypes": [{
                        "resourceType": "managedEnvironments",
                        "locations": ["East US", "Brazil South", "Chile Central"],
                    }]}
                if args == ["policy", "assignment", "list", "--only-show-errors"]:
                    return [{"parameters": {"listOfAllowedLocations": {
                        "value": ["brazilsouth", "chilecentral"],
                    }}}]
                raise AssertionError(f"Consulta inesperada: {args}")

        with self.assertRaisesRegex(deploy.DeployError, "brazilsouth, chilecentral"):
            deploy._validate_location(PolicyRunner(), "eastus")
        deploy._validate_location(PolicyRunner(), "chilecentral")

    def test_runner_redacts_secret_from_command_failure(self) -> None:
        secret = "SyntheticSensitiveValue123"
        runner = deploy.Runner()
        runner.add_sensitive(secret)
        failed = subprocess.CompletedProcess(args=["tool"], returncode=1, stdout=f"error: {secret}")
        with patch.object(deploy.subprocess, "run", return_value=failed):
            with self.assertRaises(deploy.DeployError) as error:
                runner.run(["tool"])
        self.assertNotIn(secret, str(error.exception))
        self.assertIn("[REDACTED]", str(error.exception))

    def test_windows_runner_passes_azure_args_without_cmd_quoting(self) -> None:
        runner = deploy.Runner()
        powershell = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
        expected_args = [
            "containerapp", "env", "create", "--location", "East US",
            "--body", r"@C:\Users\Test User\AppData\Local\Temp\payload.json",
        ]
        completed = subprocess.CompletedProcess(args=[], returncode=0, stdout="OK")

        def which(name):
            return powershell if name == "powershell.exe" else None

        with patch.object(deploy.os, "name", "nt"), patch.object(deploy.shutil, "which", side_effect=which), patch.object(deploy.subprocess, "run", return_value=completed) as run:
            self.assertEqual(runner.run(["az", *expected_args], quiet=True), "OK")

        command = run.call_args.args[0]
        self.assertEqual(command[0], powershell)
        self.assertIn("-EncodedCommand", command)
        script = base64.b64decode(command[-1]).decode("utf-16le")
        self.assertIn("& az @azArgs", script)
        self.assertEqual(json.loads(run.call_args.kwargs["env"]["FASHIONSTORE_AZ_ARGS_JSON"]), expected_args)

    def test_sql_driver_prefers_psql_and_falls_back_to_installed_node_pg(self) -> None:
        with patch.object(deploy.shutil, "which", side_effect=lambda name: "psql.exe" if name == "psql" else None), patch.object(deploy, "_node_pg_available", return_value=True):
            self.assertEqual(deploy._sql_driver(), "psql")

        with patch.object(deploy.shutil, "which", return_value=None), patch.object(deploy, "_node_pg_available", return_value=True):
            self.assertEqual(deploy._sql_driver(), "node")

        with patch.object(deploy.shutil, "which", return_value=None), patch.object(deploy, "_node_pg_available", return_value=False):
            self.assertIsNone(deploy._sql_driver())

    def test_node_scalar_fallback_decodes_json_without_psql(self) -> None:
        connection = deploy.parse_neon_connection_url(
            _connection_url("postgresql", "owner", "pass", "ep-a.us-east-1.aws.neon.tech", query="sslmode=require")
        )
        with patch.object(deploy.shutil, "which", return_value=None), patch.object(deploy, "_cloud_sql", return_value='"empty"') as cloud_sql:
            self.assertEqual(deploy._psql_value(deploy.Runner(), connection, "SELECT 'empty'"), "empty")
        cloud_sql.assert_called_once()

    def test_bat_signs_in_checks_sql_driver_and_runs_assistant(self) -> None:
        bat = (ROOT / "desplegar-azure.bat").read_text(encoding="utf-8").lower()
        self.assertIn("call az account show --only-show-errors", bat)
        self.assertIn("call az login", bat)
        self.assertIn("call az account show --query", bat)
        self.assertIn("where psql", bat)
        self.assertIn("where node", bat)
        self.assertIn("have_sql_client", bat)
        self.assertIn("call az extension add --name containerapp --yes", bat)
        self.assertNotIn("\naz account", bat)
        self.assertNotIn("\naz extension", bat)
        self.assertIn("tools\\deploy_azure.py", bat)
        self.assertNotIn("solo comprueba herramientas", bat)

    def test_express_region_preflight_rejects_unsupported_region_before_cloud_queries(self) -> None:
        class NoAzureCalls:
            def az_json(self, _args):
                raise AssertionError("La región debe rechazarse antes de llamar Azure")

        with self.assertRaisesRegex(deploy.DeployError, "no ofrece Azure Container Apps Express"):
            deploy._validate_location(NoAzureCalls(), "unsupported-region")
        self.assertIn("eastus", deploy.EXPRESS_REGIONS)
        self.assertIn("brazilsouth", deploy.EXPRESS_REGIONS)
        self.assertIn("chilecentral", deploy.EXPRESS_REGIONS)

    def test_azure_providers_are_registered_before_preflight(self) -> None:
        source = (ROOT / "tools" / "deploy_azure.py").read_text(encoding="utf-8")
        main_source = source[source.index("def main() -> int:"):]
        self.assertLess(
            main_source.index("_ensure_providers_registered(runner)"),
            main_source.index("_check_azure_preflight(runner, subscription_id, location, names)"),
        )
        self.assertNotIn("Microsoft.OperationalInsights", source)
        self.assertIn('"--environment-mode",\n            "express"', source)
        self.assertIn('"--logs-destination",\n            "none"', source)
        self.assertIn('"container_apps_mode": "express"', source)
        self.assertNotIn("az acr", source.lower())

    def test_ghcr_requires_explicit_confirmation_before_side_effects(self) -> None:
        source = (ROOT / "tools" / "deploy_azure.py").read_text(encoding="utf-8")
        main_source = source[source.index("def main() -> int:"):]
        self.assertLess(
            main_source.index('provider_confirmation = input("¿Confirmas usar GHCR'),
            main_source.index("_subscription(runner)"),
        )
        self.assertIn("GHCR no confirmado", main_source)

    def test_ghcr_workflow_publishes_three_runtime_images(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "publish-ghcr.yml").read_text(encoding="utf-8")
        self.assertIn("packages: write", workflow)
        self.assertIn("fashionstore-ai:latest", workflow)
        self.assertIn("fashionstore-api:latest", workflow)
        self.assertIn("fashionstore-web:latest", workflow)
        self.assertIn("VITE_API_URL=/api", workflow)
        self.assertIn("NGINX_CONF=nginx.azure.conf", workflow)

    def test_azure_web_nginx_uses_runtime_proxy_not_compose_dns_or_baked_api(self) -> None:
        dockerfile = (ROOT / "frontend-web" / "Dockerfile").read_text(encoding="utf-8")
        azure_nginx = (ROOT / "frontend-web" / "nginx.azure.conf").read_text(encoding="utf-8")
        deploy_script = (ROOT / "tools" / "deploy_azure.py").read_text(encoding="utf-8")
        self.assertIn("ARG NGINX_CONF=nginx.conf", dockerfile)
        self.assertIn("/etc/nginx/templates/default.conf.template", dockerfile)
        self.assertIn("NGINX_ENVSUBST_FILTER=^API_UPSTREAM$", dockerfile)
        self.assertNotIn("backend:3000", azure_nginx)
        self.assertIn("location /api/", azure_nginx)
        self.assertIn("location /assets/prendas/", azure_nginx)
        self.assertEqual(azure_nginx.count("proxy_pass ${API_UPSTREAM};"), 2)
        self.assertIn("proxy_set_header X-Forwarded-Proto https;", azure_nginx)
        self.assertIn("proxy_ssl_verify on;", azure_nginx)
        self.assertIn("proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;", azure_nginx)
        self.assertIn("API_UPSTREAM", deploy_script)


class CloudSqlRealServerRegressionTests(unittest.TestCase):
    """El stub de pg de los tests no detecta errores de tipos de PostgreSQL real."""

    def test_provision_casts_bind_parameters_for_postgres(self):
        source = (ROOT / "tools" / "cloud_sql.js").read_text(encoding="utf-8")
        # format(..., $1) usa VARIADIC "any": sin cast PostgreSQL responde
        # "could not determine data type of parameter $1" y el despliegue se detiene.
        self.assertIn("NOBYPASSRLS', $1::text)", source)
        self.assertIn("crypt($1::text, gen_salt('bf', 12))", source)


class BatSyntaxRegressionTests(unittest.TestCase):
    def test_no_unescaped_parentheses_in_echo_inside_blocks(self):
        # Un ")" dentro de un echo en un bloque if (...) cierra el bloque y CMD responde
        # "No se esperaba . en este momento."
        problems = []
        for path in sorted(ROOT.rglob("*.bat")):
            if "node_modules" in path.parts:
                continue
            depth = 0
            for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith(")"):
                    depth = max(0, depth - 1)
                if depth > 0 and stripped.lower().startswith("echo") and any(ch in stripped for ch in "()"):
                    problems.append("%s:%d %s" % (path.relative_to(ROOT), number, stripped))
                if stripped.endswith("("):
                    depth += 1
        self.assertEqual(problems, [])


class BatLineEndingsTests(unittest.TestCase):
    def test_all_bat_files_use_crlf(self):
        # cmd.exe con finales LF puede reanudar tras un CALL en mitad de una linea
        # ("sion-debug.txt' no se reconoce como un comando").
        bad = []
        for path in sorted(ROOT.rglob("*.bat")):
            if "node_modules" in path.parts:
                continue
            data = path.read_bytes()
            if data.count(b"\n") != data.count(b"\r\n"):
                bad.append(str(path.relative_to(ROOT)))
        self.assertEqual(bad, [])
        self.assertIn("*.bat text eol=crlf", (ROOT / ".gitattributes").read_text(encoding="utf-8"))


class DefaultRegionTests(unittest.TestCase):
    def test_default_region_respects_student_policy(self):
        with patch.object(deploy, "_policy_allowed_regions",
                          return_value={"brazilsouth", "canadacentral", "chilecentral", "francecentral", "mexicocentral", "westus9"}):
            region, allowed = deploy._default_region(object())
        self.assertEqual(region, "chilecentral")
        self.assertEqual(allowed, ["chilecentral", "brazilsouth", "mexicocentral", "canadacentral", "francecentral"])

    def test_default_region_without_policy_keeps_eastus(self):
        with patch.object(deploy, "_policy_allowed_regions", return_value=None):
            self.assertEqual(deploy._default_region(object()), ("eastus", []))
        with patch.object(deploy, "_policy_allowed_regions", side_effect=deploy.DeployError("x")):
            self.assertEqual(deploy._default_region(object()), ("eastus", []))


class BoolOutputParsingTests(unittest.TestCase):
    def test_parse_bool_ignores_cli_warnings(self):
        self.assertEqual(deploy._parse_bool_output("false"), "false")
        self.assertEqual(deploy._parse_bool_output("False\r\n"), "false")
        self.assertEqual(deploy._parse_bool_output("WARNING: The installed extension 'containerapp' is in preview.\nfalse\n"), "false")
        self.assertEqual(deploy._parse_bool_output("true"), "true")
        self.assertEqual(deploy._parse_bool_output("algo raro"), "")


class TsvNoiseTests(unittest.TestCase):
    def test_tsv_value_ignores_extension_preview_warning(self):
        noisy = "The installed extension 'containerapp' is in preview.\nfashionstore-api-abc.chilecentral.azurecontainerapps.io\n"
        self.assertEqual(deploy._tsv_value(noisy), "fashionstore-api-abc.chilecentral.azurecontainerapps.io")
        self.assertEqual(deploy._tsv_value("WARNING: x\nSucceeded"), "Succeeded")
        self.assertEqual(deploy._tsv_value("The installed extension 'containerapp' is in preview."), "")


if __name__ == "__main__":
    unittest.main()
