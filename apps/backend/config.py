from __future__ import annotations
import os
from dataclasses import dataclass
from dotenv import load_dotenv

# 加载 .env 文件
load_dotenv()


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str
    gemini_model: str = "gemini-3-flash-preview"
    chunk_size: int =6
    overlap: int = 2
    target_level: str = "N1"

    @staticmethod
    def from_env() -> Settings:
        api_key = os.getenv("GOOGLE_API_KEY", "").strip()
        if not api_key:
            raise ValueError("GOOGLE_API_KEY is not set in environment variables.")
        return Settings(gemini_api_key=api_key)

