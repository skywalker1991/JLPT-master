"""Remember what the model said about a block of text.

Extraction is the only paid step and it is deterministic in the thing that
matters: the same 問題 text with the same prompt yields the same questions.
Everything after it — building the problem, the checks, marking cloze blanks,
splitting passages, typing by number — is free and has been rewritten a dozen
times today, each rewrite paying for the extraction again.

So the model's raw answer is kept and the rest re-runs over it. Importing
thirty sittings costs five hundred calls once; improving anything downstream
afterwards costs nothing.

The key covers everything that would change the answer: the text, the prompt,
and the model. Change the prompt and every entry misses, which is correct —
a cached answer to a different question is worse than no cache.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "extract_cache"


def key_for(text: str, prompt: str, model: str) -> str:
    digest = hashlib.sha256()
    for part in (text, prompt, model):
        digest.update(part.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()[:32]


def get(key: str) -> dict | None:
    path = CACHE_DIR / f"{key}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        # A half-written file is worth ignoring, not crashing over.
        return None


def put(key: str, payload: dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        # Written beside and moved, so an interrupted run leaves no entry that
        # would be read back as a real answer.
        tmp = CACHE_DIR / f"{key}.tmp"
        tmp.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
        tmp.replace(CACHE_DIR / f"{key}.json")
    except OSError as exc:
        logger.info("Could not cache %s: %s", key, exc)


def stats() -> tuple[int, int]:
    """How many answers are kept, and how much room they take."""
    if not CACHE_DIR.exists():
        return 0, 0
    files = list(CACHE_DIR.glob("*.json"))
    return len(files), sum(f.stat().st_size for f in files)
