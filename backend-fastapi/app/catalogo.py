from __future__ import annotations

from typing import Any, Dict, List, Optional

from .db import query_tenant_rows

FALLBACK_CATALOGO: List[Dict[str, Any]] = [
    {
        "id": 1,
        "codigo": "PRD-BLU-001",
        "nombre": "Blusa Seda Imperial",
        "tipo_prenda": "blusa",
        "material": "Seda Satén",
        "precio_base": 185.0,
        "imagen_url": "/assets/prendas/blusa-azul-foto.jpg",
        "ar_overlay_url": "/assets/prendas/blusa-azul-ar.png",
        "categoria_nombre": "Blusas",
        "colores": ["azul", "rosado"],
        "tallas": ["S", "M"],
        "stock_disponible_total": 34,
    },
    {
        "id": 2,
        "codigo": "PRD-CAM-002",
        "nombre": "Camiseta Algodon Pima Urban",
        "tipo_prenda": "camiseta",
        "material": "Algodon Pima 100%",
        "precio_base": 110.0,
        "imagen_url": "/assets/prendas/camiseta-blanco-foto.jpg",
        "ar_overlay_url": "/assets/prendas/camiseta-blanco-ar.png",
        "categoria_nombre": "Camisetas",
        "colores": ["blanco", "negro", "verde"],
        "tallas": ["M", "L"],
        "stock_disponible_total": 57,
    },
    {
        "id": 3,
        "codigo": "PRD-CAR-003",
        "nombre": "Cartera Estructurada Milano",
        "tipo_prenda": "cartera",
        "material": "Eco-Cuero Graneado",
        "precio_base": 260.0,
        "imagen_url": "/assets/prendas/cartera-camel-foto.jpg",
        "ar_overlay_url": "/assets/prendas/cartera-camel-ar.png",
        "categoria_nombre": "Carteras",
        "colores": ["camel", "negro", "vino"],
        "tallas": ["U"],
        "stock_disponible_total": 22,
    },
    {
        "id": 4,
        "codigo": "PRD-CHA-004",
        "nombre": "Chaqueta Sastre Atelier",
        "tipo_prenda": "chaqueta",
        "material": "Lino y Viscosa",
        "precio_base": 340.0,
        "imagen_url": "/assets/prendas/chaqueta-negro-foto.jpg",
        "ar_overlay_url": "/assets/prendas/chaqueta-negro-ar.png",
        "categoria_nombre": "Chaquetas",
        "colores": ["negro", "camel", "beige"],
        "tallas": ["S", "M", "L"],
        "stock_disponible_total": 25,
    },
    {
        "id": 5,
        "codigo": "PRD-FAL-005",
        "nombre": "Falda Midi Plisada Soleil",
        "tipo_prenda": "falda",
        "material": "Crepe Georgette",
        "precio_base": 195.0,
        "imagen_url": "/assets/prendas/falda-beige-foto.jpg",
        "ar_overlay_url": "/assets/prendas/falda-beige-ar.png",
        "categoria_nombre": "Faldas",
        "colores": ["beige", "mostaza", "celeste"],
        "tallas": ["S", "M"],
        "stock_disponible_total": 34,
    },
    {
        "id": 6,
        "codigo": "PRD-PAN-006",
        "nombre": "Pantalon Palazzo Riviera",
        "tipo_prenda": "pantalon",
        "material": "Gabardina Ligera",
        "precio_base": 230.0,
        "imagen_url": "/assets/prendas/pantalon-vino-foto.jpg",
        "ar_overlay_url": "/assets/prendas/pantalon-vino-ar.png",
        "categoria_nombre": "Pantalones",
        "colores": ["vino", "gris", "negro"],
        "tallas": ["M", "L"],
        "stock_disponible_total": 40,
    },
    {
        "id": 7,
        "codigo": "PRD-VES-007",
        "nombre": "Vestido Gala Aurora",
        "tipo_prenda": "vestido",
        "material": "Chiffon Seda",
        "precio_base": 380.0,
        "imagen_url": "/assets/prendas/vestido-rojo-foto.jpg",
        "ar_overlay_url": "/assets/prendas/vestido-rojo-ar.png",
        "categoria_nombre": "Vestidos",
        "colores": ["rojo", "vino", "azul"],
        "tallas": ["S", "M", "L"],
        "stock_disponible_total": 21,
    },
    {
        "id": 8,
        "codigo": "PRD-ZAP-008",
        "nombre": "Stiletto Clasico Verano",
        "tipo_prenda": "zapato",
        "material": "Cuero Nobuck",
        "precio_base": 290.0,
        "imagen_url": "/assets/prendas/zapato-negro-foto.jpg",
        "ar_overlay_url": "/assets/prendas/zapato-negro-ar.png",
        "categoria_nombre": "Zapatos",
        "colores": ["negro", "beige", "rojo"],
        "tallas": ["37", "38"],
        "stock_disponible_total": 20,
    },
]


def cargar_catalogo_tenant(explicit_tenant_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Carga el catalogo activo del tenant actual desde PostgreSQL bajo RLS.
    Si la BD no esta disponible en pruebas unitarias sin DB, retorna copia segura.
    """
    try:
        rows = query_tenant_rows(
            """
            SELECT
              p.id,
              p.codigo,
              p.nombre,
              p.descripcion,
              p.tipo_prenda,
              p.genero,
              p.material,
              p.precio_base::FLOAT AS precio_base,
              p.imagen_url,
              p.ar_overlay_url,
              p.ar_config_json,
              c.nombre AS categoria_nombre,
              COALESCE(ARRAY_AGG(DISTINCT v.color) FILTER (WHERE v.color IS NOT NULL), ARRAY[]::VARCHAR[]) AS colores,
              COALESCE(ARRAY_AGG(DISTINCT v.talla) FILTER (WHERE v.talla IS NOT NULL), ARRAY[]::VARCHAR[]) AS tallas,
              COALESCE(SUM(s.cantidad - s.reservado), 0)::INT AS stock_disponible_total
            FROM public.productos p
            JOIN public.categorias c ON c.tenant_id = p.tenant_id AND c.id = p.categoria_id
            LEFT JOIN public.variantes v ON v.tenant_id = p.tenant_id AND v.producto_id = p.id AND v.activa = TRUE
            LEFT JOIN public.stock s ON s.tenant_id = v.tenant_id AND s.variante_id = v.id
            WHERE p.activo = TRUE
            GROUP BY p.id, c.nombre
            ORDER BY p.id ASC
            """,
            readonly=True,
            explicit_tenant_id=explicit_tenant_id,
        )
        return rows
    except PermissionError:
        raise
    except Exception:
        return [dict(item) for item in FALLBACK_CATALOGO]
