from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from .config import get_settings


class LLMClient:
    """Cliente opcional Groq/Gemini con salida local segura ante fallos."""

    def __init__(self, settings: Optional[Any] = None) -> None:
        self.settings = settings or get_settings()

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
            # Gemini requiere que el contenido conversacional comience con user.
            if not clean and role == "assistant":
                continue
            mapped_role = "assistant" if role == "assistant" else "user"
            if clean and clean[-1]["role"] == mapped_role:
                clean[-1]["content"] = (clean[-1]["content"] + "\n" + content)[:1200]
            else:
                clean.append({"role": mapped_role, "content": content})
        return clean

    def generate_text(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 450,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, str]:
        provider = self.active_provider
        safe_history = self._safe_history(history)
        if provider == "groq":
            try:
                with httpx.Client(timeout=20.0) as client:
                    response = client.post(
                        "https://api.groq.com/openai/v1/chat/completions",
                        headers={
                            "Authorization": f"Bearer {self.settings.groq_api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.settings.groq_model,
                            "messages": [
                                {"role": "system", "content": system_prompt},
                                *safe_history,
                                {"role": "user", "content": user_prompt},
                            ],
                            "temperature": 0.2,
                            "max_tokens": max_tokens,
                        },
                    )
                    response.raise_for_status()
                    content = response.json()["choices"][0]["message"]["content"].strip()
                    if content:
                        return {"provider": "groq", "text": content}
            except Exception:
                # La respuesta local no depende de conectividad ni de una API externa.
                pass

        if provider == "gemini":
            try:
                contents = [
                    {
                        "role": "user" if item["role"] == "user" else "model",
                        "parts": [{"text": item["content"]}],
                    }
                    for item in safe_history
                ]
                contents.append({"role": "user", "parts": [{"text": user_prompt}]})
                url = (
                    "https://generativelanguage.googleapis.com/v1beta/models/"
                    f"{self.settings.gemini_model}:generateContent"
                )
                with httpx.Client(timeout=20.0) as client:
                    response = client.post(
                        url,
                        params={"key": self.settings.gemini_api_key},
                        json={
                            "systemInstruction": {"parts": [{"text": system_prompt}]},
                            "contents": contents,
                            "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_tokens},
                        },
                    )
                    response.raise_for_status()
                    content = response.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
                    if content:
                        return {"provider": "gemini", "text": content}
            except Exception:
                pass

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
