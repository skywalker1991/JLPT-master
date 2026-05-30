from app.config import get_settings


class EmbeddingService:
    def __init__(self):
        self._model = None

    @property
    def model(self):
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
                self._model = SentenceTransformer(get_settings().EMBEDDING_MODEL)
            except ImportError:
                raise RuntimeError(
                    "sentence-transformers is not installed. "
                    "Add it to requirements.txt to enable embedding generation."
                )
        return self._model

    def embed(self, text: str) -> list[float]:
        vector = self.model.encode(text)
        return vector.tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        vectors = self.model.encode(texts)
        return vectors.tolist()


embedding_service = EmbeddingService()
