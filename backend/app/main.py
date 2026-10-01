import asyncio
import gzip
import logging
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin as admin_api
from app.api import analysis, atoms, auth, cards, dictionary, exam, internalize, jlpt, recite, tts, video
from app.api.deps import current_user, require_admin
from fastapi.staticfiles import StaticFiles
from app.config import get_settings
from app.models.db import async_engine, async_session_factory, Base
from app.services import auth_service
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

    # The first admin, and the hand-over of data from before accounts.
    async with async_session_factory() as session:
        admin = await auth_service.ensure_admin(session)
        await auth_service.purge_expired_sessions(session)
        await session.commit()

    # Ensure Qdrant collection exists
    await qdrant_service.ensure_collection()
    if admin is not None:
        await qdrant_service.claim_unowned(admin.id)

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

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@app.middleware("http")
async def reject_cross_site_writes(request: Request, call_next):
    """A page on another site must not be able to make a signed-in browser
    change anything. SameSite=Lax already keeps the cookie off cross-site
    POSTs from modern browsers; this refuses them outright whenever the
    browser says where the request came from."""
    if request.method not in _SAFE_METHODS:
        origin = request.headers.get("origin")
        if origin and origin != "null":
            trusted = {o.strip() for o in get_settings().TRUSTED_ORIGINS.split(",") if o.strip()}
            host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
            if urlsplit(origin).netloc != host and origin not in trusted:
                return JSONResponse({"detail": "跨站请求被拒绝"}, status_code=403)
    return await call_next(request)


# Signing in needs no session; everything else does, and the admin pages need
# an admin. Handlers that touch personal data also take the user themselves.
_signed_in = [Depends(current_user)]
app.include_router(auth.router, prefix="/api")
app.include_router(analysis.router, prefix="/api", dependencies=_signed_in)
app.include_router(atoms.router, prefix="/api", dependencies=_signed_in)
app.include_router(cards.router, prefix="/api", dependencies=_signed_in)
app.include_router(dictionary.router, prefix="/api", dependencies=_signed_in)
app.include_router(exam.router, prefix="/api", dependencies=_signed_in)
app.include_router(jlpt.router, prefix="/api", dependencies=_signed_in)
app.include_router(tts.router, prefix="/api", dependencies=_signed_in)
app.include_router(video.router, prefix="/api", dependencies=_signed_in)
app.include_router(internalize.router, prefix="/api", dependencies=_signed_in)
app.include_router(recite.router, prefix="/api", dependencies=_signed_in)
app.include_router(admin_api.router, prefix="/api", dependencies=[Depends(require_admin)])

_media_dir = Path(__file__).parent.parent / "media"
_media_dir.mkdir(exist_ok=True)
app.mount("/media", StaticFiles(directory=str(_media_dir)), name="media")


@app.get("/health")
async def health():
    return {"status": "ok"}
