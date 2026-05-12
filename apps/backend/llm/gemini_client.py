from __future__ import annotations

from typing import Type, TypeVar, Optional
import base64

from pydantic import BaseModel

from google import genai
from google.genai import types

from llm.base import LLMClient

T = TypeVar("T", bound=BaseModel)


class GeminiClient(LLMClient):
    def __init__(self, api_key: str, model: str):
        self._client = genai.Client(api_key=api_key)
        self._model = model

    def extract_text_from_image(self, image_base64: str) -> str:
        """从图片中提取日语文本"""
        contents = [
            "请提取图片中的所有日语文本，保持原有的格式和换行。只输出日语文本，不要添加任何解释。",
            types.Part.from_bytes(
                data=base64.b64decode(image_base64.split(',')[-1]),
                mime_type="image/jpeg"
            )
        ]
        
        response = self._client.models.generate_content(
            model=self._model,
            contents=contents,
        )
        return response.text.strip()

    def generate_structured(self, prompt: str, schema: Type[T], image_base64: Optional[str] = None) -> T:
        # 构建内容
        if image_base64:
            # 支持多模态输入
            contents = [
                prompt,
                types.Part.from_bytes(
                    data=base64.b64decode(image_base64.split(',')[-1]),  # 移除 data:image/... 前缀
                    mime_type="image/jpeg"
                )
            ]
        else:
            contents = prompt
        
        # 关键：structured outputs 的两个配置字段
        # - response_mime_type: application/json
        # - response_json_schema: Pydantic.schema
        response = self._client.models.generate_content(
            model=self._model,
            contents=contents,
            config={
                "response_mime_type": "application/json",
                "response_json_schema": schema.model_json_schema(),
            },
        )
        # response.text 通常是 JSON 字符串
        return schema.model_validate_json(response.text)