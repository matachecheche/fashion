#!/usr/bin/env python3
"""Verifica el manifiesto SHA-256 del proyecto y el ZIP final.

Uso:
    python tools/verificar_manifiesto.py
    python tools/verificar_manifiesto.py --zip
Códigos: 0 íntegro, 1 discrepancias, 2 faltan los artefactos o hay uso incorrecto.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "manifest.sha256"
ARCHIVE = ROOT / "proyecto.zip"
MAX_ARCHIVE_BYTES = 15 * 1024 * 1024
FORBIDDEN_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "builds", ".venv", ".venv-ia", "venv",
    ".expo", "__pycache__", "dist", "build", "coverage", "android", "ios", "target",
    "out", "uploads", "screenshots", ".ssh", ".aws", ".azure", ".arena", ".cache", ".local",
    ".mypy_cache", ".next", ".nox", ".npm", ".nuxt", ".output", ".parcel-cache",
    ".playwright-cli", ".pytest_cache", ".ruff_cache", ".svelte-kit", ".tox", ".turbo", ".vite",
}
FORBIDDEN_FILES = {
    ".env", ".cloud.env", ".cloud.json", ".fs_app_password", ".pg_password", ".pgpass",
    ".netrc", ".npmrc", ".pypirc", "credentials.json", "service-account.json",
}
FORBIDDEN_SUFFIXES = {
    ".pem", ".key", ".crt", ".cer", ".der", ".p12", ".pfx", ".jks", ".keystore",
    ".sqlite", ".sqlite3", ".db",
}
SECRET_PATTERNS = (
    ("private-key PEM", re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("Stripe secret key", re.compile(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b")),
    ("payment webhook secret", re.compile(r"\bwhsec_[A-Za-z0-9]{24,}\b")),
    ("JWT token", re.compile(r"\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b")),
    ("literal application secret setting", re.compile(
        r"(?im)^[\t ]*(?:JWT_SECRET|IA_INTERNAL_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|"
        r"STRIPE_SIMULATOR_WEBHOOK_SECRET|LIBELULA_APP_KEY|LIBELULA_WEBHOOK_SECRET|GROQ_API_KEY)[\t ]*=[\t ]*[\"']?"
        r"(?![^#\r\n]*(?:REPLACE|YOUR_|PLACEHOLDER|CHANGE_ME|EXAMPLE|DUMMY|SAMPLE|SET_ME|<|>))"
        r"[^\s\"'#]{24,}"
    )),
    ("credentialed database URL", re.compile(
        r"\b(?:postgres(?:ql)?|mysql|redis)://[^:/\s]+:(?![^@/\s]*[${}][^@/\s]*@)"
        r"(?![^@/\s]*(?:REPLACE|YOUR_|PASSWORD|PLACEHOLDER|CHANGEME|EXAMPLE|DUMMY|SAMPLE)"
        r"[^@/\s]*@)[^@/\s]{8,}@", re.I
    )),

)
MAX_SCAN_BYTES = 8 * 1024 * 1024


def secret_markers(data: bytes, name: str) -> list[str]:
    # Escanea bytes ASCII reconocibles en archivos de texto y assets comunes;
    # el reporte solo expone la categoría y la ruta, jamás el valor encontrado.
    text = data[:MAX_SCAN_BYTES].decode("utf-8", errors="ignore")
    return [label for label, pattern in SECRET_PATTERNS if pattern.search(text)]


def forbidden_zip_entries(names: list[str]) -> list[str]:
    bad: list[str] = []
    for raw in names:
        name = raw.replace("\\", "/")
        path = PurePosixPath(name)
        parts = path.parts
        if path.is_absolute() or ".." in parts or not parts or parts[0] != "fashionstore":
            bad.append(name)
            continue
        if any(part in FORBIDDEN_DIRS or part.startswith("dist-") for part in parts[1:-1]):
            bad.append(name)
            continue
        basename = parts[-1]
        lower = basename.lower()
        if lower in FORBIDDEN_FILES or (lower.startswith(".env.") and lower != ".env.example"):
            bad.append(name)
            continue
        if lower.startswith(("id_rsa", "id_ed25519", "service-account", "firebase-adminsdk")):
            bad.append(name)
            continue
        if "credential" in lower or "private_key" in lower or "secret" in lower:
            bad.append(name)
            continue
        if Path(lower).suffix in FORBIDDEN_SUFFIXES:
            bad.append(name)
    return bad


def sha256_stream(stream) -> str:
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def parse_manifest() -> tuple[dict[str, str], list[str]]:
    expected: dict[str, str] = {}
    errors: list[str] = []
    for line_no, raw in enumerate(MANIFEST.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        try:
            digest, rel = line.split(None, 1)
        except ValueError:
            errors.append(f"línea {line_no} malformada")
            continue
        rel = rel.strip().lstrip("*").replace("\\", "/")
        path = PurePosixPath(rel)
        if len(digest) != 64 or any(c not in "0123456789abcdefABCDEF" for c in digest):
            errors.append(f"hash SHA-256 inválido en línea {line_no}")
            continue
        if path.is_absolute() or ".." in path.parts or not path.parts:
            errors.append(f"ruta inválida en línea {line_no}: {rel}")
            continue
        if rel in expected:
            errors.append(f"ruta duplicada en manifiesto: {rel}")
            continue
        expected[rel] = digest.lower()
    return expected, errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", action="store_true", help="verifica integridad, lista de archivos y secretos del ZIP")
    args = parser.parse_args()

    if not MANIFEST.exists():
        print(f"[ERROR] No existe {MANIFEST}. Ejecuta: python tools/paquetizar_proyecto.py")
        return 2

    expected, errors = parse_manifest()
    total = len(expected)
    checked = 0
    for rel, digest in expected.items():
        path = ROOT.joinpath(*PurePosixPath(rel).parts)
        if not path.is_file() or path.is_symlink():
            errors.append(f"FALTA {rel}")
            continue
        with path.open("rb") as stream:
            actual = sha256_stream(stream)
        if actual != digest:
            errors.append(f"DIFERENTE {rel}")
        else:
            checked += 1
        if path.stat().st_size > MAX_SCAN_BYTES:
            errors.append(f"contenido demasiado grande para escaneo de secretos: {rel}")
        else:
            for marker in secret_markers(path.read_bytes(), rel):
                errors.append(f"secreto probable ({marker}) en {rel}; valor omitido")
    print(f"Manifest: {checked}/{total} archivos SHA-256 verificados")

    if args.zip:
        if not ARCHIVE.is_file():
            print(f"[ERROR] No existe {ARCHIVE}. Ejecuta: python tools/paquetizar_proyecto.py")
            errors.append("proyecto.zip ausente")
        else:
            if ARCHIVE.stat().st_size > MAX_ARCHIVE_BYTES:
                errors.append(f"proyecto.zip supera 15 MiB: {ARCHIVE.stat().st_size} bytes")
            try:
                with zipfile.ZipFile(ARCHIVE) as archive:
                    names = archive.namelist()
                    duplicates = sorted({name for name in names if names.count(name) > 1})
                    if duplicates:
                        errors.extend(f"entrada duplicada: {name}" for name in duplicates)
                    corrupt = archive.testzip()
                    if corrupt is not None:
                        errors.append(f"proyecto.zip corrupto en {corrupt}")
                    leaks = forbidden_zip_entries(names)
                    errors.extend(f"entrada prohibida: {name}" for name in leaks)

                    expected_archive = {f"fashionstore/{rel}" for rel in expected}
                    expected_archive.add("fashionstore/manifest.sha256")
                    actual_archive = set(names)
                    missing = sorted(expected_archive - actual_archive)
                    extra = sorted(actual_archive - expected_archive)
                    errors.extend(f"falta en ZIP: {name}" for name in missing)
                    errors.extend(f"no listado en manifiesto: {name}" for name in extra)

                    if "fashionstore/manifest.sha256" in actual_archive:
                        archived_manifest = archive.read("fashionstore/manifest.sha256")
                        if archived_manifest != MANIFEST.read_bytes():
                            errors.append("manifest.sha256 dentro del ZIP no coincide con el manifiesto local")
                    for rel, digest in expected.items():
                        entry = f"fashionstore/{rel}"
                        if entry not in actual_archive:
                            continue
                        info = archive.getinfo(entry)
                        data = archive.read(entry)
                        if hashlib.sha256(data).hexdigest() != digest:
                            errors.append(f"hash distinto dentro del ZIP: {rel}")
                        if info.file_size > MAX_SCAN_BYTES:
                            errors.append(f"contenido demasiado grande para escaneo de secretos dentro del ZIP: {rel}")
                        else:
                            for marker in secret_markers(data, rel):
                                errors.append(f"secreto probable dentro del ZIP ({marker}) en {rel}; valor omitido")
                    print(f"ZIP: {len(names)} entradas; testzip={'OK' if corrupt is None else 'FALLO'}; tamaño={ARCHIVE.stat().st_size:,} bytes")
            except zipfile.BadZipFile as exc:
                errors.append(f"proyecto.zip inválido: {exc}")

    if errors:
        print(f"RESULTADO: FALLO ({len(errors)} problemas)")
        for error in errors:
            print("  [X]", error)
        return 1
    print("RESULTADO: INTEGRO")
    return 0


if __name__ == "__main__":
    sys.exit(main())
