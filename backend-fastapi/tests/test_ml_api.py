from __future__ import annotations

import os
import unittest
from fastapi.testclient import TestClient

from app.main import app

KEY = os.getenv("IA_INTERNAL_KEY", "").strip()
HEADERS = {"x-ia-internal-key": KEY} if KEY else {}


class TestMLApiEndpoint(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_ml_analisis_endpoint_reproducible(self) -> None:
        r1 = self.client.get("/tiendas/legacy/ml/analisis?seed=2026", headers=HEADERS)
        r2 = self.client.get("/tiendas/legacy/ml/analisis?seed=2026", headers=HEADERS)
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        d1 = r1.json()
        d2 = r2.json()
        self.assertTrue(d1["es_dataset_sintetico"])
        self.assertEqual(d1["supervisado"]["metricas_holdout"], d2["supervisado"]["metricas_holdout"])
        self.assertEqual(d1["no_supervisado"]["inercia_k3"], d2["no_supervisado"]["inercia_k3"])
        self.assertEqual(len(d1["no_supervisado"]["segmentos"]), 3)


if __name__ == "__main__":
    unittest.main()
