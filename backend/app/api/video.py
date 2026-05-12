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


async def _fetch_translation(transcript, lang: str) -> list | None:
    try:
        return await asyncio.to_thread(lambda: transcript.translate(lang).fetch())
    except Exception:
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
            try:
                first = next(iter(transcript_list))
                transcript = first.translate("ja")
            except Exception:
                pass

        if transcript is None:
            raise HTTPException(status_code=404, detail="No Japanese subtitles available for this video")

        # Fetch all three languages concurrently
        ja_data, zh_data, en_data = await asyncio.gather(
            asyncio.to_thread(transcript.fetch),
            _fetch_translation(transcript, "zh-Hans"),
            _fetch_translation(transcript, "en"),
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
