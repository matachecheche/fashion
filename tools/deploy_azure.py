#!/usr/bin/env python3
"""Flujo asistido de FashionStore: Neon + Azure Container Apps + Stripe test.

El BAT comprueba herramientas e inicia sesión Azure; este script pide la URL Neon
localmente, restaura una base vacía o una instalación FashionStore confirmada y despliega
imágenes públicas desde GHCR. No crea ACR ni guarda credenciales en el repo/estado. Azure aún
puede generar cargos de consumo y egress.
"""
from __future__ import annotations

import base64
import getpass
import json
import hashlib
from datetime import datetime, timezone
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
BUILD_HISTORY = ROOT / "builds" / "azure-test-deployments.json"
SEED_USERS = (
    "admin@fashionstore.bo",
    "encargado@fashionstore.bo",
    "cajero@fashionstore.bo",
    "proveedor@fashionstore.bo",
    "cliente@fashionstore.bo",
)
SEED_PASSWORD = "Fashion2026!"
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
    input_was_pooled: bool = False


def parse_neon_connection_url(value: str) -> NeonConnection:
    """Validate a Neon PostgreSQL URL and normalize pooled owner URLs to direct URLs.

    Neon connection pooling is suitable for the running application, but schema setup,
    migrations, and seed restoration are performed with a direct connection.
    """
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
        was_pooled = first_label.endswith("-pooler")
        if was_pooled:
            host = first_label[:-len("-pooler")] + "." + host.split(".", 1)[1]
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
        username = urllib.parse.unquote(parsed.username)
        password = urllib.parse.unquote(parsed.password)
        netloc = f"{urllib.parse.quote(username, safe='')}:{urllib.parse.quote(password, safe='')}@{host}"
        if port != 5432:
            netloc += f":{port}"
        direct_url = urllib.parse.urlunsplit(("postgresql", netloc, "/" + urllib.parse.quote(database, safe=""), urllib.parse.urlencode(query), ""))
        return NeonConnection(
            original_url=direct_url,
            host=host,
            port=port,
            username=username,
            password=password,
            database=database,
            query=query,
            input_was_pooled=was_pooled,
        )
    except Exception as exc:
        raise DeployError(
            "La URL debe ser PostgreSQL de Neon, con usuario, contraseña, base y TLS (sslmode=require). "
            "Puedes pegar la URL pooled o directa; el asistente normaliza la pooled para preparar el esquema."
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


def _neon_state(runner: Runner, connection: NeonConnection) -> str:
    """Return empty, fashionstore, or foreign without changing the database."""
    raw = _psql_value(
        runner,
        connection,
        """SELECT CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
              AND c.relname NOT LIKE 'pg_%'
          ) THEN 'empty'
          WHEN (
            SELECT count(*) FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
              AND c.relname IN ('meta','usuarios','productos','sucursales','almacenes')
          ) >= 3 THEN 'fashionstore'
          ELSE 'foreign'
        END""",
    )
    state = (raw.splitlines() or [""])[-1].strip().strip('"')
    if state not in {"empty", "fashionstore", "foreign"}:
        raise DeployError("No pude determinar el estado de la base Neon.")
    return state


def _neon_empty_state(runner: Runner, connection: NeonConnection) -> str:
    """Backward-compatible name; now detects known FashionStore databases too."""
    state = _neon_state(runner, connection)
    if state == "foreign":
        raise DeployError(
            "La base Neon contiene tablas que no se reconocen como FashionStore; no se modificó. "
            "Usa una base/branch dedicada o inspecciona sus tablas antes de continuar."
        )
    return state


def preflight_neon(runner: Runner, connection: NeonConnection) -> str:
    """Read-only validation; returns the state for the explicit reset confirmation."""
    if not _sql_driver():
        raise DeployError(
            "Falta un cliente SQL: instala PostgreSQL Command Line Tools (psql), "
            "o Node.js con las dependencias de backend-nest instaladas (`cd backend-nest && npm ci`)."
        )
    state = _neon_empty_state(runner, connection)
    if state == "empty":
        print("Conexión Neon correcta; la base está vacía y lista para preparar.")
    else:
        print("Conexión Neon correcta; se detectó una instalación FashionStore existente.")
        print("La restauración borrará los datos actuales de esa base y volverá a cargar el seed local.")
    return state


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


def _read_optional_llm_credentials() -> dict[str, str]:
    """Collect both optional providers; secrets are only passed to ACA, never saved locally."""
    print("\nIA generativa opcional. Puedes configurar Groq, Gemini, ambos o ninguno.")
    print("Groq usa claves gsk_...; Gemini admite claves AIza... y AQ.Ab8R... nuevas.")
    print("Las claves se guardan como secretos de Azure Container Apps, no en el ZIP ni en el archivo de estado.")
    credentials: dict[str, str] = {}
    for provider in ("groq", "gemini"):
        if input(f"¿Configurar {provider.capitalize()} ahora? (s/N): ").strip().lower() not in {"s", "si", "sí", "y", "yes"}:
            continue
        key = getpass.getpass(f"Clave API {provider} (entrada oculta): ").strip()
        valid_prefix = key.startswith("gsk_") if provider == "groq" else key.startswith(("AIza", "AQ."))
        if len(key) < 20 or not valid_prefix:
            raise DeployError(f"La clave {provider} no tiene un formato admitido; no se modificaron recursos.")
        credentials[provider] = key
    return credentials


def _llm_secret_config(credentials: dict[str, str] | None) -> tuple[list[dict[str, str]], dict[str, str]]:
    env: list[dict[str, str]] = []
    secrets: dict[str, str] = {}
    for provider, key in (credentials or {}).items():
        if provider not in {"groq", "gemini"} or not key:
            raise DeployError("Proveedor IA no válido o clave vacía.")
        expected = key.startswith("gsk_") if provider == "groq" else key.startswith(("AIza", "AQ."))
        if not expected or len(key) < 20:
            raise DeployError(f"La clave {provider} no tiene el formato esperado.")
        name = f"{provider}-api-key"
        env.append(_env_secret(f"{provider.upper()}_API_KEY", name))
        secrets[name] = key
    return env, secrets


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
    llm_credentials: dict[str, str] | None = None,
) -> dict:
    llm_env, llm_secrets = _llm_secret_config(llm_credentials)
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


def _load_state() -> dict:
    try:
        value = json.loads(BUILD_STATE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _record_state_history(state: dict) -> None:
    """Keep a bounded history of non-secret deployment metadata."""
    BUILD_HISTORY.parent.mkdir(parents=True, exist_ok=True)
    try:
        history = json.loads(BUILD_HISTORY.read_text(encoding="utf-8"))
        if not isinstance(history, list):
            history = []
    except (OSError, json.JSONDecodeError):
        history = []
    snapshot = {
        key: state.get(key)
        for key in (
            "run_id", "previous_run_id", "started_at", "updated_at", "status", "resource_group_created",
            "resource_group", "environment", "ai_app", "api_app", "web_app", "subscription_id", "subscription_name",
            "location", "ghcr_owner", "image_urls", "web_url", "api_url", "fastapi_url", "neon_database",
            "neon_input_was_pooled", "neon_state_before_restore", "neon_prepared", "llm_providers",
            "database_seed_report", "stripe_test_configured", "error",
        )
        if key in state
    }
    run_id = snapshot.get("run_id")
    history = [item for item in history if not isinstance(item, dict) or item.get("run_id") != run_id]
    history.append(snapshot)
    temp = _make_private_temp_json(history[-50:])
    try:
        temp.replace(BUILD_HISTORY)
        try:
            os.chmod(BUILD_HISTORY, 0o600)
        except OSError:
            pass
    finally:
        temp.unlink(missing_ok=True)


def build_database_bootstrap_sql() -> str:
    """Create/update only the restricted runtime role; NEVER mutate demo users."""
    return r"""BEGIN;
\getenv app_password FASHIONSTORE_APP_PASSWORD
SELECT format(
  CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fashionstore_app')
       THEN 'ALTER ROLE fashionstore_app WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
       ELSE 'CREATE ROLE fashionstore_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
  END, :'app_password')
\gexec
GRANT app_runtime TO fashionstore_app;
GRANT app_readonly TO fashionstore_app;
GRANT USAGE ON SCHEMA public TO fashionstore_app;
COMMIT;
"""


WIPE_PUBLIC_SQL = """DROP SCHEMA public CASCADE;
CREATE SCHEMA public AUTHORIZATION CURRENT_USER;
GRANT USAGE ON SCHEMA public TO PUBLIC;"""


def _parse_fingerprint(raw: str) -> dict[str, int]:
    line = (str(raw or "").splitlines() or [""])[-1].strip().strip('"')
    counts: dict[str, int] = {}
    for item in filter(None, line.split(",")):
        name, _, value = item.rpartition("=")
        if name and value.lstrip("-").isdigit():
            counts[name] = int(value)
    return counts


FINGERPRINT_SQL = """SELECT COALESCE(string_agg(relname || '=' || cnt, ',' ORDER BY relname), '')
FROM (
  SELECT c.relname,
         (xpath('/row/c/text()', query_to_xml(
            format('SELECT count(*) AS c FROM public.%I', c.relname), false, true, '')))[1]::text AS cnt
    FROM pg_catalog.pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
) t"""


def verify_restored_data(runner: Runner, owner: NeonConnection) -> dict:
    """Verify all five active demo logins and collect per-table row counts."""
    emails = ", ".join("'" + email + "'" for email in SEED_USERS)
    users_sql = (
        "SELECT count(*)::text FROM public.usuarios "
        "WHERE tenant_id='legacy' AND activo=TRUE AND email IN (" + emails + ") "
        f"AND password_hash = crypt('{SEED_PASSWORD}', password_hash)"
    )
    users_raw = _psql_value(runner, owner, users_sql)
    users_ok = (users_raw.splitlines() or [""])[-1].strip().strip('"')
    if users_ok != str(len(SEED_USERS)):
        raise DeployError(
            f"Los usuarios de prueba no coinciden con el seed local: válidos {users_ok or 0} de {len(SEED_USERS)}."
        )
    counts = _parse_fingerprint(_psql_value(runner, owner, FINGERPRINT_SQL))
    if not counts:
        raise DeployError("No pude leer el conteo de tablas tras restaurar la base.")
    return {
        "tables": len(counts),
        "rows": sum(counts.values()),
        "demo_users_active_and_password_verified": int(users_ok),
        "table_row_counts": counts,
    }


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


def prepare_neon_database(
    runner: Runner,
    owner: NeonConnection,
    *,
    reset_existing: bool = False,
    app_password: str | None = None,
) -> tuple[str, str, dict]:
    """Restore the exact local schema + migrations + seed; existing FashionStore needs consent."""
    current_state = _neon_state(runner, owner)
    if current_state == "foreign":
        raise DeployError("Se detectaron tablas ajenas a FashionStore; no se borró ni modificó la base.")
    if current_state == "fashionstore":
        if not reset_existing:
            raise DeployError("La base Neon ya contiene FashionStore; confirma RESTABLECER-DEMO para restaurarla.")
        print("Restaurando FashionStore: se eliminan las tablas/vistas de public y se aplica el seed local completo ...")
        if shutil.which("psql"):
            _psql(runner, ["--quiet", "--command", WIPE_PUBLIC_SQL], owner)
        else:
            _cloud_sql(runner, owner, "scalar", WIPE_PUBLIC_SQL)
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

    runtime_password = app_password or _new_hex_secret()
    runner.add_sensitive(owner.original_url, owner.password, runtime_password)
    if shutil.which("psql"):
        sql_path = _write_private_temp_text(build_database_bootstrap_sql(), ".sql")
        try:
            _psql(
                runner,
                ["--quiet", "--file", str(sql_path)],
                owner,
                extra_env={"FASHIONSTORE_APP_PASSWORD": runtime_password},
            )
        finally:
            sql_path.unlink(missing_ok=True)
    else:
        _cloud_sql(runner, owner, "provision", extra_env={"FS_APP_PASSWORD": runtime_password})

    report = verify_restored_data(runner, owner)
    runtime_url = build_app_database_url(owner, "fashionstore_app", runtime_password)
    runner.add_sensitive(runtime_url)
    runtime_connection = replace(
        owner,
        original_url=runtime_url,
        host=_pooled_host(owner.host),
        username="fashionstore_app",
        password=runtime_password,
    )
    if shutil.which("psql"):
        access_check = _psql(
            runner,
            [
                "--quiet", "--tuples-only", "--no-align", "--command",
                "BEGIN; SET LOCAL ROLE app_readonly; "
                "SELECT set_config('app.tenant_id', 'legacy', true); "
                "SELECT count(*)::text FROM public.usuarios "
                "WHERE tenant_id='legacy' AND activo=TRUE; COMMIT;",
            ],
            runtime_connection,
        )
        rows = [line.strip() for line in access_check.splitlines() if line.strip()]
        if not rows or not rows[-1].isdigit() or int(rows[-1]) < len(SEED_USERS):
            raise DeployError("El rol runtime no pudo validar acceso de lectura/RLS a los usuarios semilla.")
    else:
        verification = _cloud_sql(runner, runtime_connection, "verify-app")
        if not verification.startswith("VERIFY OK esquema_version=") or " cuenta_admin=1" not in verification:
            raise DeployError("El rol runtime no pudo validar esquema ni acceso de lectura/RLS a la cuenta semilla.")
    report["seed_files_sha256"] = {
        file.relative_to(ROOT).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest()
        for file in files
    }
    report["seed_password_policy"] = "same_as_local_demo_seed"
    return runtime_url, runtime_password, report


def _subscription(runner: Runner, preferred_id: str | None = None) -> tuple[str, str]:
    accounts = runner.az_json(["account", "list"])
    if not isinstance(accounts, list):
        raise DeployError("Azure CLI no devolvió la lista de suscripciones esperada.")
    enabled = [account for account in accounts if str(account.get("state", "Enabled")).lower() == "enabled"]
    if not enabled:
        raise DeployError("No hay una suscripción Azure habilitada. Inicia sesión con az login y verifica el acceso.")

    print("\nSuscripciones Azure disponibles:")
    preferred_index = next((i for i, a in enumerate(enabled, 1) if str(a.get("id", "")) == str(preferred_id or "")), None)
    for index, account in enumerate(enabled, 1):
        marker = " (última utilizada)" if index == preferred_index else ""
        print(f"  {index}) {account.get('name', '(sin nombre)')} [{account.get('id', '')}]{marker}")
    default_index = preferred_index or 1
    while True:
        answer = input(f"Elige una suscripción [1-{len(enabled)}] [{default_index}]: ").strip() or str(default_index)
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


# Regiones preferidas (más cercanas a Bolivia primero) cuando la política limita las permitidas.
REGION_PREFERENCE = ("chilecentral", "brazilsouth", "mexicocentral", "canadacentral", "francecentral")


def _default_region(runner: Runner) -> tuple[str, list[str]]:
    """Elige una región por defecto compatible con Express y con la política de la suscripción.

    Devuelve (región_por_defecto, regiones_permitidas_ordenadas). Si no hay política o no se
    puede leer, conserva eastus; la validación posterior sigue siendo la que decide.
    """
    try:
        allowed = _policy_allowed_regions(runner)
    except Exception:
        allowed = None
    if not allowed:
        return "eastus", []
    usable = sorted(allowed & EXPRESS_REGIONS)
    if not usable:
        return "eastus", []
    ordered = [r for r in REGION_PREFERENCE if r in usable] + [r for r in usable if r not in REGION_PREFERENCE]
    return ordered[0], ordered


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


def _parse_bool_output(output: str) -> str:
    """Accept bare TSV, JSON booleans, and harmless Azure CLI warning wrappers."""
    raw = str(output or "").strip()
    try:
        parsed = json.loads(raw)
        if parsed is True:
            return "true"
        if parsed is False:
            return "false"
        if isinstance(parsed, str) and parsed.strip().lower() in {"true", "false"}:
            return parsed.strip().lower()
    except json.JSONDecodeError:
        pass
    values = [line.strip().strip('"').lower() for line in raw.splitlines()]
    values = [value for value in values if value in {"true", "false"}]
    return values[-1] if values else ""


def _resource_group_exists(runner: Runner, subscription_id: str, resource_group: str) -> bool:
    """Use az group exists, then group show as a fallback for broken TSV/JSON output."""
    command = [
        "az", "group", "exists", "--name", resource_group,
        "--subscription", subscription_id, "--only-show-errors", "--output", "json",
    ]
    first_error = ""
    try:
        raw = runner.run(command, quiet=True)
    except DeployError as exc:
        raw = ""
        first_error = str(exc)
    parsed = _parse_bool_output(raw)
    if parsed == "true":
        return True
    if parsed == "false":
        return False

    try:
        shown = runner.run(
            ["az", "group", "show", "--name", resource_group, "--subscription", subscription_id,
             "--only-show-errors", "--query", "id", "--output", "tsv"],
            quiet=True,
        )
        return bool(_tsv_value(shown))
    except DeployError as exc:
        detail = str(exc).lower()
        if any(marker in detail for marker in ("resourcegroupnotfound", "resource group not found", "could not be found", "404", "notfound")):
            return False
        raise DeployError(
            "Azure no pudo verificar si el Resource Group existe. Comprueba permisos Reader sobre la suscripción, "
            "el tenant activo y la conectividad de Azure CLI. Detalle: " + (str(exc) + " " + first_error)[-1500:]
        ) from exc


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
    if _resource_group_exists(runner, subscription_id, names["resource_group"]):
        raise DeployError(
            f"El Resource Group generado ya existe ({names['resource_group']}); no se modifican recursos existentes. "
            "Vuelve a iniciar para generar otro nombre."
        )


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


_CLI_NOISE_PREFIXES = ("warning", "the installed extension", "this command", "command group", "az :", "at line:", "+ ")


def _tsv_value(output: str) -> str:
    """Último valor útil de una salida tsv, ignorando avisos de Azure CLI (extensión en preview, etc.)."""
    lines = [line.strip() for line in str(output or "").splitlines()]
    lines = [line for line in lines if line and not line.lower().startswith(_CLI_NOISE_PREFIXES)]
    return lines[-1] if lines else ""


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
            )
            last_state = _tsv_value(last_state)
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
    )
    value = _tsv_value(value)
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
    llm_credentials: dict[str, str] | None = None,
) -> tuple[dict[str, str], dict]:
    """Create only scale-to-zero ACA resources and pull public images from GHCR."""
    resource_group = names["resource_group"]
    _ensure_providers_registered(runner)
    _check_azure_preflight(runner, subscription_id, location, names)
    state.update({
        "status": "azure_creation_pending",
        "subscription_id": subscription_id,
        "subscription_name": subscription_name,
        "location": location,
        **names,
        "ghcr_owner": ghcr_owner,
        "image_urls": image_urls,
        "neon_prepared": True,
        "resource_group_created": False,
    })
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    _resource_group_state(state)

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
    )
    environment_id = _tsv_value(environment_id)
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
        *(llm_credentials or {}).values(),
    )

    ai_payload = _fastapi_containerapp_payload(
        location=location,
        environment_id=environment_id,
        image=image_urls["ai"],
        app_database_url=app_database_url,
        ia_key=ia_key,
        llm_credentials=llm_credentials,
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
        "llm_providers": sorted((llm_credentials or {}).keys()),
        "llm_configured": bool(llm_credentials),
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
        print("Neon se conserva; el archivo de estado registra el último punto alcanzado.", file=sys.stderr)
    elif state.get("neon_setup_started") and not state.get("neon_prepared"):
        print("\nLa restauración Neon pudo quedar parcial. Inspecciona la base antes de continuar; el asistente no borrará tablas desconocidas automáticamente.", file=sys.stderr)
    elif state.get("neon_prepared"):
        print("\nNeon quedó preparada, pero Azure no terminó. Puedes volver a ejecutar y confirmar RESTABLECER-DEMO para reponer los datos de fábrica.", file=sys.stderr)


def main() -> int:
    runner = Runner()
    previous_state = _load_state()
    state: dict = {
        "run_id": secrets.token_hex(8),
        "status": "starting",
        "resource_group_created": False,
        "neon_setup_started": False,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "previous_run_id": previous_state.get("run_id"),
    }
    _save_state(state)
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

        subscription_id, subscription_name = _subscription(runner, str(previous_state.get("subscription_id") or "") or None)
        default_region, allowed_regions = _default_region(runner)
        if allowed_regions:
            print("Tu suscripción solo permite estas regiones compatibles con Express: " + ", ".join(allowed_regions))
        saved_location = str(previous_state.get("location") or default_region)
        location = input(f"Región Azure (nombre corto) [{saved_location}]: ").strip() or saved_location
        saved_owner = str(previous_state.get("ghcr_owner") or "")
        ghcr_owner = normalize_ghcr_owner(input(f"Owner de GitHub que publica los paquetes públicos GHCR [{saved_owner}]: ").strip() or saved_owner)
        names = _resource_names()
        state.update({**names, "subscription_id": subscription_id, "subscription_name": subscription_name, "location": location, "ghcr_owner": ghcr_owner})
        print(f"Se reservará un Resource Group nuevo: {names['resource_group']} (no se borrarán recursos existentes).")

        # Register ACA providers before resource preflight; this updates metadata only.
        _ensure_providers_registered(runner)
        _check_azure_preflight(runner, subscription_id, location, names)
        image_urls = check_public_ghcr_images(ghcr_owner)
        print("Preflight Azure y lectura anónima de las tres imágenes GHCR correctos; aún no se han creado recursos.")
        print("\nAbriendo Neon. Usa una base/branch dedicada a FashionStore; no pegues una base con datos ajenos.")
        print("Puedes pegar la URL directa o pooled; el asistente convertirá -pooler al endpoint directo para migraciones.")
        print("La URL se pedirá oculta, se usará localmente y no se guardará en archivos del repo.")
        print(f"Si el navegador no abre automáticamente, visita: {NEON_CONSOLE}")
        webbrowser.open(NEON_CONSOLE)
        owner_url = getpass.getpass("Pega la URL directa owner de Neon (entrada oculta): ").strip()
        owner = parse_neon_connection_url(owner_url)
        runner.add_sensitive(owner.original_url, owner.password)
        if owner.input_was_pooled:
            print("Detecté -pooler en el host y lo normalicé automáticamente para ejecutar schema/migraciones/seed.")
        neon_state = preflight_neon(runner, owner)
        state.update({"neon_database": owner.database, "neon_input_was_pooled": owner.input_was_pooled, "neon_state_before_restore": neon_state})
        _save_state(state)
        if neon_state == "fashionstore":
            print("ATENCIÓN: se eliminarán los datos actuales de FashionStore en public y se repondrá toda la demo local.")
            if input("Para confirmar esta restauración escribe RESTABLECER-DEMO: ").strip() != "RESTABLECER-DEMO":
                raise DeployError("Restauración cancelada; no se modificó Neon.")

        llm_credentials = _read_optional_llm_credentials()
        runner.add_sensitive(*(llm_credentials or {}).values())

        print("\nConfirmación final:")
        print("- Se aplicarán schema.sql, todas las migraciones 003–010 y seed.sql, igual que iniciar.py en modo local.")
        print("- Se conservarán exactamente las cinco cuentas semilla y sus contraseñas locales; no se desactivarán usuarios.")
        print(f"- Se usarán imágenes GHCR públicas de {ghcr_owner}; no se crea ACR ni se guardan tokens de registry.")
        print("- IA generativa: " + (f"claves configuradas para {', '.join(sorted(llm_credentials))} en secretos de FastAPI." if llm_credentials else "sin claves externas; funcionará el asistente local determinista con datos de la base."))
        print("- Luego se crearán Resource Group, entorno Express sin Log Analytics y 3 Container Apps a escala cero; uso/egress fuera de cuotas podría generar cargos Azure.")
        print("- No se borrará Neon ni Azure automáticamente si algo falla.")
        if input("Escribe DEPLOY-TEST para aplicar la base y desplegar: ").strip() != "DEPLOY-TEST":
            raise DeployError("Cancelado antes de modificar Neon o crear recursos Azure.")

        state["neon_setup_started"] = True
        state["status"] = "neon_setup_in_progress"
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_state(state)
        app_database_url, app_database_password, seed_report = prepare_neon_database(
            runner, owner, reset_existing=(neon_state == "fashionstore")
        )
        runner.add_sensitive(app_database_url, app_database_password)
        state["neon_prepared"] = True
        state["database_seed_report"] = seed_report
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_state(state)
        print(f"Neon quedó preparado y verificado: {seed_report['tables']} tablas, {seed_report['rows']} filas, {seed_report['demo_users_active_and_password_verified']} usuarios semilla activos.")

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
            llm_credentials=llm_credentials,
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
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_state(state)
        _record_state_history(state)

        print("\nDESPLIEGUE CLOUD VERIFICADO")
        print(f"Web: {result['web_url']}")
        print(f"API: {result['api_url']}")
        print(f"Salud Nest+Neon: {result['api_url']}/api/health")
        print(f"Inicio de sesión demo: legacy / {result['admin_email']} / {SEED_PASSWORD}")
        print("Otras cuentas: encargado@fashionstore.bo, cajero@fashionstore.bo, proveedor@fashionstore.bo y cliente@fashionstore.bo (misma contraseña semilla).")
        print(f"Resource Group de prueba: {result['resource_group']}")

        try:
            stripe_configured = maybe_enable_stripe(runner, result, api_payload)
            state["stripe_test_configured"] = stripe_configured
            state["updated_at"] = datetime.now(timezone.utc).isoformat()
            _save_state(state)
            _record_state_history(state)
        except DeployError as exc:
            state["stripe_test_configured"] = False
            state["stripe_setup_error"] = _redact(str(exc), runner.sensitive)
            state["updated_at"] = datetime.now(timezone.utc).isoformat()
            _save_state(state)
            _record_state_history(state)
            print(f"[STRIPE] Despliegue activo, pero Stripe test no quedó configurado: {state['stripe_setup_error']}", file=sys.stderr)

        print("\nEl despliegue respondió en vivo; esto no acredita una operación de compra ni un webhook Stripe real.")
        print(f"Metadatos sin secretos: {BUILD_STATE.relative_to(ROOT)}")
        print("Express usa concesiones gratuitas compartidas por suscripción (180,000 vCPU-s, 360,000 GiB-s y 2 M solicitudes/mes publicadas); el exceso/egress puede facturarse. Revisa el costo y elimina el RG al terminar.")
        print("Limpieza (solo tras verificar que el RG contiene esta prueba): az group delete --name " + result["resource_group"] + " --yes --no-wait")
        return 0

    except KeyboardInterrupt:
        print("\nInterrumpido. Revisa Azure si ya empezó la creación; no se eliminó ningún recurso.", file=sys.stderr)
        state["status"] = "interrupted"
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            _save_state(state)
            _record_state_history(state)
        except OSError:
            pass
        _print_cleanup(state)
        return 130
    except Exception as exc:
        safe_message = _redact(str(exc), runner.sensitive)
        print(f"[ERROR] {safe_message}", file=sys.stderr)
        state["status"] = "incomplete"
        state["error"] = safe_message
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            _save_state(state)
            _record_state_history(state)
        except OSError:
            pass
        _print_cleanup(state)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
