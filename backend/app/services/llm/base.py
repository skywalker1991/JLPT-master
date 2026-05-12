from abc import ABC, abstractmethod
from typing import AsyncIterator


class LLMClient(ABC):
    @abstractmethod
    async def analyze_stream(
        self, prompt: str, schema: dict, image_base64: str | None = None
    ) -> AsyncIterator[str]:
        """Stream analysis results as JSON chunks."""
        ...

    @abstractmethod
    async def analyze(self, prompt: str, schema: dict) -> dict:
        """Single-shot structured output."""
        ...

    @abstractmethod
    async def complete(self, prompt: str) -> str:
        """Simple text completion."""
        ...
