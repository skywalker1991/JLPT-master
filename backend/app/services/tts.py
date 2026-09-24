"""Speak a 聴解 transcript.

The paper prints nothing for 聴解問題3 and 問題4 and the audio is not in any
file we have, so a listening question can only be answered once the dialogue is
spoken. The transcript comes out of the 解析 booklet; this turns it into the
clip that should have come with the paper.

Two voices where the transcript has two speakers, because that is the whole
skill being tested: 「男：…／女：…」 read in one voice is a monologue with
labels, and telling who said what is half of 課題理解.

Who speaks each line is stated per part rather than left to be inferred from
the 「女：」 in the text — which is what this model requires, and what keeps the
labels from being read aloud.
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

MODEL = "gemini-3.8-flash-tts"
_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

#: A line of dialogue and who says it. The booklet labels speakers 男 / 女,
#: sometimes numbered (男1) where a scene has two of the same.
_SPEAKER = re.compile(r"(?:^|\n)\s*([男女⼥][0-9０-９]?|M|F)\s*[：:]")

#: Voices, picked for being clearly apart rather than for character: a learner
#: has to tell the speakers apart before anything else.
_MALE = "Iapetus"
_FEMALE = "Aoede"

#: How it should be read. The clip stands in for a test recording, which is
#: even and unperformed; carried per turn, since the model takes a style with
#: each one rather than an instruction wrapped around the whole text.
_STYLE = "日本語能力試験の聴解問題の録音らしく、自然な速さで落ち着いて"
_SCENE_STYLE = "状況説明のナレーションとして、少し改まった調子で"


def turns_in(transcript: str) -> list[tuple[str | None, str]]:
    """The transcript cut into who says what.

    Everything before the first speaker label is the scene — 「市役所で女の人と
    男の人が話しています」 — which belongs to the narration rather than to
    either of them, so it comes back with no speaker.
    """
    marks = list(_SPEAKER.finditer(transcript))
    if not marks:
        return [(None, transcript.strip())] if transcript.strip() else []

    turns: list[tuple[str | None, str]] = []
    scene = transcript[: marks[0].start()].strip()
    if scene:
        turns.append((None, scene))
    for index, match in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(transcript)
        said = transcript[match.end():end].strip()
        if said:
            turns.append((match.group(1), said))
    return turns


def speakers_in(transcript: str) -> list[str]:
    """The distinct speaker labels, in the order they first appear."""
    seen: list[str] = []
    for label, _ in turns_in(transcript):
        if label and label not in seen:
            seen.append(label)
    return seen


def _voice_for(label: str) -> str:
    return _FEMALE if label[0] in "女⼥F" else _MALE


def _speech_config(labels: list[str]) -> dict:
    # The multi-speaker form takes exactly two, so a monologue — 問題3 概要理解
    # is one person talking — uses a single voice instead.
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

    turns = turns_in(transcript)
    labels = speakers_in(transcript)
    multi = len(labels) >= 2

    # Who says each line is stated per part rather than left to be read out of
    # 「女：」 in the text. That is what this model wants, and it is also what
    # stops the labels themselves being spoken aloud.
    parts = []
    for label, said in turns:
        part: dict = {"text": said}
        if multi and label in labels[:2]:
            part["speechMetadata"] = {"speaker": label, "style": _STYLE}
        elif multi:
            # The scene, and any third speaker: read by the first voice.
            part["speechMetadata"] = {"speaker": labels[0], "style": _SCENE_STYLE}
        else:
            part["speechMetadata"] = {"style": _SCENE_STYLE if label is None else _STYLE}
        parts.append(part)

    body = {
        "contents": [{"parts": parts}],
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
