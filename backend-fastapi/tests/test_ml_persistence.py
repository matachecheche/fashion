from __future__ import annotations

import json
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import patch

from app.db import reset_tenant_context, set_tenant_context
from app.ml_engine import ejecutar_analisis_ml
from app.routers import ml as ml_router


class _FakeCursor:
    def __init__(self) -> None:
        self.last_row = None
        self.prediction_insertions = 0
        self.segment_insertions = 0
        self.next_id = 1

    def execute(self, sql: str, params=()) -> None:
        normalized = " ".join(sql.split())
        if "INSERT INTO public.predicciones" in normalized:
            self.prediction_insertions += 1
            self.last_row = {"id": self.next_id, "creado_en": datetime.now(timezone.utc)}
            self.next_id += 1
        elif "INSERT INTO public.segmentos_cliente" in normalized:
            self.segment_insertions += 1
            self.last_row = {"id": 91}
        else:
            self.last_row = {}

    def fetchone(self):
        return self.last_row


class _FakeModelPersistenceCursor:
    def __init__(self) -> None:
        self.last_row = None
        self.statements = []
        self.next_id = 1

    def execute(self, sql: str, params=()) -> None:
        normalized = " ".join(sql.split())
        self.statements.append((normalized, params))
        if "SELECT COALESCE(MAX(version), 0) + 1 AS version" in normalized:
            self.last_row = {"version": 3}
        elif "INSERT INTO public.modelos_ml" in normalized:
            self.last_row = {
                "id": self.next_id,
                "version": params[2],
                "estado": "APROBADO",
                "creado_en": datetime.now(timezone.utc),
            }
            self.next_id += 1
        else:
            self.last_row = {}

    def fetchone(self):
        return self.last_row


class TestMLPersistence(unittest.TestCase):
    def setUp(self) -> None:
        self.tokens = set_tenant_context("tenant-test-id", "tenant-test")

    def tearDown(self) -> None:
        reset_tenant_context(self.tokens)

    def test_training_persists_three_tenant_scoped_demo_artifacts(self) -> None:
        fake_rows = [
            {"id": index, "algoritmo": name, "version": 1, "estado": "APROBADO", "semilla": 19}
            for index, name in enumerate(
                (
                    "propension_compra_logistica",
                    "riesgo_quiebre_logistica",
                    "segmentacion_clientes_kmeans",
                ),
                start=1,
            )
        ]
        with patch.object(ml_router, "_persistir_artefactos", return_value=fake_rows) as persist:
            response = ml_router.entrenar_y_persistir_modelos(ml_router.EntrenamientoRequest(seed=19))

        self.assertEqual(response["tenant_id"], "tenant-test-id")
        self.assertEqual(response["tenant_slug"], "tenant-test")
        self.assertTrue(response["es_dataset_sintetico"])
        self.assertEqual(len(response["modelos_persistidos"]), 3)
        persist.assert_called_once()
        tenant_id, seed, artefactos = persist.call_args.args
        self.assertEqual(tenant_id, "tenant-test-id")
        self.assertEqual(seed, 19)
        self.assertEqual(len(artefactos), 3)
        self.assertTrue(all(item["artefacto"]["dataset"] == "sintetico_reproducible" for item in artefactos))

    def test_model_artifact_sql_is_versioned_and_tenant_scoped(self) -> None:
        analysis = ejecutar_analisis_ml(seed=77, tenant_slug="tenant-test", incluir_artefactos=True)
        cursor = _FakeModelPersistenceCursor()

        @contextmanager
        def fake_cursor(readonly: bool = False):
            self.assertFalse(readonly)
            yield cursor

        with patch.object(ml_router, "tenant_db_cursor", side_effect=fake_cursor):
            saved = ml_router._persistir_artefactos(
                "tenant-test-id", 77, analysis["_artefactos_modelo"]
            )

        self.assertEqual(len(saved), 3)
        self.assertTrue(all(model["version"] == 3 for model in saved))
        self.assertTrue(all(model["estado"] == "APROBADO" for model in saved))
        version_queries = [
            (sql, params)
            for sql, params in cursor.statements
            if "SELECT COALESCE(MAX(version), 0) + 1 AS version" in sql
        ]
        self.assertEqual(len(version_queries), 3)
        self.assertTrue(all("WHERE tenant_id = %s AND algoritmo = %s" in sql for sql, _ in version_queries))
        self.assertTrue(all(params[0] == "tenant-test-id" for _, params in version_queries))
        inserts = [
            (sql, params)
            for sql, params in cursor.statements
            if "INSERT INTO public.modelos_ml" in sql
        ]
        self.assertEqual(len(inserts), 3)
        for _sql, params in inserts:
            self.assertEqual(params[0], "tenant-test-id")
            self.assertEqual(params[2], 3)
            artifact = json.loads(params[6].decode("utf-8"))
            self.assertEqual(artifact["dataset"], "sintetico_reproducible")

    def test_demo_predictions_are_persisted_as_synthetic(self) -> None:
        analysis = ejecutar_analisis_ml(seed=2026, tenant_slug="tenant-test", incluir_artefactos=True)
        artefactos = analysis["_artefactos_modelo"]
        models = [
            {
                "id": index,
                "algoritmo": item["algoritmo"],
                "version": 1,
                "modelo": json.dumps(item["artefacto"], ensure_ascii=False).encode("utf-8"),
            }
            for index, item in enumerate(artefactos, start=1)
        ]
        cursor = _FakeCursor()

        @contextmanager
        def fake_cursor(readonly: bool = False):
            self.assertFalse(readonly)
            yield cursor

        with patch.object(ml_router, "query_tenant_rows", return_value=models), patch.object(
            ml_router, "tenant_db_cursor", side_effect=fake_cursor
        ):
            response = ml_router.crear_predicciones_sinteticas(ml_router.PrediccionDemoRequest(seed=42))

        self.assertEqual(response["tenant_id"], "tenant-test-id")
        self.assertTrue(response["es_dataset_sintetico"])
        self.assertEqual(len(response["predicciones_persistidas"]), 3)
        self.assertTrue(all(item["es_sintetico"] for item in response["predicciones_persistidas"]))
        self.assertEqual(cursor.prediction_insertions, 3)
        self.assertEqual(cursor.segment_insertions, 1)
        self.assertGreaterEqual(response["segmento_persistido_id"], 1)


if __name__ == "__main__":
    unittest.main()
