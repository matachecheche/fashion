#!/usr/bin/env python3
"""
FASHIONSTORE — Orquestador local (desarrollo)
=============================================

Levanta el stack completo en tu máquina SIN tocar producción:

  1. PostgreSQL 17  (base de datos + schema + migraciones + seed tenant 'legacy')
  2. FastAPI IA     (puerto 8000)
  3. NestJS API     (puerto 3000)
  4. Frontend Web   (puerto 5173, proxy /api -> 3000)

Uso:
    python iniciar.py              # modo automático (usa Docker si está disponible)
    python iniciar.py --docker     # fuerza Docker Compose
    python iniciar.py --native     # fuerza stack nativo (requiere psql + node + python)
    python iniciar.py              # modo fábrica: BORRA y recrea la base 'fashionstore'
                                   # SIEMPRE con los datos de ejemplo (semilla completa)

NOTA IMPORTANTE: cada arranque elimina TOTALMENTE la base de datos 'fashionstore'
y la recrea desde cero con datos de ejemplo para TODOS los módulos. Los datos que
crees entre arranques se pierden. La opción antigua --keep-db ya no está soportada.

Principios:
  * Nada se despliega a Internet desde aquí.
  * Los secretos generados son SOLO para desarrollo local y están etiquetados.
  * Fallar ruidoso y claro es mejor que fingir que funciona.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
PG_PORT = 5432
API_PORT = 3000
IA_PORT = 8000
WEB_PORT = 5173
DB_NAME = "fashionstore"

CHILDREN: list[subprocess.Popen] = []


PG_PASSWORD_FILE = ROOT / "builds" / ".pg_password"


def _read_password_file() -> str | None:
    if not PG_PASSWORD_FILE.exists():
        return None
    for line in PG_PASSWORD_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        return line
    return None


def _save_password_file(pw: str) -> None:
    PG_PASSWORD_FILE.parent.mkdir(exist_ok=True)
    marker = (
        "# FASHIONSTORE — contraseña del superusuario PostgreSQL (psql) para el modo nativo.\n"
        "# Generado por iniciar.py una sola vez; fuera de git y del paquete (builds/ está ignorado).\n"
        "# NO es la contraseña de la app (fs_app, ver builds/.fs_app_password).\n"
        "# Editar esta línea para cambiar la contraseña; borrar el archivo para que se pida de nuevo.\n"
    )
    PG_PASSWORD_FILE.write_text(marker + pw + "\n", encoding="utf-8")
    try:
        os.chmod(PG_PASSWORD_FILE, 0o600)
    except OSError:
        pass


def ensure_pg_password() -> None:
    """Garantiza que psql pueda autenticarse SIN prompts interactivos.

    Orden de precedencia:
      1. PGPASSWORD en el entorno (gana siempre).
      2. builds/.pg_password (archivo local, ignorado por git y por el paquete).
      3. En Linux sin contraseña: peer auth via sudo -u postgres (sin archivo).
      4. Si no hay ninguna fuente y hay consola interactiva: la pide UNA vez
         (getpass, entrada oculta) y la guarda en builds/.pg_password.
    """
    if os.environ.get("PGPASSWORD"):
        log("PostgreSQL: usando PGPASSWORD del entorno.")
        return
    file_pw = _read_password_file()
    if file_pw:
        os.environ["PGPASSWORD"] = file_pw
        log("PostgreSQL: usando builds/.pg_password (sin prompts).")
        return
    if os.name == "posix" and which("sudo"):
        return  # peer auth por socket; psql sin contraseña
    if not sys.stdin.isatty():
        fail(
            "No hay contraseña de PostgreSQL configurada y la consola no es interactiva.\n"
            "  Crea el archivo builds/.pg_password con la contraseña del superusuario (una línea),\n"
            "  o define la variable PGPASSWORD antes de ejecutar iniciar.bat.",
            2,
        )
    print("\n[fashionstore] PostgreSQL pide contraseña en cada arranque y la quieres en un archivo.")
    print(f"  Se guardará UNA sola vez en: {PG_PASSWORD_FILE}")
    print("  (archivo local, ignorado por git y por proyecto.zip; fuera de la nube si tu carpeta NO está en OneDrive)\n")
    try:
        pw = getpass.getpass("Contraseña del superusuario PostgreSQL (psql -U postgres): ").strip()
    except (EOFError, KeyboardInterrupt):
        fail("Cancelado.", 2)
    if not pw:
        fail("La contraseña no puede estar vacía. Crea builds/.pg_password o define PGPASSWORD.", 2)
    _save_password_file(pw)
    os.environ["PGPASSWORD"] = pw
    log("Contraseña guardada en builds/.pg_password. Próximos arranques no preguntarán.")


def log(msg: str) -> None:
    print(f"[fashionstore] {msg}", flush=True)


def fail(msg: str, code: int = 1) -> "NoReturn":  # type: ignore[name-defined]
    print(f"\n[ERROR] {msg}\n", file=sys.stderr, flush=True)
    detalle = ROOT / "builds" / "ultimo-error.log"
    try:
        detalle.parent.mkdir(exist_ok=True)
        detalle.write_text(msg + "\n", encoding="utf-8")
        log(f"Detalle guardado en {detalle}")
    except OSError:
        pass
    sys.exit(code)


def which(cmd: str) -> str | None:
    return shutil.which(cmd)


def have(cmd: str) -> bool:
    return which(cmd) is not None


def port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        return s.connect_ex((host, port)) == 0


def fail_if_ports_busy() -> None:
    """Falla ANTES de tocar nada si los puertos del stack ya están en uso
    (típico: un FashionStore anterior quedó colgado). Nada se borra ni se crea."""
    busy = [(port, nombre) for port, nombre in
            ((IA_PORT, "FastAPI IA"), (API_PORT, "NestJS API"), (WEB_PORT, "Frontend Web"))
            if port_open(port, "127.0.0.1", timeout=0.3)]
    if not busy:
        return
    detalle = "\n".join(f"  - Puerto {p} en uso: {n}" for p, n in busy)
    fail(
        f"No puedo arrancar: hay procesos usando los puertos del stack.\n{detalle}\n"
        "Causa probable: un FashionStore anterior quedó abierto (otra ventana de consola)\n"
        "o una app ajena usa el puerto. Ciérralos y vuelve a intentar:\n"
        "  Windows:  netstat -ano | findstr :3000   (repite con :8000 y :5173)\n"
        "            taskkill /F /PID <pid>\n"
        "  o cierra la(s) ventana(s) donde corre el stack anterior\n"
        "  o ejecuta detener.bat\n"
        "Nada se ha borrado ni creado: la base de datos no se tocó.",
        2,
    )



def http_ok(url: str, timeout: float = 3.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def http_json(url: str, timeout: float = 5.0) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def wait_for(label: str, url: str, seconds: int = 60) -> None:
    log(f"Esperando {label} en {url} ...")
    deadline = time.time() + seconds
    while time.time() < deadline:
        if http_ok(url):
            log(f"{label}: OK")
            return
        time.sleep(1.5)
    fail(f"{label} no respondió en {seconds}s en {url}. Revisa los logs de arriba.", 3)


def _resolve_command(cmd: list[str]) -> list[str]:
    """Windows: npm/npx son shims .cmd y CreateProcess NO resuelve PATHEXT.
    Resuelve el ejecutable con which() y envuelve los .cmd/.bat en `cmd /c`.
    En POSIX devuelve el comando intacto."""
    if not cmd or os.name != "nt":
        return cmd
    resolved = which(cmd[0])
    if not resolved:
        return cmd  # deja el error original de "no encontrado"
    resolved = str(resolved)
    if resolved.lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c", resolved, *cmd[1:]]
    return [resolved, *cmd[1:]]


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    cmd = _resolve_command(cmd)
    log("$ " + " ".join(cmd))
    return subprocess.run(cmd, cwd=str(cwd or ROOT), env=env, check=check)


def spawn(label: str, cmd: list[str], cwd: Path, env: dict | None = None) -> subprocess.Popen:
    cmd = _resolve_command(cmd)
    log(f"Iniciando {label}: {' '.join(cmd)}")
    kwargs: dict = {}
    if os.name == "posix":
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(cmd, cwd=str(cwd), env=env, **kwargs)
    CHILDREN.append(proc)
    return proc


def cleanup() -> None:
    if not CHILDREN:
        return
    log("Deteniendo procesos hijos ...")
    for p in CHILDREN:
        if p.poll() is not None:
            continue
        try:
            if os.name == "posix":
                os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            else:
                p.terminate()
        except Exception as exc:  # noqa: BLE001 - mejor intentar todos
            log(f"  no se pudo detener pid {p.pid}: {exc}")
    deadline = time.time() + 8
    for p in CHILDREN:
        try:
            p.wait(timeout=max(0.1, deadline - time.time()))
        except Exception:
            try:
                p.kill()
            except Exception:
                pass
    log("Procesos detenidos.")


def ensure_dev_env(path: Path, template: Path, extra: dict[str, str]) -> None:
    """Copia .env.example -> .env generando secretos de desarrollo si falta."""
    if path.exists():
        log(f"OK {path.relative_to(ROOT)} ya existe (no se toca).")
        return
    if not template.exists():
        fail(f"Falta {template}; no puedo generar {path}.", 4)
    content = template.read_text(encoding="utf-8")
    for key, value in extra.items():
        import re

        content = re.sub(rf"^{key}=.*$", f"{key}={value}", content, flags=re.MULTILINE)
    marker = "# GENERADO POR iniciar.py SOLO PARA DESARROLLO LOCAL. No subir a produccion.\n"
    path.write_text(marker + content, encoding="utf-8")
    log(f"Generado {path.relative_to(ROOT)} con secretos de DESARROLLO (rotados al azar).")


# --------------------------------------------------------------------------
# Modo DOCKER
# --------------------------------------------------------------------------

def mode_docker() -> int:
    fail_if_ports_busy()
    if not have("docker"):
        fail("Docker no está instalado o no está en el PATH. Instala Docker Desktop o usa --native.", 2)

    # Compose exige secretos; prepáralos y pásale siempre el mismo archivo que usa
    # iniciar-docker.bat. El archivo conserva sus valores entre reinicios de fábrica.
    run([sys.executable, str(ROOT / "tools" / "preparar_docker_env.py")])
    compose = ["docker", "compose", "--env-file", "builds/.env.docker"]
    run(compose + ["version"])
    log("MODO FÁBRICA: eliminando el volumen de datos 'pgdata' (semilla de ejemplo) ...")
    run(compose + ["down", "-v"])
    log("Construyendo y levantando el stack (la primera vez tarda varios minutos) ...")
    run(compose + ["up", "--build", "-d"])
    wait_for("NestJS API", f"http://127.0.0.1:{API_PORT}/api/health", 240)
    wait_for("FastAPI IA", f"http://127.0.0.1:{IA_PORT}/api/salud", 240)
    print_banner(docker=True)
    return 0


# --------------------------------------------------------------------------
# Modo NATIVO
# --------------------------------------------------------------------------

def psql(sql: str, db: str = DB_NAME, user: str = "postgres") -> subprocess.CompletedProcess:
    """Ejecuta psql siempre con -h 127.0.0.1 -U <user> (nunca depende del usuario del SO).

    Usa -tA (tuplas sin encabezado, valores sin formato) para que la salida sea
    IDÉNTICA en cualquier locale: en PostgreSQL en español el pie de página es
    «(1 fila)» y en inglés «(1 row)»; nunca parsear esos textos."""
    pg_password = os.environ.get("PGPASSWORD")
    if pg_password is not None:
        env = {**os.environ, "PGPASSWORD": pg_password}
        return subprocess.run(
            ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", user, "-d", db, "-tA", "-c", sql],
            env=env, capture_output=True, text=True,
        )
    if os.name == "posix" and which("sudo"):
        return subprocess.run(
            ["sudo", "-u", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", db, "-tA", "-c", sql],
            capture_output=True, text=True,
        )
    return subprocess.run(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", user, "-d", db, "-tA", "-c", sql],
        capture_output=True, text=True,
    )


def sql_file(sql_file: Path, db: str = DB_NAME) -> None:
    pg_password = os.environ.get("PGPASSWORD")
    if pg_password is not None:
        env = {**os.environ, "PGPASSWORD": pg_password}
        subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "postgres", "-d", db, "-q", "-f", str(sql_file)], env=env, check=True)
        return
    if os.name == "posix" and which("sudo"):
        subprocess.run(["sudo", "-u", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", db, "-q", "-f", str(sql_file)], check=True)
        return
    subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", "postgres", "-d", db, "-q", "-f", str(sql_file)], check=True)


def ensure_postgres() -> None:
    """En cada arranque nativo hace DROP + CREATE UTF-8 y carga schema, migraciones y seed."""
    if not port_open(PG_PORT):
        fail(
            "PostgreSQL no responde en 127.0.0.1:5432.\n"
            "  Linux (Debian): sudo pg_ctlcluster 17 main start\n"
            "  Windows:       net start postgresql-x64-17\n"
            "  O mejor:       Instala Docker y corre  python iniciar.py --docker",
            2,
        )
    log("PostgreSQL: OK (puerto 5432)")
    ensure_pg_password()
    probe = psql("SELECT 1;", db="postgres")
    if probe.returncode != 0:
        fail("No puedo conectar a PostgreSQL como superusuario (postgres). "
             "La contraseña en builds/.pg_password puede estar mal: corrígela o bórrala para que se pida de nuevo."
             f"\n{probe.stderr.strip()}", 2)

    log("MODO FÁBRICA: eliminando TOTALMENTE la base 'fashionstore' y recreándola con datos de ejemplo ...")
    rdrop = psql(f"DROP DATABASE IF EXISTS {DB_NAME} WITH (FORCE);", db="postgres")
    if rdrop.returncode != 0:
        fail(f"No pude eliminar la base '{DB_NAME}':\n{(rdrop.stderr or rdrop.stdout or '').strip()}", 2)
    rcreate = psql(
        f"CREATE DATABASE {DB_NAME} WITH ENCODING 'UTF8' TEMPLATE template0;",
        db="postgres",
    )
    if rcreate.returncode != 0:
        fail(f"No pude recrear la base '{DB_NAME}' en UTF-8 tras el borrado:\n{(rcreate.stderr or rcreate.stdout or '').strip()}", 2)

    sql_file(ROOT / "database" / "schema.sql")
    for mig in sorted((ROOT / "database" / "migrations").glob("*.sql")):
        log(f"Migración: {mig.name}")
        sql_file(mig)
    sql_file(ROOT / "database" / "seed.sql")
    # Rol de aplicación con contraseña LOCAL y aleatoria
    fs_pass = secrets.token_urlsafe(24)
    log("Creando/actualizando rol fs_app (contraseña local aleatoria en builds/.fs_app_password) ...")
    psql(
        f"DO $d$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fs_app') "
        f"THEN CREATE ROLE fs_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $d$;",
        db="postgres",
    )
    psql(f"ALTER ROLE fs_app WITH LOGIN PASSWORD '{fs_pass}';", db="postgres")
    psql("GRANT app_runtime TO fs_app; GRANT app_readonly TO fs_app;", db="postgres")
    creds = ROOT / "builds" / ".fs_app_password"
    creds.parent.mkdir(exist_ok=True)
    creds.write_text(fs_pass + "\n", encoding="utf-8")
    try:
        os.chmod(creds, 0o600)
    except OSError:
        pass


def _needs_generated_local_db_url(database_url: str | None) -> bool:
    """Use the fresh local fs_app role instead of an empty/example DB URL."""
    value = str(database_url or "").strip()
    if not value:
        return True
    normalized = value.lower()
    if any(marker in normalized for marker in ("fs_service:", "postgres:", "replace_me", "replace_with", "change_me", "placeholder")):
        return True
    try:
        username = unquote(urlsplit(value).username or "").strip().lower()
    except ValueError:
        username = ""
    return username in {"user", "username", "your_user", "your_username"}


def nest_env() -> dict[str, str]:
    """Variables para NestJS: usa .env si existe; si no, valores de desarrollo locales."""
    env_file = ROOT / "backend-nest" / ".env"
    values: dict[str, str] = {}
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip()
    creds = ROOT / "builds" / ".fs_app_password"
    fs_pass = creds.read_text(encoding="utf-8").strip() if creds.exists() else None
    database_url = values.get("DATABASE_URL")
    if fs_pass and _needs_generated_local_db_url(database_url):
        database_url = f"postgresql://fs_app:{fs_pass}@127.0.0.1:{PG_PORT}/{DB_NAME}"
    simulator_secret = values.get("STRIPE_SIMULATOR_WEBHOOK_SECRET", "").strip()
    if len(simulator_secret) < 32 or any(
        marker in simulator_secret.upper() for marker in ("REPLACE", "CHANGE_ME", "PLACEHOLDER")
    ):
        simulator_secret = secrets.token_hex(32)
    base = {
        "NODE_ENV": "production",
        "PORT": str(API_PORT),
        "DATABASE_URL": database_url or f"postgresql://postgres@127.0.0.1:{PG_PORT}/{DB_NAME}",
        "DATABASE_SSL": "false",
        "JWT_SECRET": values.get("JWT_SECRET") or secrets.token_hex(32),
        "JWT_EXPIRES_IN": values.get("JWT_EXPIRES_IN", "12h"),
        "PAGOS_MODO": values.get("PAGOS_MODO", "sandbox"),
        "STRIPE_SECRET_KEY": values.get("STRIPE_SECRET_KEY", ""),
        "STRIPE_WEBHOOK_SECRET": values.get("STRIPE_WEBHOOK_SECRET", ""),
        "STRIPE_SIMULATOR_WEBHOOK_SECRET": simulator_secret,
        "LIBELULA_APP_KEY": values.get("LIBELULA_APP_KEY", "libelula_sandbox_test"),
        "LIBELULA_WEBHOOK_SECRET": values.get("LIBELULA_WEBHOOK_SECRET", "libelula_sandbox_webhook_secret_2026"),
        "FASTAPI_URL": values.get("FASTAPI_URL", f"http://127.0.0.1:{IA_PORT}"),
        "IA_INTERNAL_KEY": values.get("IA_INTERNAL_KEY") or secrets.token_hex(24),
        "PUBLIC_API_URL": values.get("PUBLIC_API_URL", f"http://localhost:{API_PORT}"),
        "PUBLIC_WEB_URL": values.get("PUBLIC_WEB_URL", f"http://localhost:{WEB_PORT}"),
        "CORS_ORIGINS": values.get("CORS_ORIGINS", f"http://localhost:{WEB_PORT},http://127.0.0.1:{WEB_PORT}"),
    }
    return base


def fastapi_env() -> dict[str, str]:
    env_file = ROOT / "backend-fastapi" / ".env"
    values: dict[str, str] = {}
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip()
    creds = ROOT / "builds" / ".fs_app_password"
    fs_pass = creds.read_text(encoding="utf-8").strip() if creds.exists() else None
    db = values.get("DATABASE_URL")
    if fs_pass and _needs_generated_local_db_url(db):
        db = f"postgresql://fs_app:{fs_pass}@127.0.0.1:{PG_PORT}/{DB_NAME}"
    return {
        "APP_ENV": "development",
        "DATABASE_URL": db or f"postgresql://postgres@127.0.0.1:{PG_PORT}/{DB_NAME}",
        "DATABASE_SSL": "false",
        "IA_INTERNAL_KEY": values.get("IA_INTERNAL_KEY", "dev_only_internal_key_fashionstore_2026"),
        "GROQ_API_KEY": values.get("GROQ_API_KEY", "") or "",
    }


def nest_dependencies_ready(nest_dir: Path) -> bool:
    """Return true only when key Nest runtime packages are installed at the root.

    `@nestjs/serve-static` treats Express as an optional peer. With
    `npm install --legacy-peer-deps`, npm may leave that peer absent even
    when the Nest node_modules directory already exists, so test the root
    package explicitly instead of using only the directory as a sentinel.
    """
    modules = nest_dir / "node_modules"
    required = (
        modules / "@nestjs" / "core" / "package.json",
        modules / "@nestjs" / "platform-express" / "package.json",
        modules / "@nestjs" / "serve-static" / "package.json",
        modules / "express" / "package.json",
    )
    if not all(path.is_file() for path in required):
        return False
    try:
        result = subprocess.run(
            [
                "node", "-e",
                "for (const p of process.argv.slice(1)) require.resolve(p)",
                "@nestjs/core", "@nestjs/platform-express", "@nestjs/serve-static", "express",
            ],
            cwd=nest_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        return False
    return result.returncode == 0


def ensure_nest_dependencies(nest_dir: Path) -> None:
    """Install Nest dependencies whenever root runtime modules are incomplete."""
    if nest_dependencies_ready(nest_dir):
        return
    if (nest_dir / "node_modules").exists():
        log("Dependencias Nest incompletas (falta Express u otro paquete runtime); reparando con npm install ...")
    run(["npm", "install", "--legacy-peer-deps"], cwd=nest_dir)


def mode_native() -> int:
    fail_if_ports_busy()
    for cmd, hint in [
        ("node", "Instala Node.js 22+ desde https://nodejs.org"),
        ("npm", "Instala npm junto con Node.js"),
        ("psql", "Instala PostgreSQL 17 (cliente psql)"),
        ("python3", "Falta python3 en el PATH"),
    ]:
        if not have(cmd):
            fail(f"No se encontró '{cmd}'. {hint}", 2)

    ensure_postgres()

    nest_dir = ROOT / "backend-nest"
    ensure_nest_dependencies(nest_dir)
    if not (nest_dir / "dist" / "main.js").exists():
        run(["npm", "run", "build"], cwd=ROOT / "backend-nest")

    if not (ROOT / "frontend-web" / "node_modules").exists():
        run(["npm", "install", "--legacy-peer-deps"], cwd=ROOT / "frontend-web")

    venv_python = ROOT / ".venv-ia" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not venv_python.exists():
        run([sys.executable, "-m", "venv", str(ROOT / ".venv-ia")])
        run([str(venv_python), "-m", "pip", "install", "--quiet", "-r", str(ROOT / "backend-fastapi" / "requirements.txt")])

    f_env = {**os.environ, **fastapi_env()}
    n_env = {**os.environ, **nest_env()}
    signal.signal(signal.SIGINT, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))

    ia_proc = spawn("FastAPI IA", [str(venv_python), "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", str(IA_PORT)], ROOT / "backend-fastapi", f_env)
    api_proc = spawn("NestJS API", ["node", "dist/main.js"], ROOT / "backend-nest", n_env)
    web_proc = spawn("Frontend Web", ["npm", "run", "dev"], ROOT / "frontend-web", os.environ.copy())

    wait_for("FastAPI IA", f"http://127.0.0.1:{IA_PORT}/api/salud", 90)
    wait_for("NestJS API", f"http://127.0.0.1:{API_PORT}/api/health", 90)
    wait_for("Frontend Web", f"http://127.0.0.1:{WEB_PORT}/", 90)
    print_banner(docker=False)
    try:
        while True:
            for proc, name in ((ia_proc, "FastAPI"), (api_proc, "NestJS"), (web_proc, "Frontend")):
                rc = proc.poll()
                if rc is not None:
                    log(f"ERROR: el proceso {name} terminó inesperadamente (código {rc}). Revisa los logs de arriba.")
                    cleanup()
                    sys.exit(4)
            time.sleep(2)
    except KeyboardInterrupt:
        cleanup()
    return 0


def print_banner(docker: bool) -> None:
    print(
        """
============================================================
  FashionStore — stack listo
============================================================
  Web      : http://localhost:5173   (tienda 'legacy')
  API      : http://localhost:3000/api/health
  IA       : http://localhost:8000/api/salud

  Usuarios semilla (tenant legacy):
    admin@fashionstore.bo       / Fashion2026!  (Admin)
    encargado@fashionstore.bo   / Fashion2026!  (Encargado)
    cajero@fashionstore.bo      / Fashion2026!  (Cajera POS)
    proveedor@fashionstore.bo   / Fashion2026!  (Proveedor)
    cliente@fashionstore.bo     / Fashion2026!  (Cliente)

  Cobros en MODO SANDBOX (no hay dinero real de por medio).
  Para producción: cambia JWT_SECRET, contraseñas y activa
  credenciales reales SOLO desde variables de entorno.
============================================================
""".strip()
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="FashionStore — orquestador local")
    parser.add_argument("--docker", action="store_true", help="Forzar Docker Compose")
    parser.add_argument("--native", action="store_true", help="Forzar stack nativo")
    parser.add_argument("--reset-db", action="store_true",
                        help="Obsoleto: borrar y recrear la base es el comportamiento por defecto")
    parser.add_argument("--keep-db", action="store_true",
                        help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.keep_db:
        fail(
            "--keep-db fue retirado: cada arranque normal restaura la base de fábrica y elimina "
            "los datos anteriores. Quita esa opción y vuelve a iniciar.",
            2,
        )
    if args.docker and args.native:
        fail("Usa solo uno: --docker o --native", 2)

    # Limpiar builds/ de corridas anteriores fallidas
    (ROOT / "builds").mkdir(exist_ok=True)
    log("=" * 74)
    log(" MODO FÁBRICA: la base 'fashionstore' se ELIMINARÁ y recreará desde cero")
    log(" con datos de ejemplo para todos los módulos; todo arranque reinicia la fábrica.")
    log("=" * 74)

    if args.docker:
        return mode_docker()
    if args.native:
        return mode_native()
    # Automático
    if have("docker") and subprocess.run(["docker", "info"], capture_output=True).returncode == 0:
        log("Docker detectado y saludable -> modo Docker (usa --native para el stack nativo)")
        return mode_docker()
    return mode_native()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        cleanup()
