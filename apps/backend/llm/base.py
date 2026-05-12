from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Type, TypeVar, Optional

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMClient(ABC):
    @abstractmethod
    def generate_structured(self, prompt: str, schema: Type[T], image_base64: Optional[str] = None) -> T:
        """
        给定 prompt 和 Pydantic schema，返回 schema 对应的解析结果（已校验）。
        """
        raise NotImplementedError
    
    def extract_text_from_image(self, image_base64: str) -> str:
        """从图片中提取文本（可选实现）"""
        raise NotImplementedError("This LLM client does not support image text extraction")