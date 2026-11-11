from __future__ import annotations

import unittest

from app.config import Settings
from app.llm import LLMClient


class TestLLMProviderFallback(unittest.TestCase):
    def test_fallback_local_rules_sin_api_keys(self) -> None:
        cfg = Settings(groq_api_key="", gemini_api_key="")
        client = LLMClient(settings=cfg)
        self.assertEqual(client.active_provider, "local_rules")
        res = client.generate_text("Sistema", "¿Como funcionan las reservas y pagos QR?")
        self.assertEqual(res["provider"], "local_rules")
        self.assertIn("reserva", res["text"].lower())

    def test_seleccion_proveedor_groq_y_fallback_ante_error_red(self) -> None:
        cfg = Settings(groq_api_key="gsk_test_invalid_key", gemini_api_key="")
        client = LLMClient(settings=cfg)
        self.assertEqual(client.active_provider, "groq")
        res = client.generate_text("Sistema", "Recomienda un outfit con blusa")
        self.assertEqual(res["provider"], "local_rules")
        self.assertTrue(len(res["text"]) > 20)


if __name__ == "__main__":
    unittest.main()
