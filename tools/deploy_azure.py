#!/usr/bin/env python3
"""Flujo asistido de FashionStore: Neon + Azure Container Apps + Stripe test.

El BAT comprueba herramientas e inicia sesión Azure; este script pide la URL Neon
localmente, prepara solo una base vacía y despliega imágenes públicas desde GHCR. No
crea ACR ni guarda credenciales de registry en el repo o archivo de estado. Azure aún
puede generar cargos de consumo y egress.
"""
from __future__ import annotations

import base64
import getpass
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Iterable, Sequence

ROOT = Path(__file__).resolve().parents[1]
CLOUD_SQL_SCRIPT = ROOT / "tools" / "cloud_sql.js"
NEST_DIR = ROOT / "backend-nest"
BUILD_STATE = ROOT / "builds" / "azure-test-deployment.json"
NEON_CONSOLE = "https://console.neon.tech/"
STRIPE_TEST_WEBHOOKS = "https://dashboard.stripe.com/test/webhooks"
ARM_CONTAINERAPPS_API_VERSION = "2025-07-01"
REQUIRED_MIGRATIONS = (
    "003_offline_sync.sql",
    "004_offline_reservations.sql",
    "005_tenant_isolation.sql",
    "006_tenant_email_uniqueness.sql",
    "007_catalog_sync_feed.sql",
    "008_subscription_requests.sql",
    "009_tenant_onboarding.sql",
    "010_saas_sync_payments_ml.sql",
)
GHCR_TAG = "latest"
GHCR_PACKAGES = {
    "ai": "fashionstore-ai",
    "api": "fashionstore-api",
    "web": "fashionstore-web",
}


class DeployError(RuntimeError):
    """Expected, user-actionable failure in the assisted deploy."""


@dataclass(frozen=True)
class NeonConnection:
    original_url: str
    host: str
    port: int
    username: str
    password: str
    database: str
    query: tuple[tuple[str, str], ...]


def parse_neon_connection_url(value: str) -> NeonConnection:
    """Validate an unpooled Neon PostgreSQL URL without echoing its credentials."""
    raw = str(value or "").strip()
    try:
        parsed = urllib.parse.urlsplit(raw)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise ValueError("scheme")
        if not parsed.hostname or not parsed.username or not parsed.password:
            raise ValueError("auth")
        host = parsed.hostname.lower()
        if not host.endswith(".neon.tech"):
            raise ValueError("host")
        first_label = host.split(".", 1)[0]
        if first_label.endswith("-pooler"):
            raise ValueError("pooled owner")
        database = urllib.parse.unquote(parsed.path.lstrip("/"))
        if not database:
            raise ValueError("database")
        port = parsed.port or 5432
        if not 1 <= port <= 65535:
            raise ValueError("port")
        query = tuple(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
        params = dict(query)
        sslmode = params.get("sslmode", "require").lower()
        if sslmode not in {"require", "verify-ca", "verify-full"}:
            raise ValueError("ssl")
        return NeonConnection(
            original_url=raw,
            host=host,
            port=port,
            username=urllib.parse.unquote(parsed.username),
            password=urllib.parse.unquote(parsed.password),
            database=database,
            query=query,
        )
    except Exception as exc:
        raise DeployError(
            "La URL debe ser PostgreSQL de Neon, conexión directa/no pooler, con usuario, contraseña, base y TLS (sslmode=require)."
        ) from exc


def _pooled_host(host: str) -> str:
    """Return the Neon PgBouncer endpoint for runtime connections where recognizable."""
    first, dot, rest = host.partition(".")
    if first.startswith("ep-") and not first.endswith("-pooler") and dot:
        return f"{first}-pooler.{rest}"
    return host


def build_app_database_url(owner: NeonConnection, role: str, password: str) -> str:
    """Build a TLS URL for the least-privileged runtime role, using Neon pooler."""
    host = _pooled_host(owner.host)
    username = urllib.parse.quote(role, safe="")
    encoded_password = urllib.parse.quote(password, safe="")
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    netloc = f"{username}:{encoded_password}@{host}"
    if owner.port != 5432:
        netloc += f":{owner.port}"
    params = dict(owner.query)
    params["sslmode"] = "require"
    query = urllib.parse.urlencode(list(params.items()))
    path = "/" + urllib.parse.quote(owner.database, safe="")
    return urllib.parse.urlunsplit(("postgresql", netloc, path, query, ""))


def _redact(text: str, sensitive: Iterable[str]) -> str:
    result = str(text or "")
    for value in sorted({str(item) for item in sensitive if item}, key=len, reverse=True):
        result = result.replace(value, "[REDACTED]")
    return result


def _json_from_cli_output(output: str) -> object:
    """Parse Azure CLI JSON even when a harmless warning surrounds the payload."""
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        positions: list[int] = []
        for marker in ("[", "{"):
            position = output.find(marker)
            while position >= 0:
                positions.append(position)
                position = output.find(marker, position + 1)
        for position in sorted(set(positions)):
            try:
                value, _end = decoder.raw_decode(output[position:])
                return value
            except json.JSONDecodeError:
                continue
    raise DeployError("Azure CLI no devolvió JSON válido para una consulta de control.")


class Runner:
    """Run local tools quietly, redact child-process output, and avoid shell interpolation."""

    def __init__(self) -> None:
        self.sensitive: list[str] = []

    def add_sensitive(self, *values: str) -> None:
        self.sensitive.extend(str(value) for value in values if value)

    def run(
        self,
        command: Sequence[str],
        *,
        quiet: bool = False,
        cwd: Path | None = None,
        extra_env: dict[str, str] | None = None,
    ) -> str:
        cmd = [str(value) for value in command]
        env = os.environ.copy()
        if extra_env:
            env.update(extra_env)

        if os.name == "nt" and cmd and cmd[0] == "az":
            # Azure CLI on Windows is commonly installed as az.cmd. Pass arguments as
            # a JSON environment value to PowerShell, never interpolate them as script.
            powershell = shutil.which("powershell.exe") or shutil.which("pwsh.exe")
            if not powershell:
                raise DeployError("No se encontró PowerShell para invocar Azure CLI en Windows.")
            env["FASHIONSTORE_AZ_ARGS_JSON"] = json.dumps(cmd[1:], ensure_ascii=False)
            script = (
                "$azArgs = @(ConvertFrom-Json -InputObject $env:FASHIONSTORE_AZ_ARGS_JSON); "
                "& az @azArgs 2>&1; exit $LASTEXITCODE"
            )
            encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
            actual = [powershell, "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]
        else:
            actual = cmd

        try:
            completed = subprocess.run(
                actual,
                cwd=str(cwd or ROOT),
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=False,
            )
        except OSError as exc:
            raise DeployError(f"No se pudo ejecutar {cmd[0]}: {exc}") from exc

        output = _redact(completed.stdout, self.sensitive).strip()
        if completed.returncode != 0:
            detail = output[-5000:] if output else "sin detalle del proceso"
            raise DeployError(f"Falló {cmd[0]} (código {completed.returncode}). Salida saneada:\n{detail}")
        if not quiet and output:
            print(output)
        return output

    def az_json(self, args: Sequence[str]) -> object:
        output = self.run(["az", *args, "--output", "json"], quiet=True)
        return _json_from_cli_output(output)

    def az_quiet(self, args: Sequence[str]) -> None:
        self.run(["az", *args, "--output", "none"], quiet=True)


def _psql_env(connection: NeonConnection) -> dict[str, str]:
    env = {
        "PGHOST": connection.host,
        "PGPORT": str(connection.port),
        "PGUSER": connection.username,
        "PGPASSWORD": connection.password,
        "PGDATABASE": connection.database,
        "PGSSLMODE": "require",
    }
    params = dict(connection.query)
    for source, target in (
        ("channel_binding", "PGCHANNELBINDING"),
        ("application_name", "PGAPPNAME"),
        ("connect_timeout", "PGCONNECT_TIMEOUT"),
        ("options", "PGOPTIONS"),
    ):
        if params.get(source):
            env[target] = params[source]
    return env


def _psql(
    runner: Runner,
    args: Sequence[str],
    connection: NeonConnection,
    extra_env: dict[str, str] | None = None,
    *,
    quiet: bool = True,
) -> str:
    executable = shutil.which("psql")
    if not executable:
        raise DeployError("Falta psql. Instala PostgreSQL Command Line Tools; no hace falta un servidor local.")
    env = os.environ.copy()
    env.update(_psql_env(connection))
    if extra_env:
        env.update(extra_env)
    command = [executable, "--no-psqlrc", "--set", "ON_ERROR_STOP=1", *args]
    # The password and full DSN stay out of psql's arguments and terminal output.
    return runner.run(command, quiet=quiet, extra_env=env)


def _node_pg_available() -> bool:
    """Check whether Node can resolve the backend's existing `pg` dependency."""
    node = shutil.which("node")
    if not node or not CLOUD_SQL_SCRIPT.is_file():
        return False
    check = (
        "try { require.resolve('pg', { paths: [process.argv[1]] }); } "
        "catch (_error) { process.exit(1); }"
    )
    try:
        result = subprocess.run(
            [node, "-e", check, str(NEST_DIR)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def _sql_driver() -> str | None:
    """Prefer psql; fall back to the pg package already used by NestJS."""
    if shutil.which("psql"):
        return "psql"
    if _node_pg_available():
        return "node"
    return None


def _cloud_sql(
    runner: Runner,
    connection: NeonConnection,
    command: str,
    *args: str,
    extra_env: dict[str, str] | None = None,
) -> str:
    node = shutil.which("node")
    if not node or not CLOUD_SQL_SCRIPT.is_file() or not _node_pg_available():
        raise DeployError(
            "No hay cliente SQL disponible. Instala PostgreSQL Command Line Tools (psql), "
            "o instala Node.js y las dependencias Nest con `cd backend-nest && npm ci`."
        )
    env = {
        "DATABASE_URL": connection.original_url,
        "FS_BACKEND_DIR": str(NEST_DIR),
    }
    if extra_env:
        env.update(extra_env)
        runner.add_sensitive(*extra_env.values())
    runner.add_sensitive(connection.original_url, connection.password)
    return runner.run([node, str(CLOUD_SQL_SCRIPT), command, *args], quiet=True, extra_env=env)


def _psql_value(runner: Runner, connection: NeonConnection, sql: str) -> str:
    if shutil.which("psql"):
        return _psql(
            runner,
            ["--tuples-only", "--no-align", "--command", sql],
            connection,
            quiet=True,
        ).strip()
    raw = _cloud_sql(runner, connection, "scalar", sql)
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise DeployError("El ayudante SQL no devolvió un valor escalar válido.") from exc
    return "" if value is None else str(value)


def _neon_empty_state(runner: Runner, connection: NeonConnection) -> None:
    empty = _psql_value(
        runner,
        connection,
        """SELECT CASE
             WHEN to_regclass('public.meta') IS NOT NULL THEN 'not_empty'
             WHEN EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_class c
                 JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
                  AND c.relname NOT LIKE 'pg_%'
             ) THEN 'not_empty'
             ELSE 'empty'
           END""",
    )
    if empty != "empty":
        raise DeployError(
            "La base Neon no está vacía. Usa una base/branch NUEVA; el asistente no repite seed ni modifica datos existentes."
        )
    role_exists = _psql_value(
        runner,
        connection,
        "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fashionstore_app') THEN 'yes' ELSE 'no' END",
    )
    if role_exists != "no":
        raise DeployError(
            "Ya existe el rol global fashionstore_app en este proyecto Neon. Usa un proyecto Neon de prueba nuevo."
        )


def preflight_neon(runner: Runner, connection: NeonConnection) -> None:
    """Non-mutating check before asking the user to initialize Neon."""
    if not _sql_driver():
        raise DeployError(
            "Falta un cliente SQL: instala PostgreSQL Command Line Tools (psql), "
            "o Node.js con las dependencias de backend-nest instaladas (`cd backend-nest && npm ci`)."
        )
    _neon_empty_state(runner, connection)
    print("Conexión Neon correcta; la base está vacía y lista para preparar.")


def _new_hex_secret() -> str:
    return secrets.token_hex(32)


def _read_new_secret(prompt: str, *, minimum: int = 16, forbidden: Iterable[str] = ()) -> str:
    forbidden_values = {str(item).casefold() for item in forbidden}
    while True:
        value = getpass.getpass(prompt)
        if value.casefold() in forbidden_values:
            print("No reutilices la contraseña semilla de demostración.")
            continue
        if len(value) < minimum:
            print(f"Usa al menos {minimum} caracteres.")
            continue
        confirmation = getpass.getpass("Repite el valor: ")
        if value != confirmation:
            print("No coinciden; intenta otra vez.")
            continue
        return value


def _make_private_temp_json(payload: object) -> Path:
    fd, raw_path = tempfile.mkstemp(prefix="fashionstore-azure-", suffix=".json")
    path = Path(raw_path)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise


def _write_private_temp_text(content: str, suffix: str) -> Path:
    fd, raw_path = tempfile.mkstemp(prefix="fashionstore-", suffix=suffix)
    path = Path(raw_path)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise


def _containerapp_uri(subscription_id: str, resource_group: str, name: str) -> str:
    encoded_rg = urllib.parse.quote(resource_group, safe="")
    encoded_name = urllib.parse.quote(name, safe="")
    return (
        "https://management.azure.com/subscriptions/"
        f"{urllib.parse.quote(subscription_id, safe='')}/resourceGroups/{encoded_rg}"
        f"/providers/Microsoft.App/containerApps/{encoded_name}"
        f"?api-version={ARM_CONTAINERAPPS_API_VERSION}"
    )


def _arm_containerapp_request(
    runner: Runner,
    method: str,
    subscription_id: str,
    resource_group: str,
    name: str,
    payload: dict,
) -> None:
    """Send a Container Apps ARM body from a short-lived local JSON file.

    In particular, secret values never appear in Azure CLI arguments or shell history.
    """
    path = _make_private_temp_json(payload)
    try:
        runner.az_quiet(
            [
                "rest",
                "--method",
                method.lower(),
                "--url",
                _containerapp_uri(subscription_id, resource_group, name),
                "--headers",
                "Content-Type=application/json",
                "--body",
                "@" + str(path),
            ]
        )
    finally:
        path.unlink(missing_ok=True)


def _secret_refs(secrets_by_name: dict[str, str]) -> list[dict[str, str]]:
    # ACA secret names are intentionally short, lowercase, and nonsecret.
    return [{"name": name, "value": value} for name, value in secrets_by_name.items()]


def _env_value(name: str, value: str) -> dict[str, str]:
    return {"name": name, "value": str(value)}


def _env_secret(name: str, secret_name: str) -> dict[str, str]:
    return {"name": name, "secretRef": secret_name}


def _read_optional_llm_credentials() -> tuple[str | None, str | None]:
    print("\nIA generativa opcional (los agregados de BD funcionan con reglas locales si se omite).")
    print("Si la habilitas, el proveedor recibe la pregunta y el contexto comercial reducido; no se envían PII de clientes ni secretos.")
    print("El proveedor puede tener límites o cargos propios: verifica sus condiciones; no forman parte de la cuota Azure.")
    if input("¿Configurar ahora una clave API de Groq o Gemini? (s/N): ").strip().lower() not in {"s", "si", "sí", "y", "yes"}:
        return None, None
    provider = input("Proveedor [groq/gemini] (Groq): ").strip().lower() or "groq"
    if provider not in {"groq", "gemini"}:
        raise DeployError("Proveedor IA no válido; elige Groq o Gemini.")
    key = getpass.getpass(f"Clave API {provider} (entrada oculta; no se imprime ni se guarda en el repo): ").strip()
    if len(key) < 20 or (provider == "groq" and not key.startswith("gsk_")):
        raise DeployError("La clave IA no tiene el formato esperado; se canceló sin modificar recursos.")
    return provider, key


def _llm_secret_config(provider: str | None, key: str | None) -> tuple[list[dict[str, str]], dict[str, str]]:
    if not provider or not key:
        return [], {}
    if provider not in {"groq", "gemini"}:
        raise DeployError("Proveedor IA no válido.")
    name = f"{provider}-api-key"
    return [_env_secret(name.upper().replace("-", "_"), name)], {name: key}


def _containerapp_payload(
    *,
    location: str,
    environment_id: str,
    image: str,
    container_name: str,
    port: int,
    external: bool,
    cpu: float,
    memory: str,
    env: list[dict[str, str]],
    secret_values: dict[str, str] | None = None,
) -> dict:
    ingress = {
        "external": external,
        "targetPort": port,
        "transport": "auto",
        "allowInsecure": False,
        "traffic": [{"latestRevision": True, "weight": 100}],
    }
    container = {
        "name": container_name,
        "image": image,
        "resources": {"cpu": cpu, "memory": memory},
        "env": env,
    }
    configuration: dict[str, object] = {
        "activeRevisionsMode": "Single",
        "secrets": _secret_refs(secret_values or {}),
        "ingress": ingress,
    }
    payload: dict[str, object] = {
        "location": location,
        "tags": {"app": "fashionstore", "environment": "test", "managedBy": "deploy-azure-bat"},
        "properties": {
            "environmentId": environment_id,
            "configuration": configuration,
            "template": {
                "containers": [container],
                "scale": {"minReplicas": 0, "maxReplicas": 1},
            },
        },
    }
    return payload


def _fastapi_containerapp_payload(
    *,
    location: str,
    environment_id: str,
    image: str,
    app_database_url: str,
    ia_key: str,
    llm_provider: str | None = None,
    llm_api_key: str | None = None,
) -> dict:
    llm_env, llm_secrets = _llm_secret_config(llm_provider, llm_api_key)
    return _containerapp_payload(
        location=location,
        environment_id=environment_id,
        image=image,
        container_name="fashionstore-ai",
        port=8000,
        # Express has no built-in service discovery; Nest calls FastAPI through its
        # HTTPS app URL. Every non-health FastAPI route still requires IA_INTERNAL_KEY.
        external=True,
        cpu=0.25,
        memory="0.5Gi",
        secret_values={"db-url": app_database_url, "ia-key": ia_key, **llm_secrets},
        env=[
            _env_value("APP_ENV", "production"),
            _env_value("PORT", "8000"),
            _env_value("DATABASE_SSL", "true"),
            _env_secret("DATABASE_URL", "db-url"),
            _env_secret("IA_INTERNAL_KEY", "ia-key"),
            *llm_env,
        ],
    )


def _patch_payload_from_app(app_payload: dict, *, include_secrets: bool = False) -> dict:
    properties: dict[str, object] = {
        "template": {"containers": app_payload["properties"]["template"]["containers"]},
    }
    if include_secrets:
        properties["configuration"] = {
            "secrets": app_payload["properties"]["configuration"]["secrets"]
        }
    return {"location": app_payload["location"], "properties": properties}


def _set_plain_env(container: dict, name: str, value: str) -> None:
    env = container.setdefault("env", [])
    for item in env:
        if item.get("name") == name:
            item.pop("secretRef", None)
            item["value"] = str(value)
            return
    env.append(_env_value(name, value))


def _set_secret_env(container: dict, name: str, secret_name: str) -> None:
    env = container.setdefault("env", [])
    for item in env:
        if item.get("name") == name:
            item.pop("value", None)
            item["secretRef"] = secret_name
            return
    env.append(_env_secret(name, secret_name))


def _configure_public_web_origin(api_payload: dict, ai_payload: dict, web_url: str) -> None:
    """Restrict Nest and FastAPI browser CORS to the deployed web origin."""
    api_container = api_payload["properties"]["template"]["containers"][0]
    ai_container = ai_payload["properties"]["template"]["containers"][0]
    _set_plain_env(api_container, "CORS_ORIGINS", web_url)
    _set_plain_env(api_container, "PUBLIC_WEB_URL", web_url)
    _set_plain_env(ai_container, "CORS_ORIGINS", web_url)


def _configure_web_api_upstream(web_payload: dict, api_url: str) -> None:
    """Provide the API endpoint to Nginx at runtime; the web image stays reusable."""
    container = web_payload["properties"]["template"]["containers"][0]
    _set_plain_env(container, "API_UPSTREAM", api_url.rstrip("/"))


def _save_state(state: dict) -> None:
    BUILD_STATE.parent.mkdir(parents=True, exist_ok=True)
    temp = _make_private_temp_json(state)
    try:
        temp.replace(BUILD_STATE)
        try:
            os.chmod(BUILD_STATE, 0o600)
        except OSError:
            pass
    finally:
        temp.unlink(missing_ok=True)


def build_database_bootstrap_sql() -> str:
    """Return client-side psql script; passwords arrive only via process environment."""
    return r"""BEGIN;
\getenv app_password FASHIONSTORE_APP_PASSWORD
SELECT format('CREATE ROLE fashionstore_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS', :'app_password')
\gexec
GRANT app_runtime TO fashionstore_app;
GRANT app_readonly TO fashionstore_app;
GRANT USAGE ON SCHEMA public TO fashionstore_app;
SELECT set_config('app.tenant_id', 'legacy', true);
\getenv admin_password FASHIONSTORE_ADMIN_PASSWORD
UPDATE public.usuarios
   SET password_hash = crypt(:'admin_password', gen_salt('bf', 12))
 WHERE tenant_id = 'legacy' AND email = 'admin@fashionstore.bo';
UPDATE public.usuarios SET activo = FALSE
 WHERE tenant_id = 'legacy' AND email <> 'admin@fashionstore.bo';
COMMIT;
"""


def _migration_files_for_bootstrap(directory: Path) -> list[Path]:
    """Require the reviewed 003–010 migration set before any Neon write."""
    files = sorted(directory.glob("*.sql"))
    actual = [path.name for path in files]
    expected = list(REQUIRED_MIGRATIONS)
    if actual != expected:
        missing = [name for name in expected if name not in actual]
        unexpected = [name for name in actual if name not in expected]
        details = []
        if missing:
            details.append("faltan: " + ", ".join(missing))
        if unexpected:
            details.append("inesperadas: " + ", ".join(unexpected))
        detail = "; ".join(details) or "orden distinto"
        raise DeployError(f"La secuencia de migraciones debe ser exactamente 003–010 ({detail}).")
    return files


def prepare_neon_database(runner: Runner, owner: NeonConnection, admin_password: str) -> tuple[str, str]:
    """Apply schema/migrations/seed on a checked-empty DB and verify runtime login."""
    _neon_empty_state(runner, owner)  # Recheck immediately before any write.
    migration_files = _migration_files_for_bootstrap(ROOT / "database" / "migrations")
    files = [ROOT / "database" / "schema.sql", *migration_files, ROOT / "database" / "seed.sql"]
    for sql_file in files:
        if not sql_file.is_file():
            raise DeployError(f"Falta el archivo SQL requerido: {sql_file.relative_to(ROOT)}")

    for sql_file in files:
        print(f"Aplicando {sql_file.relative_to(ROOT)} ...")
        if shutil.which("psql"):
            _psql(runner, ["--quiet", "--file", str(sql_file)], owner)
        else:
            _cloud_sql(runner, owner, "file", str(sql_file))

    app_password = _new_hex_secret()
    runner.add_sensitive(owner.original_url, owner.password, app_password, admin_password)
    if shutil.which("psql"):
        bootstrap_sql = build_database_bootstrap_sql()
        sql_path = _write_private_temp_text(bootstrap_sql, ".sql")
        try:
            _psql(
                runner,
                ["--quiet", "--file", str(sql_path)],
                owner,
                extra_env={
                    "FASHIONSTORE_APP_PASSWORD": app_password,
                    "FASHIONSTORE_ADMIN_PASSWORD": admin_password,
                },
            )
        finally:
            sql_path.unlink(missing_ok=True)
    else:
        _cloud_sql(
            runner,
            owner,
            "provision",
            extra_env={
                "FS_APP_PASSWORD": app_password,
                "FS_ADMIN_PASSWORD": admin_password,
            },
        )

    app_url = build_app_database_url(owner, "fashionstore_app", app_password)
    runner.add_sensitive(app_url)
    runtime_connection = replace(
        owner,
        original_url=app_url,
        host=_pooled_host(owner.host),
        username="fashionstore_app",
        password=app_password,
    )
    if shutil.which("psql"):
        access_check = _psql(
            runner,
            [
                "--quiet",
                "--tuples-only",
                "--no-align",
                "--command",
                "BEGIN; SET LOCAL ROLE app_readonly; "
                "SELECT set_config('app.tenant_id', 'legacy', true); "
                "SELECT count(*)::text FROM public.usuarios "
                "WHERE tenant_id='legacy' AND email='admin@fashionstore.bo'; COMMIT;",
            ],
            runtime_connection,
        )
        rows = [line.strip() for line in access_check.splitlines() if line.strip()]
        if not rows or rows[-1] != "1":
            raise DeployError("El rol runtime no pudo validar acceso de lectura/RLS a la cuenta semilla.")
    else:
        verification = _cloud_sql(runner, runtime_connection, "verify-app")
        if not verification.startswith("VERIFY OK esquema_version=") or " cuenta_admin=1" not in verification:
            raise DeployError("El rol runtime no pudo validar esquema ni acceso de lectura/RLS a la cuenta semilla.")
    return app_url, app_password


def _subscription(runner: Runner) -> tuple[str, str]:
    accounts = runner.az_json(["account", "list"])
    if not isinstance(accounts, list):
        raise DeployError("Azure CLI no devolvió la lista de suscripciones esperada.")
    enabled = [account for account in accounts if str(account.get("state", "Enabled")).lower() == "enabled"]
    if not enabled:
        raise DeployError("No hay una suscripción Azure habilitada. Inicia sesión con az login y verifica el acceso.")

    print("\nSuscripciones Azure disponibles:")
    for index, account in enumerate(enabled, 1):
        print(f"  {index}) {account.get('name', '(sin nombre)')} [{account.get('id', '')}]")
    while True:
        answer = input(f"Elige una suscripción [1-{len(enabled)}]: ").strip()
        if answer.isdigit() and 1 <= int(answer) <= len(enabled):
            selected = enabled[int(answer) - 1]
            subscription_id = str(selected.get("id", ""))
            if not subscription_id:
                raise DeployError("Azure devolvió una suscripción sin ID.")
            runner.az_quiet(["account", "set", "--subscription", subscription_id])
            active = runner.az_json(["account", "show"])
            if str(active.get("id", "")) != subscription_id:
                raise DeployError("Azure no activó la suscripción seleccionada.")
            return subscription_id, str(selected.get("name", "Azure subscription"))
        print("Selección inválida.")


def _resource_names() -> dict[str, str]:
    suffix = secrets.token_hex(3)
    return {
        "suffix": suffix,
        "resource_group": f"rg-fashionstore-test-{suffix}",
        "environment": f"fs-test-{suffix}",
        "ai_app": f"fashionstore-ai-{suffix}",
        "api_app": f"fashionstore-api-{suffix}",
        "web_app": f"fashionstore-web-{suffix}",
    }


def normalize_ghcr_owner(value: str) -> str:
    owner = str(value or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?", owner):
        raise DeployError("Indica el owner de GitHub/GHCR: solo letras, números y guiones (1–39 caracteres).")
    return owner


def ghcr_image_urls(owner: str) -> dict[str, str]:
    namespace = normalize_ghcr_owner(owner)
    return {
        key: f"ghcr.io/{namespace}/{package}:{GHCR_TAG}"
        for key, package in GHCR_PACKAGES.items()
    }


def _check_public_ghcr_image(owner: str, package: str) -> None:
    """Verify an image can be pulled anonymously before any Neon/Azure writes."""
    namespace = normalize_ghcr_owner(owner)
    repository = f"{namespace}/{package}"
    scope = urllib.parse.urlencode({"service": "ghcr.io", "scope": f"repository:{repository}:pull"})
    token_url = f"https://ghcr.io/token?{scope}"
    try:
        token_request = urllib.request.Request(token_url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(token_request, timeout=15) as response:
            token_body = json.loads(response.read().decode("utf-8"))
        token = str(token_body.get("token") or token_body.get("access_token") or "")
        if not token:
            raise DeployError(f"GHCR no emitió un token anónimo de lectura para {repository}.")

        manifest_url = f"https://ghcr.io/v2/{repository}/manifests/{GHCR_TAG}"
        manifest_request = urllib.request.Request(
            manifest_url,
            headers={
                "Accept": (
                    "application/vnd.oci.image.index.v1+json, "
                    "application/vnd.docker.distribution.manifest.list.v2+json, "
                    "application/vnd.oci.image.manifest.v1+json, "
                    "application/vnd.docker.distribution.manifest.v2+json"
                ),
                "Authorization": f"Bearer {token}",
                "Range": "bytes=0-0",
            },
        )
        with urllib.request.urlopen(manifest_request, timeout=15) as response:
            if response.status not in {200, 206}:
                raise DeployError(f"GHCR no devolvió un manifiesto público válido para {repository}:{GHCR_TAG}.")
            response.read(1)
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403, 404}:
            raise DeployError(
                f"La imagen {repository}:{GHCR_TAG} no existe o no es pública. "
                "Publica el paquete en GitHub Container Registry con visibilidad Public y reintenta."
            ) from None
        raise DeployError(f"GHCR respondió HTTP {exc.code} al verificar {repository}:{GHCR_TAG}.") from None
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        raise DeployError(f"No se pudo verificar GHCR para {repository}:{GHCR_TAG}; revisa la conexión a Internet.") from exc


def check_public_ghcr_images(owner: str) -> dict[str, str]:
    namespace = normalize_ghcr_owner(owner)
    for package in GHCR_PACKAGES.values():
        _check_public_ghcr_image(namespace, package)
    return ghcr_image_urls(namespace)


def _normal_region(value: str) -> str:
    return "".join(char for char in str(value).lower() if char.isalnum())


# Published availability for Azure Container Apps Express. Keep normalized CLI region
# names here so an unsupported region is rejected before Neon is modified.
EXPRESS_REGIONS = frozenset(
    _normal_region(region)
    for region in (
        "australiaeast", "austriaeast", "brazilsouth", "canadacentral", "canadaeast",
        "centralindia", "centralus", "chilecentral", "eastasia", "eastus", "eastus2",
        "francecentral", "germanywestcentral", "indonesiacentral", "italynorth", "japaneast",
        "japanwest", "jioindiacentral", "koreacentral", "malaysiawest", "mexicocentral",
        "newzealandnorth", "northcentralus", "northeurope", "norwayeast", "polandcentral",
        "southafricanorth", "southcentralus", "southindia", "southeastasia", "spaincentral",
        "swedencentral", "switzerlandnorth", "switzerlandwest", "uaenorth", "uksouth",
        "ukwest", "westcentralus", "westeurope", "westus", "westus2", "westus3",
    )
)


def _policy_allowed_regions(runner: Runner) -> set[str] | None:
    """Return the active subscription location allowlist, if Azure Policy defines one."""
    assignments = runner.az_json(["policy", "assignment", "list", "--only-show-errors"])
    if not isinstance(assignments, list):
        raise DeployError("Azure Policy no devolvió la lista de asignaciones esperada.")

    allowlists: list[set[str]] = []
    for assignment in assignments:
        if not isinstance(assignment, dict):
            continue
        properties = assignment.get("properties") if isinstance(assignment.get("properties"), dict) else {}
        enforcement = str(assignment.get("enforcementMode") or properties.get("enforcementMode") or "").lower()
        if enforcement == "donotenforce":
            continue
        parameters = assignment.get("parameters") or properties.get("parameters") or {}
        if not isinstance(parameters, dict):
            continue
        effect = parameters.get("effect")
        effect = effect.get("value") if isinstance(effect, dict) else effect
        if effect and str(effect).lower() not in {"deny", "denyaction"}:
            continue

        for name, parameter in parameters.items():
            normalized_name = str(name).lower()
            if "allowed" not in normalized_name or not any(word in normalized_name for word in ("location", "region")):
                continue
            regions = parameter.get("value") if isinstance(parameter, dict) else parameter
            if isinstance(regions, list):
                allowlists.append({_normal_region(region) for region in regions if isinstance(region, str)})

    if not allowlists:
        return None
    return set.intersection(*allowlists)


def _validate_location(runner: Runner, location: str) -> None:
    normalized = _normal_region(location)
    if normalized not in EXPRESS_REGIONS:
        raise DeployError(
            "Esa región no ofrece Azure Container Apps Express. Elige una región compatible, "
            "por ejemplo eastus, brazilsouth, chilecentral o westus2."
        )
    locations = runner.az_json(["account", "list-locations"])
    valid = {
        _normal_region(item.get("name", ""))
        for item in locations
        if isinstance(item, dict) and item.get("name")
    }
    if normalized not in valid:
        raise DeployError("Esa región no está disponible para la suscripción seleccionada. Usa el nombre corto, por ejemplo eastus.")

    provider = runner.az_json(["provider", "show", "--namespace", "Microsoft.App"])
    supported = set()
    for resource_type in provider.get("resourceTypes", []):
        if str(resource_type.get("resourceType", "")).lower() == "managedenvironments":
            supported = {_normal_region(region) for region in resource_type.get("locations", [])}
            break
    if supported and normalized not in supported:
        raise DeployError("Microsoft.App no ofrece Container Apps en esa región. Elige otra región antes de continuar.")

    policy_allowed = _policy_allowed_regions(runner)
    if policy_allowed is not None and normalized not in policy_allowed:
        express_available = policy_allowed & EXPRESS_REGIONS & valid
        if supported:
            express_available &= supported
        suggestions = ", ".join(sorted(express_available)) or "ninguna región Express compatible detectada"
        raise DeployError(
            f"La política de Azure de la suscripción no permite {location}. "
            f"Regiones Express permitidas disponibles: {suggestions}. Elige una antes de continuar."
        )


def _check_azure_preflight(
    runner: Runner,
    subscription_id: str,
    location: str,
    names: dict[str, str],
) -> None:
    if not shutil.which("az"):
        raise DeployError("No se encontró Azure CLI (az). Ejecuta desplegar-azure.bat en Windows con Azure CLI instalada.")
    active = runner.az_json(["account", "show"])
    if str(active.get("id", "")) != subscription_id:
        raise DeployError("La suscripción activa cambió; vuelve a iniciar el BAT y selecciona la correcta.")
    _validate_location(runner, location)

    exists = runner.run(
        ["az", "group", "exists", "--name", names["resource_group"], "--output", "tsv"],
        quiet=True,
    ).strip().lower()
    if exists == "true":
        raise DeployError(f"El Resource Group generado ya existe ({names['resource_group']}); no se modifican recursos existentes.")
    if exists != "false":
        raise DeployError("No se pudo confirmar que el Resource Group generado no exista.")


def _ensure_providers_registered(runner: Runner) -> None:
    # Express with logs disabled needs only Microsoft.App; avoid extra provider
    # permissions for a workspace that this deployment intentionally does not create.
    for namespace in ("Microsoft.App",):
        details = runner.az_json(["provider", "show", "--namespace", namespace])
        if str(details.get("registrationState", "")).lower() != "registered":
            print(f"Registrando el proveedor Azure {namespace} (sin crear recursos facturables) ...")
            runner.az_quiet(["provider", "register", "--namespace", namespace, "--wait"])


def _resource_group_state(state: dict) -> None:
    _save_state(state)


def _wait_containerapp(runner: Runner, name: str, resource_group: str, *, attempts: int = 60) -> None:
    last_state = ""
    for _ in range(attempts):
        try:
            last_state = runner.run(
                [
                    "az",
                    "containerapp",
                    "show",
                    "--name",
                    name,
                    "--resource-group",
                    resource_group,
                    "--query",
                    "properties.provisioningState",
                    "--output",
                    "tsv",
                ],
                quiet=True,
            ).strip()
        except DeployError:
            last_state = ""
        if last_state.lower() == "succeeded":
            return
        if last_state.lower() == "failed":
            raise DeployError(f"Azure marcó {name} como Failed. El Resource Group se conserva para revisar/limpiar.")
        time.sleep(10)
    raise DeployError(f"Timeout esperando Container App {name} (último estado: {last_state or 'sin respuesta'}).")


def _fqdn(runner: Runner, app: str, resource_group: str) -> str:
    value = runner.run(
        [
            "az",
            "containerapp",
            "show",
            "--name",
            app,
            "--resource-group",
            resource_group,
            "--query",
            "properties.configuration.ingress.fqdn",
            "--output",
            "tsv",
        ],
        quiet=True,
    ).strip()
    if not value or value.lower() == "none":
        raise DeployError(f"Azure todavía no devolvió el FQDN de {app}.")
    return value


def _create_containerapp(
    runner: Runner,
    *,
    subscription_id: str,
    resource_group: str,
    name: str,
    payload: dict,
) -> None:
    _arm_containerapp_request(runner, "put", subscription_id, resource_group, name, payload)
    _wait_containerapp(runner, name, resource_group)


def _patch_containerapp(
    runner: Runner,
    *,
    subscription_id: str,
    resource_group: str,
    name: str,
    app_payload: dict,
    include_secrets: bool = False,
) -> None:
    _arm_containerapp_request(
        runner,
        "patch",
        subscription_id,
        resource_group,
        name,
        _patch_payload_from_app(app_payload, include_secrets=include_secrets),
    )
    _wait_containerapp(runner, name, resource_group)


def _create_azure(
    runner: Runner,
    *,
    app_database_url: str,
    app_database_password: str,
    subscription_id: str,
    subscription_name: str,
    location: str,
    names: dict[str, str],
    ghcr_owner: str,
    image_urls: dict[str, str],
    state: dict,
    llm_provider: str | None = None,
    llm_api_key: str | None = None,
) -> tuple[dict[str, str], dict]:
    """Create only scale-to-zero ACA resources and pull public images from GHCR."""
    resource_group = names["resource_group"]
    _ensure_providers_registered(runner)
    _check_azure_preflight(runner, subscription_id, location, names)

    print(f"Creando Azure Container Apps Express (Consumption, escala a cero) en {subscription_name}, región {location}, RG {resource_group} ...")
    runner.az_quiet(["group", "create", "--name", resource_group, "--location", location])
    state.update(
        {
            "status": "in_progress",
            "subscription_id": subscription_id,
            "subscription_name": subscription_name,
            "location": location,
            "container_apps_mode": "express",
            "logs_destination": "none",
            **names,
            "ghcr_owner": ghcr_owner,
            "image_urls": image_urls,
            "resource_group_created": True,
            "neon_prepared": True,
        }
    )
    _resource_group_state(state)

    runner.az_quiet(
        [
            "containerapp",
            "env",
            "create",
            "--name",
            names["environment"],
            "--resource-group",
            resource_group,
            "--location",
            location,
            "--environment-mode",
            "express",
            "--logs-destination",
            "none",
        ]
    )
    environment_id = runner.run(
        [
            "az",
            "containerapp",
            "env",
            "show",
            "--name",
            names["environment"],
            "--resource-group",
            resource_group,
            "--query",
            "id",
            "--output",
            "tsv",
        ],
        quiet=True,
    ).strip()
    if not environment_id:
        raise DeployError("Azure no devolvió el ID del Container Apps Environment.")

    ia_key = _new_hex_secret()
    jwt_secret = _new_hex_secret()
    simulator_secret = _new_hex_secret()
    libelula_key = _new_hex_secret()
    libelula_webhook = _new_hex_secret()
    runner.add_sensitive(
        app_database_url,
        app_database_password,
        ia_key,
        jwt_secret,
        simulator_secret,
        libelula_key,
        libelula_webhook,
        llm_api_key or "",
    )

    ai_payload = _fastapi_containerapp_payload(
        location=location,
        environment_id=environment_id,
        image=image_urls["ai"],
        app_database_url=app_database_url,
        ia_key=ia_key,
        llm_provider=llm_provider,
        llm_api_key=llm_api_key,
    )
    _create_containerapp(
        runner,
        subscription_id=subscription_id,
        resource_group=resource_group,
        name=names["ai_app"],
        payload=ai_payload,
    )
    fastapi_fqdn = _fqdn(runner, names["ai_app"], resource_group)

    api_payload = _containerapp_payload(
        location=location,
        environment_id=environment_id,
        image=image_urls["api"],
        container_name="fashionstore-api",
        port=3000,
        external=False,
        cpu=0.5,
        memory="1Gi",
        secret_values={
            "db-url": app_database_url,
            "jwt-secret": jwt_secret,
            "ia-key": ia_key,
            "stripe-sim-hook": simulator_secret,
            "lib-key": libelula_key,
            "lib-hook": libelula_webhook,
        },
        env=[
            _env_value("NODE_ENV", "production"),
            _env_value("PORT", "3000"),
            _env_value("DATABASE_SSL", "true"),
            _env_value("PAGOS_MODO", "sandbox"),
            _env_secret("DATABASE_URL", "db-url"),
            _env_secret("JWT_SECRET", "jwt-secret"),
            _env_secret("IA_INTERNAL_KEY", "ia-key"),
            _env_secret("STRIPE_SIMULATOR_WEBHOOK_SECRET", "stripe-sim-hook"),
            _env_secret("LIBELULA_APP_KEY", "lib-key"),
            _env_secret("LIBELULA_WEBHOOK_SECRET", "lib-hook"),
            _env_value("FASTAPI_URL", f"https://{fastapi_fqdn}"),
        ],
    )
    _create_containerapp(
        runner,
        subscription_id=subscription_id,
        resource_group=resource_group,
        name=names["api_app"],
        payload=api_payload,
    )

    # Nest receives public HTTPS ingress only after its secrets are present.
    runner.az_quiet(
        [
            "containerapp",
            "ingress",
            "enable",
            "--name",
            names["api_app"],
            "--resource-group",
            resource_group,
            "--type",
            "external",
            "--target-port",
            "3000",
            "--transport",
            "auto",
            "--allow-insecure",
            "false",
        ]
    )
    _wait_containerapp(runner, names["api_app"], resource_group)
    api_fqdn = _fqdn(runner, names["api_app"], resource_group)
    api_url = f"https://{api_fqdn}"
    api_container = api_payload["properties"]["template"]["containers"][0]
    _set_plain_env(api_container, "PUBLIC_API_URL", api_url)
    _patch_containerapp(
        runner,
        subscription_id=subscription_id,
        resource_group=resource_group,
        name=names["api_app"],
        app_payload=api_payload,
    )

    web_payload = _containerapp_payload(
        location=location,
        environment_id=environment_id,
        image=image_urls["web"],
        container_name="fashionstore-web",
        port=80,
        external=True,
        cpu=0.25,
        memory="0.5Gi",
        env=[],
    )
    _configure_web_api_upstream(web_payload, api_url)
    _create_containerapp(
        runner,
        subscription_id=subscription_id,
        resource_group=resource_group,
        name=names["web_app"],
        payload=web_payload,
    )
    web_fqdn = _fqdn(runner, names["web_app"], resource_group)
    web_url = f"https://{web_fqdn}"

    _configure_public_web_origin(api_payload, ai_payload, web_url)
    _patch_containerapp(
        runner,
        subscription_id=subscription_id,
        resource_group=resource_group,
        name=names["api_app"],
        app_payload=api_payload,
    )
    # FastAPI has public HTTPS ingress in Express; business routes still require IA_INTERNAL_KEY.
    _patch_containerapp(
        runner,
        subscription_id=subscription_id,
        resource_group=resource_group,
        name=names["ai_app"],
        app_payload=ai_payload,
    )

    result = {
        **names,
        "subscription_id": subscription_id,
        "subscription_name": subscription_name,
        "location": location,
        "container_apps_mode": "express",
        "logs_destination": "none",
        "ghcr_owner": ghcr_owner,
        "image_urls": image_urls,
        "llm_provider": llm_provider if llm_api_key else "local_rules",
        "llm_configured": bool(llm_api_key),
        "fastapi_fqdn": fastapi_fqdn,
        "fastapi_url": f"https://{fastapi_fqdn}",
        "api_fqdn": api_fqdn,
        "api_url": api_url,
        "web_fqdn": web_fqdn,
        "web_url": web_url,
        "admin_email": "admin@fashionstore.bo",
    }
    state.update(result)
    state["resource_group_created"] = True
    state["neon_prepared"] = True
    state["status"] = "in_progress"
    _resource_group_state(state)
    return result, api_payload


def _wait_http(url: str, *, attempts: int = 36) -> bool:
    for _ in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(request, timeout=8) as response:
                body = response.read().decode("utf-8", errors="replace")
                if response.status != 200:
                    time.sleep(5)
                    continue
                if url.endswith("/api/health"):
                    try:
                        return json.loads(body).get("estado") == "ok"
                    except json.JSONDecodeError:
                        return False
                return True
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(5)
    return False


def maybe_enable_stripe(runner: Runner, result: dict[str, str], api_payload: dict) -> bool:
    answer = input("¿Configurar Stripe Checkout test ahora? (s/N): ").strip().lower()
    if answer not in {"s", "si", "sí", "y", "yes"}:
        print("Stripe no quedó configurado; los pagos reales siguen desactivados y solo queda el simulador.")
        return False

    endpoint = f"{result['api_url']}/api/pagos/webhooks/stripe-checkout"
    print("\nAbriendo el Dashboard de Stripe en modo test.")
    print("Crea un webhook endpoint con estos datos:")
    print(f"  URL: {endpoint}")
    print("  Eventos: checkout.session.completed, checkout.session.async_payment_succeeded,")
    print("           checkout.session.async_payment_failed, checkout.session.expired")
    webbrowser.open(STRIPE_TEST_WEBHOOKS)
    input("Cuando veas el secreto whsec_... del endpoint, pulsa Enter para continuar.")

    stripe_key = getpass.getpass("Pega localmente una clave API Stripe test rk_test_... o sk_test_... (oculta): ").strip()
    if not (stripe_key.startswith("rk_test_") or stripe_key.startswith("sk_test_")) or len(stripe_key) < 16:
        raise DeployError("Se rechazó la clave: solo se aceptan claves de prueba rk_test_... o sk_test_... válidas.")
    webhook_secret = getpass.getpass("Pega localmente el secreto whsec_ del endpoint (oculto): ").strip()
    if not webhook_secret.startswith("whsec_") or len(webhook_secret) < 24:
        raise DeployError("El secreto de webhook no tiene formato whsec_ válido.")

    runner.add_sensitive(stripe_key, webhook_secret)
    api_config = api_payload["properties"]["configuration"]
    secret_values = {secret["name"]: secret["value"] for secret in api_config.get("secrets", [])}
    secret_values["stripe-key"] = stripe_key
    secret_values["stripe-hook"] = webhook_secret
    api_config["secrets"] = _secret_refs(secret_values)

    api_container = api_payload["properties"]["template"]["containers"][0]
    _set_secret_env(api_container, "STRIPE_SECRET_KEY", "stripe-key")
    _set_secret_env(api_container, "STRIPE_WEBHOOK_SECRET", "stripe-hook")
    _patch_containerapp(
        runner,
        subscription_id=result["subscription_id"],
        resource_group=result["resource_group"],
        name=result["api_app"],
        app_payload=api_payload,
        include_secrets=True,
    )
    print("Stripe test quedó configurado en la API; este flujo rechaza claves live.")
    return True


def _print_cleanup(state: dict) -> None:
    if state.get("resource_group_created"):
        rg = state.get("resource_group", "")
        print(f"\nHay recursos Azure posiblemente facturables en el Resource Group {rg}.", file=sys.stderr)
        print("Revísalos en el Portal; si ese grupo contiene solo esta prueba, elimínalo con:", file=sys.stderr)
        print(f"  az group delete --name {rg} --yes --no-wait", file=sys.stderr)
        print(f"Metadatos sin secretos: {BUILD_STATE.relative_to(ROOT)}", file=sys.stderr)
        print("La base Neon se conserva. Para repetir desde cero, crea un proyecto Neon nuevo con una base vacía.", file=sys.stderr)
    elif state.get("neon_setup_started") and not state.get("neon_prepared"):
        print("\nEl setup Neon pudo quedar parcial. No repitas seed sobre esa base; inspecciónala o crea un proyecto nuevo.", file=sys.stderr)
    elif state.get("neon_prepared"):
        print("\nNeon quedó preparada, pero Azure no creó su Resource Group. No vuelvas a ejecutar sobre esa DB; inspecciónala o crea un proyecto Neon nuevo.", file=sys.stderr)


def main() -> int:
    runner = Runner()
    state: dict = {"status": "starting", "resource_group_created": False, "neon_setup_started": False}
    try:
        if not shutil.which("az"):
            raise DeployError("Falta Azure CLI (az). Ejecuta desplegar-azure.bat en Windows con Azure CLI instalada.")
        if not _sql_driver():
            raise DeployError(
                "Falta un cliente SQL: instala PostgreSQL Command Line Tools (psql), "
                "o Node.js con las dependencias de backend-nest (`cd backend-nest && npm ci`)."
            )
        if not (ROOT / "database" / "schema.sql").is_file():
            raise DeployError("No se encontró la raíz del proyecto FashionStore con database/schema.sql.")

        print("FashionStore: despliegue asistido de prueba Azure Container Apps + Neon.")
        print("Azure Container Apps Express usa Consumption, escala a cero y no crea un entorno de pago, ACR ni Log Analytics.")
        print("Las imágenes públicas vienen de GHCR; Container Apps puede cobrar por uso/egress que exceda las concesiones gratis. No se garantiza $0.")
        print("El script no borra recursos automáticamente ante un fallo.")
        print("El preflight registra solo Microsoft.App si hace falta (metadatos; no crea recursos facturables).")
        print("La ruta configurada usa imágenes públicas de GHCR; el prompt siguiente confirma que aceptas esa configuración.")
        provider_confirmation = input("¿Confirmas usar GHCR con imágenes públicas? (s/N): ").strip().lower()
        if provider_confirmation not in {"s", "si", "sí", "y", "yes"}:
            raise DeployError("GHCR no confirmado. No se registraron providers, no se modificó Neon y no se crearon recursos Azure.")
        if input("Para continuar con las comprobaciones, escribe CONTINUAR: ").strip() != "CONTINUAR":
            raise DeployError("Cancelado antes de abrir Neon o cambiar la suscripción/recursos.")

        subscription_id, subscription_name = _subscription(runner)
        location = input("Región Azure (nombre corto) [eastus]: ").strip() or "eastus"
        ghcr_owner = normalize_ghcr_owner(input("Owner de GitHub que publica los paquetes públicos GHCR: "))
        names = _resource_names()
        state.update({**names, "subscription_id": subscription_id, "subscription_name": subscription_name, "location": location, "ghcr_owner": ghcr_owner})
        print(f"Se reservará un Resource Group nuevo: {names['resource_group']} (no se borrarán recursos existentes).")

        # Register ACA providers before resource preflight; this updates metadata only.
        _ensure_providers_registered(runner)
        _check_azure_preflight(runner, subscription_id, location, names)
        image_urls = check_public_ghcr_images(ghcr_owner)
        print("Preflight Azure y lectura anónima de las tres imágenes GHCR correctos; aún no se han creado recursos.")
        print("\nAbriendo Neon. Crea un proyecto Neon NUEVO (no reutilices otro proyecto) con una base/branch vacía.")
        print("En Connection Details elige la conexión directa (sin -pooler) y copia la URL PostgreSQL del owner.")
        print("La URL se pedirá oculta, se usará localmente y no se guardará en archivos del repo.")
        print(f"Si el navegador no abre automáticamente, visita: {NEON_CONSOLE}")
        webbrowser.open(NEON_CONSOLE)
        owner_url = getpass.getpass("Pega la URL directa owner de Neon (entrada oculta): ").strip()
        owner = parse_neon_connection_url(owner_url)
        runner.add_sensitive(owner.original_url, owner.password)
        preflight_neon(runner, owner)

        admin_password = _read_new_secret(
            "Nueva contraseña para admin@fashionstore.bo (14+ caracteres; no uses la demo): ",
            minimum=14,
            forbidden=("Fashion2026!",),
        )
        runner.add_sensitive(admin_password)
        llm_provider, llm_api_key = _read_optional_llm_credentials()
        runner.add_sensitive(llm_api_key or "")

        print("\nConfirmación final:")
        print("- Se aplicarán schema.sql, migraciones 003–010 y seed a la base Neon vacía.")
        print("- Se creará fashionstore_app con privilegios runtime y se cambiará la contraseña semilla del admin.")
        print(f"- Se usarán imágenes GHCR públicas de {ghcr_owner}; no se crea ACR ni se guardan tokens de registry.")
        print("- IA generativa: " + (f"clave de {llm_provider} configurada en secreto de FastAPI." if llm_api_key else "sin clave externa; funcionará el asistente local determinista con datos de la base."))
        print("- Luego se crearán Resource Group, entorno Express sin Log Analytics y 3 Container Apps a escala cero; uso/egress fuera de cuotas podría generar cargos Azure.")
        print("- No se borrará Neon ni Azure automáticamente si algo falla.")
        if input("Escribe DEPLOY-TEST para aplicar la base y desplegar: ").strip() != "DEPLOY-TEST":
            raise DeployError("Cancelado antes de modificar Neon o crear recursos Azure.")

        state["neon_setup_started"] = True
        state["status"] = "neon_setup_in_progress"
        app_database_url, app_database_password = prepare_neon_database(runner, owner, admin_password)
        runner.add_sensitive(app_database_url, app_database_password)
        state["neon_prepared"] = True
        print("Neon quedó preparado; la URL runtime y las contraseñas no se mostrarán.")

        result, api_payload = _create_azure(
            runner,
            app_database_url=app_database_url,
            app_database_password=app_database_password,
            subscription_id=subscription_id,
            subscription_name=subscription_name,
            location=location,
            names=names,
            ghcr_owner=ghcr_owner,
            image_urls=image_urls,
            state=state,
            llm_provider=llm_provider,
            llm_api_key=llm_api_key,
        )

        print("\nEsperando FastAPI HTTPS en /health ...")
        if not _wait_http(f"{result['fastapi_url']}/health"):
            raise DeployError("FastAPI no pasó /health tras 3 minutos. El recurso se conserva en el RG para revisar/limpiar.")
        print("FastAPI /health: OK")

        print("Esperando la API Nest y su conexión Neon en /api/health ...")
        if not _wait_http(f"{result['api_url']}/api/health"):
            raise DeployError("Nest no pasó /api/health tras 3 minutos. El recurso se conserva en el RG para revisar/limpiar.")
        print("Nest /api/health: OK")
        if not _wait_http(result["web_url"]):
            raise DeployError("La web no respondió HTTP 200 tras 3 minutos. El recurso se conserva en el RG para revisar/limpiar.")
        print("Web: HTTP 200")

        state.update(result)
        state["status"] = "deployed"
        state["stripe_test_configured"] = False
        _save_state(state)

        print("\nDESPLIEGUE CLOUD VERIFICADO")
        print(f"Web: {result['web_url']}")
        print(f"API: {result['api_url']}")
        print(f"Salud Nest+Neon: {result['api_url']}/api/health")
        print(f"Inicio de sesión demo: legacy / {result['admin_email']} / contraseña elegida localmente")
        print(f"Resource Group de prueba: {result['resource_group']}")

        try:
            stripe_configured = maybe_enable_stripe(runner, result, api_payload)
            state["stripe_test_configured"] = stripe_configured
            _save_state(state)
        except DeployError as exc:
            state["stripe_test_configured"] = False
            state["stripe_setup_error"] = _redact(str(exc), runner.sensitive)
            _save_state(state)
            print(f"[STRIPE] Despliegue activo, pero Stripe test no quedó configurado: {state['stripe_setup_error']}", file=sys.stderr)

        print("\nEl despliegue respondió en vivo; esto no acredita una operación de compra ni un webhook Stripe real.")
        print(f"Metadatos sin secretos: {BUILD_STATE.relative_to(ROOT)}")
        print("Express usa concesiones gratuitas compartidas por suscripción (180,000 vCPU-s, 360,000 GiB-s y 2 M solicitudes/mes publicadas); el exceso/egress puede facturarse. Revisa el costo y elimina el RG al terminar.")
        print("Limpieza (solo tras verificar que el RG contiene esta prueba): az group delete --name " + result["resource_group"] + " --yes --no-wait")
        return 0

    except KeyboardInterrupt:
        print("\nInterrumpido. Revisa Azure si ya empezó la creación; no se eliminó ningún recurso.", file=sys.stderr)
        if state.get("resource_group_created") or state.get("neon_setup_started"):
            state["status"] = "interrupted"
            try:
                _save_state(state)
            except OSError:
                pass
        _print_cleanup(state)
        return 130
    except Exception as exc:
        safe_message = _redact(str(exc), runner.sensitive)
        print(f"[ERROR] {safe_message}", file=sys.stderr)
        if state.get("resource_group_created") or state.get("neon_setup_started"):
            state["status"] = "incomplete"
            try:
                _save_state(state)
            except OSError:
                pass
        _print_cleanup(state)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
