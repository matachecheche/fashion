#!/usr/bin/env python3
"""Crea el manifiesto SHA-256 y un ZIP liviano y reproducible de FashionStore.

Uso: python tools/paquetizar_proyecto.py
El ZIP extrae a `fashionstore/` y omite dependencias, compilados, datos locales,
capturas y archivos con nombres/extensiones de secretos conocidos. Ejecuta luego
`tools/verificar_manifiesto.py --zip`; ningún filtro detecta secretos arbitrarios
ofuscados. Los `.env.example` con placeholders explícitos sí se incluyen.
"""
from __future__ import annotations

import hashlib
import os
import stat
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "manifest.sha256"
ARCHIVE = ROOT / "proyecto.zip"
MAX_ARCHIVE_BYTES = 15 * 1024 * 1024

EXCLUDED_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "dist", "build", "builds", "coverage",
    ".arena", ".cache", ".local", ".mypy_cache", ".next", ".nox", ".npm", ".nuxt",
    ".output", ".parcel-cache", ".playwright-cli", ".pytest_cache", ".ruff_cache", ".svelte-kit",
    ".tox", ".turbo", ".vite", ".expo", ".venv", ".venv-ia", "venv", "__pycache__",
    "android", "ios", "target", "out", "uploads", "screenshots", ".ssh", ".aws", ".azure",
}
EXCLUDED_PREFIXES = {"docs/screenshots"}
EXCLUDED_FILES = {
    ".env", ".cloud.env", ".cloud.json", ".fs_app_password", ".pg_password", ".pgpass",
    ".netrc", ".npmrc", ".pypirc", "credentials.json", "service-account.json",
    "manifest.sha256", "proyecto.zip", "Thumbs.db", ".DS_Store",
}
EXCLUDED_SUFFIXES = {
    ".pyc", ".pyo", ".log", ".tmp", ".pem", ".key", ".crt", ".cer", ".der",
    ".p12", ".pfx", ".jks", ".keystore", ".sqlite", ".sqlite3", ".db",
}


def excluded(rel: Path) -> bool:
    parts = rel.parts
    if any(part in EXCLUDED_DIRS or part.startswith("dist-") for part in parts[:-1]):
        return True
    posix = rel.as_posix()
    if any(posix == prefix or posix.startswith(prefix + "/") for prefix in EXCLUDED_PREFIXES):
        return True
    name = rel.name
    lower = name.lower()
    if lower in EXCLUDED_FILES:
        return True
    if lower.startswith(".env.") and lower != ".env.example":
        return True
    if lower.startswith(("id_rsa", "id_ed25519", "service-account", "firebase-adminsdk")):
        return True
    if "credential" in lower or "private_key" in lower or "secret" in lower:
        return True
    if rel.suffix.lower() in EXCLUDED_SUFFIXES:
        return True
    return False


def excluded_directory(rel: Path) -> bool:
    parts = rel.parts
    if any(part in EXCLUDED_DIRS or part.startswith("dist-") for part in parts):
        return True
    posix = rel.as_posix()
    return any(posix == prefix or posix.startswith(prefix + "/") for prefix in EXCLUDED_PREFIXES)


def collect_files() -> list[Path]:
    found: list[Path] = []
    for base, dirs, files in os.walk(ROOT):
        base_path = Path(base)
        rel_base = base_path.relative_to(ROOT)
        dirs[:] = sorted(
            d for d in dirs
            if not excluded_directory(rel_base / d) and not (rel_base / d).is_symlink()
        )
        for name in files:
            path = base_path / name
            rel = path.relative_to(ROOT)
            if path.is_symlink() or excluded(rel) or not path.is_file():
                continue
            found.append(path)
    return sorted(found, key=lambda p: p.relative_to(ROOT).as_posix())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(files: list[Path]) -> bytes:
    lines = [f"{sha256_file(path)}  {path.relative_to(ROOT).as_posix()}" for path in files]
    content = ("\n".join(lines) + "\n").encode("utf-8")
    fd, tmp_name = tempfile.mkstemp(prefix="manifest-", dir=ROOT)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        Path(tmp_name).replace(MANIFEST)
    finally:
        Path(tmp_name).unlink(missing_ok=True)
    return content


def make_zip(files: list[Path], manifest_bytes: bytes) -> int:
    fd, tmp_name = tempfile.mkstemp(prefix="fashionstore-", suffix=".zip", dir=ROOT)
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in files:
                rel = path.relative_to(ROOT).as_posix()
                info = zipfile.ZipInfo(f"fashionstore/{rel}", date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
            manifest_info = zipfile.ZipInfo("fashionstore/manifest.sha256", date_time=(2026, 1, 1, 0, 0, 0))
            manifest_info.compress_type = zipfile.ZIP_DEFLATED
            manifest_info.create_system = 3
            manifest_info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(manifest_info, manifest_bytes, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        tmp_path.replace(ARCHIVE)
        return ARCHIVE.stat().st_size
    finally:
        tmp_path.unlink(missing_ok=True)


def main() -> int:
    files = collect_files()
    if not files:
        print("[ERROR] No hay archivos de proyecto para empaquetar.")
        return 2
    manifest_bytes = write_manifest(files)
    archive_size = make_zip(files, manifest_bytes)
    print(f"Manifiesto SHA-256: {len(files)} archivos -> {MANIFEST.name}")
    print(f"ZIP: {ARCHIVE.name} ({archive_size:,} bytes, {len(files) + 1} entradas)")
    print("Incluye fuentes/assets runtime; excluye dependencias, builds, datos/capturas y archivos típicos de secretos.")
    print("El verificador escanea marcadores conocidos; revisa manualmente el contenido antes de compartir.")
    if archive_size > MAX_ARCHIVE_BYTES:
        print(f"[ERROR] El ZIP supera el presupuesto de 15 MiB ({MAX_ARCHIVE_BYTES:,} bytes).")
        return 1
    print("[OK] Presupuesto de 15 MiB cumplido.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
