from app.config import get_settings
from app.services.llm.base import LLMClient
from app.services.llm.gemini import GeminiClient

llm_client: LLMClient | None = None
exam_client: LLMClient | None = None


def create_llm_client() -> LLMClient:
    settings = get_settings()
    if settings.LLM_PROVIDER == "gemini":
        return GeminiClient(api_key=settings.LLM_API_KEY, model=settings.LLM_MODEL)
    raise ValueError(f"Unknown LLM provider: {settings.LLM_PROVIDER}")


def get_llm_client() -> LLMClient:
    global llm_client
    if llm_client is None:
        llm_client = create_llm_client()
    return llm_client


def get_exam_client() -> LLMClient:
    """The client used for reading exam papers.

    Kept separate from the everyday one: ingest happens a few dozen times in
    total and a misread answer is wrong on every future attempt, so it is worth
    a stronger model, while sentence analysis runs constantly and is not.
    """
    global exam_client
    if exam_client is None:
        settings = get_settings()
        if settings.LLM_PROVIDER != "gemini":
            return get_llm_client()
        exam_client = GeminiClient(api_key=settings.LLM_API_KEY, model=settings.EXAM_MODEL)
    return exam_client
