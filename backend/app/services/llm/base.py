from abc import ABC, abstractmethod
from typing import AsyncIterator


class LLMClient(ABC):
    @abstractmethod
    async def analyze_stream(
        self, prompt: str, schema: dict, image_base64: str | None = None,
        image_mime: str = "image/png", think: bool = True,
    ) -> AsyncIterator[str]:
        """Stream analysis results as JSON chunks. `think`: let the model
        reason before answering (slower, dearer; worth it where the answer
        needs reasoning)."""
        ...

    @abstractmethod
    async def analyze(self, prompt: str, schema: dict, enforce: bool = False, think: bool = True) -> dict:
        """Single-shot structured output. `enforce`: hold the model to the schema."""
        ...

    @abstractmethod
    async def complete(self, prompt: str) -> str:
        """Simple text completion."""
        ...
