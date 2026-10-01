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
    #: Where the source booklets live, for a reviewer to open the page a
    #: question was read from. A reference, not a copy: ingest is offline
    #: tooling run where the material already is, and one copy of it stays
    #: the truth of it. Empty means no source viewing.
    EXAM_SOURCE_DIR: str = ""

    # ── Accounts ─────────────────────────────────────────────────────────────
    #: The first admin, created at start-up when no admin exists yet. Data
    #: from before accounts existed is handed to this account.
    ADMIN_EMAIL: str = ""
    ADMIN_PASSWORD: str = ""
    #: 'closed' — only an admin creates accounts; 'invite' — sign-up needs an
    #: invite code an admin handed out; 'open' — anyone can sign up.
    #: Closed by default: every account spends model calls.
    SIGNUP_MODE: str = "closed"
    SESSION_DAYS: int = 30
    #: Send the session cookie over HTTPS only. Must be true once the site is
    #: served over HTTPS; while it is plain HTTP the cookie would never be sent.
    COOKIE_SECURE: bool = False
    #: Origins allowed to make state-changing requests besides the site itself
    #: (the Vite dev server, which proxies to a different host).
    TRUSTED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env")


@lru_cache()
def get_settings() -> Settings:
    return Settings()
