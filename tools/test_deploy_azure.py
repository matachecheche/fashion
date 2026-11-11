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

    def test_rejects_non_neon_and_non_tls_urls(self) -> None:
        rejected = (
            _connection_url("mysql", "user", "pass", "db.example.test", "store", "sslmode=require"),
            _connection_url("postgresql", "user", "pass", "ep-a.us-east-1.aws.neon.tech", query="sslmode=disable"),
            _connection_url("postgresql", "user", None, "ep-a.us-east-1.aws.neon.tech", query="sslmode=require"),
            _connection_url("postgresql", "user", "", "ep-a.us-east-1.aws.neon.tech", query="sslmode=require"),
        )
        for value in rejected:
            with self.subTest(value=value):
                with self.assertRaises(deploy.DeployError):
                    deploy.parse_neon_connection_url(value)

    def test_pooled_owner_url_is_normalized_to_direct_and_runtime_is_pooled(self) -> None:
        pooled = _connection_url(
            "postgresql", "owner", "ultra-private", "ep-a-pooler.us-east-1.aws.neon.tech",
            query="sslmode=require&channel_binding=require",
        )
        owner = deploy.parse_neon_connection_url(pooled)
        self.assertTrue(owner.input_was_pooled)
        self.assertEqual(owner.host, "ep-a.us-east-1.aws.neon.tech")
        self.assertNotIn("-pooler", owner.original_url)
        runtime = deploy.build_app_database_url(owner, "fashionstore_app", "runtime")
        self.assertIn("ep-a-pooler.", urlsplit(runtime).hostname or "")

    def test_url_is_not_in_user_facing_validation_error(self) -> None:
        secret_url = _connection_url("mysql", "owner", "ultra-private", "ep-a.us-east-1.aws.neon.tech")
        with self.assertRaises(deploy.DeployError) as error:
            deploy.parse_neon_connection_url(secret_url)
        self.assertNotIn("ultra-private", str(error.exception))


class AzureCliRunnerPreflightTests(unittest.TestCase):
    def test_python_runner_verifies_active_azure_account_read_only(self):
        class FakeRunner:
            def __init__(self):
                self.calls = []
            def az_json(self, args):
                self.calls.append(args)
                return {"id": "synthetic-subscription", "name": "Azure Students"}

        runner = FakeRunner()
        account = deploy._verify_azure_cli_runner(runner)
        self.assertEqual(account["id"], "synthetic-subscription")
        self.assertEqual(runner.calls, [["account", "show"]])

    def test_python_runner_reports_cmd_launch_failure_before_prompting(self):
        class FakeRunner:
            def az_json(self, _args):
                raise deploy.DeployError("Falló az (código 1). Salida saneada: No se ha encontrado la ruta de acceso de la red.")

        with self.assertRaisesRegex(deploy.DeployError, "no pudo ejecutarse desde Python") as error:
            deploy._verify_azure_cli_runner(FakeRunner())
        self.assertIn("No se ha encontrado la ruta de acceso de la red", str(error.exception))
        self.assertIn("No se ha consultado ni modificado", str(error.exception))


class AzureResourceGroupPreflightTests(unittest.TestCase):
    def test_resource_group_exists_parses_json_boolean_and_uses_subscription(self) -> None:
        class FakeRunner:
            def __init__(self):
                self.calls = []
            def run(self, args, quiet=False):
                self.calls.append(args)
                return 'true'
        runner = FakeRunner()
        self.assertTrue(deploy._resource_group_exists(runner, "subscription-id", "rg-test"))
        self.assertIn("--subscription", runner.calls[0])
        self.assertIn("subscription-id", runner.calls[0])

    def test_resource_group_exists_falls_back_to_show_when_exists_output_is_blank(self) -> None:
        class FakeRunner:
            def __init__(self):
                self.calls = []
            def run(self, args, quiet=False):
                self.calls.append(args)
                if args[1:3] == ["group", "exists"]:
                    return "WARNING: extension notice\n"
                raise deploy.DeployError("ResourceGroupNotFound: resource group could not be found (404)")
        runner = FakeRunner()
        self.assertFalse(deploy._resource_group_exists(runner, "sub", "new-rg"))
        self.assertEqual(len(runner.calls), 2)
        self.assertIn("group", runner.calls[1])
        self.assertIn("show", runner.calls[1])

    def test_resource_group_preflight_does_not_treat_permission_errors_as_absent(self) -> None:
        class FakeRunner:
            def run(self, args, quiet=False):
                if args[1:3] == ["group", "exists"]:
                    return ""
                raise deploy.DeployError("AuthorizationFailed: forbidden (403)")
        with self.assertRaisesRegex(deploy.DeployError, "no pudo verificar"):
            deploy._resource_group_exists(FakeRunner(), "sub", "new-rg")

    def test_failed_attempt_cleanup_only_targets_the_run_resource_group(self) -> None:
        class FakeRunner:
            def __init__(self):
                self.calls = []
            def az_quiet(self, args):
                self.calls.append(list(args))

        runner = FakeRunner()
        state = {
            "status": "incomplete", "resource_group_created": True,
            "resource_group": "rg-fashionstore-test-new", "subscription_id": "sub-id",
            "environment_reused": True,
        }
        with patch.object(deploy.sys, "argv", ["deploy_azure.py"]), patch.dict(os.environ, {}, clear=True):
            self.assertTrue(deploy._cleanup_failed_resource_group(runner, state))
        self.assertEqual(runner.calls, [[
            "group", "delete", "--name", "rg-fashionstore-test-new", "--yes", "--subscription", "sub-id",
        ]])
        self.assertTrue(state["resource_group_deleted"])
        self.assertEqual(state["azure_cleanup_status"], "completed")

    def test_failed_attempt_cleanup_can_be_disabled_for_debugging(self) -> None:
        class FakeRunner:
            def az_quiet(self, args):
                raise AssertionError("No debe eliminar recursos si el usuario solicita conservarlos")

        state = {"status": "incomplete", "resource_group_created": True, "resource_group": "rg-debug"}
        with patch.object(deploy.sys, "argv", ["deploy_azure.py", "--keep-failed-resources"]):
            self.assertFalse(deploy._cleanup_failed_resource_group(FakeRunner(), state))
        self.assertEqual(state["azure_cleanup_status"], "kept_by_user")


class InteractiveRetryTests(unittest.TestCase):
    def test_yes_no_prompt_retries_typo(self):
        with patch("builtins.input", side_effect=["siii", "s"]):
            self.assertTrue(deploy._prompt_yes_no("¿Continuar?", default=False))

    def test_exact_confirmation_retries_typo_and_supports_cancel(self):
        with patch("builtins.input", side_effect=["CONTINUAR ", "CONTINUR", "CONTINUAR"]):
            self.assertTrue(deploy._prompt_exact_confirmation("Escribe: ", "CONTINUAR", purpose="probar"))
        with patch("builtins.input", return_value="CANCELAR"):
            self.assertFalse(deploy._prompt_exact_confirmation("Escribe: ", "DEPLOY-TEST", purpose="probar"))

    def test_region_prompt_retries_invalid_region(self):
        class RegionRunner:
            def __init__(self):
                self.validated = []
            def az_json(self, args):
                if args == ["account", "list-locations"]:
                    return [{"name": "chilecentral"}, {"name": "brazilsouth"}]
                if args == ["provider", "show", "--namespace", "Microsoft.App"]:
                    return {"resourceTypes": [{"resourceType": "managedEnvironments", "locations": ["Chile Central", "Brazil South"]}]}
                if args == ["policy", "assignment", "list", "--only-show-errors"]:
                    return [{"parameters": {"listOfAllowedLocations": {"value": ["chilecentral", "brazilsouth"]}}}]
                raise AssertionError(args)

        with patch("builtins.input", side_effect=["chile-central-typo", "brazilsouth"]):
            self.assertEqual(deploy._prompt_region(RegionRunner(), "Región: ", "chilecentral", allowed_regions=["chilecentral", "brazilsouth"]), "brazilsouth")

    def test_neon_connection_prompt_retries_malformed_url_without_echoing_it(self):
        valid_url = _connection_url(
            "postgresql", "owner", "synthetic-password", "ep-test.us-east-1.aws.neon.tech", query="sslmode=require"
        )
        with patch.object(deploy.getpass, "getpass", side_effect=["not-a-postgresql-url", valid_url]):
            connection = deploy._prompt_neon_connection()
        self.assertEqual(connection.username, "owner")
        self.assertEqual(connection.database, "db")


    def test_neon_authentication_error_allows_reentering_connection(self):
        first = deploy.parse_neon_connection_url(
            _connection_url("postgresql", "owner", "wrong-password", "ep-test.us-east-1.aws.neon.tech", query="sslmode=require")
        )
        second = deploy.parse_neon_connection_url(
            _connection_url("postgresql", "owner", "correct-password", "ep-test.us-east-1.aws.neon.tech", query="sslmode=require")
        )
        with patch.object(deploy, "_prompt_neon_connection", side_effect=[first, second]) as prompt, patch.object(
            deploy, "preflight_neon", side_effect=[deploy.DeployError("FATAL: password authentication failed for user owner"), "fashionstore"]
        ):
            connection, state = deploy._prompt_and_preflight_neon(deploy.Runner())
        self.assertIs(connection, second)
        self.assertEqual(state, "fashionstore")
        self.assertEqual(prompt.call_count, 2)

    def test_neon_unknown_foreign_database_is_not_misclassified_as_typo(self):
        self.assertFalse(deploy._is_retryable_neon_connection_error(
            deploy.DeployError("La base Neon contiene tablas que no se reconocen como FashionStore")
        ))


class ExpressEnvironmentReuseTests(unittest.TestCase):
    def test_list_express_environments_filters_region_and_mode(self):
        express_id = "/subscriptions/sub/resourceGroups/rg-old/providers/Microsoft.App/managedEnvironments/env-express"
        class FakeRunner:
            def az_json(self, args):
                self.args = args
                return [
                    {"id": express_id, "name": "env-express", "location": "Chile Central",
                     "properties": {"environmentMode": "Express", "provisioningState": "Succeeded"}},
                    {"id": "/subscriptions/sub/resourceGroups/rg-managed/providers/Microsoft.App/managedEnvironments/env-managed",
                     "name": "env-managed", "location": "chilecentral",
                     "properties": {"environmentMode": "WorkloadProfiles", "provisioningState": "Succeeded"}},
                    {"id": "/subscriptions/sub/resourceGroups/rg-other/providers/Microsoft.App/managedEnvironments/env-brazil",
                     "name": "env-brazil", "location": "brazilsouth",
                     "properties": {"environmentMode": "Express", "provisioningState": "Succeeded"}},
                ]
        runner = FakeRunner()
        environments = deploy._list_express_environments(runner, "sub", "chilecentral")
        self.assertEqual(len(environments), 1)
        self.assertEqual(environments[0]["id"], express_id)
        self.assertEqual(environments[0]["resource_group"], "rg-old")
        self.assertEqual(runner.args[:4], ["containerapp", "env", "list", "--subscription"])

    def test_list_express_environments_uses_arm_when_cli_list_omits_mode(self):
        express_id = "/subscriptions/sub/resourceGroups/rg-existing/providers/Microsoft.App/managedEnvironments/env-express"
        class FakeRunner:
            def __init__(self):
                self.calls = []
            def az_json(self, args):
                self.calls.append(args)
                if args[0:3] == ["containerapp", "env", "list"]:
                    return [{"id": express_id, "name": "env-express", "location": "chilecentral", "properties": {}}]
                if args[0:2] == ["rest", "--method"]:
                    return {"properties": {"environmentMode": "Express", "provisioningState": "Succeeded"}}
                raise AssertionError(args)
        runner = FakeRunner()
        result = deploy._list_express_environments(runner, "sub", "chilecentral")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "env-express")
        self.assertEqual(result[0]["resource_group"], "rg-existing")
        self.assertEqual(len(runner.calls), 2)
        self.assertIn("api-version=2025-07-01", runner.calls[1][-1])

    def test_existing_environment_selection_retries_bad_choice(self):
        env = {"id": "/subscriptions/sub/resourceGroups/rg-old/providers/Microsoft.App/managedEnvironments/env-old",
              "name": "env-old", "resource_group": "rg-old", "location": "chilecentral", "provisioning_state": "succeeded"}
        with patch.object(deploy, "_list_express_environments", return_value=[env]), patch(
            "builtins.input", side_effect=["oops", "1"]
        ):
            location, selected = deploy._choose_express_environment(object(), "sub", "chilecentral", ["chilecentral", "brazilsouth"])
        self.assertEqual(location, "chilecentral")
        self.assertEqual(selected, env)

    def test_regional_express_quota_error_retries_in_another_allowed_region(self):
        class FakeRunner:
            def __init__(self):
                self.create_calls = []
                self.first = True
            def az_quiet(self, args):
                self.create_calls.append(list(args))
                if self.first:
                    self.first = False
                    raise deploy.DeployError("MaxNumberOfRegionalExpressEnvironmentsInSubExceeded")
            def az_json(self, args):
                if args[0:3] == ["containerapp", "env", "show"]:
                    return {"id": "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env-new"}
                raise AssertionError(args)

        runner = FakeRunner()
        state = {"resource_group": "rg", "status": "in_progress"}
        with patch.object(deploy, "_list_express_environments", return_value=[]), patch.object(
            deploy, "_prompt_region", return_value="brazilsouth"
        ), patch.object(deploy, "_choose_express_environment", return_value=("brazilsouth", None)), patch.object(
            deploy, "_resource_group_state"
        ):
            env_id, location, env_name = deploy._create_or_reuse_express_environment(
                runner,
                subscription_id="sub",
                resource_group="rg",
                environment_name="env-new",
                location="chilecentral",
                allowed_regions=["chilecentral", "brazilsouth"],
                existing_environment=None,
                state=state,
            )
        self.assertEqual(location, "brazilsouth")
        self.assertEqual(env_name, "env-new")
        self.assertIn("managedEnvironments/env-new", env_id)
        self.assertEqual(len(runner.create_calls), 2)
        self.assertIn("chilecentral", runner.create_calls[0])
        self.assertIn("brazilsouth", runner.create_calls[1])

    def test_deployment_state_history_keeps_metadata_but_never_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(deploy, "BUILD_STATE", Path(temp_dir) / "state.json"), patch.object(deploy, "BUILD_HISTORY", Path(temp_dir) / "history.json"):
                state = {
                    "run_id": "run-001", "status": "deployed", "resource_group": "rg-demo",
                    "web_url": "https://web.example.test", "groq_api_key": "DO_NOT_SAVE_THIS_KEY",
                    "database_seed_report": {"tables": 48, "rows": 347},
                }
                deploy._save_state(state)
                deploy._record_state_history(state)
                deploy._record_state_history({**state, "status": "deployed", "updated_at": "2026-11-11T10:00:00+00:00"})
                latest = json.loads((Path(temp_dir) / "state.json").read_text(encoding="utf-8"))
                history = json.loads((Path(temp_dir) / "history.json").read_text(encoding="utf-8"))
                encoded = json.dumps(history)
                self.assertEqual(latest["resource_group"], "rg-demo")
                self.assertEqual(len(history), 1)
                self.assertIn("database_seed_report", history[0])
                self.assertNotIn("DO_NOT_SAVE_THIS_KEY", encoded)
                self.assertNotIn("groq_api_key", encoded)


class NeonBootstrapTests(unittest.TestCase):
    def test_reusing_prepared_neon_skips_schema_migrations_and_seed(self) -> None:
        owner = deploy.parse_neon_connection_url(
            _connection_url("postgresql", "owner", "password", "ep-test.us-east-1.aws.neon.tech", query="sslmode=require")
        )
        runner = deploy.Runner()
        report = {
            "tables": 48,
            "rows": 347,
            "demo_users_active_and_password_verified": 5,
            "table_row_counts": {"usuarios": 5},
        }
        with patch.object(deploy, "_neon_state", return_value="fashionstore"), patch.object(
            deploy.shutil, "which", return_value="/usr/bin/psql"
        ), patch.object(deploy, "_psql", side_effect=["", "5"]) as psql, patch.object(
            deploy, "verify_restored_data", return_value=report
        ):
            runtime_url, runtime_password, verified_report = deploy.prepare_neon_database(
                runner, owner, reuse_existing=True, app_password="SYNTHETIC_RUNTIME_PASSWORD"
            )
        self.assertEqual(verified_report["tables"], 48)
        self.assertEqual(verified_report["demo_users_active_and_password_verified"], 5)
        self.assertEqual(runtime_password, "SYNTHETIC_RUNTIME_PASSWORD")
        self.assertIn("fashionstore_app", runtime_url)
        # The only two psql calls are runtime-role provisioning and the read-only
        # access check; schema.sql, migrations and seed.sql are not re-applied.
        self.assertEqual(psql.call_count, 2)
        self.assertIn("FASHIONSTORE_APP_PASSWORD", psql.call_args_list[0].kwargs["extra_env"])

    def test_bootstrap_only_provisions_runtime_role_and_never_mutates_demo_users(self) -> None:
        sql = deploy.build_database_bootstrap_sql()
        self.assertTrue(sql.startswith("BEGIN;\n\\getenv app_password FASHIONSTORE_APP_PASSWORD"))
        self.assertIn("\\gexec", sql)
        self.assertIn("ALTER ROLE fashionstore_app", sql)
        self.assertIn("CREATE ROLE fashionstore_app", sql)
        alter_clause = sql.split("THEN 'ALTER ROLE fashionstore_app", 1)[1].split("'", 1)[0]
        self.assertNotIn("SUPERUSER", alter_clause)
        self.assertIn("NOSUPERUSER", sql.split("ELSE 'CREATE ROLE fashionstore_app", 1)[1])
        self.assertIn("rolsuper", sql)
        self.assertIn("GRANT app_runtime TO fashionstore_app", sql)
        self.assertNotIn("UPDATE public.usuarios", sql)
        self.assertNotIn("SET activo = FALSE", sql)
        self.assertNotIn("FASHIONSTORE_ADMIN_PASSWORD", sql)
        self.assertNotIn("Fashion2026!", sql)


    def test_tenant_migration_does_not_alter_superuser_attribute_on_neon(self) -> None:
        migration = (ROOT / "database" / "migrations" / "005_tenant_isolation.sql").read_text(encoding="utf-8")
        role_statements = [
            line.strip() for line in migration.splitlines()
            if line.strip().upper().startswith("ALTER ROLE APP_")
        ]
        self.assertEqual(len(role_statements), 2)
        for statement in role_statements:
            self.assertNotIn("SUPERUSER", statement.upper())
            self.assertIn("NOLOGIN", statement.upper())
            self.assertIn("NOBYPASSRLS", statement.upper())
        self.assertIn("rolsuper", migration)
        self.assertIn("rolbypassrls", migration)

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
    if (sql.startsWith('SELECT format(')) return {rows:[{command:\"ALTER ROLE fashionstore_app WITH LOGIN PASSWORD 'quoted-by-server' NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS\"}]};
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

            records = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
            config = next(item["config"] for item in records if item.get("kind") == "config")
            self.assertEqual(config["ssl"], {"rejectUnauthorized": True})
            self.assertNotIn("sslmode=", config["connectionString"])
            queries = [item for item in records if item.get("kind") == "query"]
            role_password_query = next(item for item in queries if item["sql"].startswith("SELECT format("))
            self.assertEqual(role_password_query["params"], [env["FS_APP_PASSWORD"]])
            self.assertNotIn(env["FS_APP_PASSWORD"], role_password_query["sql"])
            self.assertNotIn("NOSUPERUSER", role_password_query["sql"])
            self.assertTrue(any("rolsuper" in item["sql"] for item in queries))
            self.assertFalse(any("UPDATE public.usuarios" in item["sql"] for item in queries))
            self.assertFalse(any("activo = FALSE" in item["sql"] for item in queries))

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

    def test_neon_state_distinguishes_empty_fashionstore_and_foreign(self) -> None:
        conn = deploy.parse_neon_connection_url(
            _connection_url("postgresql", "owner", "pass", "ep-a.us-east-1.aws.neon.tech", query="sslmode=require")
        )
        for value in ("empty", "fashionstore"):
            with patch.object(deploy, "_psql_value", return_value=value):
                self.assertEqual(deploy._neon_empty_state(deploy.Runner(), conn), value)
        with patch.object(deploy, "_psql_value", return_value="foreign"):
            with self.assertRaisesRegex(deploy.DeployError, "tablas que no se reconocen"):
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

    def test_seed_demo_accounts_are_preserved_and_shared_with_local_setup(self) -> None:
        local = (ROOT / "iniciar.py").read_text(encoding="utf-8")
        seed = (ROOT / "database" / "seed.sql").read_text(encoding="utf-8")
        self.assertIn("Fashion2026!", local)
        self.assertIn("crypt('Fashion2026!'", seed)
        self.assertEqual(len(deploy.SEED_USERS), 5)
        self.assertEqual(deploy.SEED_PASSWORD, "Fashion2026!")
        self.assertIn("RESTABLECER-DEMO", (ROOT / "tools" / "deploy_azure.py").read_text(encoding="utf-8"))



class GHCRImageTests(unittest.TestCase):
    def test_package_owner_typo_can_be_corrected_without_restarting_assistant(self):
        fake_images = {"ai": "ghcr.io/owner/fashionstore-ai:latest"}
        with patch.object(deploy, "check_public_ghcr_images", side_effect=[
            deploy.DeployError("La imagen wrong/fashionstore-ai:latest no existe o no es pública."),
            fake_images,
        ]), patch("builtins.input", side_effect=["correct-owner"]):
            owner, images = deploy._check_ghcr_images_with_retry("wrong")
        self.assertEqual(owner, "correct-owner")
        self.assertEqual(images, fake_images)

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

    def test_both_llm_keys_are_container_app_secret_references(self) -> None:
        groq_key = "gsk_" + "g" * 35
        gemini_key = "AQ.Ab8RN6KzvT-" + "m" * 35
        env, secrets = deploy._llm_secret_config({"groq": groq_key, "gemini": gemini_key})
        self.assertEqual({item["name"] for item in env}, {"GROQ_API_KEY", "GEMINI_API_KEY"})
        self.assertEqual(secrets, {"groq-api-key": groq_key, "gemini-api-key": gemini_key})
        self.assertEqual(deploy._llm_secret_config(None), ([], {}))
        with self.assertRaises(deploy.DeployError):
            deploy._llm_secret_config({"other": "SYNTHETIC_KEY"})

    def test_accepts_new_gemini_aq_key_and_stripe_restricted_test_key(self) -> None:
        # Synthetic keys only: validate both prefixes without contacting either provider.
        gemini_key = "AQ.Ab8RN6KzvT-" + "x" * 28
        stripe_key = "rk_test_" + "s" * 32
        self.assertTrue(deploy._is_gemini_api_key(gemini_key))
        self.assertTrue(deploy._is_stripe_test_api_key(stripe_key))
        self.assertFalse(deploy._is_groq_api_key(stripe_key))
        self.assertFalse(deploy._is_gemini_api_key(stripe_key))
        env, secrets = deploy._llm_secret_config({"gemini": gemini_key})
        self.assertEqual(secrets["gemini-api-key"], gemini_key)
        self.assertEqual(env[0]["name"], "GEMINI_API_KEY")
        with self.assertRaises(deploy.DeployError):
            deploy._llm_secret_config({"groq": stripe_key})

    def test_stripe_key_pasted_at_groq_prompt_does_not_abort_deploy_or_misconfigure_groq(self) -> None:
        stripe_key = "rk_test_" + "s" * 32
        gemini_key = "AQ.Ab8RN6KzvT-" + "x" * 28
        with patch("builtins.input", side_effect=["s", "s"]), patch.object(
            deploy.getpass, "getpass", side_effect=[stripe_key, gemini_key]
        ):
            credentials = deploy._read_optional_llm_credentials()
        self.assertEqual(credentials, {"gemini": gemini_key})

    def test_gemini_key_pasted_at_groq_prompt_is_routed_to_gemini(self) -> None:
        gemini_key = "AQ.Ab8RN6KzvT-" + "x" * 28
        with patch("builtins.input", side_effect=["s"]), patch.object(
            deploy.getpass, "getpass", return_value=gemini_key
        ):
            credentials = deploy._read_optional_llm_credentials()
        self.assertEqual(credentials, {"gemini": gemini_key})

    def test_fastapi_payload_references_optional_llm_key_as_aca_secret(self) -> None:
        key = "AQ.Ab8RN6KzvT-" + "m" * 35
        groq_key = "gsk_" + "g" * 35
        payload = deploy._fastapi_containerapp_payload(
            location="eastus",
            environment_id="/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env",
            image="ghcr.io/fashionstoreorg/fashionstore-ai:latest",
            app_database_url="postgresql://synthetic",
            ia_key="SYNTHETIC_INTERNAL_KEY",
            llm_credentials={"gemini": "AQ.Ab8RN6KzvT-" + "m" * 35, "groq": "gsk_" + "g" * 35},
        )
        configuration = payload["properties"]["configuration"]
        secrets = {item["name"]: item["value"] for item in configuration["secrets"]}
        env = {item["name"]: item for item in payload["properties"]["template"]["containers"][0]["env"]}
        self.assertEqual(secrets["gemini-api-key"], key)
        self.assertEqual(secrets["groq-api-key"], groq_key)
        self.assertEqual(env["GEMINI_API_KEY"]["secretRef"], "gemini-api-key")
        self.assertEqual(env["GROQ_API_KEY"]["secretRef"], "groq-api-key")
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

    def test_optional_llm_keys_can_skip_or_configure_both(self) -> None:
        with patch("builtins.input", side_effect=["n", "n"]):
            self.assertEqual(deploy._read_optional_llm_credentials(), {})
        groq_key = "gsk_" + "x" * 32
        gemini_key = "AQ.Ab8RN6KzvT-" + "y" * 32
        with patch("builtins.input", side_effect=["s", "s"]), patch.object(deploy.getpass, "getpass", side_effect=[groq_key, gemini_key]):
            self.assertEqual(deploy._read_optional_llm_credentials(), {"groq": groq_key, "gemini": gemini_key})

    def test_invalid_ai_key_can_be_corrected_without_aborting(self) -> None:
        groq_key = "gsk_" + "x" * 32
        with patch("builtins.input", side_effect=["s", "n"]), patch.object(
            deploy.getpass, "getpass", side_effect=["not-a-real-key", groq_key]
        ):
            self.assertEqual(deploy._read_optional_llm_credentials(), {"groq": groq_key})

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

    def test_windows_runner_uses_local_cmd_call_and_preserves_arguments(self) -> None:
        runner = deploy.Runner()
        az_cmd = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
        comspec = r"C:\Windows\System32\cmd.exe"
        expected_args = [
            "containerapp", "env", "create", "--location", "East US",
            "--body", r"@C:\Users\Test User\AppData\Local\Temp\payload.json",
        ]
        completed = subprocess.CompletedProcess(args=[], returncode=0, stdout="OK", stderr="WARNING: harmless extension notice")

        def which(name):
            if name == "az":
                return az_cmd
            if name == "cmd.exe":
                return comspec
            return None

        def isfile(path):
            return str(path).lower() == comspec.lower()

        with patch.object(deploy.os, "name", "nt"), patch.object(deploy.os.path, "isfile", side_effect=isfile), patch.object(
            deploy.shutil, "which", side_effect=which
        ), patch.object(deploy.subprocess, "run", return_value=completed) as run:
            self.assertEqual(runner.run(["az", *expected_args], quiet=True), "OK")

        command = run.call_args.args[0]
        self.assertIsInstance(command, str)
        self.assertTrue(command.startswith('"' + comspec + '" /d /c call '))
        self.assertIn('"' + az_cmd + '"', command)
        self.assertIn('"East US"', command)
        self.assertIn('"@C:\\Users\\Test User\\AppData\\Local\\Temp\\payload.json"', command)
        self.assertNotIn("/s", command)
        self.assertNotIn("powershell", command.lower())
        self.assertNotIn("FASHIONSTORE_AZ_ARGS_JSON", run.call_args.kwargs["env"])
        self.assertEqual(run.call_args.kwargs["env"]["COMSPEC"], comspec)
        # Azure CLI inherits the working directory already set by the launcher BAT.
        self.assertIsNone(run.call_args.kwargs["cwd"])

    def test_windows_runner_ignores_unc_comspec_and_uses_local_system_cmd(self) -> None:
        az_cmd = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
        local_cmd = r"C:\Windows\System32\cmd.exe"
        network_comspec = r"\\server\share\cmd.exe"

        def which(name):
            if name == "az":
                return az_cmd
            if name == "cmd.exe":
                return network_comspec
            return None

        def isfile(path):
            return str(path).lower() == local_cmd.lower()

        env = {"SystemRoot": r"C:\Windows", "COMSPEC": network_comspec}
        with patch.object(deploy.os, "name", "nt"), patch.object(deploy.os.path, "isfile", side_effect=isfile), patch.object(
            deploy.shutil, "which", side_effect=which
        ):
            command = deploy.Runner._windows_az_command(["account", "list"], env)
        self.assertIsInstance(command, str)
        self.assertTrue(command.startswith('"' + local_cmd + '" /d /c call '))
        self.assertEqual(env["COMSPEC"], local_cmd)

    def test_runner_keeps_successful_azure_stderr_out_of_structured_stdout(self) -> None:
        runner = deploy.Runner()
        completed = subprocess.CompletedProcess(
            args=[], returncode=0,
            stdout='{"id":"/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env"}',
            stderr="WARNING: extension preview notice",
        )
        with patch.object(deploy.subprocess, "run", return_value=completed):
            output = runner.run(["az", "containerapp", "env", "show"], quiet=True)
        self.assertTrue(output.startswith('{"id":'))
        self.assertNotIn("WARNING", output)

    def test_managed_environment_id_rejects_clixml_and_wrong_subscription(self) -> None:
        valid = "/subscriptions/sub-123/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env"
        self.assertEqual(deploy._validate_managed_environment_id(valid, "sub-123"), valid)
        with self.assertRaisesRegex(deploy.DeployError, "ID de Container Apps Environment inválido"):
            deploy._validate_managed_environment_id("<Objs Version=\"1.1.0.1\">CLIXML</Objs>", "sub-123")
        with self.assertRaisesRegex(deploy.DeployError, "otra suscripción"):
            deploy._validate_managed_environment_id(valid, "another-sub")

    def test_wait_containerapp_uses_json_provisioning_state_not_tsv_stderr(self) -> None:
        class JsonRunner:
            def __init__(self):
                self.calls = 0
            def az_json(self, args):
                self.calls += 1
                return {"properties": {"provisioningState": "Succeeded"}}
        runner = JsonRunner()
        with patch.object(deploy.time, "sleep") as sleep:
            deploy._wait_containerapp(runner, "fashionstore-ai-test", "rg-test", attempts=1)
        self.assertEqual(runner.calls, 1)
        sleep.assert_not_called()

    def test_wait_containerapp_stops_with_actionable_failed_state(self) -> None:
        class JsonRunner:
            def az_json(self, args):
                return {"properties": {"provisioningState": "Failed", "deploymentErrors": "ImagePullFailed"}}
        with self.assertRaisesRegex(deploy.DeployError, "ImagePullFailed"):
            deploy._wait_containerapp(JsonRunner(), "fashionstore-ai-test", "rg-test", attempts=1)

    def test_wait_containerapp_reports_repeated_query_errors_without_clixml_state(self) -> None:
        class BrokenRunner:
            def az_json(self, args):
                raise deploy.DeployError("Falló az (código 1). Salida saneada: WARNING: extension notice")
        with patch.object(deploy.time, "sleep"):
            with self.assertRaisesRegex(deploy.DeployError, "No se pudo consultar de forma fiable") as error:
                deploy._wait_containerapp(BrokenRunner(), "fashionstore-ai-test", "rg-test", attempts=8)
        self.assertNotIn("<Objs", str(error.exception))

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
        self.assertIn('"--environment-mode", "express"', source)
        self.assertIn('"--logs-destination", "none"', source)
        self.assertIn('"container_apps_mode": "express"', source)
        self.assertIn("_list_express_environments", source)
        self.assertIn("MaxNumberOfRegionalExpressEnvironmentsInSubExceeded", source)
        self.assertNotIn("az acr", source.lower())

    def test_ghcr_requires_explicit_confirmation_before_side_effects(self) -> None:
        source = (ROOT / "tools" / "deploy_azure.py").read_text(encoding="utf-8")
        main_source = source[source.index("def main() -> int:"):]
        self.assertLess(
            main_source.index('_prompt_yes_no("¿Confirmas usar GHCR'),
            main_source.index("_subscription("),
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
        self.assertNotIn("UPDATE public.usuarios", source)
        self.assertNotIn("FS_ADMIN_PASSWORD", source)


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


class SavedDeploymentProfileTests(unittest.TestCase):
    def test_profile_persists_editable_settings_and_encrypts_secrets_in_same_file(self):
        with tempfile.TemporaryDirectory() as directory:
            profile_path = Path(directory) / "deploy-profile.json"
            with patch.object(deploy, "DEPLOY_PROFILE", profile_path), patch.object(
                deploy, "_supports_dpapi", return_value=True
            ), patch.object(deploy, "_dpapi_protect", return_value="SYNTHETIC_CIPHERTEXT"):
                deploy._save_deploy_profile(
                    {"settings": {"subscription_id": "sub-id", "location": "chilecentral", "ghcr_owner": "matachecheche"}},
                    {"neon_url": "postgresql://synthetic-secret", "llm_credentials": {"gemini": "AQ.synthetic-secret"}},
                )
            saved = json.loads(profile_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["settings"]["subscription_id"], "sub-id")
            self.assertEqual(saved["secret_protection"], "Windows DPAPI / CurrentUser")
            self.assertEqual(saved["secrets_protected"], "SYNTHETIC_CIPHERTEXT")
            raw = profile_path.read_text(encoding="utf-8")
            self.assertNotIn("postgresql://synthetic-secret", raw)
            self.assertNotIn("AQ.synthetic-secret", raw)

    def test_profile_load_decrypts_saved_secret_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            profile_path = Path(directory) / "deploy-profile.json"
            profile_path.write_text(json.dumps({
                "settings": {"location": "chilecentral"},
                "secrets_protected": "SYNTHETIC_CIPHERTEXT",
            }), encoding="utf-8")
            payload = json.dumps({"neon_url": "postgresql://synthetic", "llm_credentials": {}}).encode()
            with patch.object(deploy, "DEPLOY_PROFILE", profile_path), patch.object(
                deploy, "_dpapi_unprotect", return_value=payload
            ):
                profile, secrets_data = deploy._load_deploy_profile()
            self.assertEqual(profile["settings"]["location"], "chilecentral")
            self.assertEqual(secrets_data["neon_url"], "postgresql://synthetic")

    def test_fast_profile_menu_is_default_and_does_not_need_manual_reentry(self):
        profile = {"settings": {"subscription_id": "sub", "location": "chilecentral", "ghcr_owner": "matachecheche"}}
        with patch("builtins.input", return_value=""):
            self.assertEqual(deploy._select_profile_mode(profile), "quick")

    def test_fast_mode_reuses_saved_llm_keys_without_prompting(self):
        groq = "gsk_" + "g" * 35
        gemini = "AQ.Ab8RN6KzvT-" + "m" * 35
        with patch("builtins.input") as input_mock, patch.object(deploy.getpass, "getpass") as getpass_mock:
            credentials = deploy._read_optional_llm_credentials(
                {"groq": groq, "gemini": gemini}, auto_use_saved=True
            )
        self.assertEqual(credentials, {"groq": groq, "gemini": gemini})
        input_mock.assert_not_called()
        getpass_mock.assert_not_called()

    def test_fast_mode_keeps_previously_omitted_llm_providers_omitted(self):
        with patch("builtins.input") as input_mock, patch.object(deploy.getpass, "getpass") as getpass_mock:
            credentials = deploy._read_optional_llm_credentials({}, auto_use_saved=True)
        self.assertEqual(credentials, {})
        input_mock.assert_not_called()
        getpass_mock.assert_not_called()

    def test_profile_selected_llm_provider_is_preselected_when_secret_needs_entering(self):
        gemini = "AQ.Ab8RN6KzvT-" + "p" * 35
        with patch("builtins.input", return_value=""), patch.object(deploy.getpass, "getpass", return_value=gemini):
            credentials = deploy._read_optional_llm_credentials(
                {}, auto_use_saved=True, preferred_providers=["gemini"]
            )
        self.assertEqual(credentials, {"gemini": gemini})

    def test_fast_mode_selects_saved_express_environment(self):
        saved = {
            "id": "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/managedEnvironments/env-saved",
            "name": "env-saved", "resource_group": "rg", "location": "chilecentral", "provisioning_state": "succeeded",
        }
        with patch.object(deploy, "_list_express_environments", return_value=[saved]):
            location, selected = deploy._choose_express_environment(
                object(), "sub", "chilecentral", ["chilecentral"],
                preferred_environment_id=saved["id"], auto_select=True,
            )
        self.assertEqual(location, "chilecentral")
        self.assertEqual(selected["name"], "env-saved")

    def test_subscription_auto_selects_saved_id_without_prompting(self):
        class ProfileRunner:
            def __init__(self):
                self.active = ""
            def az_json(self, args):
                if args == ["account", "list"]:
                    return [{"id": "sub-saved", "name": "Azure Students", "state": "Enabled"}]
                if args == ["account", "show"]:
                    return {"id": self.active}
                raise AssertionError(args)
            def az_quiet(self, args):
                self.active = args[args.index("--subscription") + 1]
        runner = ProfileRunner()
        with patch("builtins.input") as input_mock:
            result = deploy._subscription(runner, "sub-saved", auto_select=True)
        self.assertEqual(result, ("sub-saved", "Azure Students"))
        input_mock.assert_not_called()



if __name__ == "__main__":
    unittest.main()
