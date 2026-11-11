from __future__ import annotations

import json
import unittest

from app.ml_engine import ejecutar_analisis_ml
from app.routers.ml import _cluster_mas_cercano, _probabilidad_logistica


class TestMLEngine(unittest.TestCase):
    def test_entrenamiento_supervisado_y_no_supervisado_sin_leakage(self) -> None:
        res = ejecutar_analisis_ml(seed=2026, tenant_slug="legacy")
        sup = res["supervisado"]
        self.assertEqual(sup["total_muestras"], 800)
        self.assertEqual(sup["muestras_entrenamiento"], 640)
        self.assertEqual(sup["muestras_holdout"], 160)

        holdout = sup["metricas_holdout"]
        cm = holdout["matriz_confusion"]
        self.assertEqual(cm["tp"] + cm["fp"] + cm["tn"] + cm["fn"], 160)
        self.assertGreater(holdout["accuracy"], 0.75)
        self.assertGreater(holdout["f1"], 0.75)

        stock_model = sup["modelo_auxiliar_quiebre_stock"]
        self.assertEqual(stock_model["muestras_holdout"], 80)
        self.assertGreater(stock_model["metricas_holdout"]["f1"], 0.70)

        unsup = res["no_supervisado"]
        self.assertEqual(unsup["k_elegido"], 3)
        self.assertEqual(sum(s["tamano"] for s in unsup["segmentos"]), 300)

    def test_artefactos_persistibles_son_serializables_y_solo_demo(self) -> None:
        res = ejecutar_analisis_ml(seed=71, tenant_slug="demo-boutique", incluir_artefactos=True)
        artefactos = res["_artefactos_modelo"]
        self.assertEqual(len(artefactos), 3)
        por_algoritmo = {item["algoritmo"]: item for item in artefactos}
        self.assertEqual(
            set(por_algoritmo),
            {"propension_compra_logistica", "riesgo_quiebre_logistica", "segmentacion_clientes_kmeans"},
        )
        for item in artefactos:
            artefacto = item["artefacto"]
            self.assertEqual(artefacto["dataset"], "sintetico_reproducible")
            self.assertEqual(artefacto["seed"], 71)
            json.dumps(artefacto, allow_nan=False)

        muestra = {"dias_desde_compra": 14, "compras_12m": 6, "gasto_12m_bs": 1500, "interacciones_30d": 8}
        prob = _probabilidad_logistica(por_algoritmo["propension_compra_logistica"]["artefacto"], muestra)
        cluster = _cluster_mas_cercano(por_algoritmo["segmentacion_clientes_kmeans"]["artefacto"], muestra)
        self.assertGreaterEqual(prob, 0.0)
        self.assertLessEqual(prob, 1.0)
        self.assertIn(cluster, (0, 1, 2))


if __name__ == "__main__":
    unittest.main()
