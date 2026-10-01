from abc import ABC, abstractmethod
from typing import AsyncIterator


class LLMClient(ABC):
    @abstractmethod
    async def analyze_stream(
        self, prompt: str, schema: dict, image_base64: str | None = None,
        image_mime: str = "image/png",
    ) -> AsyncIterator[str]:
        """Stream analysis results as JSON chunks."""
        ...

    @abstractmethod
    async def analyze(self, prompt: str, schema: dict, enforce: bool = False) -> dict:
        """Single-shot structured output. `enforce`: hold the model to the schema."""
        ...

    @abstractmethod
    async def complete(self, prompt: str) -> str:
        """Simple text completion."""
        ...
