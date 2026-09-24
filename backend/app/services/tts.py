"""Speak a 聴解 transcript.

The paper prints nothing for 聴解問題3 and 問題4 and the audio is not in any
file we have, so a listening question can only be answered once the dialogue is
spoken. The transcript comes out of the 解析 booklet; this turns it into the
clip that should have come with the paper.

Two voices where the transcript has two speakers, because that is the whole
skill being tested: 「男：…／女：…」 read in one voice is a monologue with
labels, and telling who said what is half of 課題理解.
"""
from __future__ import annotations

import base64
import io
import logging
import re
import wave

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

MODEL = "gemini-3.1-flash-tts-preview"
_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

#: A line of dialogue and who says it. The booklet labels speakers 男 / 女,
#: sometimes numbered (男1) where a scene has two of the same.
_SPEAKER = re.compile(r"(?:^|\n)\s*([男女⼥][0-9０-９]?|M|F)\s*[：:]")

#: Voices, picked for being clearly apart rather than for character: a learner
#: has to tell the speakers apart before anything else.
_MALE = "Iapetus"
_FEMALE = "Aoede"

#: What the reading should sound like. The clip stands in for a test recording,
#: which is read at an even pace and without performance.
_PROMPT = (
    "これは日本語能力試験の聴解問題の音声です。"
    "試験の録音らしく、自然な速さで、落ち着いて読んでください。"
    "「ナレーション」の部分は状況説明、そのあとが会話です。\n\n{text}"
)


def speakers_in(transcript: str) -> list[str]:
    """The distinct speaker labels, in the order they first appear."""
    seen: list[str] = []
    for match in _SPEAKER.finditer(transcript):
        label = match.group(1)
        if label not in seen:
            seen.append(label)
    return seen


def _voice_for(label: str) -> str:
    return _FEMALE if label[0] in "女⼥F" else _MALE


def _speech_config(labels: list[str]) -> dict:
    # One speaker gets a single voice; the multi-speaker form takes at most two,
    # which is what these dialogues have.
    if len(labels) < 2:
        return {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": _MALE}}}
    return {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [
        {"speaker": label, "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": _voice_for(label)}}}
        for label in labels[:2]
    ]}}


def _to_wav(pcm: bytes) -> bytes:
    """The API returns raw 24kHz mono PCM; a browser needs a container."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm)
    return buf.getvalue()


class TTSUnavailable(RuntimeError):
    pass


async def speak(transcript: str) -> bytes:
    """Synthesise one listening clip, as WAV bytes."""
    key = get_settings().LLM_API_KEY
    if not key:
        raise TTSUnavailable("没有配置 LLM_API_KEY，无法合成音频")

    labels = speakers_in(transcript)
    body = {
        "contents": [{"parts": [{"text": _PROMPT.format(text=transcript)}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": _speech_config(labels),
        },
    }
    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(_URL, params={"key": key}, json=body)
    if response.status_code != 200:
        logger.warning("TTS %s: %s", response.status_code, response.text[:300])
        raise TTSUnavailable(f"合成失败（{response.status_code}）")

    try:
        part = response.json()["candidates"][0]["content"]["parts"][0]
        pcm = part["inlineData"]["data"]
    except (KeyError, IndexError) as exc:
        raise TTSUnavailable("合成返回里没有音频") from exc

    return _to_wav(base64.b64decode(pcm))
