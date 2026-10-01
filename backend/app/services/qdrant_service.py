import logging
from uuid import UUID

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
    IsEmptyCondition,
    PayloadField,
    SearchRequest,
)

from app.config import get_settings
from app.services.embedding import embedding_service

logger = logging.getLogger(__name__)


class QdrantService:
    def __init__(self):
        self._client: AsyncQdrantClient | None = None

    def _get_client(self) -> AsyncQdrantClient:
        if self._client is None:
            settings = get_settings()
            self._client = AsyncQdrantClient(url=settings.QDRANT_URL)
        return self._client

    async def ensure_collection(self) -> None:
        """Create the grammar atoms collection if it doesn't already exist."""
        settings = get_settings()
        collection_name = settings.QDRANT_COLLECTION
        client = self._get_client()
        try:
            existing = await client.get_collections()
            names = [c.name for c in existing.collections]
            if collection_name not in names:
                # Determine vector size from a sample embedding
                sample_vector = embedding_service.embed("sample")
                vector_size = len(sample_vector)
                await client.create_collection(
                    collection_name=collection_name,
                    vectors_config=VectorParams(
                        size=vector_size,
                        distance=Distance.COSINE,
                    ),
                )
                logger.info("Created Qdrant collection '%s' with size %d", collection_name, vector_size)
            else:
                logger.info("Qdrant collection '%s' already exists", collection_name)
        except Exception as e:
            logger.warning("Qdrant ensure_collection failed: %s", e)

    async def upsert_grammar_atom(self, atom_id: UUID, key: str, meaning: str, user_id: UUID) -> None:
        """Embed key+meaning and upsert into Qdrant. Failures are non-blocking."""
        settings = get_settings()
        client = self._get_client()
        try:
            text = f"{key} {meaning}"
            vector = embedding_service.embed(text)
            point = PointStruct(
                id=str(atom_id),
                vector=vector,
                # Whose dictionary this grammar point is in: searches are
                # filtered on it, so one person never sees another's atoms.
                payload={"key": key, "meaning": meaning, "user_id": str(user_id)},
            )
            await client.upsert(
                collection_name=settings.QDRANT_COLLECTION,
                points=[point],
            )
        except Exception as e:
            logger.warning("Qdrant upsert_grammar_atom failed for '%s': %s", key, e)

    async def search_similar(
        self,
        query: str,
        user_id: UUID,
        limit: int = 5,
        score_threshold: float = 0.75,
    ) -> list[dict]:
        """Search for similar grammar atoms. Returns [{id, key, meaning, score}]."""
        settings = get_settings()
        client = self._get_client()
        try:
            vector = embedding_service.embed(query)
            results = await client.search(
                collection_name=settings.QDRANT_COLLECTION,
                query_vector=vector,
                limit=limit,
                score_threshold=score_threshold,
                query_filter=Filter(must=[FieldCondition(key="user_id", match=MatchValue(value=str(user_id)))]),
                with_payload=True,
            )
            return [
                {
                    "id": hit.id,
                    "key": hit.payload.get("key", ""),
                    "meaning": hit.payload.get("meaning"),
                    "score": hit.score,
                }
                for hit in results
            ]
        except Exception as e:
            logger.warning("Qdrant search_similar failed for query '%s': %s", query, e)
            return []

    async def claim_unowned(self, user_id: UUID) -> None:
        """Points written before accounts existed carry no user_id; they were
        all the first admin's. Idempotent — only points without one change."""
        settings = get_settings()
        client = self._get_client()
        try:
            await client.set_payload(
                collection_name=settings.QDRANT_COLLECTION,
                payload={"user_id": str(user_id)},
                points=Filter(must=[IsEmptyCondition(is_empty=PayloadField(key="user_id"))]),
            )
        except Exception as e:
            logger.warning("Qdrant claim_unowned failed: %s", e)


qdrant_service = QdrantService()
