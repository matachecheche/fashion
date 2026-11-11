from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.db import reset_tenant_context, set_tenant_context
from app.main import app
from app.routers.asistente import (
    ChatRequest,
    _catalogo_desde_contexto,
    _contexto_de_confianza,
    _detectar_intencion,
    _is_business_question,
    _is_exact_data_question,
    _local_reply,
)


class TestAssistantContext(unittest.TestCase):
    def setUp(self) -> None:
        self.context = {
            "base_datos_disponible": True,
            "tenant_id": "tenant-a",
            "actualizado_en": "2026-11-10T10:00:00Z",
            "tienda": {"slug": "tienda-a", "nombre": "Tienda A"},
            "acceso": {"rol": "anonimo", "puede_consultar_metricas_comerciales": False},
            "catalogo": {
                "resumen_total": {
                    "productos_activos": 5,
                    "variantes_activas": 12,
                    "unidades_fisicas": 70,
                    "unidades_reservadas": 8,
                    "unidades_disponibles": 62,
                    "categorias_activas": 4,
                    "temporadas_activas": 2,
                    "colecciones_activas": 3,
                },
                "maestros": {
                    "categorias": [{"nombre": "Blusas"}],
                    "temporadas": [{"nombre": "Primavera", "anio": 2026}],
                    "colecciones": [{"nombre": "Aurora", "temporada": "Primavera"}],
                },
                "productos_relevantes": [
                    {
                        "id": 4,
                        "nombre": "Vestido Rojo",
                        "tipo_prenda": "vestido",
                        "precio_base": 300,
                        "variante": {
                            "sku": "VES-ROJ-M",
                            "talla": "M",
                            "color": "rojo",
                            "precio_adicional": 10,
                            "unidades_disponibles": 2,
                        },
                    }
                ],
            },
            "consulta": {
                "filtros_catalogo": {"tipo_prenda": None, "color": None, "talla": None, "terminos": []},
                "resumen_filtrado": {},
            },
            "sucursales": [],
            "promociones_activas": [],
            "promociones_total": 0,
            "analitica_comercial": None,
        }

    def test_exact_count_uses_current_database_aggregate(self) -> None:
        products = _catalogo_desde_contexto(self.context)
        response = _local_reply("¿Cuántas prendas hay?", self.context, products)
        self.assertIn("5 productos", response)
        self.assertIn("12 variantes/SKU", response)
        self.assertIn("62 unidades disponibles", response)

    def test_product_rows_are_grouped_and_variant_price_is_available(self) -> None:
        products = _catalogo_desde_contexto(self.context)
        self.assertEqual(len(products), 1)
        self.assertEqual(products[0]["stock_disponible_total"], 2)
        self.assertEqual(products[0]["variantes"][0]["precio_adicional"], 10)

    def test_catalogue_masters_and_plans_are_live_context_data(self) -> None:
        context = {
            **self.context,
            "planes_suscripcion": [{
                "codigo": "basico", "nombre": "Plan Básico", "precio_mensual_bs": 190,
                "max_usuarios": 10, "max_sucursales": 2, "max_productos": 2000,
                "facturable": False,
            }],
        }
        categories = _local_reply("¿Cuáles son las categorías activas?", context, [])
        self.assertIn("Blusas", categories)
        seasons = _local_reply("¿Qué temporadas están activas?", context, [])
        self.assertIn("Primavera 2026", seasons)
        collections = _local_reply("¿Qué colecciones hay?", context, [])
        self.assertIn("Aurora (Primavera)", collections)
        plans = _local_reply("¿Qué planes de suscripción hay?", context, [])
        self.assertIn("Plan Básico (basico", plans)
        self.assertIn("190.00", plans)
        self.assertIn("no confirman un cobro real", plans)
        plan_count = _local_reply("¿Cuántos planes hay?", context, [])
        self.assertIn("1 planes de suscripción", plan_count)

    def test_no_database_never_returns_demo_catalogue_claims(self) -> None:
        unavailable = {
            "base_datos_disponible": False,
            "catalogo": {"productos_relevantes": [{"nombre": "Producto ficticio"}]},
        }
        response = _local_reply("¿Cuánto stock hay?", unavailable, [])
        self.assertIn("no voy a inventar", response)
        self.assertNotIn("Producto ficticio", response)

    def test_business_metrics_are_role_gated(self) -> None:
        response = _local_reply("¿Cuántas ventas hubo?", self.context, [])
        self.assertIn("requieren iniciar sesión", response)
        self.assertNotIn("Bs. 0", response)
        returns_response = _local_reply("¿Cuántas devoluciones hubo?", self.context, [])
        self.assertIn("requieren iniciar sesión", returns_response)

    def test_varied_operational_metrics_use_aggregates_and_not_personal_records(self) -> None:
        admin_context = {
            **self.context,
            "acceso": {"rol": "admin", "puede_consultar_metricas_comerciales": True},
            "analitica_comercial": {
                "clientes_activos": 12,
                "reservas": {"reservas_activas": 2, "citas_futuras": 1},
                "ventas": {"ventas_confirmadas": 4, "ingresos_confirmados_bs": 920, "ventas_pendientes_pago": 1},
            },
            "datos_operativos": {
                "devoluciones": {"total": 3, "por_estado": {"reembolsada": 2, "procesada": 1}, "monto_reembolsado_bs": 510},
                "cuentas_por_cobrar": {"total": 1, "por_estado": {"PARCIAL": 1}, "saldo_pendiente_bs": 95, "saldo_vencido_bs": 0, "abonos_total": 4, "abonos_monto_bs": 120, "abonos_por_metodo": {"efectivo": 3, "qr": 1}},
                "inventario": {"movimientos_total": 5, "movimientos_ultimos_30_dias": 4, "movimientos_por_tipo": {"recepcion": 2}, "posiciones_stock_critico": 2, "stock_critico_por_sucursal": [{"sucursal": "Central", "posiciones": 3}]},
                "pagos": {"total": 9, "por_estado": {"aprobado": 6, "pendiente": 2, "rechazado": 1}, "monto_confirmado_bs": 920},
                "recepciones": {"total": 2, "por_estado": {"completada": 1, "en_transito": 1}, "costo_total_bs": 3075},
                "operaciones_offline": {"total": 2, "por_estado": {"sincronizada": 1, "pendiente": 1}},
            },
        }
        returns = _local_reply("¿Cuántas devoluciones hubo?", admin_context, [])
        self.assertIn("3 devoluciones", returns)
        self.assertIn("Bs. 510.00", returns)
        payments = _local_reply("¿Cuántos pagos están pendientes?", admin_context, [])
        self.assertIn("pendiente: 2", payments)
        receipts = _local_reply("¿Cuántas recepciones están en tránsito?", admin_context, [])
        self.assertIn("Bs. 3075.00", receipts)
        offline = _local_reply("¿Cuántas operaciones offline siguen pendientes?", admin_context, [])
        self.assertIn("pendiente: 1", offline)
        balance = _local_reply("¿Cuánto saldo vencido tenemos?", admin_context, [])
        self.assertIn("saldo vencido: Bs. 0.00", balance)
        installments = _local_reply("¿Cuántos abonos se registraron?", admin_context, [])
        self.assertIn("4 abonos por Bs. 120.00", installments)
        self.assertIn("efectivo: 3, qr: 1", installments)
        branch_context = {
            **admin_context,
            "consulta": {**self.context["consulta"], "filtros_catalogo": {"sucursal_nombre": "Central"}},
        }
        branch_stock = _local_reply("¿Cuántas posiciones de stock crítico hay en sucursal Central?", branch_context, [])
        self.assertIn("Central tiene 3 posiciones", branch_stock)
        self.assertNotIn("Andrea", returns + payments + receipts + offline + balance + installments + branch_stock)

    def test_price_of_sale_is_not_misclassified_as_sales_analytics(self) -> None:
        self.assertFalse(_is_business_question("¿Cuál es el precio de venta del vestido?"))
        self.assertTrue(_is_business_question("¿Cuántas ventas hubo este mes?"))

    def test_exact_data_questions_use_deterministic_reply_but_style_can_use_llm(self) -> None:
        self.assertTrue(_is_exact_data_question("¿Cuántas blusas negras hay en stock?"))
        self.assertTrue(_is_exact_data_question("¿Cuál es el horario de la sucursal?"))
        self.assertTrue(_is_business_question("¿Cuántas devoluciones fueron reembolsadas?"))
        self.assertTrue(_is_exact_data_question("¿Cuántas operaciones offline siguen pendientes?"))
        self.assertFalse(_is_business_question("¿Cuántas prendas hay disponibles en inventario?"))
        self.assertFalse(_is_exact_data_question("Recomiéndame un vestido para gala"))
        self.assertEqual(_detectar_intencion("Recomiéndame una blusa para gala"), "recomendacion_estilo")
        self.assertEqual(_detectar_intencion("¿Cuántas devoluciones hubo?"), "consulta_operativa")
        self.assertEqual(_detectar_intencion("¿Cuántos webhooks tienen firma inválida?"), "consulta_operativa")
        self.assertEqual(_detectar_intencion("¿Cuántos conflictos de sincronización hay?"), "consulta_operativa")
        self.assertEqual(_detectar_intencion("¿Cuántas conversaciones de IA se registraron?"), "consulta_operativa")

    def test_context_requires_internal_key_and_same_tenant(self) -> None:
        tokens = set_tenant_context("tenant-a", "tienda-a")
        try:
            req = ChatRequest(mensaje="hola", contexto=self.context)
            scope = {"type": "http", "headers": [(b"x-ia-internal-key", b"shared-secret")]}
            request = Request(scope)
            with patch("app.routers.asistente.get_settings", return_value=SimpleNamespace(ia_internal_key="shared-secret")):
                self.assertEqual(_contexto_de_confianza(req, request), self.context)

            wrong = dict(self.context)
            wrong["tenant_id"] = "tenant-b"
            req_wrong = ChatRequest(mensaje="hola", contexto=wrong)
            with patch("app.routers.asistente.get_settings", return_value=SimpleNamespace(ia_internal_key="shared-secret")):
                with self.assertRaises(HTTPException) as error:
                    _contexto_de_confianza(req_wrong, request)
            self.assertEqual(error.exception.status_code, 403)

            no_key_request = Request({"type": "http", "headers": []})
            with patch("app.routers.asistente.get_settings", return_value=SimpleNamespace(ia_internal_key="shared-secret")):
                with self.assertRaises(HTTPException) as error:
                    _contexto_de_confianza(req, no_key_request)
            self.assertEqual(error.exception.status_code, 401)
        finally:
            reset_tenant_context(tokens)


class TestProductionInternalAuthMiddleware(unittest.TestCase):
    def test_business_routes_require_internal_key_but_health_stays_public(self) -> None:
        client = TestClient(app)
        production = SimpleNamespace(app_env="production", ia_internal_key="synthetic-internal-key")
        with patch("app.main.get_settings", return_value=production):
            self.assertEqual(client.get("/health").status_code, 200)
            self.assertEqual(client.get("/recomendaciones").status_code, 401)
            self.assertEqual(
                client.get("/recomendaciones", headers={"x-ia-internal-key": "wrong"}).status_code,
                401,
            )
            # With the service key, request processing advances to the tenant-scope check.
            self.assertEqual(
                client.get("/recomendaciones", headers={"x-ia-internal-key": production.ia_internal_key}).status_code,
                400,
            )


if __name__ == "__main__":
    unittest.main()
