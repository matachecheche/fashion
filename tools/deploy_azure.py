#!/usr/bin/env python3
"""Flujo asistido de FashionStore: Neon + Azure Container Apps + Stripe test.

El BAT comprueba herramientas e inicia sesión Azure; este script pide la URL Neon
localmente, restaura una base vacía o una instalación FashionStore confirmada y despliega
imágenes públicas desde GHCR. No crea ACR ni guarda credenciales en el repo/estado. Azure aún
puede generar cargos de consumo y egress.
"""
from __future__ import annotations

import getpass
import json
import base64
import ntpath
import ctypes
from ctypes import wintypes
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
DEPLOY_PROFILE = ROOT / "builds" / "deploy-profile.json"
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


YES_VALUES = {"s", "si", "sí", "y", "yes"}
NO_VALUES = {"n", "no"}
CANCEL_VALUES = {"cancelar", "cancel", "salir"}


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
    """Run tools with stdout/stderr separated and redact credentials from errors.

    On Windows, Azure CLI is normally installed as ``az.cmd``. It must be
    launched through cmd.exe, not PowerShell: PowerShell can serialize native
    stderr as CLIXML ErrorRecords, which previously contaminated JSON/TSV
    responses and even became the value of Container Apps ``environmentId``.
    """

    def __init__(self) -> None:
        self.sensitive: list[str] = []

    def add_sensitive(self, *values: str) -> None:
        self.sensitive.extend(str(value) for value in values if value)

    @staticmethod
    def _windows_az_command(args: Sequence[str], env: dict[str, str]) -> list[str] | str:
        az_executable = shutil.which("az")
        if not az_executable:
            raise DeployError("No se encontró Azure CLI (az) en PATH.")

        suffix = os.path.splitext(az_executable)[1].lower()
        if suffix not in {".cmd", ".bat"}:
            return [az_executable, *[str(value) for value in args]]

        # Prefer cmd.exe from the local Windows installation. COMSPEC can be
        # customized by terminals, remote sessions, or enterprise logon scripts;
        # an invalid/UNC COMSPEC was causing 'The network path was not found'
        # before Azure CLI even received `account list`.
        system_root = env.get("SystemRoot") or env.get("WINDIR") or r"C:\Windows"
        local_cmd = ntpath.join(system_root, "System32", "cmd.exe")
        candidates = [local_cmd, env.get("COMSPEC", ""), shutil.which("cmd.exe") or ""]
        comspec = ""
        for candidate in candidates:
            candidate = str(candidate or "").strip().strip('"')
            if not candidate:
                continue
            normalized = candidate.replace("/", "\\")
            # Do not trust network/UNC shells for this local deployment runner.
            if normalized.startswith("\\\\") and not normalized.startswith("\\\\?\\"):
                continue
            if os.path.isfile(candidate):
                comspec = candidate
                break
        if not comspec:
            raise DeployError(
                "No se encontró cmd.exe en la instalación local de Windows. "
                "Comprueba SystemRoot y ejecuta `where cmd` desde CMD."
            )

        # Invoke a batch file with CALL. Starting /c with a quoted executable
        # and wrapping the whole command in another pair of quotes (/s /c)
        # is fragile: CMD may strip the wrong quote pair when paths contain
        # spaces. With CALL as the first token, /c receives a plain command;
        # list2cmdline quotes each path/argument separately.
        # Also normalize COMSPEC in the child environment in case the az.cmd
        # wrapper or an extension starts another CMD process.
        env["COMSPEC"] = comspec
        quoted_cmd = f'"{comspec}"'
        quoted_executable = subprocess.list2cmdline([az_executable])
        quoted_arguments = subprocess.list2cmdline([str(value) for value in args])
        command = f"call {quoted_executable}"
        if quoted_arguments:
            command += " " + quoted_arguments
        # Pass one raw CreateProcess command line. If this were passed as a
        # Python list, Python would quote the /c payload again; CMD can then
        # misparse the nested quotes around paths containing spaces.
        return f"{quoted_cmd} /d /c {command}"

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

        if os.name == "nt" and cmd and cmd[0].lower() == "az":
            actual = self._windows_az_command(cmd[1:], env)
        else:
            actual = cmd

        # The launcher BAT already changes to the project folder. Inheriting
        # that current directory for Azure CLI avoids a second Windows cwd
        # resolution through OneDrive/network-backed paths. Other tools retain
        # the explicit project ROOT as their working directory.
        run_cwd = str(cwd or ROOT)
        if os.name == "nt" and cmd and cmd[0].lower() == "az" and cwd is None:
            run_cwd = None  # type: ignore[assignment]

        try:
            completed = subprocess.run(
                actual,
                cwd=run_cwd,
                env=env,
                text=True,
                encoding="utf-8",
                errors="replace",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        except OSError as exc:
            raise DeployError(f"No se pudo ejecutar {cmd[0]}: {exc}") from exc

        output = _redact(completed.stdout or "", self.sensitive).strip()
        error_output = _redact(completed.stderr or "", self.sensitive).strip()
        if completed.returncode != 0:
            parts = [part for part in (output, error_output) if part]
            detail = "\n".join(parts)[-7000:] if parts else "sin detalle del proceso"
            network_path_error = any(
                marker in detail.casefold()
                for marker in (
                    "no se ha encontrado la ruta de acceso de la red",
                    "the network path was not found",
                    "network path was not found",
                )
            )
            if network_path_error and os.name == "nt" and cmd and cmd[0].lower() == "az":
                detail += (
                    "\n\nDiagnóstico: CMD no pudo resolver la ruta del proceso. "
                    "La nueva versión fuerza el cmd.exe local de Windows y ejecuta az.cmd con CALL. "
                    "Si persiste, abre CMD (no PowerShell) en la carpeta del proyecto y comprueba: "
                    "where cmd & where az & echo %COMSPEC% & az account show."
                )
            raise DeployError(f"Falló {cmd[0]} (código {completed.returncode}). Salida saneada:\n{detail}")

        if not quiet:
            if output:
                print(output)
            if error_output:
                # Azure CLI and its extension may emit non-fatal warnings to stderr.
                print(error_output, file=sys.stderr)
        # Structured data consumers receive stdout only. Warning text stays separate.
        return output

    def az_json(self, args: Sequence[str]) -> object:
        normalized = list(args)
        if "--only-show-errors" not in normalized:
            normalized.append("--only-show-errors")
        if "--output" not in normalized:
            normalized.extend(["--output", "json"])
        output = self.run(["az", *normalized], quiet=True)
        return _json_from_cli_output(output)

    def az_quiet(self, args: Sequence[str]) -> None:
        # Suppress informational warnings; Runner still keeps stdout/stderr separate.
        normalized = list(args)
        if "--only-show-errors" not in normalized:
            normalized.append("--only-show-errors")
        if "--output" not in normalized:
            normalized.extend(["--output", "none"])
        self.run(["az", *normalized], quiet=True)


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
        print("Podrás reutilizar sus datos actuales o, si confirmas expresamente, restaurar la demo desde cero.")
    return state


def _prompt_yes_no(prompt: str, *, default: bool = False) -> bool:
    """Keep prompting after a typo; only an explicit S/N decision is accepted."""
    while True:
        answer = input(prompt).strip().casefold()
        if not answer:
            return default
        if answer in YES_VALUES:
            return True
        if answer in NO_VALUES:
            return False
        print("Respuesta no reconocida. Escribe S para sí o N para no; puedes intentarlo nuevamente.")


def _prompt_exact_confirmation(prompt: str, expected: str, *, purpose: str) -> bool:
    """Retry a mistyped safety token rather than aborting on the first typo."""
    while True:
        answer = input(prompt).strip()
        if answer == expected:
            return True
        if answer.casefold() in CANCEL_VALUES:
            return False
        print(f"El texto no coincide. Vuelve a escribir {expected} para {purpose}, o escribe CANCELAR para salir.")


def _prompt_neon_connection(saved_url: str | None = None, *, prefer_saved: bool = False) -> NeonConnection:
    """Ask again when the user pastes a malformed Neon URL; never echo the URL."""
    if saved_url and prefer_saved and _prompt_yes_no("¿Reutilizar la conexión Neon guardada? (S/n): ", default=True):
        try:
            return parse_neon_connection_url(saved_url)
        except DeployError:
            print("[AVISO] La URL guardada no es válida; introduce una conexión nueva.")
    while True:
        raw = getpass.getpass("Pega la URL directa owner de Neon (entrada oculta; Enter para cancelar): ").strip()
        if not raw:
            raise DeployError("No se recibió una URL de Neon; no se modificó la base.")
        try:
            return parse_neon_connection_url(raw)
        except DeployError as exc:
            print(f"[DATO INVÁLIDO] {exc}")
            print("Vuelve a pegar la URL completa de Neon. La URL no se mostrará en pantalla.")

def _is_retryable_neon_connection_error(error: Exception) -> bool:
    """Recognize errors commonly caused by a mistyped Neon URL/user/password/database."""
    message = str(error).casefold()
    markers = (
        "password authentication failed",
        "authentication failed",
        "could not connect to server",
        "connection refused",
        "connection timed out",
        "timeout expired",
        "could not translate host name",
        "name or service not known",
        "getaddrinfo failed",
        'database "',
        "does not exist",
        'role "',
        "no pg_hba.conf entry",
        "permission denied for database",
        "connection reset by peer",
        "server closed the connection unexpectedly",
        "ssl syscall",
    )
    return any(marker in message for marker in markers)


def _prompt_and_preflight_neon(
    runner: Runner, saved_url: str | None = None, *, auto_use_saved: bool = False
) -> tuple[NeonConnection, str]:
    """Reuse a protected Neon URL or prompt again if it is missing/invalid."""
    if saved_url and auto_use_saved:
        try:
            owner = parse_neon_connection_url(saved_url)
        except DeployError:
            owner = None
            print("[AVISO] La URL Neon guardada no tiene un formato válido. Se solicitará una nueva.")
        if owner is not None:
            runner.add_sensitive(owner.original_url, owner.password)
            try:
                return owner, preflight_neon(runner, owner)
            except DeployError as exc:
                if not _is_retryable_neon_connection_error(exc):
                    raise
                print("[AVISO] La conexión Neon guardada ya no funciona. Se solicitará una nueva URL.")
    while True:
        owner = _prompt_neon_connection(saved_url, prefer_saved=bool(saved_url and not auto_use_saved))
        runner.add_sensitive(owner.original_url, owner.password)
        try:
            return owner, preflight_neon(runner, owner)
        except DeployError as exc:
            if not _is_retryable_neon_connection_error(exc):
                raise
            print("[CONEXIÓN NEON NO VÁLIDA] No se pudo autenticar o abrir la base con esos datos.")
            print("Revisa usuario, contraseña, host y nombre de base. Vuelve a pegar la URL completa; no se mostrará en pantalla.")


def _prompt_region(runner: Runner, prompt: str, default: str, *, allowed_regions: list[str] | None = None,
                   exclude: set[str] | None = None) -> str:
    """Validate a region at entry time and let the user correct it immediately."""
    excluded = {_normal_region(value) for value in (exclude or set())}
    while True:
        answer = input(prompt).strip() or default
        normalized = _normal_region(answer)
        if normalized in excluded:
            print("Esa región ya tiene un entorno Express y no hay cuota para crear otro. Elige otra región.")
            continue
        try:
            _validate_location(runner, answer)
            if allowed_regions and normalized not in {_normal_region(value) for value in allowed_regions}:
                print("La región no está dentro de las permitidas por tu suscripción. Opciones: " + ", ".join(allowed_regions))
                continue
            return normalized
        except DeployError as exc:
            print(f"[REGIÓN INVÁLIDA] {exc}")
            options = ", ".join(allowed_regions) if allowed_regions else ", ".join(REGION_PREFERENCE)
            print(f"Vuelve a introducir una región compatible. Opciones conocidas: {options}.")


def _prompt_ghcr_owner(saved_owner: str) -> str:
    while True:
        raw = input(f"Owner de GitHub que publica los paquetes públicos GHCR [{saved_owner}]: ").strip() or saved_owner
        try:
            return normalize_ghcr_owner(raw)
        except DeployError as exc:
            print(f"[DATO INVÁLIDO] {exc} Vuelve a introducir el owner.")

def _check_ghcr_images_with_retry(owner: str) -> tuple[str, dict[str, str]]:
    """Retry a syntactically valid but incorrect GHCR owner/package namespace."""
    while True:
        try:
            return owner, check_public_ghcr_images(owner)
        except DeployError as exc:
            message = str(exc)
            if "no existe o no es pública" not in message:
                raise
            print(f"[OWNER/PAQUETE GHCR NO VÁLIDO] {message}")
            print("Comprueba el owner y que las tres imágenes sean públicas. Puedes volver a introducir el owner.")
            owner = _prompt_ghcr_owner(owner)


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


def _is_groq_api_key(key: str) -> bool:
    """Groq uses its own gsk_ key format; Stripe and Google keys are not interchangeable."""
    return key.startswith("gsk_") and len(key) >= 20 and not re.search(r"REPLACE|CHANGE_ME", key, re.I)


def _is_gemini_api_key(key: str) -> bool:
    """Accept legacy AIza keys and Google's newer AQ.* authorization-key format."""
    return key.startswith(("AIza", "AQ.")) and len(key) >= 20 and not re.search(r"REPLACE|CHANGE_ME", key, re.I)


def _is_stripe_test_api_key(key: str) -> bool:
    """Accept Stripe restricted or secret keys in test mode only."""
    return key.startswith(("rk_test_", "sk_test_")) and len(key) >= 16 and not re.search(r"REPLACE|CHANGE_ME", key, re.I)


def _read_optional_llm_credentials(
    saved_credentials: dict[str, str] | None = None, *, auto_use_saved: bool = False,
    preferred_providers: Iterable[str] | None = None,
) -> dict[str, str]:
    """Collect/reuse optional LLM keys and identify keys pasted into the wrong provider prompt."""
    print("\nIA generativa opcional. Puedes configurar Groq, Gemini, ambos o ninguno.")
    print("  Groq:   gsk_... (solo claves Groq).")
    print("  Gemini: AIza... o AQ.Ab8RN6KzvT-... (claves de Google Gemini).")
    print("  Stripe: rk_test_... o sk_test_... (se solicitará por separado después del despliegue).")
    print("Las claves IA se guardan como secretos de Azure Container Apps, no en el ZIP ni en el archivo de estado.")
    credentials: dict[str, str] = {}
    saved_credentials = saved_credentials or {}
    preferred = {str(value).casefold() for value in (preferred_providers or [])}
    for provider in ("groq", "gemini"):
        saved_key = str(saved_credentials.get(provider) or "")
        saved_valid = _is_groq_api_key(saved_key) if provider == "groq" else _is_gemini_api_key(saved_key)
        if saved_valid and auto_use_saved:
            credentials[provider] = saved_key
            print(f"[OK] Se reutiliza la clave {provider.capitalize()} guardada (cifrada).")
            continue
        if auto_use_saved and provider not in preferred:
            print(f"[OK] {provider.capitalize()} quedó omitido en el perfil anterior; no se volverá a preguntar.")
            continue
        if saved_valid and _prompt_yes_no(f"¿Mantener la clave {provider.capitalize()} guardada? (S/n): ", default=True):
            credentials[provider] = saved_key
            continue
        # If a Gemini key was recognized in the previous prompt, do not ask for it twice.
        if provider in credentials:
            print("[OK] Se detectó y reservó una clave Gemini; no se volverá a solicitar.")
            continue
        should_configure_by_profile = provider in preferred
        if not _prompt_yes_no(
            f"¿Configurar {provider.capitalize()} ahora? (s/N): ", default=should_configure_by_profile
        ):
            continue
        while True:
            key = getpass.getpass(f"Clave API {provider} (entrada oculta; Enter para omitir): ").strip()
            if not key:
                print(f"[AVISO] {provider.capitalize()} queda sin configurar; el despliegue continuará.")
                break

            if _is_stripe_test_api_key(key):
                print("[DATO EN CAMPO INCORRECTO] Esa clave pertenece a Stripe test (rk_test_/sk_test_), no a IA.")
                print("No se descarta el despliegue: vuelve a introducir la clave correcta o pulsa Enter para omitir.")
                continue

            if provider == "groq" and _is_gemini_api_key(key):
                credentials["gemini"] = key
                print("[OK] Se reconoció una clave Gemini (AQ./AIza) en el campo de Groq.")
                print("Se reservará para Gemini; Groq quedará omitido. La clave no se mezclará entre proveedores.")
                break

            valid = _is_groq_api_key(key) if provider == "groq" else _is_gemini_api_key(key)
            if not valid:
                expected = "gsk_..." if provider == "groq" else "AQ.Ab8R... o AIza..."
                print(f"[DATO INVÁLIDO] El formato de {provider.capitalize()} no es correcto; se esperaba {expected}.")
                print("Vuelve a introducir la clave correcta o pulsa Enter para omitir este proveedor.")
                continue
            credentials[provider] = key
            break
    return credentials


def _llm_secret_config(credentials: dict[str, str] | None) -> tuple[list[dict[str, str]], dict[str, str]]:
    env: list[dict[str, str]] = []
    secrets: dict[str, str] = {}
    for provider, key in (credentials or {}).items():
        if provider not in {"groq", "gemini"} or not key:
            raise DeployError("Proveedor IA no válido o clave vacía.")
        expected = _is_groq_api_key(key) if provider == "groq" else _is_gemini_api_key(key)
        if not expected:
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


def _supports_dpapi() -> bool:
    return os.name == "nt"


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _dpapi_protect(raw: bytes) -> str:
    """Encrypt profile secrets with Windows DPAPI for the current Windows user."""
    if not _supports_dpapi():
        raise DeployError("El guardado cifrado de credenciales requiere Windows DPAPI.")
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    source_buffer = ctypes.create_string_buffer(raw)
    source = _DATA_BLOB(len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte)))
    output = _DATA_BLOB()
    crypt32.CryptProtectData.argtypes = [
        ctypes.POINTER(_DATA_BLOB), wintypes.LPCWSTR, ctypes.POINTER(_DATA_BLOB),
        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_DATA_BLOB),
    ]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if not crypt32.CryptProtectData(ctypes.byref(source), "FashionStore deployment profile", None, None, None, 0x1, ctypes.byref(output)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        encrypted = ctypes.string_at(output.pbData, output.cbData)
        return base64.b64encode(encrypted).decode("ascii")
    finally:
        kernel32.LocalFree(output.pbData)


def _dpapi_unprotect(encoded: str) -> bytes:
    """Decrypt profile secrets; only the same Windows user on this device can do so."""
    if not _supports_dpapi():
        raise DeployError("El descifrado DPAPI solo está disponible en Windows.")
    encrypted = base64.b64decode(encoded, validate=True)
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    source_buffer = ctypes.create_string_buffer(encrypted)
    source = _DATA_BLOB(len(encrypted), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte)))
    output = _DATA_BLOB()
    description = wintypes.LPWSTR()
    crypt32.CryptUnprotectData.argtypes = [
        ctypes.POINTER(_DATA_BLOB), ctypes.POINTER(wintypes.LPWSTR), ctypes.POINTER(_DATA_BLOB),
        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(_DATA_BLOB),
    ]
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if not crypt32.CryptUnprotectData(ctypes.byref(source), ctypes.byref(description), None, None, None, 0x1, ctypes.byref(output)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel32.LocalFree(output.pbData)
        if description:
            kernel32.LocalFree(ctypes.cast(description, ctypes.c_void_p))


def _load_deploy_profile() -> tuple[dict, dict]:
    """Load editable settings and decrypt any saved credentials, if available."""
    try:
        profile = json.loads(DEPLOY_PROFILE.read_text(encoding="utf-8"))
        if not isinstance(profile, dict):
            return {}, {}
    except (OSError, json.JSONDecodeError):
        return {}, {}
    secrets_data: dict = {}
    encrypted = profile.get("secrets_protected")
    if encrypted:
        try:
            decoded = json.loads(_dpapi_unprotect(str(encrypted)).decode("utf-8"))
            if isinstance(decoded, dict):
                secrets_data = decoded
                secrets_data["__profile_secrets_loaded__"] = True
        except Exception:
            print("[AVISO] No se pudieron descifrar las credenciales guardadas. Se solicitarán nuevamente.")
            secrets_data["__decrypt_failed__"] = True
    return profile, secrets_data


def _save_deploy_profile(profile: dict, secrets_data: dict | None = None) -> None:
    """Persist one human-editable JSON profile; credentials are DPAPI-encrypted on Windows."""
    DEPLOY_PROFILE.parent.mkdir(parents=True, exist_ok=True)
    output = {
        "version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "instructions": "Edita settings para cambiar valores no secretos. Las credenciales se guardan cifradas con DPAPI del usuario Windows actual; usa el asistente para cambiarlas.",
        "settings": dict(profile.get("settings") or {}),
    }
    secret_values = dict(secrets_data or {})
    if secret_values and _supports_dpapi():
        output["secret_protection"] = "Windows DPAPI / CurrentUser"
        output["secrets_protected"] = _dpapi_protect(json.dumps(secret_values, ensure_ascii=False).encode("utf-8"))
    elif profile.get("secrets_protected"):
        # Preserve ciphertext if the profile is edited on a non-Windows machine.
        output["secret_protection"] = profile.get("secret_protection", "Windows DPAPI / CurrentUser")
        output["secrets_protected"] = profile["secrets_protected"]
    elif _supports_dpapi():
        output["secret_protection"] = "Windows DPAPI / CurrentUser (sin credenciales guardadas todavía)"
        output["secrets_protected"] = ""
    else:
        output["secret_protection"] = "No disponible en este sistema; el asistente volverá a solicitar credenciales."
        output["secrets_protected"] = ""
    temporary = _make_private_temp_json(output)
    try:
        temporary.replace(DEPLOY_PROFILE)
        try:
            os.chmod(DEPLOY_PROFILE, 0o600)
        except OSError:
            pass
    finally:
        temporary.unlink(missing_ok=True)


def _select_profile_mode(profile: dict) -> str:
    """Offer a fast repeat deployment, full review, or opening the editable profile."""
    settings = profile.get("settings") if isinstance(profile.get("settings"), dict) else {}
    configured = bool(settings.get("subscription_id") and settings.get("location") and settings.get("ghcr_owner"))
    print("\nPERFIL DE DESPLIEGUE")
    print(f"Archivo: {DEPLOY_PROFILE.relative_to(ROOT)}")
    if configured:
        print("  1) USAR CONFIGURACIÓN ANTERIOR (rápido; reutiliza datos guardados)")
        print("  2) REVISAR/CAMBIAR OPCIONES antes de desplegar")
        print("  3) ABRIR EL ARCHIVO de configuración para editar opciones")
        print("  4) CANCELAR")
        while True:
            choice = input("Elige [1-4] [1]: ").strip() or "1"
            if choice == "1":
                return "quick"
            if choice == "2":
                return "review"
            if choice == "3":
                return "edit"
            if choice == "4" or choice.casefold() in CANCEL_VALUES:
                return "cancel"
            print("Opción inválida. Vuelve a elegir 1, 2, 3 o 4.")
    print("  1) CONFIGURAR DESPLIEGUE (se guardará para la próxima vez)")
    print("  2) ABRIR/CREAR ARCHIVO DE CONFIGURACIÓN")
    print("  3) CANCELAR")
    while True:
        choice = input("Elige [1-3] [1]: ").strip() or "1"
        if choice == "1":
            return "review"
        if choice == "2":
            return "edit"
        if choice == "3" or choice.casefold() in CANCEL_VALUES:
            return "cancel"
        print("Opción inválida. Vuelve a elegir 1, 2 o 3.")


def _open_deploy_profile() -> None:
    """Create a starter profile if needed and open it in the system's default editor."""
    if not DEPLOY_PROFILE.exists():
        _save_deploy_profile({"settings": {
            "ghcr_public": True,
            "subscription_id": "",
            "subscription_name": "",
            "location": "chilecentral",
            "ghcr_owner": "matachecheche",
            "environment_id": "",
            "environment_name": "",
            "environment_resource_group": "",
            "neon_strategy": "reuse",
            "llm_providers": [],
            "stripe_setup_choice": "ask",
        }}, {})
    print(f"\nArchivo de configuración: {DEPLOY_PROFILE}")
    try:
        if _supports_dpapi():
            os.startfile(str(DEPLOY_PROFILE))  # type: ignore[attr-defined]
        else:
            webbrowser.open(DEPLOY_PROFILE.resolve().as_uri())
        print("Se abrió el archivo. Guarda los cambios y vuelve a ejecutar desplegar-azure.bat.")
    except Exception as exc:
        print(f"No se pudo abrir automáticamente: {exc}")
        print("Abre manualmente el archivo indicado con Bloc de notas o tu editor JSON.")


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
       THEN 'ALTER ROLE fashionstore_app WITH LOGIN PASSWORD %L NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
       ELSE 'CREATE ROLE fashionstore_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
  END, :'app_password')
\gexec
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname = 'fashionstore_app'
       AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'fashionstore_app debe ser un rol de aplicación sin privilegios administrativos';
  END IF;
END $$;
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
    reuse_existing: bool = False,
    app_password: str | None = None,
) -> tuple[str, str, dict]:
    """Prepare the runtime role and verify data; optionally restore or reuse existing FashionStore."""
    current_state = _neon_state(runner, owner)
    if current_state == "foreign":
        raise DeployError("Se detectaron tablas ajenas a FashionStore; no se borró ni modificó la base.")
    should_apply_seed = current_state == "empty" or reset_existing
    if current_state == "fashionstore":
        if reset_existing:
            print("Restaurando FashionStore: se eliminan las tablas/vistas de public y se aplica el seed local completo ...")
            if shutil.which("psql"):
                _psql(runner, ["--quiet", "--command", WIPE_PUBLIC_SQL], owner)
            else:
                _cloud_sql(runner, owner, "scalar", WIPE_PUBLIC_SQL)
        elif reuse_existing:
            print("Reutilizando los datos actuales de FashionStore: no se borrarán tablas, pedidos ni registros.")
            print("Se verificará la semilla, se renovará el rol de aplicación y se comprobarán los permisos.")
        else:
            raise DeployError("La base Neon ya contiene FashionStore; confirma RESTABLECER-DEMO para restaurarla.")
    migration_files = _migration_files_for_bootstrap(ROOT / "database" / "migrations")
    files = [ROOT / "database" / "schema.sql", *migration_files, ROOT / "database" / "seed.sql"]
    for sql_file in files:
        if not sql_file.is_file():
            raise DeployError(f"Falta el archivo SQL requerido: {sql_file.relative_to(ROOT)}")
    if should_apply_seed:
        for sql_file in files:
            print(f"Aplicando {sql_file.relative_to(ROOT)} ...")
            if shutil.which("psql"):
                _psql(runner, ["--quiet", "--file", str(sql_file)], owner)
            else:
                _cloud_sql(runner, owner, "file", str(sql_file))
    elif current_state == "fashionstore" and not reuse_existing:
        raise DeployError("La base ya contiene FashionStore; selecciona reutilizarla o restaurar la demo.")

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


def _verify_azure_cli_runner(runner: Runner) -> dict:
    """Run a read-only Azure CLI smoke test through the exact Python runner path."""
    try:
        account = runner.az_json(["account", "show"])
    except DeployError as exc:
        raise DeployError(
            "Azure CLI funciona desde el BAT, pero no pudo ejecutarse desde Python. "
            "No se ha consultado ni modificado ninguna suscripción ni recurso Azure. "
            f"Detalle: {exc}"
        ) from exc
    if not isinstance(account, dict) or not str(account.get("id") or "").strip():
        raise DeployError(
            "Azure CLI no devolvió una sesión activa válida. Ejecuta `az login` desde CMD y vuelve a intentarlo."
        )
    print(f"[OK] Azure CLI también responde desde Python: {account.get('name') or 'suscripción activa'}.")
    return account


def _subscription(runner: Runner, preferred_id: str | None = None, *, auto_select: bool = False) -> tuple[str, str]:
    accounts = runner.az_json(["account", "list"])
    if not isinstance(accounts, list):
        raise DeployError("Azure CLI no devolvió la lista de suscripciones esperada.")
    enabled = [account for account in accounts if str(account.get("state", "Enabled")).lower() == "enabled"]
    if not enabled:
        raise DeployError("No hay una suscripción Azure habilitada. Inicia sesión con az login y verifica el acceso.")

    print("\nSuscripciones Azure disponibles:")
    preferred_index = next((i for i, a in enumerate(enabled, 1) if str(a.get("id", "")) == str(preferred_id or "")), None)
    if auto_select and preferred_index is not None:
        selected = enabled[preferred_index - 1]
        subscription_id = str(selected.get("id", ""))
        runner.az_quiet(["account", "set", "--subscription", subscription_id])
        active = runner.az_json(["account", "show"])
        if str(active.get("id", "")) != subscription_id:
            raise DeployError("Azure no activó la suscripción guardada en el perfil.")
        print(f"[OK] Se reutiliza la suscripción guardada: {selected.get('name')}.")
        return subscription_id, str(selected.get("name", "Azure subscription"))
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


def _validate_managed_environment_id(value: object, subscription_id: str | None = None) -> str:
    """Reject malformed/CLIXML identifiers before putting an ID into ARM payloads."""
    resource_id = str(value or "").strip().strip('"')
    pattern = re.compile(
        r"^/subscriptions/([A-Za-z0-9-]{1,64})/resourceGroups/([^/]+)/providers/"
        r"Microsoft\.App/managedEnvironments/([^/]+)$",
        re.IGNORECASE,
    )
    match = pattern.fullmatch(resource_id)
    if not match:
        raise DeployError(
            "Azure devolvió un ID de Container Apps Environment inválido. "
            "Se descartó la respuesta para evitar enviar texto de PowerShell/CLIXML a Azure Resource Manager."
        )
    if subscription_id and match.group(1).casefold() != str(subscription_id).casefold():
        raise DeployError("El entorno Express pertenece a otra suscripción; selecciona uno de la suscripción activa.")
    return resource_id


def _list_express_environments(runner: Runner, subscription_id: str, location: str) -> list[dict[str, str]]:
    """Find reusable Express environments in this subscription and region.

    Some Azure CLI/extension builds omit environmentMode from the list response.
    In that case, read the resource itself through ARM before deciding that no
    reusable Express environment exists. This avoids creating a duplicate and
    hitting a subscription-specific regional quota.
    """
    raw = runner.az_json([
        "containerapp", "env", "list", "--subscription", subscription_id, "--only-show-errors",
    ])
    if not isinstance(raw, list):
        raise DeployError("Azure no devolvió una lista válida de Container Apps Environments.")

    wanted_location = _normal_region(location)
    matches: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        if _normal_region(str(item.get("location") or "")) != wanted_location:
            continue
        properties = item.get("properties") if isinstance(item.get("properties"), dict) else {}
        mode = (
            properties.get("environmentMode")
            or properties.get("environment_mode")
            or properties.get("environmentType")
            or item.get("environmentMode")
            or item.get("environmentType")
            or ""
        )
        resource_id = str(item.get("id") or "")
        name = str(item.get("name") or "")
        if not resource_id or not name:
            continue
        try:
            resource_id = _validate_managed_environment_id(resource_id, subscription_id)
        except DeployError:
            # Ignore malformed list rows. Never pass an untrusted identifier to ARM.
            continue

        # Older CLI extensions may return only a partial list object. Confirm
        # the mode using the ARM resource endpoint instead of silently missing it.
        if not str(mode).strip() and resource_id.startswith("/subscriptions/"):
            try:
                detail = runner.az_json([
                    "rest", "--method", "get", "--url",
                    f"https://management.azure.com{resource_id}?api-version=2025-07-01",
                ])
                detail_properties = detail.get("properties", {}) if isinstance(detail, dict) else {}
                if isinstance(detail_properties, dict):
                    properties = detail_properties
                    mode = detail_properties.get("environmentMode") or ""
            except DeployError:
                # Never classify an unknown mode as Express. The quota recovery
                # path can still ask the user to select another region.
                mode = ""

        if str(mode).strip().casefold() != "express":
            continue
        provisioning = str(properties.get("provisioningState") or "Succeeded").casefold()
        if provisioning != "succeeded":
            continue
        group_match = re.search(r"/resourceGroups/([^/]+)/providers/Microsoft\.App/managedEnvironments/", resource_id, re.I)
        resource_group = str(item.get("resourceGroup") or (group_match.group(1) if group_match else ""))
        matches.append({
            "id": resource_id,
            "name": name,
            "resource_group": resource_group,
            "location": wanted_location,
            "provisioning_state": provisioning,
        })
    return sorted(matches, key=lambda env: (env["resource_group"], env["name"]))


def _choose_express_environment(
    runner: Runner,
    subscription_id: str,
    location: str,
    allowed_regions: list[str],
    *,
    preferred_environment_id: str | None = None,
    auto_select: bool = False,
) -> tuple[str, dict[str, str] | None]:
    """Reuse a regional Express environment or let the user choose another region."""
    while True:
        existing = _list_express_environments(runner, subscription_id, location)
        if existing:
            preferred = next((item for item in existing if item.get("id") == preferred_environment_id), None)
            if auto_select and preferred:
                print(f"[OK] Se reutiliza el entorno Express guardado: {preferred['name']} ({preferred.get('resource_group') or 'RG existente'}).")
                return location, preferred
            if auto_select and len(existing) == 1:
                print(f"[OK] Se reutiliza el único entorno Express disponible: {existing[0]['name']}.")
                return location, existing[0]
            print(f"\nSe detectaron {len(existing)} entorno(s) Express en {location}.")
            print("Crear otro puede superar el límite regional de tu suscripción. Puedes reutilizar uno sin modificarlo.")
            for index, environment in enumerate(existing, 1):
                rg = environment["resource_group"] or "grupo no identificado"
                print(f"  {index}) {environment['name']}  (RG: {rg}, estado: {environment['provisioning_state']})")
            print("  0) Elegir otra región y no utilizar estos entornos.")
            while True:
                answer = input(f"Selecciona el entorno a reutilizar [0-{len(existing)}] [1]: ").strip() or "1"
                if answer.isdigit() and 0 <= int(answer) <= len(existing):
                    selected = int(answer)
                    break
                print("Selección inválida. Vuelve a introducir un número de la lista.")
            if selected:
                return location, existing[selected - 1]

            alternatives = [region for region in (allowed_regions or list(REGION_PREFERENCE))
                            if _normal_region(region) != _normal_region(location)]
            if not alternatives:
                raise DeployError("No hay otra región permitida disponible; reutiliza el entorno Express existente o cancela.")
            print("Regiones alternativas permitidas: " + ", ".join(alternatives))
            location = _prompt_region(
                runner,
                f"Introduce otra región [{alternatives[0]}]: ",
                alternatives[0],
                allowed_regions=alternatives,
                exclude={location},
            )
            continue
        return location, None


def _create_or_reuse_express_environment(
    runner: Runner,
    *,
    subscription_id: str,
    resource_group: str,
    environment_name: str,
    location: str,
    allowed_regions: list[str],
    existing_environment: dict[str, str] | None,
    state: dict,
) -> tuple[str, str, str]:
    """Create Express or recover interactively from a regional quota error."""
    if existing_environment:
        environment_id = _validate_managed_environment_id(existing_environment.get("id"), subscription_id)
        print(
            f"Reutilizando el entorno Express existente {existing_environment['name']} "
            f"(RG: {existing_environment.get('resource_group') or 'no identificado'}). No se modificará ni eliminará."
        )
        return environment_id, location, existing_environment["name"]

    current_location = location
    while True:
        try:
            runner.az_quiet([
                "containerapp", "env", "create",
                "--name", environment_name,
                "--resource-group", resource_group,
                "--location", current_location,
                "--environment-mode", "express",
                "--logs-destination", "none",
            ])
            environment = runner.az_json([
                "containerapp", "env", "show",
                "--name", environment_name,
                "--resource-group", resource_group,
                "--subscription", subscription_id,
            ])
            environment_id = _validate_managed_environment_id(
                environment.get("id") if isinstance(environment, dict) else None,
                subscription_id,
            )
            return environment_id, current_location, environment_name
        except DeployError as exc:
            error_text = str(exc)
            if "MaxNumberOfRegionalExpressEnvironmentsInSubExceeded" not in error_text:
                raise

            print("\n[CUOTA REGIONAL] Azure informa que tu suscripción ya alcanzó el máximo de entornos Express en esta región.")
            print("No es un error de Neon ni de las imágenes. No volveremos a intentar crear otro entorno en esa región.")
            discovered = _list_express_environments(runner, subscription_id, current_location)
            if discovered:
                old_location = current_location
                current_location, selected = _choose_express_environment(
                    runner, subscription_id, current_location, allowed_regions
                )
                if selected:
                    print("Se continuará utilizando el entorno Express existente.")
                    return selected["id"], current_location, selected["name"]
                if _normal_region(current_location) != _normal_region(old_location):
                    print(f"Reintentando crear un entorno Express en {current_location} ...")
                    state["location"] = current_location
                    state["updated_at"] = datetime.now(timezone.utc).isoformat()
                    _resource_group_state(state)
                    continue

            alternatives = [region for region in (allowed_regions or list(REGION_PREFERENCE))
                            if _normal_region(region) != _normal_region(current_location)]
            if not alternatives:
                raise DeployError(
                    "La suscripción no permite crear otro entorno Express en la región y no quedan regiones alternativas. "
                    "Reutiliza un entorno existente o solicita a Azure revisar la cuota de la suscripción."
                ) from exc
            print("Regiones alternativas permitidas: " + ", ".join(alternatives))
            current_location = _prompt_region(
                runner,
                f"Región alternativa para Express [{alternatives[0]}]: ",
                alternatives[0],
                allowed_regions=alternatives,
                exclude={current_location},
            )
            current_location, existing_environment = _choose_express_environment(
                runner, subscription_id, current_location, allowed_regions
            )
            if existing_environment:
                print("Se reutilizará el entorno Express encontrado en la región alternativa.")
                return existing_environment["id"], current_location, existing_environment["name"]
            print(f"Reintentando crear un entorno Express en {current_location} ...")
            state["location"] = current_location
            state["updated_at"] = datetime.now(timezone.utc).isoformat()
            _resource_group_state(state)


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
    """Poll the structured ARM object, never parse warning/CLIXML text as a state."""
    last_state = ""
    last_error = ""
    consecutive_errors = 0
    for _ in range(attempts):
        properties: dict[str, object] = {}
        try:
            app = runner.az_json([
                "containerapp", "show",
                "--name", name,
                "--resource-group", resource_group,
            ])
            if not isinstance(app, dict):
                raise DeployError("Azure devolvió una respuesta sin objeto JSON para la Container App.")
            properties = app.get("properties") if isinstance(app.get("properties"), dict) else {}
            last_state = str(properties.get("provisioningState") or "").strip()
            consecutive_errors = 0
            last_error = ""
        except DeployError as exc:
            consecutive_errors += 1
            last_error = str(exc)
            # Transient 404 while ARM finishes creating the resource is expected.
            # Repeated CLI/authorization/transport errors are not a provisioning state.
            if consecutive_errors >= 6:
                raise DeployError(
                    f"No se pudo consultar de forma fiable el estado de {name} después de "
                    f"{consecutive_errors} intentos. No se interpretó stderr/CLIXML como estado. "
                    f"Último detalle: {last_error[-1800:]}"
                ) from exc

        normalized = last_state.casefold()
        if normalized == "succeeded":
            return
        if normalized in {"failed", "canceled", "cancelled"}:
            error_details = properties.get("eventStreamEndpoint") or properties.get("deploymentErrors") or ""
            raise DeployError(
                f"Azure marcó la Container App {name} como {last_state}. "
                f"Detalle de aprovisionamiento: {str(error_details)[:1600] or 'Azure no devolvió detalles.'} "
                "Se intentará limpiar únicamente el Resource Group creado por este intento."
            )
        time.sleep(10)

    state_text = last_state or "sin estado JSON"
    detail = f"; último error de consulta: {last_error[-1200:]}" if last_error else ""
    raise DeployError(
        f"Timeout esperando Container App {name} (último estado: {state_text}{detail}). "
        "El script no confundió advertencias de Azure CLI con estados de aprovisionamiento."
    )


def _fqdn(runner: Runner, app: str, resource_group: str) -> str:
    value = runner.az_json([
        "containerapp", "show",
        "--name", app,
        "--resource-group", resource_group,
    ])
    properties = value.get("properties", {}) if isinstance(value, dict) else {}
    configuration = properties.get("configuration", {}) if isinstance(properties, dict) else {}
    ingress = configuration.get("ingress", {}) if isinstance(configuration, dict) else {}
    fqdn = str(ingress.get("fqdn") or "").strip() if isinstance(ingress, dict) else ""
    if not fqdn or fqdn.lower() == "none":
        raise DeployError(f"Azure todavía no devolvió el FQDN de {app}.")
    return fqdn


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
    existing_environment: dict[str, str] | None = None,
    allowed_regions: list[str] | None = None,
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

    requested_environment_name = names["environment"]
    environment_id, location, actual_environment_name = _create_or_reuse_express_environment(
        runner,
        subscription_id=subscription_id,
        resource_group=resource_group,
        environment_name=names["environment"],
        location=location,
        allowed_regions=allowed_regions or [],
        existing_environment=existing_environment,
        state=state,
    )
    names = {**names, "environment": actual_environment_name}
    state.update({
        "location": location,
        "environment": actual_environment_name,
        "environment_id": environment_id,
        "environment_reused": bool(existing_environment) or actual_environment_name != requested_environment_name,
    })
    _resource_group_state(state)

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
    if not _prompt_yes_no("¿Configurar Stripe Checkout test ahora? (s/N): ", default=False):
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

    while True:
        stripe_key = getpass.getpass("Pega localmente una clave API Stripe test rk_test_... o sk_test_... (oculta; Enter para cancelar Stripe): ").strip()
        if not stripe_key:
            print("Stripe no quedó configurado; la aplicación seguirá en modo sandbox/simulador.")
            return False
        if _is_stripe_test_api_key(stripe_key):
            break
        print("[DATO INVÁLIDO] La clave no tiene formato Stripe test rk_test_... o sk_test_... válido.")
        print("Vuelve a introducir la clave correcta. No pegues claves Groq ni Gemini aquí.")

    while True:
        webhook_secret = getpass.getpass("Pega localmente el secreto whsec_ del endpoint (oculto; Enter para cancelar Stripe): ").strip()
        if not webhook_secret:
            print("Stripe no quedó configurado porque no se proporcionó el secreto del webhook.")
            return False
        if webhook_secret.startswith("whsec_") and len(webhook_secret) >= 24:
            break
        print("[DATO INVÁLIDO] El secreto debe comenzar con whsec_ y tener longitud suficiente. Vuelve a introducirlo.")

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
    if state.get("resource_group_deleted"):
        rg = state.get("resource_group", "")
        print(f"\nLimpieza automática completada: se eliminó el Resource Group nuevo {rg} creado en este intento.", file=sys.stderr)
        if state.get("environment_reused"):
            print("El entorno Express reutilizado pertenece a otro Resource Group y no se eliminó.", file=sys.stderr)
        print("Neon se conserva; no se borró ni eliminó la base de datos.", file=sys.stderr)
        return
    if state.get("resource_group_created"):
        rg = state.get("resource_group", "")
        print(f"\nNo se pudo completar la limpieza automática del Resource Group {rg}.", file=sys.stderr)
        print("Revísalo en el Portal; si contiene únicamente esta prueba, elimínalo manualmente con:", file=sys.stderr)
        print(f"  az group delete --name {rg} --yes --no-wait", file=sys.stderr)
        print(f"Metadatos sin secretos: {BUILD_STATE.relative_to(ROOT)}", file=sys.stderr)
        print("Neon se conserva; el archivo de estado registra el último punto alcanzado.", file=sys.stderr)
    elif state.get("neon_setup_started") and not state.get("neon_prepared"):
        print("\nLa restauración Neon pudo quedar parcial. Inspecciona la base antes de continuar; el asistente no borrará tablas desconocidas automáticamente.", file=sys.stderr)
    elif state.get("neon_prepared"):
        print("\nNeon quedó preparada, pero Azure no terminó. Al volver a ejecutar, el asistente ofrecerá reutilizar y verificar los datos existentes sin borrarlos.", file=sys.stderr)


def _cleanup_failed_resource_group(runner: Runner, state: dict) -> bool:
    """Delete only the brand-new RG created by this run after a failed deployment."""
    if not state.get("resource_group_created") or not state.get("resource_group"):
        return False
    if state.get("status") == "deployed":
        return False
    if "--keep-failed-resources" in sys.argv or os.getenv("FASHIONSTORE_KEEP_FAILED_RESOURCES", "").strip() == "1":
        print("Se conservarán los recursos de diagnóstico por petición (--keep-failed-resources).", file=sys.stderr)
        state["azure_cleanup_status"] = "kept_by_user"
        return False

    resource_group = str(state["resource_group"])
    subscription_id = str(state.get("subscription_id") or "")
    try:
        print(f"\nLimpiando automáticamente el Resource Group nuevo {resource_group} del intento fallido ...", file=sys.stderr)
        args = ["group", "delete", "--name", resource_group, "--yes"]
        if subscription_id:
            args.extend(["--subscription", subscription_id])
        runner.az_quiet(args)
        state["resource_group_deleted"] = True
        state["azure_cleanup_status"] = "completed"
        state["azure_cleanup_completed_at"] = datetime.now(timezone.utc).isoformat()
        return True
    except Exception as exc:
        state["azure_cleanup_status"] = "failed"
        state["azure_cleanup_error"] = _redact(str(exc), runner.sensitive)
        print(f"[AVISO] No se pudo eliminar automáticamente {resource_group}: {state['azure_cleanup_error']}", file=sys.stderr)
        return False


def main() -> int:
    runner = Runner()
    previous_state = _load_state()
    profile, saved_secrets = _load_deploy_profile()
    profile_settings = profile.get("settings") if isinstance(profile.get("settings"), dict) else {}
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
        # Check the Python-to-CLI bridge before showing prompts or collecting
        # Neon/API credentials. The BAT's own `call az` check is not enough:
        # it does not exercise Runner's subprocess invocation path.
        _verify_azure_cli_runner(runner)
        if not _sql_driver():
            raise DeployError(
                "Falta un cliente SQL: instala PostgreSQL Command Line Tools (psql), "
                "o Node.js con las dependencias de backend-nest (`cd backend-nest && npm ci`)."
            )
        if not (ROOT / "database" / "schema.sql").is_file():
            raise DeployError("No se encontró la raíz del proyecto FashionStore con database/schema.sql.")

        print("FashionStore: despliegue asistido Azure Container Apps + Neon.")
        print("Azure Container Apps Express usa Consumption, escala a cero y no crea un entorno de pago, ACR ni Log Analytics.")
        print("Las imágenes públicas vienen de GHCR; Container Apps puede cobrar por uso/egress que exceda las concesiones gratis. No se garantiza $0.")
        print("Si el despliegue falla, se eliminará únicamente el Resource Group nuevo creado por este intento; Neon y entornos Express ajenos se conservarán.")
        print("Para conservar recursos de diagnóstico, ejecuta tools\\deploy_azure.py --keep-failed-resources.")

        profile_mode = _select_profile_mode(profile)
        if profile_mode == "cancel":
            state["status"] = "cancelled"
            state["updated_at"] = datetime.now(timezone.utc).isoformat()
            _save_state(state)
            print("Despliegue cancelado; no se modificó Neon ni Azure.")
            return 0
        if profile_mode == "edit":
            _open_deploy_profile()
            return 0
        quick_mode = profile_mode == "quick"
        if quick_mode:
            print("\n[CONFIGURACIÓN RÁPIDA] Se reutilizarán las opciones anteriores. Solo se preguntará lo que falte o haya dejado de ser válido.")
        else:
            print("\n[CONFIGURACIÓN REVISADA] Puedes corregir los valores; se guardarán para el próximo despliegue.")
            print("El archivo de configuración se generará automáticamente en builds\\deploy-profile.json.")
            if not _prompt_yes_no("¿Confirmas usar GHCR con imágenes públicas? (s/N): ", default=False):
                raise DeployError("GHCR no confirmado. No se registraron providers, no se modificó Neon y no se crearon recursos Azure.")
            if not _prompt_exact_confirmation(
                "Para continuar con las comprobaciones, escribe CONTINUAR: ", "CONTINUAR", purpose="continuar con el preflight"
            ):
                raise DeployError("Cancelado antes de abrir Neon o cambiar la suscripción/recursos.")

        saved_subscription = str(profile_settings.get("subscription_id") or previous_state.get("subscription_id") or "")
        subscription_id, subscription_name = _subscription(
            runner, saved_subscription or None, auto_select=quick_mode
        )
        default_region, allowed_regions = _default_region(runner)
        if allowed_regions:
            print("Tu suscripción solo permite estas regiones compatibles con Express: " + ", ".join(allowed_regions))
        saved_location = str(profile_settings.get("location") or previous_state.get("location") or default_region)
        if quick_mode and saved_location:
            try:
                location = _normal_region(saved_location)
                _validate_location(runner, location)
                if allowed_regions and location not in {_normal_region(value) for value in allowed_regions}:
                    raise DeployError("La región guardada ya no está permitida por esta suscripción.")
                print(f"[OK] Se reutiliza la región guardada: {location}.")
            except DeployError as exc:
                print(f"[AVISO] La región guardada ya no es válida: {exc}")
                location = _prompt_region(
                    runner, f"Región Azure (nombre corto) [{default_region}]: ", default_region,
                    allowed_regions=allowed_regions or None,
                )
        else:
            location = _prompt_region(
                runner, f"Región Azure (nombre corto) [{saved_location}]: ", saved_location,
                allowed_regions=allowed_regions or None,
            )

        location, existing_environment = _choose_express_environment(
            runner,
            subscription_id,
            location,
            allowed_regions or [location],
            preferred_environment_id=str(profile_settings.get("environment_id") or "") or None,
            auto_select=quick_mode,
        )
        saved_owner = str(profile_settings.get("ghcr_owner") or previous_state.get("ghcr_owner") or "")
        if quick_mode and saved_owner:
            try:
                ghcr_owner = normalize_ghcr_owner(saved_owner)
                print(f"[OK] Se reutiliza el owner GHCR guardado: {ghcr_owner}.")
            except DeployError as exc:
                print(f"[AVISO] El owner GHCR guardado no es válido: {exc}")
                ghcr_owner = _prompt_ghcr_owner(saved_owner)
        else:
            ghcr_owner = _prompt_ghcr_owner(saved_owner)

        names = _resource_names()
        if existing_environment:
            names["environment"] = existing_environment["name"]
        state.update({**names, "subscription_id": subscription_id, "subscription_name": subscription_name, "location": location, "ghcr_owner": ghcr_owner})
        print(f"Se reservará un Resource Group nuevo: {names['resource_group']} (no se borrarán recursos existentes).")
        if existing_environment:
            print(f"Se reutilizará {existing_environment['name']} del Resource Group {existing_environment.get('resource_group') or '(no identificado)'}. No se eliminará ese entorno.")

        profile_settings.update({
            "ghcr_public": True, "subscription_id": subscription_id, "subscription_name": subscription_name,
            "location": location, "ghcr_owner": ghcr_owner,
            "environment_id": str(existing_environment.get("id") if existing_environment else profile_settings.get("environment_id") or ""),
            "environment_name": str(existing_environment.get("name") if existing_environment else ""),
            "environment_resource_group": str(existing_environment.get("resource_group") if existing_environment else ""),
            "neon_strategy": "reuse",
        })
        profile = {"settings": profile_settings, **({"secrets_protected": profile.get("secrets_protected"), "secret_protection": profile.get("secret_protection")} if profile.get("secrets_protected") else {})}
        _save_deploy_profile(profile, {key: value for key, value in saved_secrets.items() if not key.startswith("__")})

        _ensure_providers_registered(runner)
        _check_azure_preflight(runner, subscription_id, location, names)
        ghcr_owner, image_urls = _check_ghcr_images_with_retry(ghcr_owner)
        state["ghcr_owner"] = ghcr_owner
        print("Preflight Azure y lectura anónima de las tres imágenes GHCR correctos; aún no se han creado recursos.")
        profile_settings.update({
            "ghcr_public": True, "subscription_id": subscription_id, "subscription_name": subscription_name,
            "location": location, "ghcr_owner": ghcr_owner,
            "environment_id": str(existing_environment.get("id") if existing_environment else profile_settings.get("environment_id") or ""),
            "environment_name": str(existing_environment.get("name") if existing_environment else ""),
            "environment_resource_group": str(existing_environment.get("resource_group") if existing_environment else ""),
            "neon_strategy": "reuse",
        })
        profile = {"settings": profile_settings, **({"secrets_protected": profile.get("secrets_protected"), "secret_protection": profile.get("secret_protection")} if profile.get("secrets_protected") else {})}
        _save_deploy_profile(profile, {key: value for key, value in saved_secrets.items() if not key.startswith("__")})

        saved_neon_url = str(saved_secrets.get("neon_url") or "")
        if not quick_mode:
            print("\nAbriendo Neon. Usa una base/branch dedicada a FashionStore; no pegues una base con datos ajenos.")
            print("Puedes pegar la URL directa o pooled; el asistente convertirá -pooler al endpoint directo para migraciones.")
            print("La URL se solicitará oculta y se guardará cifrada en el perfil local de Windows.")
            print(f"Si el navegador no abre automáticamente, visita: {NEON_CONSOLE}")
            webbrowser.open(NEON_CONSOLE)
        elif saved_neon_url:
            print("[OK] Se intentará reutilizar la conexión Neon guardada (credenciales cifradas).")
        else:
            print("[AVISO] No hay una conexión Neon guardada disponible; se abrirá Neon para que puedas introducirla.")
            webbrowser.open(NEON_CONSOLE)
        owner, neon_state = _prompt_and_preflight_neon(
            runner, saved_neon_url or None, auto_use_saved=quick_mode
        )
        if owner.input_was_pooled:
            print("Detecté -pooler en el host y lo normalicé automáticamente para ejecutar schema/migraciones/seed.")
        state.update({"neon_database": owner.database, "neon_input_was_pooled": owner.input_was_pooled, "neon_state_before_restore": neon_state})
        _save_state(state)

        reset_existing = False
        reuse_existing = False
        if neon_state == "fashionstore":
            saved_neon_strategy = str(profile_settings.get("neon_strategy") or "reuse").casefold()
            if quick_mode and saved_neon_strategy == "reuse":
                reuse_existing = True
                print("[OK] Se reutilizará la base FashionStore existente. No se borrarán pedidos, clientes, pagos ni registros.")
            else:
                print("Se detectó una base con tablas de FashionStore.")
                print("  1) REUTILIZAR (recomendado): conservar pedidos, clientes, pagos y demás datos; verificar cuentas y permisos.")
                print("  2) RESTAURAR DEMO: borrar los objetos/datos de public y volver a aplicar esquema, migraciones y seed.")
                print("  3) CANCELAR: salir sin modificar Neon.")
                while True:
                    choice = input("Elige una opción [1-3] [1]: ").strip() or "1"
                    if choice == "1":
                        reuse_existing = True
                        break
                    if choice == "2":
                        reset_existing = _prompt_exact_confirmation(
                            "Para confirmar la restauración destructiva escribe RESTABLECER-DEMO: ",
                            "RESTABLECER-DEMO",
                            purpose="borrar y reconstruir el esquema public de Neon",
                        )
                        if not reset_existing:
                            raise DeployError("Restauración cancelada; Neon no se modificó.")
                        break
                    if choice == "3" or choice.casefold() in CANCEL_VALUES:
                        raise DeployError("Cancelado; Neon no se modificó.")
                    print("Opción inválida. Vuelve a introducir 1, 2 o 3; puedes corregir la respuesta.")

        saved_llm_credentials = saved_secrets.get("llm_credentials") if isinstance(saved_secrets.get("llm_credentials"), dict) else {}
        if quick_mode and isinstance(profile_settings.get("llm_providers"), list):
            enabled_saved_providers = {str(value).casefold() for value in profile_settings.get("llm_providers", [])}
            saved_llm_credentials = {key: value for key, value in saved_llm_credentials.items() if key in enabled_saved_providers}
        llm_credentials = _read_optional_llm_credentials(
            saved_llm_credentials,
            auto_use_saved=quick_mode and bool(saved_secrets.get("__profile_secrets_loaded__")) and not bool(saved_secrets.get("__decrypt_failed__")),
            preferred_providers=profile_settings.get("llm_providers", []),
        )
        runner.add_sensitive(*(llm_credentials or {}).values())

        # Save choices and encrypted credentials before the destructive/deployment confirmation.
        profile_settings = {
            **profile_settings,
            "ghcr_public": True,
            "subscription_id": subscription_id,
            "subscription_name": subscription_name,
            "location": location,
            "ghcr_owner": ghcr_owner,
            "environment_id": str(existing_environment.get("id") if existing_environment else profile_settings.get("environment_id") or ""),
            "environment_name": str(existing_environment.get("name") if existing_environment else ""),
            "environment_resource_group": str(existing_environment.get("resource_group") if existing_environment else ""),
            "neon_strategy": "reuse",
            "llm_providers": sorted(llm_credentials),
            "notes": "Los datos secretos están cifrados con Windows DPAPI en secrets_protected.",
        }
        profile = {"settings": profile_settings}
        saved_secrets = {"neon_url": owner.original_url, "llm_credentials": llm_credentials}
        _save_deploy_profile(profile, saved_secrets)
        if not _supports_dpapi():
            print("[AVISO] Este sistema no ofrece DPAPI; las credenciales no se guardarán y se solicitarán nuevamente en la próxima ejecución.")
        else:
            print(f"[OK] Configuración guardada en {DEPLOY_PROFILE.relative_to(ROOT)}; credenciales cifradas con Windows DPAPI.")

        print("\nConfirmación final:")
        if reuse_existing:
            print("- Se conservarán los datos actuales de Neon; no se volverán a ejecutar schema.sql, migraciones ni seed.sql.")
        else:
            print("- Se aplicarán schema.sql, todas las migraciones 003–010 y seed.sql, igual que iniciar.py en modo local.")
        print("- Se conservarán exactamente las cinco cuentas semilla y sus contraseñas locales; no se desactivarán usuarios.")
        print(f"- Se usarán imágenes GHCR públicas de {ghcr_owner}; no se crea ACR ni se guardan tokens de registry.")
        print("- IA generativa: " + (f"claves configuradas para {', '.join(sorted(llm_credentials))} en secretos de FastAPI." if llm_credentials else "sin claves externas; funcionará el asistente local determinista con datos de la base."))
        if existing_environment:
            print(f"- Se reutilizará el entorno Express existente {existing_environment['name']}; no se creará otro en {location}.")
        else:
            print(f"- Se creará un entorno Express nuevo en {location}; si Azure informa cuota regional, podrás reutilizar uno o elegir otra región permitida.")
        print("- Se crearán 3 Container Apps a escala cero dentro del Resource Group nuevo; el uso/egress fuera de cuotas puede generar cargos Azure.")
        print("- Si falla Azure, se intentará eliminar únicamente ese Resource Group nuevo. Neon y entornos Express preexistentes se conservarán.")
        if not _prompt_exact_confirmation(
            "Escribe DEPLOY-TEST para aplicar la base y desplegar: ", "DEPLOY-TEST", purpose="iniciar el despliegue"
        ):
            raise DeployError("Cancelado antes de modificar Neon o crear recursos Azure.")

        state["neon_setup_started"] = True
        state["status"] = "neon_setup_in_progress"
        state["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_state(state)
        app_database_url, app_database_password, seed_report = prepare_neon_database(
            runner,
            owner,
            reset_existing=reset_existing,
            reuse_existing=reuse_existing,
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
            existing_environment=existing_environment,
            allowed_regions=allowed_regions,
        )

        # Remember the environment actually used, including a quota-recovery selection.
        profile_settings.update({
            "location": result.get("location", location),
            "environment_id": str(state.get("environment_id") or ""),
            "environment_name": str(result.get("environment") or names.get("environment") or ""),
            "environment_resource_group": str(existing_environment.get("resource_group") if existing_environment else result.get("resource_group") or ""),
        })
        profile = {"settings": profile_settings}
        _save_deploy_profile(profile, saved_secrets)

        print("\nEsperando FastAPI HTTPS en /health ...")
        if not _wait_http(f"{result['fastapi_url']}/health"):
            raise DeployError("FastAPI no pasó /health tras 3 minutos. Se intentará eliminar el Resource Group nuevo; Neon se conserva.")
        print("FastAPI /health: OK")

        print("Esperando la API Nest y su conexión Neon en /api/health ...")
        if not _wait_http(f"{result['api_url']}/api/health"):
            raise DeployError("Nest no pasó /api/health tras 3 minutos. Se intentará eliminar el Resource Group nuevo; Neon se conserva.")
        print("Nest /api/health: OK")
        if not _wait_http(result["web_url"]):
            raise DeployError("La web no respondió HTTP 200 tras 3 minutos. Se intentará eliminar el Resource Group nuevo; Neon se conserva.")
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
            if quick_mode and profile_settings.get("stripe_setup_choice") == "skip":
                stripe_configured = False
                print("[OK] Stripe se omitió según el perfil anterior; no se volverá a preguntar.")
            else:
                stripe_configured = maybe_enable_stripe(runner, result, api_payload)
            profile_settings["stripe_setup_choice"] = "configured" if stripe_configured else "skip"
            _save_deploy_profile({"settings": profile_settings}, saved_secrets)
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
        print(f"Perfil reutilizable: {DEPLOY_PROFILE.relative_to(ROOT)}")
        print("Express usa concesiones gratuitas compartidas por suscripción (180,000 vCPU-s, 360,000 GiB-s y 2 M solicitudes/mes publicadas); el exceso/egress puede facturarse. Revisa el costo y elimina el RG al terminar.")
        print("Limpieza (solo tras verificar que el RG contiene esta prueba): az group delete --name " + result["resource_group"] + " --yes --no-wait")
        return 0

    except KeyboardInterrupt:
        print("\nInterrumpido por el usuario.", file=sys.stderr)
        if state.get("status") != "deployed":
            _cleanup_failed_resource_group(runner, state)
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
        _cleanup_failed_resource_group(runner, state)
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
