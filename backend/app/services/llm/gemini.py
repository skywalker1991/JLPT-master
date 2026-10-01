import base64
import logging
from typing import AsyncIterator

from google import genai
from google.genai import types

from app.services.llm.base import LLMClient

logger = logging.getLogger(__name__)

# Thinking off. Measured on real passages and questions (2026-10-01): for
# sentence analysis it cut the wait for the first sentence from 13–28 s to
# about 1 s and the cost by 34–59% at the same quality; for JLPT
# explanations it got answers wrong (an ordering question, a grammar
# point), so those keep it.
_NO_THINKING = types.ThinkingConfig(thinking_budget=0)


class GeminiClient(LLMClient):
    def __init__(self, api_key: str, model: str = "gemini-2.0-flash"):
        self._model_name = model
        self._client = genai.Client(api_key=api_key)

    async def analyze_stream(
        self, prompt: str, schema: dict, image_base64: str | None = None,
        image_mime: str = "image/png", think: bool = True,
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
                    types.Part.from_bytes(data=image_bytes, mime_type=image_mime),
                    types.Part.from_text(text=prompt),
                ]
            else:
                contents = prompt

            stream = await self._client.aio.models.generate_content_stream(
                model=self._model_name,
                contents=contents,
                config=None if think else types.GenerateContentConfig(thinking_config=_NO_THINKING),
            )
            async for chunk in stream:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            logger.error("Gemini stream error: %s", e)
            raise

    async def analyze(self, prompt: str, schema: dict, enforce: bool = False, think: bool = True) -> str:
        """Single-shot call, return raw JSON string.

        With `enforce`, the schema is given to the model as its output format
        (not only described in the prompt), so the shape — enums included —
        is guaranteed. Should the API refuse the schema, it falls back to
        plain JSON and the caller's own checks."""
        try:
            thinking = {} if think else {"thinking_config": _NO_THINKING}
            config = types.GenerateContentConfig(response_mime_type="application/json", **thinking)
            if enforce and schema:
                try:
                    response = await self._client.aio.models.generate_content(
                        model=self._model_name, contents=prompt,
                        config=types.GenerateContentConfig(response_mime_type="application/json",
                                                           response_json_schema=schema, **thinking),
                    )
                    return response.text or ""
                except Exception as e:
                    if "schema" not in str(e).lower():
                        raise
                    logger.warning("Gemini refused the output schema, asking without it: %s", e)
            response = await self._client.aio.models.generate_content(
                model=self._model_name, contents=prompt, config=config,
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
