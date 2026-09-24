from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://jlpt:jlpt@localhost:5432/jlpt"
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_COLLECTION: str = "grammar_atoms"
    LLM_PROVIDER: str = "gemini"  # gemini | openai | ollama
    LLM_MODEL: str = "gemini-2.0-flash"
    #: Ingesting a paper is the one place accuracy is worth paying for: a
    #: misread answer is wrong every time the question is practised, and the
    #: whole corpus is a few dozen papers, so the difference is a few dollars.
    #: Pinned rather than an alias — an extraction has to stay reproducible,
    #: and a moving alias makes "did the model change or did the code?"
    #: impossible to answer.
    EXAM_MODEL: str = "gemini-3.8-flash"
    LLM_API_KEY: str = ""
    EMBEDDING_MODEL: str = "BAAI/bge-m3"
    JMDICT_PATH: str = "/app/data/JMdict.xml"
    TARGET_LEVEL: str = "N2"

    model_config = SettingsConfigDict(env_file=".env")


@lru_cache()
def get_settings() -> Settings:
    return Settings()
