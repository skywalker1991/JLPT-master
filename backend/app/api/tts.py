import base64
import io
import wave
from functools import lru_cache

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.config import get_settings

router = APIRouter()

GEMINI_TTS_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models"
    "/gemini-3.1-flash-tts-preview:generateContent"
)

VOICE_NAME = "Kore"

TTS_PROMPT = (
    "穏やかで忍耐強い日本語の女性教師として、"
    "外国人の生徒に教えるように、"
    "ゆっくりと間を取りながら、明るく温かみのある声で読んでください。"
    "発音は丁寧に、一語一語はっきりと：\n\n"
    "{text}"
)


def pcm_to_wav(pcm: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


@lru_cache(maxsize=256)
def _cached_wav(text: str, api_key: str) -> bytes | None:
    # Synchronous helper — called from async context via run_in_executor if needed,
    # but lru_cache on the sync fetch is the simplest approach here.
    # We store None on failure so we don't retry transiently.
    return None  # placeholder — actual fetch is async, see below


# Simple async-safe in-memory cache: text → WAV bytes
_tts_cache: dict[str, bytes] = {}
_MAX_CACHE = 256


@router.get("/tts")
async def tts(text: str = Query(..., max_length=500)):
    if text in _tts_cache:
        return Response(content=_tts_cache[text], media_type="audio/wav")

    settings = get_settings()
    if not settings.LLM_API_KEY:
        raise HTTPException(status_code=500, detail="LLM_API_KEY not configured")

    prompt = TTS_PROMPT.format(text=text)
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": VOICE_NAME}
                }
            },
        },
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            GEMINI_TTS_URL,
            params={"key": settings.LLM_API_KEY},
            json=payload,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Gemini TTS error: {resp.text}")

    data = resp.json()
    try:
        b64 = data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
    except (KeyError, IndexError) as e:
        raise HTTPException(status_code=502, detail=f"Unexpected TTS response: {e}")

    wav = pcm_to_wav(base64.b64decode(b64))

    if len(_tts_cache) >= _MAX_CACHE:
        _tts_cache.pop(next(iter(_tts_cache)))  # evict oldest
    _tts_cache[text] = wav

    return Response(content=wav, media_type="audio/wav")
