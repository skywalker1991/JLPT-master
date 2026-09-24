import asyncio
import logging
import re
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled

from app.models.db import VideoSubtitle, get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["video"])

_ytt = YouTubeTranscriptApi()


def _extract_video_id(url: str) -> str | None:
    patterns = [r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})"]
    for pattern in patterns:
        m = re.search(pattern, url)
        if m:
            return m.group(1)
    if re.match(r"^[A-Za-z0-9_-]{11}$", url.strip()):
        return url.strip()
    return None


async def _none() -> None:
    return None


#: Preference order per target language. YouTube offers different codes per
#: video (zh-Hans for one, zh-Hant for another), so a hard-coded code silently
#: returns nothing.
ZH_CODES = ["zh-Hans", "zh-CN", "zh", "zh-Hant", "zh-TW"]
EN_CODES = ["en", "en-US", "en-GB"]


def _pick_code(offered: set[str], wanted: list[str]) -> str | None:
    return next((code for code in wanted if code in offered), None)


def _pick_language(transcript, wanted: list[str]) -> str | None:
    """First of `wanted` this transcript can actually be translated into."""
    try:
        offered = {l.language_code for l in transcript.translation_languages}
    except Exception:
        return None
    return _pick_code(offered, wanted)


async def _fetch_translation(transcript, lang: str | None) -> list | None:
    if not lang:
        return None
    try:
        return await asyncio.to_thread(lambda: transcript.translate(lang).fetch())
    except Exception as e:
        logger.warning("Subtitle translation to %s failed: %s", lang, e)
        return None


async def _fetch_from_youtube(video_id: str) -> list[dict]:
    """Japanese subtitles with Chinese / English translations where offered."""
    try:
        transcript_list = await asyncio.to_thread(_ytt.list, video_id)

        transcript = None
        native_ja = True            # Japanese comes from the video itself
        try:
            transcript = transcript_list.find_manually_created_transcript(["ja"])
        except Exception:
            pass

        if transcript is None:
            try:
                transcript = transcript_list.find_generated_transcript(["ja"])
            except Exception:
                pass

        if transcript is None:
            # No Japanese track: translate another language into Japanese.
            # YouTube won't translate a translation, so skip zh/en entirely
            # rather than firing requests that always fail.
            try:
                first = next(iter(transcript_list))
                transcript = first.translate("ja")
                native_ja = False
            except Exception:
                pass

        if transcript is None:
            raise HTTPException(status_code=404, detail="No Japanese subtitles available for this video")

        # Fetch all three languages concurrently
        # YouTube won't translate a translation, so only ask when the Japanese
        # track came from the video itself.
        translatable = native_ja and getattr(transcript, "is_translatable", False)
        zh_lang = _pick_language(transcript, ZH_CODES) if translatable else None
        en_lang = _pick_language(transcript, EN_CODES) if translatable else None
        ja_data, zh_data, en_data = await asyncio.gather(
            asyncio.to_thread(transcript.fetch),
            _fetch_translation(transcript, zh_lang),
            _fetch_translation(transcript, en_lang),
        )

        entries = []
        for i, s in enumerate(ja_data):
            if not s.text.strip():
                continue
            entry = {
                "start": round(s.start, 2),
                "duration": round(s.duration, 2),
                "text": s.text.strip(),
                "zh": zh_data[i].text.strip() if zh_data and i < len(zh_data) else None,
                "en": en_data[i].text.strip() if en_data and i < len(en_data) else None,
            }
            entries.append(entry)

        return entries

    except HTTPException:
        raise
    except (NoTranscriptFound, TranscriptsDisabled):
        raise HTTPException(status_code=404, detail="No subtitles available for this video")
    except Exception as e:
        logger.error("Failed to fetch subtitles for %s: %s", video_id, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch subtitles: {str(e)}")


# --- Client-fetched subtitles -------------------------------------------------
# YouTube blocks datacenter IPs from its internal API, so the server can't do
# the lookup at all in production. A phone can: an iOS Shortcut calls YouTube
# with the user's own (residential) IP and posts the raw player response here.
# The Shortcut stays dumb on purpose — it parses nothing, so YouTube changing
# its response shape breaks the code below, which we maintain, not the Shortcut.

def _timedtext_url(base_url: str, tlang: str | None = None) -> str:
    """json3 instead of the srv3 baked into baseUrl (appending won't override
    it — the first occurrence of a param wins), plus an optional translation."""
    parts = urlparse(base_url)
    query = parse_qs(parts.query)
    query["fmt"] = ["json3"]
    if tlang:
        query["tlang"] = [tlang]
    return urlunparse(parts._replace(query=urlencode(query, doseq=True)))


def _lines_from_events(payload: dict) -> list[dict]:
    lines = []
    for event in payload.get("events") or []:
        segs = event.get("segs")
        if not segs:
            continue
        text = "".join(s.get("utf8", "") for s in segs).strip()
        if not text:
            continue
        lines.append({
            "start": round(event.get("tStartMs", 0) / 1000, 2),
            "duration": round(event.get("dDurationMs", 0) / 1000, 2),
            "text": text,
        })
    return lines


def _track_urls(player_response: dict) -> dict[str, str | None]:
    """Which timedtext URLs to fetch for a player response."""
    renderer = (player_response.get("captions") or {}).get("playerCaptionsTracklistRenderer") or {}
    tracks = renderer.get("captionTracks") or []
    if not tracks:
        raise HTTPException(status_code=404, detail="No subtitles available for this video")

    # A video can carry both a human-written and an auto-generated Japanese
    # track, segmented differently. Prefer the human one.
    ja_track = (
        next((t for t in tracks if t.get("languageCode") == "ja" and t.get("kind") != "asr"), None)
        or next((t for t in tracks if t.get("languageCode") == "ja"), None)
    )
    if ja_track is None:
        raise HTTPException(status_code=404, detail="No Japanese subtitles available for this video")

    # Translate the Japanese track rather than taking a native zh/en track:
    # native tracks are segmented independently, so they wouldn't line up
    # line-for-line with the Japanese the rest of the app works from.
    offered = {l.get("languageCode") for l in renderer.get("translationLanguages") or []}
    base = ja_track.get("baseUrl") or ""
    zh_code = _pick_code(offered, ZH_CODES)
    en_code = _pick_code(offered, EN_CODES)

    return {
        "ja": _timedtext_url(base),
        "zh": _timedtext_url(base, zh_code) if zh_code else None,
        "en": _timedtext_url(base, en_code) if en_code else None,
    }


def _merge_tracks(ja: dict, zh: dict | None, en: dict | None) -> list[dict]:
    ja_lines = _lines_from_events(ja)
    if not ja_lines:
        raise HTTPException(status_code=400, detail="The Japanese track contained no subtitles")
    zh_lines = _lines_from_events(zh) if zh else []
    en_lines = _lines_from_events(en) if en else []
    return [
        {
            **line,
            "zh": zh_lines[i]["text"] if i < len(zh_lines) else None,
            "en": en_lines[i]["text"] if i < len(en_lines) else None,
        }
        for i, line in enumerate(ja_lines)
    ]


class PrepareRequest(BaseModel):
    video_id: str
    player_response: dict


class IngestRequest(BaseModel):
    video_id: str
    ja: dict
    zh: dict | None = None
    en: dict | None = None


def _validated_id(video_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise HTTPException(status_code=400, detail="Invalid video id")
    return video_id


@router.post("/video/subtitles/prepare")
async def prepare_subtitles(req: PrepareRequest):
    """Step 1: turn a player response the client fetched into the timedtext URLs
    it should fetch next. Keeps the client free of any parsing — it only ever
    reads back flat string fields."""
    return {"video_id": _validated_id(req.video_id), "tracks": _track_urls(req.player_response)}


@router.post("/video/subtitles/ingest")
async def ingest_subtitles(req: IngestRequest, db: AsyncSession = Depends(get_db)):
    """Step 2: store the timedtext the client fetched with its own IP."""
    video_id = _validated_id(req.video_id)
    entries = _merge_tracks(req.ja, req.zh, req.en)
    await db.merge(VideoSubtitle(video_id=video_id, subtitles=entries))
    await db.commit()
    return {"video_id": video_id, "count": len(entries)}


@router.get("/video/subtitles")
async def get_subtitles(
    url: str = Query(...),
    refresh: bool = Query(default=False, description="Re-fetch even if cached"),
    db: AsyncSession = Depends(get_db),
):
    """
    Subtitles for a video, served from the cache when we already have them.
    YouTube rate-limits repeated fetches (it starts refusing the server's IP),
    and subtitles don't change, so the first fetch is kept.
    """
    video_id = _extract_video_id(url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or video ID")

    if not refresh:
        cached = await db.get(VideoSubtitle, video_id)
        if cached is not None:
            return {"video_id": video_id, "subtitles": cached.subtitles, "cached": True}

    entries = await _fetch_from_youtube(video_id)

    try:
        await db.merge(VideoSubtitle(video_id=video_id, subtitles=entries))
        await db.commit()
    except Exception as e:                       # caching is best-effort
        logger.warning("Could not cache subtitles for %s: %s", video_id, e)
        await db.rollback()

    return {"video_id": video_id, "subtitles": entries, "cached": False}
