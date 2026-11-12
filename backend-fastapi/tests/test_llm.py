from __future__ import annotations

import json
import unittest
from unittest.mock import patch

import httpx

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
        self.assertEqual(res["diagnostico"], "LLM_KEYS_NOT_CONFIGURED")

    def test_groq_usa_bearer_y_descubre_modelo_habilitado(self) -> None:
        key = "gsk_" + "a" * 40
        requested = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append(request)
            self.assertEqual(request.headers.get("Authorization"), f"Bearer {key}")
            if request.url.path.endswith("/models"):
                return httpx.Response(200, json={"data": [{"id": "openai/gpt-oss-20b"}]})
            if request.url.path.endswith("/chat/completions"):
                body = json.loads(request.content)
                self.assertEqual(body["model"], "openai/gpt-oss-20b")
                self.assertIn("max_completion_tokens", body)
                self.assertEqual(body["temperature"], 0.35)
                if body["model"].startswith("openai/gpt-oss-"):
                    self.assertEqual(body["reasoning_effort"], "high")
                return httpx.Response(200, json={"choices": [{"message": {"content": "Hola desde Groq"}}]})
            return httpx.Response(404)

        original_client = httpx.Client
        def client_factory(*args, **kwargs):
            return original_client(transport=httpx.MockTransport(handler), *args, **kwargs)

        cfg = Settings(groq_api_key=key, gemini_api_key="", groq_model="auto")
        with patch("app.llm.httpx.Client", side_effect=client_factory):
            result = LLMClient(settings=cfg).generate_text("Sistema", "Hola")

        self.assertEqual(result["provider"], "groq")
        self.assertEqual(result["model"], "openai/gpt-oss-20b")
        self.assertEqual(result["text"], "Hola desde Groq")
        self.assertEqual(len(requested), 2)

    def test_gemini_acepta_clave_AQ_y_usa_header_sin_query_key(self) -> None:
        key = "AQ.Ab8R" + "b" * 38
        requested = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append(request)
            self.assertEqual(request.headers.get("x-goog-api-key"), key)
            self.assertNotIn("key=", request.url.query.decode("utf-8"))
            if request.url.path.endswith("/models"):
                return httpx.Response(200, json={"models": [{
                    "name": "models/gemini-3.5-flash-lite",
                    "supportedGenerationMethods": ["generateContent"],
                }]})
            self.assertIn(":generateContent", request.url.path)
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [
                {"text": "texto de razonamiento", "thought": True},
                {"text": "Hola desde Gemini"},
            ]}}]})

        original_client = httpx.Client
        def client_factory(*args, **kwargs):
            return original_client(transport=httpx.MockTransport(handler), *args, **kwargs)

        cfg = Settings(groq_api_key="", gemini_api_key=key, gemini_model="auto")
        with patch("app.llm.httpx.Client", side_effect=client_factory):
            result = LLMClient(settings=cfg).generate_text("Sistema", "Hola")

        self.assertEqual(result["provider"], "gemini")
        self.assertEqual(result["model"], "gemini-3.5-flash-lite")
        self.assertEqual(result["text"], "Hola desde Gemini")
        self.assertEqual(len(requested), 2)

    def test_falla_groq_y_continua_con_gemini_si_ambos_estan_configurados(self) -> None:
        groq_key = "gsk_" + "g" * 40
        gemini_key = "AQ.Ab8R" + "m" * 40

        def handler(request: httpx.Request) -> httpx.Response:
            if "groq.com" in request.url.host:
                self.assertEqual(request.headers.get("Authorization"), f"Bearer {groq_key}")
                return httpx.Response(401, json={"error": {"message": f"invalid key {groq_key}"}})
            self.assertEqual(request.headers.get("x-goog-api-key"), gemini_key)
            if request.url.path.endswith("/models"):
                return httpx.Response(200, json={"models": [{
                    "name": "models/gemini-3.8-flash",
                    "supportedGenerationMethods": ["generateContent"],
                }]})
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "respuesta alternativa"}]}}]})

        original_client = httpx.Client
        def client_factory(*args, **kwargs):
            return original_client(transport=httpx.MockTransport(handler), *args, **kwargs)

        cfg = Settings(groq_api_key=groq_key, gemini_api_key=gemini_key, groq_model="auto", gemini_model="auto")
        with patch("app.llm.httpx.Client", side_effect=client_factory):
            client = LLMClient(settings=cfg)
            result = client.generate_text("Sistema", "Hola")

        self.assertEqual(result["provider"], "gemini")
        self.assertEqual(result["text"], "respuesta alternativa")
        self.assertNotIn(groq_key, client.last_errors["groq"])

    def test_probe_informa_estado_de_claves_sin_revelarlas(self) -> None:
        groq_key = "gsk_" + "s" * 40
        gemini_key = "AQ.Ab8R" + "x" * 40

        def handler(request: httpx.Request) -> httpx.Response:
            if "groq.com" in request.url.host:
                return httpx.Response(403, json={"error": {"message": f"key {groq_key} forbidden"}})
            if request.url.path.endswith("/models"):
                return httpx.Response(200, json={"models": [{
                    "name": "models/gemini-3.8-flash",
                    "supportedGenerationMethods": ["generateContent"],
                }]})
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "OK"}]}}]})

        original_client = httpx.Client
        def client_factory(*args, **kwargs):
            return original_client(transport=httpx.MockTransport(handler), *args, **kwargs)

        with patch("app.llm.httpx.Client", side_effect=client_factory):
            results = LLMClient(settings=Settings(groq_api_key=groq_key, gemini_api_key=gemini_key)).probe()

        self.assertEqual([item["provider"] for item in results], ["groq", "gemini"])
        self.assertFalse(results[0]["ok"])
        self.assertTrue(results[1]["ok"])
        self.assertNotIn(groq_key, json.dumps(results))
        self.assertNotIn(gemini_key, json.dumps(results))


if __name__ == "__main__":
    unittest.main()
