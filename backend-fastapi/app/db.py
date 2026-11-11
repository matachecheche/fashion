from __future__ import annotations

import contextvars
import re
from contextlib import contextmanager
from typing import Any, Dict, Generator, Iterable, List, Optional

import psycopg
from psycopg.rows import dict_row

from .config import get_settings

SLUG_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$")

_tenant_id_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("tenant_id", default=None)
_tenant_slug_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("tenant_slug", default=None)


def set_tenant_context(tenant_id: str, tenant_slug: str) -> tuple[contextvars.Token, contextvars.Token]:
    if not tenant_id or not SLUG_RE.match(tenant_slug):
        raise ValueError("Identificador de tenant invalido o ausente.")
    t1 = _tenant_id_ctx.set(tenant_id)
    t2 = _tenant_slug_ctx.set(tenant_slug)
    return t1, t2


def reset_tenant_context(tokens: tuple[contextvars.Token, contextvars.Token]) -> None:
    t1, t2 = tokens
    _tenant_id_ctx.reset(t1)
    _tenant_slug_ctx.reset(t2)


def get_current_tenant_id(required: bool = True) -> Optional[str]:
    val = _tenant_id_ctx.get()
    if required and not val:
        raise PermissionError("TENANT_CONTEXT_REQUIRED: No se establecio contexto de tienda para la consulta.")
    return val


def get_current_tenant_slug() -> Optional[str]:
    return _tenant_slug_ctx.get()


def _build_conninfo() -> str:
    settings = get_settings()
    dsn = settings.database_url
    if settings.database_ssl and "sslmode=" not in dsn:
        sep = "&" if "?" in dsn else "?"
        dsn = f"{dsn}{sep}sslmode=require"
    return dsn


def resolve_tenant_by_slug(slug: str) -> Optional[Dict[str, Any]]:
    clean = (slug or "").strip().lower()
    if not SLUG_RE.match(clean):
        return None
    try:
        with psycopg.connect(_build_conninfo(), row_factory=dict_row, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute("SET LOCAL ROLE app_runtime")
                cur.execute(
                    """
                    SELECT id, slug, nombre, plan, estado, demo_inicia_en, demo_vence_en,
                           max_usuarios, max_sucursales, max_productos
                      FROM public.tenants
                     WHERE slug = %s
                     LIMIT 1
                    """,
                    (clean,),
                )
                row = cur.fetchone()
                conn.commit()
                return dict(row) if row else None
    except Exception:
        return None


@contextmanager
def tenant_db_cursor(readonly: bool = False, explicit_tenant_id: Optional[str] = None) -> Generator[psycopg.Cursor[Dict[str, Any]], None, None]:
    """
    Abre una transaccion aislada que aplica:
      1. SET LOCAL ROLE app_readonly / app_runtime (sin BYPASSRLS)
      2. SELECT set_config('app.tenant_id', tenant_id, true)
      3. SET LOCAL statement_timeout = '8000ms'
    Al salir (o ante excepcion), hace commit/rollback y nunca deja estado residual.
    """
    tenant_id = explicit_tenant_id or get_current_tenant_id(required=True)
    role_sql = "SET LOCAL ROLE app_readonly" if readonly else "SET LOCAL ROLE app_runtime"
    conn = psycopg.connect(_build_conninfo(), row_factory=dict_row, autocommit=False, connect_timeout=5)
    try:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = '8000ms'")
            cur.execute(role_sql)
            cur.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant_id,))
            if readonly:
                cur.execute("SET TRANSACTION READ ONLY")
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def query_tenant_rows(
    sql: str,
    params: Optional[Iterable[Any]] = None,
    readonly: bool = True,
    explicit_tenant_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    with tenant_db_cursor(readonly=readonly, explicit_tenant_id=explicit_tenant_id) as cur:
        cur.execute(sql, tuple(params or ()))
        if cur.description is None:
            return []
        return [dict(r) for r in cur.fetchall()]
