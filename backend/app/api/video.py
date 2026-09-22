import asyncio
import logging
import re

from fastapi import APIRouter, HTTPException, Query
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound, TranscriptsDisabled

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


def _pick_language(transcript, wanted: list[str]) -> str | None:
    """First of `wanted` this transcript can actually be translated into.
    YouTube offers different codes per video (zh-Hans for one, zh-Hant for
    another), so asking for a hard-coded code silently returns nothing."""
    try:
        offered = {l.language_code for l in transcript.translation_languages}
    except Exception:
        return None
    return next((code for code in wanted if code in offered), None)


async def _fetch_translation(transcript, lang: str | None) -> list | None:
    if not lang:
        return None
    try:
        return await asyncio.to_thread(lambda: transcript.translate(lang).fetch())
    except Exception as e:
        logger.warning("Subtitle translation to %s failed: %s", lang, e)
        return None


@router.get("/video/subtitles")
async def get_subtitles(url: str = Query(...)):
    """Fetch Japanese subtitles with Chinese and English translations."""
    video_id = _extract_video_id(url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or video ID")

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
        zh_lang = _pick_language(transcript, ["zh-Hans", "zh-CN", "zh", "zh-Hant", "zh-TW"]) if translatable else None
        en_lang = _pick_language(transcript, ["en", "en-US", "en-GB"]) if translatable else None
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

        return {"video_id": video_id, "subtitles": entries}

    except HTTPException:
        raise
    except (NoTranscriptFound, TranscriptsDisabled):
        raise HTTPException(status_code=404, detail="No subtitles available for this video")
    except Exception as e:
        logger.error("Failed to fetch subtitles for %s: %s", video_id, e)
        raise HTTPException(status_code=502, detail=f"Failed to fetch subtitles: {str(e)}")
