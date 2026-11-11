from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..catalogo import cargar_catalogo_tenant
from ..db import get_current_tenant_slug

router = APIRouter(prefix="/ar", tags=["Vestidor Virtual AR"])

TIPOS_PRENDA = ["blusa", "camiseta", "cartera", "chaqueta", "falda", "pantalon", "vestido", "zapato"]
COLORES_PRENDA = ["azul", "beige", "blanco", "camel", "celeste", "gris", "mostaza", "negro", "rojo", "rosado", "verde", "vino"]

ANCHORS_POR_TIPO: Dict[str, Dict[str, Any]] = {
    "blusa": {"anchor": "torso", "landmarks": [11, 12, 23, 24], "scale": 1.05, "offsetY": -0.02},
    "camiseta": {"anchor": "torso", "landmarks": [11, 12, 23, 24], "scale": 1.02, "offsetY": 0.0},
    "chaqueta": {"anchor": "torso", "landmarks": [11, 12, 23, 24], "scale": 1.12, "offsetY": 0.0},
    "vestido": {"anchor": "full_body", "landmarks": [11, 12, 23, 24, 25, 26], "scale": 1.18, "offsetY": 0.08},
    "falda": {"anchor": "hips", "landmarks": [23, 24, 25, 26], "scale": 1.05, "offsetY": 0.22},
    "pantalon": {"anchor": "legs", "landmarks": [23, 24, 27, 28], "scale": 1.08, "offsetY": 0.28},
    "cartera": {"anchor": "hip_left", "landmarks": [11, 23], "scale": 0.85, "offsetY": 0.15},
    "zapato": {"anchor": "feet", "landmarks": [27, 28, 31, 32], "scale": 0.75, "offsetY": 0.42},
}


class CalibracionARRequest(BaseModel):
    tipo_prenda: str = Field(default="vestido")
    color: str = Field(default="rojo")
    ancho_hombros_px: float = Field(default=160.0, gt=10.0)
    altura_torso_px: float = Field(default=240.0, gt=10.0)
    modo_manual: bool = Field(default=False)


@router.get("/catalogo-overlays")
def obtener_overlays_ar() -> Dict[str, Any]:
    catalogo = cargar_catalogo_tenant()
    variantes_ar: List[Dict[str, Any]] = []
    for tipo in TIPOS_PRENDA:
        cfg = ANCHORS_POR_TIPO[tipo]
        for color in COLORES_PRENDA:
            variantes_ar.append(
                {
                    "id": f"{tipo}-{color}",
                    "tipo_prenda": tipo,
                    "color": color,
                    "foto_url": f"/assets/prendas/{tipo}-{color}-foto.jpg",
                    "ar_url": f"/assets/prendas/{tipo}-{color}-ar.png",
                    "anchor": cfg["anchor"],
                    "landmarks": cfg["landmarks"],
                    "scale": cfg["scale"],
                    "offsetY": cfg["offsetY"],
                }
            )
    return {
        "tenant_slug": get_current_tenant_slug() or "legacy",
        "total_variantes_ar": len(variantes_ar),
        "productos_tienda": len(catalogo),
        "modos_soportados": ["camara_mediapipe", "manual_interactivo"],
        "productos": catalogo,
        "overlays": variantes_ar,
    }


@router.post("/calibrar")
def calibrar_overlay_ar(body: CalibracionARRequest) -> Dict[str, Any]:
    tipo = body.tipo_prenda.strip().lower()
    color = body.color.strip().lower()
    if tipo not in ANCHORS_POR_TIPO:
        raise HTTPException(status_code=400, detail=f"Tipo de prenda no soportado en AR: {tipo}")
    if color not in COLORES_PRENDA:
        raise HTTPException(status_code=400, detail=f"Color no disponible en catalogo AR: {color}")

    cfg = ANCHORS_POR_TIPO[tipo]
    escala_sugerida = round((body.ancho_hombros_px / 180.0) * cfg["scale"], 3)
    alto_sugerido = round(body.altura_torso_px * 1.45 * cfg["scale"], 1)
    ancho_sugerido = round(body.ancho_hombros_px * 1.65 * cfg["scale"], 1)

    return {
        "tipo_prenda": tipo,
        "color": color,
        "modo": "manual_fallback" if body.modo_manual else "camara_tracking",
        "ar_url": f"/assets/prendas/{tipo}-{color}-ar.png",
        "foto_url": f"/assets/prendas/{tipo}-{color}-foto.jpg",
        "anchor": cfg["anchor"],
        "landmarks_requeridos": cfg["landmarks"],
        "parametros_render": {
            "scale": escala_sugerida,
            "width_px": ancho_sugerido,
            "height_px": alto_sugerido,
            "offset_y_ratio": cfg["offsetY"],
            "fallback_manual_habilitado": True,
        },
    }
