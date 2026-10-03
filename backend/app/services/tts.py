"""Speak a 聴解 transcript the way the test plays it.

The paper prints nothing for 聴解問題3 and 問題4 and the audio is not in any
file we have, so a listening question can only be answered once the dialogue is
spoken. The transcript comes out of the 解析 booklet; this turns it into the
clip that should have come with the paper.

A test recording is paced: the scene and the question, a pause, the
conversation, a pause, the question again, and — for 即時応答 — the three
replies read out one by one. Read in one go, the scene runs straight into the
first line and the question is lost in the dialogue. So the transcript is cut
into those blocks, each block is spoken on its own, and the clip is joined with
silence between them.

Who speaks is told by the booklet's labels — 「男：」「女（店長）：」「女2：」 —
which can sit at the start of a line or after a full stop on the same line. A
voice per person (a woman and a man, a second woman, …) because telling who said
what is half of the skill being tested; the narration has a voice of its own.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import re
import shutil
import subprocess
import wave
from dataclasses import dataclass

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

MODEL = "gemini-3.8-flash-tts"
_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
RATE = 24000  # the API returns 24 kHz mono 16-bit PCM

#: A speaker label: 男 / 女, maybe numbered (男1, 女２), maybe with a role in
#: brackets (女（店長）), at a line start or right after a sentence ends.
_LABEL = re.compile(
    r"(?:(?<=^)|(?<=\n)|(?<=[。！？!?」』…\s]))\s*(?:→\s*)?"
    r"([男女⼥][0-9０-９]?|[MFＭＦ][0-9０-９]?)\s*(?:[（(][^）)\n]{0,10}[）)])?\s*[：:]"
)
#: What the booklet prints that the recording does not say: a break, the next
#: 問題's heading, and the printed options copied under the question.
_NOT_SPOKEN = [
    re.compile(r"ここでちょっと休みましょう。?\s*(では、?また続けます。?)?"),
    re.compile(r"\s*問題\s*[一二三四五六七八九0-9０-９]+\s*$"),
    re.compile(r"(?m)^\s*質問\s*[0-9０-９]\s*(?:[「1-4１-４][^。？?\n]*){2,}$"),   # 質問1 「手帳」「秋の空」… / 質問1 1 島田書店 2 …
    re.compile(r"(?m)^\s*[1-4１-４][．.、]\s*[^。？?\n]{1,40}(?:\s+[1-4１-４][．.、]\s*[^。？?\n]{1,40})+\s*$"),  # １．… ３．… on one line
]
#: 「質問1 …」: the question asked of a conversation that has two.
_QUESTION_LINE = re.compile(r"^\s*質問\s*[0-9０-９]")

#: Voices, chosen to be clearly apart: a learner has to tell people apart first.
_NARRATOR = "Kore"
_VOICES = {"女": ["Aoede", "Despina", "Leda"], "男": ["Iapetus", "Charon", "Orus"]}

#: How it should be read: like a test recording, even and unperformed.
_STYLE = "日本語能力試験の聴解問題の録音らしく、自然な速さで落ち着いて"
_NARRATION_STYLE = "試験の音声案内として、はっきり落ち着いた調子で"

#: Silences (seconds) between the blocks of a clip.
PAUSE = {"head": 0.5, "after_scene": 1.5, "turn": 0.4, "before_question": 1.5,
         "between_questions": 2.0, "before_options": 1.2, "between_options": 1.0, "tail": 1.0}


def _digits(s: str) -> str:
    return s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))


def _speaker(raw: str) -> str:
    """「女（店長）」 and 「女」 are the same person; 「女2」 is another; F is 女."""
    raw = _digits(raw).replace("⼥", "女").replace("Ｍ", "M").replace("Ｆ", "F")
    return {"M": "男", "F": "女"}.get(raw[0], raw[0]) + raw[1:]


def _join_lines(text: str) -> str:
    """The booklet breaks lines mid-sentence; a break only matters after a stop."""
    text = re.sub(r"(?<![。！？!?」』])\n(?!\s*質問)", "", text)
    return re.sub(r"[ 　]+", " ", text).strip()


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[。？?])", text) if s.strip()]


def _is_question(s: str) -> bool:
    return bool(re.search(r"か\s*[。？?]?\s*$", s.strip()))


@dataclass
class Block:
    """One stretch of a clip: who says it (None = the narration) and what."""
    speaker: str | None
    text: str
    pause_before: float = 0.0


def blocks_for(transcript: str, options: dict | None = None) -> list[Block]:
    """The transcript as the test would play it."""
    text = transcript.replace("\r", "").strip()
    text = re.sub(r"^\s*問題\s*[：:]\s*", "", text)          # 「問題：」 is the booklet's, not the recording's
    for pattern in _NOT_SPOKEN:
        text = pattern.sub("", text).strip()
    marks = list(_LABEL.finditer(text))

    # 即時応答: one line said to you, then three replies read out by the other person
    if options and len(options) == 3:
        who = _speaker(marks[0].group(1)) if marks else "女"
        said = _join_lines(text[marks[0].end():] if marks else text)
        other = "男" if who[0] == "女" else "女"
        out = [Block(who, said)]
        for n, (k, v) in enumerate(sorted(options.items())):
            out.append(Block(other, f"{_digits(k)}、{v}",
                             PAUSE["before_options"] if n == 0 else PAUSE["between_options"]))
        return out

    if not marks:
        # A monologue: the scene, the talk, the question
        lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
        scene = lines[0] if len(lines) > 1 else ""
        body = lines[1:] if scene else lines
        questions = []
        while body and (_QUESTION_LINE.match(body[-1]) or _is_question(body[-1])):
            questions.insert(0, body.pop())
        out = []
        if scene:
            out.append(Block(None, _join_lines(scene)))
        if body:
            out.append(Block("男", _join_lines("\n".join(body)), PAUSE["after_scene"] if out else 0))
        for i, q in enumerate(questions):
            out.append(Block(None, _join_lines(q), PAUSE["before_question"] if i == 0 else PAUSE["between_questions"]))
        return out

    # A conversation
    scene = _join_lines(text[: marks[0].start()])
    turns: list[tuple[str, str]] = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        turns.append((_speaker(m.group(1)), text[m.end():end]))

    # What follows the last line of dialogue — 「質問1 …」 or the question asked
    # again — is narration, not the last speaker's words
    closing: list[str] = []
    last_who, last_said = turns[-1]
    lines = last_said.rstrip().split("\n")
    while len(lines) > 1 and (_QUESTION_LINE.match(lines[-1]) or _is_question(lines[-1])):
        closing.insert(0, lines.pop().strip())
    turns[-1] = (last_who, "\n".join(lines))

    # The test asks the question again after the conversation; the booklet
    # often prints it only once, at the start
    if not closing and scene:
        asked = [s for s in _sentences(scene) if _is_question(s)]
        if asked:
            closing = [asked[-1].strip()]

    out: list[Block] = []
    if scene:
        out.append(Block(None, scene))
    for i, (who, said) in enumerate(turns):
        said = _join_lines(said)
        if said:
            out.append(Block(who, said, PAUSE["after_scene"] if i == 0 and scene else PAUSE["turn"]))
    for i, q in enumerate(closing):
        out.append(Block(None, _join_lines(q), PAUSE["before_question"] if i == 0 else PAUSE["between_questions"]))
    return out


def _voices(blocks: list[Block]) -> dict[str, str]:
    """A voice per person, in the order they first speak, apart by sex."""
    used: dict[str, str] = {}
    count = {"女": 0, "男": 0}
    for b in blocks:
        if b.speaker and b.speaker not in used:
            sex = b.speaker[0]
            pool = _VOICES[sex]
            used[b.speaker] = pool[count[sex] % len(pool)]
            count[sex] += 1
    return used


class TTSUnavailable(RuntimeError):
    pass


#: The model allows 10 requests a minute per project; stay just under.
_PER_MINUTE = 9
_sent: list[float] = []
_rate_lock = asyncio.Lock()


async def _wait_turn() -> None:
    async with _rate_lock:
        loop = asyncio.get_running_loop()
        while True:
            now = loop.time()
            while _sent and now - _sent[0] > 60:
                _sent.pop(0)
            if len(_sent) < _PER_MINUTE:
                _sent.append(now)
                return
            await asyncio.sleep(60 - (now - _sent[0]) + 0.2)


def _retry_delay(response: httpx.Response) -> float:
    try:
        for d in response.json().get("error", {}).get("details", []):
            if "retryDelay" in d:
                return float(str(d["retryDelay"]).rstrip("s")) + 1
    except Exception:
        pass
    return 20.0


async def _request(client: httpx.AsyncClient, key: str, parts: list[dict], speech_config: dict, usage: dict | None) -> bytes:
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": speech_config}}
    for attempt in range(6):
        await _wait_turn()
        response = await client.post(_URL, params={"key": key}, json=body)
        if response.status_code == 200:
            break
        if response.status_code in (429, 500, 503) and attempt < 5:
            await asyncio.sleep(_retry_delay(response) if response.status_code == 429 else 5 * (attempt + 1))
            continue
        logger.warning("TTS %s: %s", response.status_code, response.text[:300])
        raise TTSUnavailable(f"合成失败（{response.status_code}）")
    data = response.json()
    try:
        pcm = data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
    except (KeyError, IndexError) as exc:
        raise TTSUnavailable("合成返回里没有音频") from exc
    if usage is not None:
        meta = data.get("usageMetadata", {})
        usage["in"] = usage.get("in", 0) + meta.get("promptTokenCount", 0)
        usage["out"] = usage.get("out", 0) + meta.get("candidatesTokenCount", 0)
    return base64.b64decode(pcm)


async def _say(client, key, text, voice, style, usage) -> bytes:
    """One voice."""
    return await _request(client, key, [{"text": text, "speechMetadata": {"style": style}}],
                          {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}, usage)


async def _dialogue(client, key, turns: list[Block], voices: dict[str, str], usage) -> bytes:
    """Two people talking, in one go: the model handles the turn-taking."""
    labels = list(dict.fromkeys(b.speaker for b in turns))
    parts = [{"text": b.text, "speechMetadata": {"speaker": b.speaker, "style": _STYLE}} for b in turns]
    config = {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [
        {"speaker": label, "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voices[label]}}} for label in labels]}}
    return await _request(client, key, parts, config, usage)


def _silence(seconds: float) -> bytes:
    return b"\x00\x00" * int(RATE * seconds)


def _encode(pcm: bytes) -> tuple[bytes, str]:
    """MP3 where ffmpeg is at hand (a clip is ~300 KB instead of ~4 MB), else WAV."""
    if shutil.which("ffmpeg"):
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1",
             "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", "48k", "-f", "mp3", "pipe:1"],
            input=pcm, capture_output=True, check=False,
        )
        if proc.returncode == 0 and proc.stdout:
            return proc.stdout, "audio/mpeg"
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(RATE); wf.writeframes(pcm)
    return buf.getvalue(), "audio/wav"


async def speak(transcript: str, options: dict | None = None, usage: dict | None = None) -> bytes:
    """Synthesise one listening clip (MP3, or WAV without ffmpeg)."""
    key = get_settings().LLM_API_KEY
    if not key:
        raise TTSUnavailable("没有配置 LLM_API_KEY，无法合成音频")
    blocks = blocks_for(transcript, options)
    if not blocks:
        raise TTSUnavailable("这道题没有可以朗读的内容")
    voices = _voices(blocks)

    # Pieces to synthesise: a run of dialogue between two people goes in one
    # request (fewer requests, and the model times the turns); the narration,
    # a third voice and each reply of 即時応答 go on their own.
    pieces: list[list[Block]] = []
    for b in blocks:
        prev = pieces[-1] if pieces else None
        if (prev and b.speaker and prev[0].speaker and b.pause_before <= PAUSE["turn"]
                and len({x.speaker for x in prev} | {b.speaker}) <= 2):
            prev.append(b)
        else:
            pieces.append([b])

    async with httpx.AsyncClient(timeout=180) as client:
        async def one(piece: list[Block]) -> bytes:
            first = piece[0]
            if first.speaker is None:
                return await _say(client, key, first.text, _NARRATOR, _NARRATION_STYLE, usage)
            if len({x.speaker for x in piece}) == 2:
                return await _dialogue(client, key, piece, voices, usage)
            text = "\n".join(x.text for x in piece)
            return await _say(client, key, text, voices[first.speaker], _STYLE, usage)

        clips = await asyncio.gather(*(one(p) for p in pieces))

    pcm = _silence(PAUSE["head"])
    for piece, clip in zip(pieces, clips):
        pcm += _silence(piece[0].pause_before) + clip
    pcm += _silence(PAUSE["tail"])
    return _encode(pcm)[0]


def media_type_of(data: bytes) -> str:
    return "audio/mpeg" if data[:3] == b"ID3" or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2") else "audio/wav"


# Kept for anything that still lists speakers
def speakers_in(transcript: str) -> list[str]:
    seen: list[str] = []
    for b in blocks_for(transcript):
        if b.speaker and b.speaker not in seen:
            seen.append(b.speaker)
    return seen
