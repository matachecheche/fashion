from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from .config import get_settings


GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

# Se prioriza descubrir los modelos habilitados para la clave. Estos IDs son solo
# alternativas en caso de que la lista del proveedor no esté disponible.
GROQ_MODEL_CANDIDATES = ("openai/gpt-oss-20b", "qwen/qwen3.8-27b")
GEMINI_MODEL_CANDIDATES = ("gemini-3.8-flash", "gemini-3.5-flash-lite")
EXCLUDED_MODEL_TERMS = (
    "embed", "whisper", "tts", "speech", "audio", "transcri", "image", "vision-only",
    "moderation", "guard", "rerank", "live",
)


class LLMClient:
    """Cliente Groq/Gemini con detección de modelos y fallback local determinista.

    Groq y Gemini pueden configurarse simultáneamente. Se intenta Groq primero y,
    ante una clave/modelo/cuota no disponible, se prueba Gemini antes de usar reglas.
    Las claves nunca se agregan a URLs ni se incluyen en mensajes de error.
    """

    _working_model: Dict[str, str] = {}

    def __init__(self, settings: Optional[Any] = None) -> None:
        self.settings = settings or get_settings()
        self.last_errors: Dict[str, str] = {}

    @property
    def active_provider(self) -> str:
        if self.settings.groq_api_key:
            return "groq"
        if self.settings.gemini_api_key:
            return "gemini"
        return "local_rules"

    @staticmethod
    def _safe_history(history: Optional[List[Dict[str, str]]]) -> List[Dict[str, str]]:
        clean: List[Dict[str, str]] = []
        for item in (history or [])[-8:]:
            role = item.get("role")
            content = str(item.get("content") or "").strip()[:800]
            if role not in {"user", "assistant"} or not content:
                continue
            if not clean and role == "assistant":
                continue
            mapped_role = "assistant" if role == "assistant" else "user"
            if clean and clean[-1]["role"] == mapped_role:
                clean[-1]["content"] = (clean[-1]["content"] + "\n" + content)[:1200]
            else:
                clean.append({"role": mapped_role, "content": content})
        return clean

    @staticmethod
    def _eligible_model(name: str) -> bool:
        normalized = name.lower()
        return not any(term in normalized for term in EXCLUDED_MODEL_TERMS)

    @staticmethod
    def _unique(values: Sequence[str]) -> List[str]:
        return list(dict.fromkeys(value.strip() for value in values if value and value.strip()))

    @staticmethod
    def _safe_error(exc: Exception, key: str) -> str:
        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            try:
                body = exc.response.json()
                detail = body.get("error", {}).get("message") if isinstance(body, dict) else None
            except Exception:
                detail = None
            message = str(detail or f"HTTP {status}")
        elif isinstance(exc, httpx.TimeoutException):
            message = "tiempo de espera agotado"
        elif isinstance(exc, httpx.RequestError):
            message = "no se pudo conectar con el proveedor"
        else:
            message = str(exc) or exc.__class__.__name__
        if key:
            message = message.replace(key, "[CLAVE OCULTA]")
        message = re.sub(r"(?i)(AIza|AQ\.)[A-Za-z0-9_\-.]{12,}", "[CLAVE OCULTA]", message)
        return message[:240]

    def _groq_models_to_try(self, client: httpx.Client) -> List[str]:
        configured = str(getattr(self.settings, "groq_model", "") or "").strip()
        ordered = self._unique((self._working_model.get("groq", ""), configured if configured.lower() != "auto" else "", *GROQ_MODEL_CANDIDATES))
        # Model list is authoritative for currently enabled models; use it to replace
        # names retired by the provider or unavailable to this key.
        try:
            response = client.get(f"{GROQ_BASE_URL}/models", headers={"Authorization": f"Bearer {self.settings.groq_api_key}"})
            response.raise_for_status()
            payload = response.json()
            data = payload.get("data", []) if isinstance(payload, dict) else []
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in {401, 403, 429}:
                raise
            data = []  # If model discovery is temporarily unavailable, try fallbacks.
        except httpx.RequestError:
            data = []
        discovered = []
        for entry in data:
            if not isinstance(entry, dict):
                continue
            model_id = str(entry.get("id") or "").strip()
            if model_id and self._eligible_model(model_id):
                discovered.append(model_id)
        # Prefer known inexpensive chat candidates, then provider discovery order.
        preference = {name: len(GROQ_MODEL_CANDIDATES) - i for i, name in enumerate(GROQ_MODEL_CANDIDATES)}
        discovered.sort(key=lambda name: (preference.get(name, 0), name), reverse=True)
        available = set(discovered)
        current = [name for name in ordered if not available or name in available]
        return self._unique((*current, *discovered))[:8]

    def _gemini_models_to_try(self, client: httpx.Client) -> List[str]:
        configured = str(getattr(self.settings, "gemini_model", "") or "").strip()
        ordered = self._unique((self._working_model.get("gemini", ""), configured if configured.lower() != "auto" else "", *GEMINI_MODEL_CANDIDATES))
        try:
            response = client.get(
                f"{GEMINI_BASE_URL}/models",
                params={"pageSize": 200},
                headers={"x-goog-api-key": self.settings.gemini_api_key},
            )
            response.raise_for_status()
            payload = response.json()
            entries = payload.get("models", []) if isinstance(payload, dict) else []
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in {401, 403, 429}:
                raise
            entries = []
        except httpx.RequestError:
            entries = []
        discovered: List[str] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "").removeprefix("models/").strip()
            methods = entry.get("supportedGenerationMethods") or []
            if name and "generateContent" in methods and self._eligible_model(name) and "gemini" in name.lower():
                discovered.append(name)
        # Prefer flash and newer versions but keep provider's own list as truth.
        def rank(name: str) -> Tuple[int, str]:
            flash = 1 if "flash" in name.lower() else 0
            numbers = tuple(int(part) for part in re.findall(r"\d+", name))
            return flash, "".join(f"{n:04d}" for n in numbers)
        discovered.sort(key=rank, reverse=True)
        available = set(discovered)
        current = [name for name in ordered if not available or name in available]
        return self._unique((*current, *discovered))[:8]

    @staticmethod
    def _groq_content(payload: dict) -> str:
        choices = payload.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content", "") if isinstance(message, dict) else ""
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            return "\n".join(str(part.get("text") or "") for part in content if isinstance(part, dict)).strip()
        return ""

    @staticmethod
    def _gemini_content(payload: dict) -> str:
        candidates = payload.get("candidates") or []
        collected: List[str] = []
        for candidate in candidates:
            content = candidate.get("content") if isinstance(candidate, dict) else None
            for part in (content or {}).get("parts", []) if isinstance(content, dict) else []:
                if not isinstance(part, dict) or part.get("thought") is True:
                    continue
                value = str(part.get("text") or "").strip()
                if value:
                    collected.append(value)
        return "\n".join(collected).strip()

    def _generate_groq(
        self,
        client: httpx.Client,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        history: List[Dict[str, str]],
    ) -> Dict[str, str]:
        key = self.settings.groq_api_key
        models = self._groq_models_to_try(client)
        if not models:
            raise RuntimeError("Groq no devolvió modelos de chat disponibles")
        last_error: Exception | None = None
        for model in models:
            try:
                response = client.post(
                    f"{GROQ_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            *history,
                            {"role": "user", "content": user_prompt},
                        ],
                        "temperature": 0.2,
                        "max_completion_tokens": max_tokens,
                    },
                )
                response.raise_for_status()
                text = self._groq_content(response.json())
                if text:
                    self._working_model["groq"] = model
                    return {"provider": "groq", "model": model, "text": text}
                last_error = RuntimeError("Groq devolvió una respuesta vacía")
            except (httpx.HTTPStatusError, httpx.RequestError, KeyError, IndexError, TypeError, RuntimeError) as exc:
                last_error = exc
                # Invalid/unauthorized keys and rate limits won't be repaired by changing model.
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {401, 403, 429}:
                    break
        raise last_error or RuntimeError("Groq no pudo generar una respuesta")

    def _generate_gemini(
        self,
        client: httpx.Client,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        history: List[Dict[str, str]],
    ) -> Dict[str, str]:
        key = self.settings.gemini_api_key
        models = self._gemini_models_to_try(client)
        if not models:
            raise RuntimeError("Gemini no devolvió modelos compatibles con generateContent")
        contents = [
            {"role": "user" if item["role"] == "user" else "model", "parts": [{"text": item["content"]}]}
            for item in history
        ]
        contents.append({"role": "user", "parts": [{"text": user_prompt}]})
        last_error: Exception | None = None
        for model in models:
            try:
                response = client.post(
                    f"{GEMINI_BASE_URL}/models/{model}:generateContent",
                    headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                    json={
                        "systemInstruction": {"parts": [{"text": system_prompt}]},
                        "contents": contents,
                        "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_tokens},
                    },
                )
                response.raise_for_status()
                text = self._gemini_content(response.json())
                if text:
                    self._working_model["gemini"] = model
                    return {"provider": "gemini", "model": model, "text": text}
                last_error = RuntimeError("Gemini devolvió una respuesta vacía")
            except (httpx.HTTPStatusError, httpx.RequestError, KeyError, IndexError, TypeError, RuntimeError) as exc:
                last_error = exc
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in {401, 403, 429}:
                    break
        raise last_error or RuntimeError("Gemini no pudo generar una respuesta")

    def _generate_provider(
        self,
        provider: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        history: List[Dict[str, str]],
    ) -> Dict[str, str]:
        with httpx.Client(timeout=25.0) as client:
            if provider == "groq":
                return self._generate_groq(client, system_prompt, user_prompt, max_tokens, history)
            if provider == "gemini":
                return self._generate_gemini(client, system_prompt, user_prompt, max_tokens, history)
        raise ValueError("Proveedor desconocido")

    def probe(self) -> List[Dict[str, Any]]:
        """Check each configured key independently without returning or logging its value."""
        results: List[Dict[str, Any]] = []
        for provider, key in (("groq", self.settings.groq_api_key), ("gemini", self.settings.gemini_api_key)):
            if not key:
                continue
            try:
                result = self._generate_provider(provider, "Responde solo OK.", "Prueba de conectividad.", 12, [])
                results.append({"provider": provider, "ok": True, "model": result.get("model"), "error": None})
            except Exception as exc:
                message = self._safe_error(exc, key)
                self.last_errors[provider] = message
                results.append({"provider": provider, "ok": False, "model": None, "error": message})
        return results

    def generate_text(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 450,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, str]:
        safe_history = self._safe_history(history)
        for provider, key in (("groq", self.settings.groq_api_key), ("gemini", self.settings.gemini_api_key)):
            if not key:
                continue
            try:
                result = self._generate_provider(provider, system_prompt, user_prompt, max_tokens, safe_history)
                self.last_errors.pop(provider, None)
                return result
            except Exception as exc:
                self.last_errors[provider] = self._safe_error(exc, key)
        return {"provider": "local_rules", "text": self._deterministic_reply(user_prompt)}

    def _deterministic_reply(self, user_prompt: str) -> str:
        """Fallback general, sin inventar artículos, precios ni cifras de la tienda."""
        question = (user_prompt or "").lower()
        if any(term in question for term in ("reserva", "reservar", "cita", "apartar")):
            return (
                "Puedes iniciar una reserva desde la ficha de un producto disponible y elegir una sucursal. "
                "La disponibilidad final se confirma en el flujo de reserva de la tienda."
            )
        if any(term in question for term in ("pago", "qr", "tarjeta", "transferencia")):
            return (
                "Los métodos disponibles aparecen en el checkout. Los pagos digitales operan en sandbox y "
                "no deben darse por confirmados hasta recibir la validación del proveedor."
            )
        if any(term in question for term in ("vestidor", "probador", "camara", "probar")):
            return (
                "El Vestidor Virtual se abre desde la ficha de un producto compatible; requiere permiso de cámara "
                "si quieres probar el modo con seguimiento."
            )
        return (
            "Puedo ayudarte con recomendaciones y explicar las funciones de la tienda. Para confirmar stock, "
            "precios u otras cifras necesito que la consulta a la base de datos de la tienda esté disponible."
        )
