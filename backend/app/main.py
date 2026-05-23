import asyncio
import gzip
import logging
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin as admin_api
from app.api import analysis, atoms, dictionary, exam, internalize, tts, video
from fastapi.staticfiles import StaticFiles
from app.config import get_settings
from app.models.db import async_engine, Base
from app.services.qdrant_service import qdrant_service

logger = logging.getLogger(__name__)

JMDICT_URL = "http://ftp.edrdg.org/pub/Nihongo/JMdict.gz"  # multilingual, includes zhs


async def ensure_jmdict():
    """Download JMdict on first startup if not present."""
    path = Path(get_settings().JMDICT_PATH)
    if path.exists():
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    gz_path = path.with_suffix(".gz")

    logger.info("JMdict not found — downloading from edrdg.org (~60MB)...")
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("GET", JMDICT_URL) as resp:
                resp.raise_for_status()
                total = int(resp.headers.get("content-length", 0))
                downloaded = 0
                with open(gz_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total:
                            pct = downloaded / total * 100
                            if downloaded % (5 * 1024 * 1024) < 65536:
                                logger.info(f"  {pct:.0f}% ({downloaded // 1024 // 1024}MB)")

        logger.info("Decompressing JMdict...")
        with gzip.open(gz_path, "rb") as f_in, open(path, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
        gz_path.unlink()
        logger.info(f"JMdict ready at {path}")
    except Exception as e:
        logger.error(f"Failed to download JMdict: {e}")
        if gz_path.exists():
            gz_path.unlink()
        # Non-fatal — dictionary queries will return 404, core features still work


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create DB tables (idempotent)
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Ensure Qdrant collection exists
    await qdrant_service.ensure_collection()

    # Download JMdict in background (non-blocking startup)
    asyncio.create_task(ensure_jmdict())

    yield


app = FastAPI(
    title="JLPT Master API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analysis.router, prefix="/api")
app.include_router(atoms.router, prefix="/api")
app.include_router(dictionary.router, prefix="/api")
app.include_router(exam.router, prefix="/api")
app.include_router(tts.router, prefix="/api")
app.include_router(video.router, prefix="/api")
app.include_router(internalize.router, prefix="/api")
app.include_router(admin_api.router, prefix="/api")

_media_dir = Path(__file__).parent.parent / "media"
_media_dir.mkdir(exist_ok=True)
app.mount("/media", StaticFiles(directory=str(_media_dir)), name="media")


@app.get("/health")
async def health():
    return {"status": "ok"}
