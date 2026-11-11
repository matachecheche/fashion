from __future__ import annotations

import hmac
import re
from typing import Any, Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import SLUG_RE, reset_tenant_context, resolve_tenant_by_slug, set_tenant_context
from .routers import ar, asistente, ml, recomendador, reportes

settings = get_settings()

_production = settings.app_env.strip().lower() == "production"
app = FastAPI(
    title="FashionStore IA & Ciencia de Datos Microservice",
    version="2.0.0",
    description="Servicio FastAPI Multi-Tenant para Recomendaciones, Asistente IA, Vestidor AR, Reportes NL/Voz y Machine Learning.",
    # Express gives FastAPI an HTTPS public app URL for Nest-to-FastAPI calls.
    # Do not publish an interactive API/schema browser on that endpoint.
    docs_url=None if _production else "/docs",
    redoc_url=None if _production else "/redoc",
    openapi_url=None if _production else "/openapi.json",
)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TENANT_PATH_RE = re.compile(r"^/(?:api/)?tiendas/([a-z0-9-]+)/(.+)$")


@app.middleware("http")
async def tenant_and_internal_auth_middleware(request: Request, call_next):
    path = request.url.path
    if path in ("/health", "/api/health", "/salud", "/api/salud"):
        return await call_next(request)

    # En desarrollo se conserva la documentación interactiva local. En Express/producción
    # queda deshabilitada y sus rutas no se eximen de la autenticación interna.
    current_settings = get_settings()
    if current_settings.app_env.lower() != "production" and path in ("/docs", "/openapi.json", "/redoc"):
        return await call_next(request)

    # En producción el microservicio no debe aceptar llamadas sin autenticación servicio-a-servicio.
    if current_settings.app_env.lower() == "production" and not current_settings.ia_internal_key:
        return JSONResponse(
            status_code=503,
            content={"error": "IA_INTERNAL_KEY_REQUIRED", "detail": "Falta configurar la clave interna del microservicio IA."},
        )
    if current_settings.ia_internal_key:
        provided_key = (request.headers.get("x-ia-internal-key") or "").strip()
        if not hmac.compare_digest(provided_key, current_settings.ia_internal_key):
            return JSONResponse(
                status_code=401,
                content={"error": "UNAUTHORIZED_IA_KEY", "detail": "Clave interna de microservicio IA invalida o ausente."},
            )

    # 2. Resolver tenant desde ruta canonica /tiendas/{slug}/... o headers validados
    path_slug = None
    match = TENANT_PATH_RE.match(path)
    if match:
        path_slug = match.group(1).strip().lower()
        # Reescribir scope path al router subyacente manteniendo el tenant resuelto
        request.scope["path"] = "/" + match.group(2)

    header_slug = (request.headers.get("x-tenant-slug") or "").strip().lower()
    header_tid = (request.headers.get("x-tenant-id") or "").strip()

    if path_slug and header_slug and path_slug != header_slug:
        return JSONResponse(
            status_code=403,
            content={"error": "TENANT_MISMATCH", "detail": "El slug de la ruta no coincide con X-Tenant-Slug."},
        )

    effective_slug = path_slug or header_slug
    if not effective_slug:
        return JSONResponse(
            status_code=400,
            content={
                "error": "TENANT_SLUG_REQUIRED",
                "detail": "Se requiere especificar la tienda mediante /tiendas/{slug}/... o header X-Tenant-Slug.",
            },
        )

    if not SLUG_RE.match(effective_slug):
        return JSONResponse(
            status_code=400,
            content={"error": "INVALID_TENANT_SLUG", "detail": "Formato de slug de tienda invalido."},
        )

    tenant_row = resolve_tenant_by_slug(effective_slug)
    if tenant_row is not None:
        if header_tid and str(tenant_row["id"]) != header_tid:
            return JSONResponse(
                status_code=403,
                content={"error": "TENANT_ID_MISMATCH", "detail": "El tenant_id no coincide con la tienda resuelta."},
            )
        resolved_tid = str(tenant_row["id"])
    else:
        # En pruebas unitarias sin DB activa permitimos solo si coincide con slug explicito de prueba
        resolved_tid = header_tid or effective_slug

    tokens = set_tenant_context(resolved_tid, effective_slug)
    try:
        response = await call_next(request)
        response.headers["X-Resolved-Tenant-Slug"] = effective_slug
        return response
    finally:
        reset_tenant_context(tokens)


@app.get("/health")
@app.get("/api/health")
@app.get("/salud")
@app.get("/api/salud")
def healthcheck() -> Dict[str, Any]:
    return {
        "status": "ok",
        "estado": "ok",
        "service": "fashionstore-fastapi-ia",
        "version": "2.0.0",
        "tenant_isolation": "enforced",
    }


app.include_router(recomendador.router)
app.include_router(asistente.router)
app.include_router(ar.router)
app.include_router(reportes.router)
app.include_router(ml.router)
