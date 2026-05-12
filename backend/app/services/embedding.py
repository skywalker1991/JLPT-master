from sentence_transformers import SentenceTransformer
from app.config import get_settings


class EmbeddingService:
    def __init__(self):
        self._model: SentenceTransformer | None = None

    @property
    def model(self) -> SentenceTransformer:
        if self._model is None:
            self._model = SentenceTransformer(get_settings().EMBEDDING_MODEL)
        return self._model

    def embed(self, text: str) -> list[float]:
        """Embed a single text string."""
        vector = self.model.encode(text)
        return vector.tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of text strings."""
        vectors = self.model.encode(texts)
        return vectors.tolist()


embedding_service = EmbeddingService()
