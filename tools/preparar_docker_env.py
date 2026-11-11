#!/usr/bin/env python3
"""Genera secretos locales persistentes para Docker Compose; nunca imprime sus valores."""
from __future__ import annotations

import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "builds" / ".env.docker"
REQUIRED = (
    "POSTGRES_PASSWORD",
    "FS_APP_PASSWORD",
    "JWT_SECRET",
    "IA_INTERNAL_KEY",
    "STRIPE_SIMULATOR_WEBHOOK_SECRET",
    "LIBELULA_APP_KEY",
    "LIBELULA_WEBHOOK_SECRET",
)
DEFAULTS = {
    "NODE_ENV": "development",
    "APP_ENV": "development",
    "CORS_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173",
    "PUBLIC_API_URL": "http://localhost:3000",
    "PUBLIC_WEB_URL": "http://localhost:5173",
}


def read_env(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    if not path.exists():
        return result
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result


def main() -> int:
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    values = read_env(ENV_FILE)
    created = not ENV_FILE.exists()
    for name in REQUIRED:
        current = values.get(name, "")
        if current:
            if len(current) < 32:
                print(f"[ERROR] {name} ya existe pero tiene menos de 32 caracteres; no se reemplaza para proteger la base persistida.")
                return 2
            continue
        if not created and name != "STRIPE_SIMULATOR_WEBHOOK_SECRET":
            print(f"[ERROR] Falta {name} en {ENV_FILE}; no se rota automáticamente un secreto de una instalación existente.")
            return 2
        # Este secreto nuevo solo firma la simulación local; puede crearse al migrar
        # una instalación antigua sin rotar secretos de DB, JWT o pasarelas reales.
        values[name] = secrets.token_hex(32)

    for key, value in DEFAULTS.items():
        values.setdefault(key, value)
    ordered = list(REQUIRED) + list(DEFAULTS)
    extra = sorted(set(values) - set(ordered))
    content = "".join(f"{key}={values[key]}\n" for key in ordered + extra)
    ENV_FILE.write_text(content, encoding="utf-8")
    try:
        ENV_FILE.chmod(0o600)
    except OSError:
        pass
    action = "Creado" if created else "Validado"
    print(f"[OK] Archivo de secretos local {action}: {ENV_FILE.relative_to(ROOT)} (los valores no se muestran).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
