import base64
import logging
from typing import AsyncIterator

from google import genai
from google.genai import types

from app.services.llm.base import LLMClient

logger = logging.getLogger(__name__)


class GeminiClient(LLMClient):
    def __init__(self, api_key: str, model: str = "gemini-2.0-flash"):
        self._model_name = model
        self._client = genai.Client(api_key=api_key)

    async def analyze_stream(
        self, prompt: str, schema: dict, image_base64: str | None = None
    ) -> AsyncIterator[str]:
        """Stream analysis, yield raw text chunks.

        NOTE: response_mime_type="application/json" causes Gemini to buffer the
        entire response before streaming, killing any streaming effect. We omit
        it here and rely on prompt-based JSON format enforcement instead.
        """
        try:
            if image_base64:
                image_bytes = base64.b64decode(image_base64)
                contents = [
                    types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                    types.Part.from_text(text=prompt),
                ]
            else:
                contents = prompt

            stream = await self._client.aio.models.generate_content_stream(
                model=self._model_name,
                contents=contents,
            )
            async for chunk in stream:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            logger.error("Gemini stream error: %s", e)
            raise

    async def analyze(self, prompt: str, schema: dict) -> str:
        """Single-shot call, return raw JSON string."""
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                ),
            )
            return response.text or ""
        except Exception as e:
            logger.error("Gemini analyze error: %s", e)
            raise

    async def complete(self, prompt: str) -> str:
        """Free-form text completion."""
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model_name,
                contents=prompt,
            )
            return response.text or ""
        except Exception as e:
            logger.error("Gemini complete error: %s", e)
            raise
