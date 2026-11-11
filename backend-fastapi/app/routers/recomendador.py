from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel

from ..catalogo import cargar_catalogo_tenant
from ..db import get_current_tenant_slug

router = APIRouter(prefix="/recomendaciones", tags=["Recomendador Hibrido"])

REGLAS_COMBINACION: Dict[str, List[str]] = {
    "blusa": ["pantalon", "falda", "cartera", "chaqueta"],
    "camiseta": ["pantalon", "chaqueta", "zapato"],
    "chaqueta": ["blusa", "pantalon", "vestido", "cartera"],
    "vestido": ["zapato", "cartera", "chaqueta"],
    "falda": ["blusa", "camiseta", "zapato", "cartera"],
    "pantalon": ["blusa", "chaqueta", "zapato", "camiseta"],
    "cartera": ["vestido", "blusa", "zapato"],
    "zapato": ["vestido", "pantalon", "cartera"],
}


class RecomendacionRequest(BaseModel):
    producto_id: Optional[int] = None
    tipo_prenda: Optional[str] = None
    color_preferido: Optional[str] = None
    presupuesto_max_bs: Optional[float] = None
    limite: int = 4


@router.get("")
def recomendar_get(
    producto_id: Optional[int] = None,
    tipo_prenda: Optional[str] = None,
    color_preferido: Optional[str] = None,
    limite: int = 4,
) -> Dict[str, Any]:
    return _calcular_recomendaciones(
        RecomendacionRequest(
            producto_id=producto_id,
            tipo_prenda=tipo_prenda,
            color_preferido=color_preferido,
            limite=limite,
        )
    )


@router.post("")
def recomendar_post(req: RecomendacionRequest) -> Dict[str, Any]:
    return _calcular_recomendaciones(req)


def _calcular_recomendaciones(req: RecomendacionRequest) -> Dict[str, Any]:
    catalogo = cargar_catalogo_tenant()
    origen: Optional[Dict[str, Any]] = None
    if req.producto_id is not None:
        for p in catalogo:
            if int(p["id"]) == int(req.producto_id):
                origen = p
                break

    tipo_base = (
        (origen.get("tipo_prenda") if origen else None)
        or (req.tipo_prenda or "vestido")
    ).lower()
    complementarios = REGLAS_COMBINACION.get(tipo_base, ["blusa", "pantalon", "cartera", "zapato"])

    puntuados: List[Dict[str, Any]] = []
    for prod in catalogo:
        if origen and int(prod["id"]) == int(origen["id"]):
            continue
        if req.presupuesto_max_bs and float(prod["precio_base"]) > req.presupuesto_max_bs:
            continue

        score = 50.0
        motivos: List[str] = []
        if prod["tipo_prenda"] in complementarios:
            idx_rank = complementarios.index(prod["tipo_prenda"])
            score += 35.0 - (idx_rank * 5.0)
            motivos.append(f"Combina con {tipo_base}")

        colores_prod = [str(c).lower() for c in (prod.get("colores") or [])]
        if req.color_preferido and req.color_preferido.lower() in colores_prod:
            score += 15.0
            motivos.append(f"Disponible en tu color preferido ({req.color_preferido})")

        stock = int(prod.get("stock_disponible_total") or 0)
        if stock > 0:
            score += min(10.0, stock * 0.4)
            motivos.append("Con stock inmediato y vista AR")

        puntuados.append(
            {
                **prod,
                "score_afinidad": round(score, 2),
                "motivo_recomendacion": " · ".join(motivos) or "Destacado de temporada",
            }
        )

    puntuados.sort(key=lambda x: x["score_afinidad"], reverse=True)
    seleccion = puntuados[: max(1, min(12, req.limite))]

    return {
        "tenant_slug": get_current_tenant_slug() or "legacy",
        "algoritmo": "hibrido_reglas_contenido_tenant_scoped",
        "producto_origen": origen["nombre"] if origen else None,
        "tipo_base": tipo_base,
        "total_recomendaciones": len(seleccion),
        "recomendaciones": seleccion,
    }
