from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import get_current_tenant_id, get_current_tenant_slug, query_tenant_rows

router = APIRouter(prefix="/reportes", tags=["Reportes Inteligentes NL/Voz"])

FORBIDDEN_SQL_PATTERNS = re.compile(
    r"\b(drop|delete|update|insert|alter|truncate|grant|revoke|create|copy|pg_sleep|pg_read_file|set\s+role|set\s+session)\b|;|--",
    re.IGNORECASE,
)

CATALOGO_PLANTILLAS: Dict[str, Dict[str, Any]] = {
    "ventas_tienda_mes": {
        "id": "ventas_tienda_mes",
        "titulo": "Ventas por Tienda/Sucursal y Mes",
        "tablas": ["ventas", "sucursales", "tenants"],
        "agrupacion": ["tienda_nombre", "sucursal_nombre", "periodo_mes"],
        "metricas": ["cantidad_ventas", "subtotal_bs", "descuento_bs", "total_ventas_bs"],
        "columnas": [
            {"key": "tienda_nombre", "label": "Tienda"},
            {"key": "sucursal_nombre", "label": "Sucursal"},
            {"key": "periodo_mes", "label": "Mes"},
            {"key": "estado", "label": "Estado"},
            {"key": "cantidad_ventas", "label": "Nro Ventas"},
            {"key": "total_ventas_bs", "label": "Total (Bs.)"},
        ],
    },
    "stock_bajo_sucursal": {
        "id": "stock_bajo_sucursal",
        "titulo": "Productos con Stock Bajo o Critico por Sucursal",
        "tablas": ["stock", "almacenes", "sucursales", "variantes", "productos", "categorias"],
        "agrupacion": ["sucursal_nombre", "almacen_nombre", "producto_nombre", "sku"],
        "metricas": ["cantidad_fisica", "reservado", "disponible", "stock_minimo", "deficit"],
        "columnas": [
            {"key": "sucursal_nombre", "label": "Sucursal"},
            {"key": "producto_nombre", "label": "Producto"},
            {"key": "sku", "label": "SKU"},
            {"key": "talla", "label": "Talla"},
            {"key": "color", "label": "Color"},
            {"key": "disponible", "label": "Disponible"},
            {"key": "stock_minimo", "label": "Stock Minimo"},
            {"key": "nivel_alerta", "label": "Nivel Alerta"},
        ],
    },
    "ingresos_metodo_pago": {
        "id": "ingresos_metodo_pago",
        "titulo": "Ingresos por Metodo de Pago y Pasarela",
        "tablas": ["pagos", "ventas", "sucursales"],
        "agrupacion": ["metodo_pago", "pasarela", "estado_pago", "sucursal_nombre"],
        "metricas": ["transacciones", "total_recaudado_bs", "ticket_promedio_bs"],
        "columnas": [
            {"key": "metodo_pago", "label": "Metodo de Pago"},
            {"key": "pasarela", "label": "Pasarela"},
            {"key": "sucursal_nombre", "label": "Sucursal"},
            {"key": "estado_pago", "label": "Estado"},
            {"key": "transacciones", "label": "Transacciones"},
            {"key": "total_recaudado_bs", "label": "Total Recaudado (Bs.)"},
            {"key": "ticket_promedio_bs", "label": "Ticket Promedio (Bs.)"},
        ],
    },
    "prendas_mas_reservadas": {
        "id": "prendas_mas_reservadas",
        "titulo": "Prendas y Variantes Mas Reservadas por Sucursal",
        "tablas": ["reservas", "detalle_reserva", "variantes", "productos", "sucursales"],
        "agrupacion": ["sucursal_nombre", "producto_nombre", "tipo_prenda", "color"],
        "metricas": ["total_reservas", "unidades_reservadas", "monto_estimado_bs"],
        "columnas": [
            {"key": "sucursal_nombre", "label": "Sucursal"},
            {"key": "producto_nombre", "label": "Prenda"},
            {"key": "tipo_prenda", "label": "Tipo"},
            {"key": "color", "label": "Color"},
            {"key": "total_reservas", "label": "Nro Reservas"},
            {"key": "unidades_reservadas", "label": "Unidades"},
            {"key": "monto_estimado_bs", "label": "Valor Reservado (Bs.)"},
        ],
    },
}


class ConsultaReporteNLRequest(BaseModel):
    texto: str = Field(..., min_length=3, max_length=600)
    origen_entrada: str = Field(default="texto", pattern="^(texto|voz)$")
    fecha_desde: Optional[str] = None
    fecha_hasta: Optional[str] = None
    sucursal_id: Optional[int] = None
    solo_pagadas: Optional[bool] = None
    orden: Optional[str] = Field(default=None, pattern="^(asc|desc)?$")
    limite: int = Field(default=100, ge=1, le=500)


def interpretar_solicitud_nl(req: ConsultaReporteNLRequest, tenant_slug: str) -> Dict[str, Any]:
    raw = req.texto.strip()
    if FORBIDDEN_SQL_PATTERNS.search(raw) and any(tok in raw.lower() for tok in ("select ", "drop ", "delete ", "update ", "insert ")):
        raise HTTPException(
            status_code=400,
            detail="Seguridad DSL: No se permite enviar sentencias SQL crudas o comandos DDL/DML.",
        )

    q = raw.lower()
    now = datetime.now(timezone.utc)

    # Determinar plantilla del DSL
    if any(w in q for w in ("stock", "critico", "bajo", "agotad", "inventario", "alerta")):
        plantilla_id = "stock_bajo_sucursal"
    elif any(w in q for w in ("metodo de pago", "metodos de pago", "qr", "tarjeta", "efectivo", "pasarela", "ingreso")):
        plantilla_id = "ingresos_metodo_pago"
    elif any(w in q for w in ("reserva", "reservad", "cita")):
        plantilla_id = "prendas_mas_reservadas"
    else:
        plantilla_id = "ventas_tienda_mes"

    # Determinar rango temporal
    if req.fecha_desde and req.fecha_hasta:
        desde_str = req.fecha_desde
        hasta_str = req.fecha_hasta
        periodo_label = f"{desde_str} a {hasta_str}"
    elif "semestre" in q or "6 meses" in q or "seis meses" in q:
        desde_dt = now - timedelta(days=180)
        desde_str = desde_dt.strftime("%Y-%m-%d")
        hasta_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        periodo_label = "Ultimo semestre (180 dias)"
    elif "mes" in q and ("ultimo" in q or "este" in q or "actual" in q):
        desde_dt = now - timedelta(days=31)
        desde_str = desde_dt.strftime("%Y-%m-%d")
        hasta_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        periodo_label = "Ultimo mes (31 dias)"
    elif "semana" in q:
        desde_dt = now - timedelta(days=7)
        desde_str = desde_dt.strftime("%Y-%m-%d")
        hasta_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        periodo_label = "Ultima semana (7 dias)"
    else:
        desde_dt = now - timedelta(days=365)
        desde_str = desde_dt.strftime("%Y-%m-%d")
        hasta_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        periodo_label = "Ultimos 12 meses"

    # Filtros adicionales
    solo_pagadas = req.solo_pagadas
    if solo_pagadas is None:
        solo_pagadas = any(w in q for w in ("solo pagada", "pagadas", "confirmad", "aprobada"))

    metodo_filtro: Optional[str] = None
    for m in ("efectivo", "tarjeta", "qr", "transferencia"):
        if f" {m}" in f" {q}" and plantilla_id == "ventas_tienda_mes":
            metodo_filtro = m
            break

    # Direccion de ordenamiento
    if req.orden in ("asc", "desc"):
        orden_dir = req.orden.upper()
    elif "menor a mayor" in q or "ascendente" in q:
        orden_dir = "ASC"
    else:
        orden_dir = "DESC"

    meta = CATALOGO_PLANTILLAS[plantilla_id]
    filtros_aplicados = {
        "tenant_slug": tenant_slug,
        "fecha_desde": desde_str,
        "fecha_hasta": hasta_str,
        "solo_pagadas": bool(solo_pagadas),
        "sucursal_id": req.sucursal_id,
        "metodo_pago": metodo_filtro,
    }

    return {
        "plantilla_id": plantilla_id,
        "titulo": meta["titulo"],
        "origen_entrada": req.origen_entrada,
        "solicitud_original": raw,
        "interpretacion_verificable": (
            f"Reporte '{meta['titulo']}' para la tienda '{tenant_slug}', "
            f"periodo {periodo_label} ({desde_str}..{hasta_str}), "
            f"solo_pagadas={bool(solo_pagadas)}, orden={orden_dir}, limite={req.limite}."
        ),
        "tablas": meta["tablas"],
        "agrupacion": meta["agrupacion"],
        "metricas": meta["metricas"],
        "columnas": meta["columnas"],
        "periodo": {
            "etiqueta": periodo_label,
            "desde": desde_str,
            "hasta": hasta_str,
        },
        "filtros": filtros_aplicados,
        "orden": orden_dir,
        "limite": req.limite,
    }


@router.get("/catalogo-dsl")
def listar_catalogo_dsl() -> Dict[str, Any]:
    return {
        "seguridad": "DSL cerrado con lista blanca de vistas/tablas, parametros vinculados y rol read-only con RLS.",
        "plantillas": list(CATALOGO_PLANTILLAS.values()),
    }


@router.post("/interpretar-y-ejecutar")
def interpretar_y_ejecutar_reporte(req: ConsultaReporteNLRequest) -> Dict[str, Any]:
    tenant_id = get_current_tenant_id(required=True)
    tenant_slug = get_current_tenant_slug() or "legacy"
    dsl = interpretar_solicitud_nl(req, tenant_slug=tenant_slug)
    orden_sql = "ASC" if dsl["orden"] == "ASC" else "DESC"
    plantilla_id = dsl["plantilla_id"]
    filtros = dsl["filtros"]
    limite = int(dsl["limite"])

    filas: List[Dict[str, Any]] = []
    if plantilla_id == "ventas_tienda_mes":
        estados = ["pagada", "entregada"] if filtros["solo_pagadas"] else ["pendiente_pago", "pagada", "entregada"]
        sql = f"""
            SELECT
              t.nombre AS tienda_nombre,
              s.nombre AS sucursal_nombre,
              TO_CHAR(DATE_TRUNC('month', v.creado_en), 'YYYY-MM') AS periodo_mes,
              v.estado AS estado,
              COUNT(v.id)::INT AS cantidad_ventas,
              ROUND(COALESCE(SUM(v.subtotal), 0), 2)::FLOAT AS subtotal_bs,
              ROUND(COALESCE(SUM(v.descuento), 0), 2)::FLOAT AS descuento_bs,
              ROUND(COALESCE(SUM(v.total), 0), 2)::FLOAT AS total_ventas_bs
            FROM public.ventas v
            JOIN public.sucursales s ON s.tenant_id = v.tenant_id AND s.id = v.sucursal_id
            JOIN public.tenants t ON t.id = v.tenant_id
            WHERE v.tenant_id = %s
              AND v.creado_en >= %s::timestamptz
              AND v.creado_en <= (%s::timestamptz + INTERVAL '1 day')
              AND v.estado = ANY(%s)
              AND (%s::int IS NULL OR v.sucursal_id = %s::int)
            GROUP BY t.nombre, s.nombre, DATE_TRUNC('month', v.creado_en), v.estado
            ORDER BY total_ventas_bs {orden_sql}, periodo_mes DESC
            LIMIT %s
        """
        params = (
            tenant_id,
            filtros["fecha_desde"],
            filtros["fecha_hasta"],
            estados,
            filtros["sucursal_id"],
            filtros["sucursal_id"],
            limite,
        )
        filas = query_tenant_rows(sql, params=params, readonly=True)

    elif plantilla_id == "stock_bajo_sucursal":
        sql = f"""
            SELECT
              suc.nombre AS sucursal_nombre,
              a.nombre AS almacen_nombre,
              p.nombre AS producto_nombre,
              v.sku AS sku,
              v.talla AS talla,
              v.color AS color,
              s.cantidad::INT AS cantidad_fisica,
              s.reservado::INT AS reservado,
              (s.cantidad - s.reservado)::INT AS disponible,
              s.stock_minimo::INT AS stock_minimo,
              GREATEST(0, s.stock_minimo - (s.cantidad - s.reservado))::INT AS deficit,
              CASE
                WHEN (s.cantidad - s.reservado) <= 0 THEN 'AGOTADO'
                WHEN (s.cantidad - s.reservado) <= s.stock_minimo THEN 'CRITICO'
                ELSE 'PREVENTIVO'
              END AS nivel_alerta
            FROM public.stock s
            JOIN public.almacenes a ON a.tenant_id = s.tenant_id AND a.id = s.almacen_id
            JOIN public.sucursales suc ON suc.tenant_id = a.tenant_id AND suc.id = a.sucursal_id
            JOIN public.variantes v ON v.tenant_id = s.tenant_id AND v.id = s.variante_id
            JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
            WHERE s.tenant_id = %s
              AND (s.cantidad - s.reservado) <= (s.stock_minimo + 2)
              AND (%s::int IS NULL OR suc.id = %s::int)
            ORDER BY disponible { 'ASC' if orden_sql == 'DESC' else 'DESC' }, deficit DESC
            LIMIT %s
        """
        params = (tenant_id, filtros["sucursal_id"], filtros["sucursal_id"], limite)
        filas = query_tenant_rows(sql, params=params, readonly=True)

    elif plantilla_id == "ingresos_metodo_pago":
        sql = f"""
            SELECT
              pg.metodo AS metodo_pago,
              pg.pasarela AS pasarela,
              s.nombre AS sucursal_nombre,
              pg.estado AS estado_pago,
              COUNT(pg.id)::INT AS transacciones,
              ROUND(COALESCE(SUM(pg.monto), 0), 2)::FLOAT AS total_recaudado_bs,
              ROUND(COALESCE(AVG(pg.monto), 0), 2)::FLOAT AS ticket_promedio_bs
            FROM public.pagos pg
            JOIN public.ventas v ON v.tenant_id = pg.tenant_id AND v.id = pg.venta_id
            JOIN public.sucursales s ON s.tenant_id = v.tenant_id AND s.id = v.sucursal_id
            WHERE pg.tenant_id = %s
              AND pg.creado_en >= %s::timestamptz
              AND pg.creado_en <= (%s::timestamptz + INTERVAL '1 day')
              AND (%s::int IS NULL OR v.sucursal_id = %s::int)
            GROUP BY pg.metodo, pg.pasarela, s.nombre, pg.estado
            ORDER BY total_recaudado_bs {orden_sql}
            LIMIT %s
        """
        params = (
            tenant_id,
            filtros["fecha_desde"],
            filtros["fecha_hasta"],
            filtros["sucursal_id"],
            filtros["sucursal_id"],
            limite,
        )
        filas = query_tenant_rows(sql, params=params, readonly=True)

    elif plantilla_id == "prendas_mas_reservadas":
        sql = f"""
            SELECT
              suc.nombre AS sucursal_nombre,
              p.nombre AS producto_nombre,
              p.tipo_prenda AS tipo_prenda,
              v.color AS color,
              COUNT(DISTINCT r.id)::INT AS total_reservas,
              COALESCE(SUM(dr.cantidad), 0)::INT AS unidades_reservadas,
              ROUND(COALESCE(SUM(dr.cantidad * dr.precio_unitario), 0), 2)::FLOAT AS monto_estimado_bs
            FROM public.reservas r
            JOIN public.detalle_reserva dr ON dr.tenant_id = r.tenant_id AND dr.reserva_id = r.id
            JOIN public.variantes v ON v.tenant_id = dr.tenant_id AND v.id = dr.variante_id
            JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
            JOIN public.sucursales suc ON suc.tenant_id = r.tenant_id AND suc.id = r.sucursal_id
            WHERE r.tenant_id = %s
              AND r.creado_en >= %s::timestamptz
              AND r.creado_en <= (%s::timestamptz + INTERVAL '1 day')
            GROUP BY suc.nombre, p.nombre, p.tipo_prenda, v.color
            ORDER BY unidades_reservadas {orden_sql}, monto_estimado_bs {orden_sql}
            LIMIT %s
        """
        params = (tenant_id, filtros["fecha_desde"], filtros["fecha_hasta"], limite)
        filas = query_tenant_rows(sql, params=params, readonly=True)

    # Calcular resumen de totales verificables
    total_importe = 0.0
    total_unidades = 0
    for row in filas:
        for k in ("total_ventas_bs", "total_recaudado_bs", "monto_estimado_bs"):
            if k in row and row[k] is not None:
                total_importe += float(row[k])
        for k in ("cantidad_ventas", "transacciones", "disponible", "unidades_reservadas"):
            if k in row and row[k] is not None:
                total_unidades += int(row[k])

    return {
        "tenant_id": tenant_id,
        "tenant_slug": tenant_slug,
        "especificacion": dsl,
        "total_filas": len(filas),
        "totales": {
            "suma_importe_bs": round(total_importe, 2),
            "suma_unidades_o_operaciones": total_unidades,
        },
        "filas": filas,
    }
