#!/usr/bin/env python3
"""Aplica en el repo los arreglos que hacen falta para que CI y el APK pasen.

Uso (desde cualquier carpeta dentro del repo, o desde su raíz):
    python arreglar_repo.py

Es idempotente: si algo ya está arreglado, lo deja como está.
Busca la raíz del repo (la carpeta que contiene backend-nest y mobile-app),
tanto si está en la raíz como dentro de una subcarpeta (p. ej. fashionstore/).
"""
import json
import re
import sys
from pathlib import Path

VERSION = "2.0.1"
VERSION_CODE = 21


def find_root() -> Path:
    start = Path.cwd().resolve()
    for base in [start, *start.parents]:
        if (base / "backend-nest").is_dir() and (base / "mobile-app").is_dir():
            return base
    for base in [start, *start.parents]:
        for sub in base.glob("*/"):
            if (sub / "backend-nest").is_dir() and (sub / "mobile-app").is_dir():
                return sub
    sys.exit("No encuentro la raíz del repo (carpeta con backend-nest y mobile-app).")


def find_file(root: Path, name: str, must_contain: str = "") -> "Path | None":
    """Busca un archivo por nombre bajo root (ignora node_modules y .git)."""
    for path in root.rglob(name):
        parts = set(path.parts)
        if "node_modules" in parts or ".git" in parts:
            continue
        if must_contain and must_contain not in path.as_posix():
            continue
        return path
    return None


def fix_specific_status(root: Path) -> None:
    path = find_file(root, "asistente-context.ts")
    if path is None:
        ia = root / "backend-nest/src/ia"
        print("AVISO: no existe asistente-context.ts en tu copia local; se omite este arreglo.")
        print("  Contenido de backend-nest/src/ia:",
              sorted(x.name for x in ia.iterdir()) if ia.is_dir() else "(la carpeta no existe)")
        return
    print(f"Archivo TS: {path}")
    text = path.read_text(encoding="utf-8")
    if "function isAssistantDetailRequest(" not in text:
        print("AVISO: asistente-context.ts no contiene isAssistantDetailRequest; se omite.")
        return
    start = text.index("function isAssistantDetailRequest(")
    end = text.index("\n}", start)
    body = text[start:end]
    decl_match = re.search(r"^[ \t]*const specificStatus = .*\n", body, re.M)
    use_match = re.search(r"^[ \t]*if \(asksConcept .*specificStatus.*\n", body, re.M)
    if not decl_match or not use_match:
        print("asistente-context.ts: no encontré el patrón esperado; revisa a mano.")
        return
    if decl_match.start() < use_match.start():
        print("asistente-context.ts: ya estaba bien.")
        return
    decl = decl_match.group(0)
    body = body.replace(decl, "", 1)
    use_match = re.search(r"^[ \t]*if \(asksConcept .*specificStatus.*\n", body, re.M)
    body = body[: use_match.start()] + decl + body[use_match.start():]
    path.write_text(text[:start] + body + text[end:], encoding="utf-8")
    print("asistente-context.ts: declaración de specificStatus movida antes de su uso.")


def dump_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def fix_versions(root: Path) -> None:
    mobile = root / "mobile-app"

    cfg = mobile / "src/config.ts"
    if cfg.is_file():
        text = cfg.read_text(encoding="utf-8")
        new = re.sub(r"APP_VERSION = '[^']*'", f"APP_VERSION = '{VERSION}'", text)
        cfg.write_text(new, encoding="utf-8")
    else:
        print("AVISO: falta mobile-app/src/config.ts")

    pkg_path = mobile / "package.json"
    if pkg_path.is_file():
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
        pkg["version"] = VERSION
        dump_json(pkg_path, pkg)
    else:
        print("AVISO: falta mobile-app/package.json")

    lock_path = mobile / "package-lock.json"
    if lock_path.is_file():
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock["version"] = VERSION
        lock.setdefault("packages", {}).setdefault("", {})["version"] = VERSION
        dump_json(lock_path, lock)
    else:
        print("AVISO: falta mobile-app/package-lock.json")

    app_path = mobile / "app.json"
    if app_path.is_file():
        app = json.loads(app_path.read_text(encoding="utf-8"))
        app["expo"]["version"] = VERSION
        app["expo"].setdefault("android", {})["versionCode"] = VERSION_CODE
        dump_json(app_path, app)
    else:
        print("AVISO: falta mobile-app/app.json")
    print(f"Versión móvil alineada en {VERSION} (versionCode {VERSION_CODE}).")


if __name__ == "__main__":
    root = find_root()
    print(f"Raíz del repo: {root}")
    fix_specific_status(root)
    fix_versions(root)
    print("Listo. Haz commit y push de los archivos modificados.")
