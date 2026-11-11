from __future__ import annotations

import os
import unittest
from fastapi.testclient import TestClient

from app.main import app


def _internal_key_headers() -> dict:
    key = os.getenv("IA_INTERNAL_KEY", "").strip()
    return {"x-ia-internal-key": key} if key else {}


class PruebaFuncionalIAMicroservice(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.headers = {"X-Tenant-Slug": "legacy", "X-Tenant-Id": "legacy", **_internal_key_headers()}

    def test_01_healthcheck_publico(self) -> None:
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "ok")

    def test_02_bloquea_peticion_sin_tenant_slug(self) -> None:
        res = self.client.get("/recomendaciones", headers=_internal_key_headers())
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"], "TENANT_SLUG_REQUIRED")

    def test_03_bloquea_conflicto_slug_ruta_vs_header(self) -> None:
        res = self.client.get(
            "/tiendas/tienda-a/recomendaciones",
            headers={"X-Tenant-Slug": "tienda-b", **_internal_key_headers()},
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["error"], "TENANT_MISMATCH")

    def test_04_recomendaciones_y_asistente(self) -> None:
        rec = self.client.get("/tiendas/legacy/recomendaciones?tipo_prenda=vestido&limite=3", headers=_internal_key_headers())
        self.assertEqual(rec.status_code, 200)
        body = rec.json()
        self.assertEqual(body["tenant_slug"], "legacy")
        self.assertGreaterEqual(len(body["recomendaciones"]), 1)

        chat = self.client.post(
            "/tiendas/legacy/asistente/chat",
            headers=_internal_key_headers(),
            json={"mensaje": "Quiero usar el probador AR para un vestido rojo"},
        )
        self.assertEqual(chat.status_code, 200)
        self.assertEqual(chat.json()["intencion"], "vestidor_ar")

    def test_05_vestidor_ar_overlays_y_calibracion(self) -> None:
        ov = self.client.get("/ar/catalogo-overlays", headers=self.headers)
        self.assertEqual(ov.status_code, 200)
        self.assertEqual(ov.json()["total_variantes_ar"], 96)

        cal = self.client.post(
            "/ar/calibrar",
            headers=self.headers,
            json={"tipo_prenda": "chaqueta", "color": "camel", "ancho_hombros_px": 180, "altura_torso_px": 250},
        )
        self.assertEqual(cal.status_code, 200)
        self.assertIn("/assets/prendas/chaqueta-camel-ar.png", cal.json()["ar_url"])

    def test_06_reportes_nl_rechaza_sql_arbitrario(self) -> None:
        bad = self.client.post(
            "/reportes/interpretar-y-ejecutar",
            headers=self.headers,
            json={"texto": "SELECT * FROM usuarios; DROP TABLE ventas;"},
        )
        self.assertEqual(bad.status_code, 400)


if __name__ == "__main__":
    unittest.main()
