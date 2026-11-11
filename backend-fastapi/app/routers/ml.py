from __future__ import annotations

import json
import math
from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..db import (
    get_current_tenant_id,
    get_current_tenant_slug,
    query_tenant_rows,
    tenant_db_cursor,
)
from ..ml_engine import (
    ejecutar_analisis_ml,
    generar_dataset_sintetico_quiebre_stock,
    generar_dataset_sintetico_recompra,
)

router = APIRouter(prefix="/ml", tags=["Machine Learning Supervisado y No Supervisado"])

GOBERNANZA_ML_DEMO = (
    "Estos artefactos y predicciones se entrenan/prueban únicamente con datos sintéticos reproducibles. "
    "No son modelos operativos sobre clientes o inventario real y no deben activar decisiones comerciales."
)


class EntrenamientoRequest(BaseModel):
    seed: int = Field(default=2026, ge=1, le=999999)


class PrediccionDemoRequest(BaseModel):
    seed: int = Field(default=42, ge=1, le=999999)


def _json_canonico(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _persistir_artefactos(tenant_id: str, seed: int, artefactos: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    guardados: List[Dict[str, Any]] = []
    with tenant_db_cursor(readonly=False) as cur:
        for item in artefactos:
            algoritmo = str(item["algoritmo"])
            # Serializa la asignación de versiones dentro del tenant y algoritmo.
            cur.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s), hashtext(%s))",
                ("fashionstore_ml", f"{tenant_id}:{algoritmo}"),
            )
            cur.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS version "
                "FROM public.modelos_ml WHERE tenant_id = %s AND algoritmo = %s",
                (tenant_id, algoritmo),
            )
            version = int(cur.fetchone()["version"])
            metricas = {
                **item["metricas"],
                "es_dataset_sintetico": True,
                "gobernanza": GOBERNANZA_ML_DEMO,
            }
            blob = _json_canonico(item["artefacto"]).encode("utf-8")
            cur.execute(
                """INSERT INTO public.modelos_ml
                     (tenant_id, algoritmo, version, estado, semilla, metricas, features_json, modelo)
                   VALUES (%s, %s, %s, 'APROBADO', %s, %s::jsonb, %s::jsonb, %s)
                   RETURNING id, version, estado, creado_en""",
                (
                    tenant_id,
                    algoritmo,
                    version,
                    seed,
                    _json_canonico(metricas),
                    _json_canonico(item["features"]),
                    blob,
                ),
            )
            row = cur.fetchone()
            created_at = row["creado_en"]
            guardados.append(
                {
                    "id": int(row["id"]),
                    "algoritmo": algoritmo,
                    "version": int(row["version"]),
                    "estado": str(row["estado"]),
                    "semilla": seed,
                    "metricas": metricas,
                    "creado_en": created_at.isoformat() if isinstance(created_at, datetime) else str(created_at),
                }
            )
    return guardados


def _leer_artefacto(blob: Any) -> Dict[str, Any]:
    if isinstance(blob, memoryview):
        blob = blob.tobytes()
    if isinstance(blob, bytes):
        value = json.loads(blob.decode("utf-8"))
    elif isinstance(blob, str):
        value = json.loads(blob)
    else:
        raise HTTPException(status_code=500, detail="ML_MODEL_ARTIFACT_INVALID: formato persistido no reconocido.")
    if not isinstance(value, dict) or value.get("dataset") != "sintetico_reproducible":
        raise HTTPException(status_code=409, detail="ML_MODEL_NOT_DEMO: el artefacto no es un modelo de demostración permitido.")
    return value


def _probabilidad_logistica(artefacto: Dict[str, Any], fila: Dict[str, Any]) -> float:
    features = artefacto["features"]
    medias = artefacto["scaler"]["media"]
    desviaciones = artefacto["scaler"]["desviacion"]
    pesos = artefacto["pesos"]
    if not (len(features) == len(medias) == len(desviaciones) == len(pesos)):
        raise HTTPException(status_code=500, detail="ML_MODEL_ARTIFACT_INVALID: dimensiones inconsistentes.")
    z = float(artefacto["intercepto"])
    for idx, feature in enumerate(features):
        divisor = float(desviaciones[idx]) or 1.0
        x = (float(fila[feature]) - float(medias[idx])) / divisor
        z += float(pesos[idx]) * x
    if z >= 0:
        exp_neg = math.exp(-z)
        return 1.0 / (1.0 + exp_neg)
    exp_pos = math.exp(z)
    return exp_pos / (1.0 + exp_pos)


def _cluster_mas_cercano(artefacto: Dict[str, Any], fila: Dict[str, Any]) -> int:
    features = artefacto["features"]
    medias = artefacto["scaler"]["media"]
    desviaciones = artefacto["scaler"]["desviacion"]
    x = [
        (float(fila[feature]) - float(medias[idx])) / (float(desviaciones[idx]) or 1.0)
        for idx, feature in enumerate(features)
    ]
    centroides = artefacto["centroides_escalados"]
    distancias = [sum((x[j] - float(c[j])) ** 2 for j in range(len(x))) for c in centroides]
    return min(range(len(distancias)), key=distancias.__getitem__)


@router.get("/analisis")
@router.get("/metricas")
def obtener_analisis_ml(seed: int = Query(default=2026, ge=1, le=999999)) -> Dict[str, Any]:
    tenant_slug = get_current_tenant_slug() or "legacy"
    res = ejecutar_analisis_ml(seed=seed, tenant_slug=tenant_slug)
    res["modelos"] = {
        "propension_compra": {
            "holdout_metrics": res["supervisado"]["metricas_holdout"],
        },
        "riesgo_quiebre_stock": {
            "holdout_metrics": res["supervisado"]["modelo_auxiliar_quiebre_stock"]["metricas_holdout"],
        },
        "segmentacion_clientes": {
            "k_seleccionado": res["no_supervisado"]["k_elegido"],
            "inercia_k3": res["no_supervisado"]["inercia_k3"],
            "segmentos": res["no_supervisado"]["segmentos"],
        },
    }
    return res


@router.post("/entrenar")
def entrenar_y_persistir_modelos(req: EntrenamientoRequest) -> Dict[str, Any]:
    tenant_id = get_current_tenant_id(required=True)
    tenant_slug = get_current_tenant_slug() or "legacy"
    analisis = ejecutar_analisis_ml(
        seed=req.seed,
        tenant_slug=tenant_slug,
        incluir_artefactos=True,
    )
    artefactos = analisis.pop("_artefactos_modelo", [])
    guardados = _persistir_artefactos(tenant_id, req.seed, artefactos)
    return {
        "tenant_id": tenant_id,
        "tenant_slug": tenant_slug,
        "es_dataset_sintetico": True,
        "aviso_gobernanza": GOBERNANZA_ML_DEMO,
        "modelos_persistidos": guardados,
        "analisis": analisis,
    }


@router.get("/modelos")
def listar_modelos_ml(limit: int = Query(default=50, ge=1, le=200)) -> Dict[str, Any]:
    tenant_id = get_current_tenant_id(required=True)
    rows = query_tenant_rows(
        """SELECT id, algoritmo, version, estado, semilla, metricas, features_json, creado_en
             FROM public.modelos_ml
            WHERE tenant_id = %s
            ORDER BY creado_en DESC, id DESC
            LIMIT %s""",
        (tenant_id, limit),
        readonly=True,
    )
    return {
        "tenant_id": tenant_id,
        "modelos": rows,
        "aviso_gobernanza": GOBERNANZA_ML_DEMO,
    }


@router.get("/predicciones")
def listar_predicciones_ml(limit: int = Query(default=50, ge=1, le=200)) -> Dict[str, Any]:
    tenant_id = get_current_tenant_id(required=True)
    rows = query_tenant_rows(
        """SELECT id, modelo_id, entidad_tipo, entidad_id, valor_json, es_sintetico, creado_en
             FROM public.predicciones
            WHERE tenant_id = %s
            ORDER BY creado_en DESC, id DESC
            LIMIT %s""",
        (tenant_id, limit),
        readonly=True,
    )
    return {"tenant_id": tenant_id, "predicciones": rows, "aviso_gobernanza": GOBERNANZA_ML_DEMO}


@router.post("/predecir-demo")
def crear_predicciones_sinteticas(req: PrediccionDemoRequest) -> Dict[str, Any]:
    tenant_id = get_current_tenant_id(required=True)
    tenant_slug = get_current_tenant_slug() or "legacy"
    models = query_tenant_rows(
        """SELECT id, algoritmo, version, modelo
             FROM public.modelos_ml
            WHERE tenant_id = %s AND estado = 'APROBADO'
              AND algoritmo IN ('propension_compra_logistica', 'riesgo_quiebre_logistica', 'segmentacion_clientes_kmeans')
            ORDER BY algoritmo ASC, version DESC""",
        (tenant_id,),
        readonly=True,
    )
    latest: Dict[str, Dict[str, Any]] = {}
    for row in models:
        latest.setdefault(str(row["algoritmo"]), row)
    required = {
        "propension_compra_logistica",
        "riesgo_quiebre_logistica",
        "segmentacion_clientes_kmeans",
    }
    if not required.issubset(latest):
        raise HTTPException(status_code=409, detail="ML_MODELS_REQUIRED: entrena y persiste los tres modelos demo antes de predecir.")

    cliente = generar_dataset_sintetico_recompra(seed=req.seed, n_samples=1)[0]
    inventario = generar_dataset_sintetico_quiebre_stock(seed=req.seed, n_samples=1)[0]
    prob_recompra = _probabilidad_logistica(
        _leer_artefacto(latest["propension_compra_logistica"]["modelo"]),
        cliente,
    )
    prob_quiebre = _probabilidad_logistica(
        _leer_artefacto(latest["riesgo_quiebre_logistica"]["modelo"]),
        inventario,
    )
    cluster_model = _leer_artefacto(latest["segmentacion_clientes_kmeans"]["modelo"])
    cluster_id = _cluster_mas_cercano(cluster_model, cliente)
    segmento = cluster_model["segmentos"][cluster_id]
    entidad_id = f"demo-seed-{req.seed}"
    predicciones = [
        {
            "modelo_id": int(latest["propension_compra_logistica"]["id"]),
            "algoritmo": "propension_compra_logistica",
            "valor": {
                "probabilidad": round(prob_recompra, 6),
                "clase": int(prob_recompra >= 0.5),
                "features_sinteticas": {key: cliente[key] for key in ["dias_desde_compra", "compras_12m", "gasto_12m_bs", "interacciones_30d"]},
            },
        },
        {
            "modelo_id": int(latest["riesgo_quiebre_logistica"]["id"]),
            "algoritmo": "riesgo_quiebre_logistica",
            "valor": {
                "probabilidad": round(prob_quiebre, 6),
                "clase": int(prob_quiebre >= 0.5),
                "features_sinteticas": {key: inventario[key] for key in ["stock_disponible", "ventas_30d", "rotacion_diaria", "plazo_reposicion_dias", "indice_temporada"]},
            },
        },
        {
            "modelo_id": int(latest["segmentacion_clientes_kmeans"]["id"]),
            "algoritmo": "segmentacion_clientes_kmeans",
            "valor": {
                "cluster_id": cluster_id,
                "nombre_segmento": segmento["nombre_segmento"],
                "recomendacion": segmento["decision_negocio"],
                "features_sinteticas": {key: cliente[key] for key in ["dias_desde_compra", "compras_12m", "gasto_12m_bs", "interacciones_30d"]},
            },
        },
    ]
    persistidas: List[Dict[str, Any]] = []
    with tenant_db_cursor(readonly=False) as cur:
        for prediccion in predicciones:
            cur.execute(
                """INSERT INTO public.predicciones
                     (tenant_id, modelo_id, entidad_tipo, entidad_id, valor_json, es_sintetico)
                   VALUES (%s, %s, 'muestra_sintetica', %s, %s::jsonb, TRUE)
                   RETURNING id, creado_en""",
                (
                    tenant_id,
                    prediccion["modelo_id"],
                    entidad_id,
                    _json_canonico(prediccion["valor"]),
                ),
            )
            row = cur.fetchone()
            persistidas.append(
                {
                    "id": int(row["id"]),
                    "modelo_id": prediccion["modelo_id"],
                    "algoritmo": prediccion["algoritmo"],
                    "valor": prediccion["valor"],
                    "es_sintetico": True,
                }
            )
        cur.execute(
            """INSERT INTO public.segmentos_cliente
                 (tenant_id, modelo_id, cliente_id, cluster_id, perfil_json, recomendacion, es_sintetico)
               VALUES (%s, %s, NULL, %s, %s::jsonb, %s, TRUE)
               RETURNING id""",
            (
                tenant_id,
                int(latest["segmentacion_clientes_kmeans"]["id"]),
                cluster_id,
                _json_canonico({"entidad_id": entidad_id, "features": predicciones[2]["valor"]["features_sinteticas"]}),
                str(segmento["decision_negocio"]),
            ),
        )
        segmento_row = cur.fetchone()
    return {
        "tenant_id": tenant_id,
        "tenant_slug": tenant_slug,
        "semilla": req.seed,
        "predicciones_persistidas": persistidas,
        "segmento_persistido_id": int(segmento_row["id"]),
        "es_dataset_sintetico": True,
        "aviso_gobernanza": GOBERNANZA_ML_DEMO,
    }
