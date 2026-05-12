from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://jlpt:jlpt@localhost:5432/jlpt"
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_COLLECTION: str = "grammar_atoms"
    LLM_PROVIDER: str = "gemini"  # gemini | openai | ollama
    LLM_MODEL: str = "gemini-2.0-flash"
    LLM_API_KEY: str = ""
    EMBEDDING_MODEL: str = "BAAI/bge-m3"
    JMDICT_PATH: str = "/app/data/JMdict.xml"
    TARGET_LEVEL: str = "N2"

    model_config = SettingsConfigDict(env_file=".env")


@lru_cache()
def get_settings() -> Settings:
    return Settings()
