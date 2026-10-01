"""The part of a word / grammar card that is the same for everyone.

Opening a card for the first time asks the model for three example sentences
(each showing a different meaning or collocation), other common spellings, how
a grammar pattern attaches, and a usage rule when there really is one. The
answer is kept per (type, key, reading), so each card is generated once.

What a word meant in the reader's own sentence is not here: that comes from
the analysis and belongs to the encounter, not the word.
"""
import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.db import CardDetail, get_db
from app.services.llm.factory import get_llm_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["cards"])


class CardDetailRequest(BaseModel):
    # False: only what is already kept (null if nothing yet) — opening a card
    # costs nothing; examples are made when asked for.
    generate: bool = True
    type: str = Field(pattern="^(vocabulary|grammar)$")
    key: str = Field(min_length=1, max_length=100)
    reading: str | None = Field(default=None, max_length=100)
    meaning: str | None = Field(default=None, max_length=300)


_EXAMPLE = {
    "type": "object",
    "properties": {
        "ja": {"type": "string"},
        "zh": {"type": "string"},
        "point": {"type": "string"},
    },
    "required": ["ja", "zh", "point"],
}

_VOCAB_SCHEMA = {
    "type": "object",
    "properties": {
        "examples": {"type": "array", "items": _EXAMPLE},
        "variants": {"type": "array", "items": {"type": "string"}},
        "dictionary_meaning": {"type": "string"},
        "usage_hint": {"type": ["string", "null"]},
    },
    "required": ["examples", "variants", "dictionary_meaning"],
}

_GRAMMAR_SCHEMA = {
    "type": "object",
    "properties": {
        "examples": {"type": "array", "items": _EXAMPLE},
        "connection": {"type": "array", "items": {"type": "string"}},
        "conjugation": {"type": ["string", "null"]},
        "usage_hint": {"type": ["string", "null"]},
    },
    "required": ["examples", "connection"],
}

_COMMON = """
例句要求：
- 正好 3 句，自然、常见的日语，长度适中（15～40 字）。
- 每句展示一个不同的意思或搭配，不要三句都是同一种用法。
- 在 ja 里用 ⟦ ⟧ 把这个{what}在句中出现的那一段括起来（活用后的形态也括，例如 ⟦落ち着いた⟧）。
- zh 是自然的中文翻译；point 用不超过 12 个汉字说明这句展示的是哪个意思或搭配。

usage_hint：只有存在真正的使用规则或限制、用错就不对时才写，一句话，例如「后项不接意志、命令」「只能接过去式」「不能用于自己」。「多用于……」「常用来……」这类倾向性描述不算规则，这时填 null。
只输出 JSON，符合这个结构：
{schema}
"""

_VOCAB_PROMPT = """你在为一个说中文的日语学习者制作单词卡。
单词：{key}（读音：{reading}）
学习者遇到时的意思：{meaning}

请给出：
- dictionary_meaning：这个词的词典意思，中文，按常见程度列出，用「；」分隔，不超过 30 字。
- variants：这个词其他常见的写法（同一个词、同一读音，例如 分かる 也写作 わかる），没有就给空数组。不要列出活用形。
""" + _COMMON

_GRAMMAR_PROMPT = """你在为一个说中文的日语学习者制作语法卡。
语法：{key}
意思：{meaning}

请给出：
- connection：正好两段：第一段是前面接什么（有几种接法就用「／」分开，例如「动词普通形／名词＋である」），第二段是语法本身。例如 ["动词て形", "みると"]、["名词", "にわたって"]。
- conjugation：用一个常见动词演示怎样接上，例如「聞く → 聞いて → 聞いてみると」；不需要变形的语法填 null。
""" + _COMMON




def _strip_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[-1].rsplit("```", 1)[0]
    return t.strip()


def _clean(detail: dict) -> dict:
    """Keep only well-formed examples, at most three."""
    examples = []
    for e in detail.get("examples") or []:
        if not isinstance(e, dict):
            continue
        ja, zh = (e.get("ja") or "").strip(), (e.get("zh") or "").strip()
        if ja and zh:
            examples.append({"ja": ja, "zh": zh, "point": (e.get("point") or "").strip()})
    detail["examples"] = examples[:3]
    if "variants" in detail:
        detail["variants"] = [v.strip() for v in detail.get("variants") or [] if isinstance(v, str) and v.strip()][:3]
    if "connection" in detail:
        detail["connection"] = [c.strip() for c in detail.get("connection") or [] if isinstance(c, str) and c.strip()][:2]
    hint = detail.get("usage_hint")
    detail["usage_hint"] = hint.strip() if isinstance(hint, str) and hint.strip() and hint.strip() != "null" else None
    return detail


@router.post("/cards/detail")
async def card_detail(body: CardDetailRequest, db: AsyncSession = Depends(get_db)):
    key = re.sub(r"[~～]", "〜", body.key).strip() if body.type == "grammar" else body.key.strip()
    reading = (body.reading or "").strip() if body.type == "vocabulary" else ""

    cached = (await db.execute(
        select(CardDetail.detail).where(CardDetail.type == body.type, CardDetail.key == key, CardDetail.reading == reading)
    )).scalar_one_or_none()
    if cached is not None:
        return cached
    if not body.generate:
        return None

    if body.type == "vocabulary":
        schema = _VOCAB_SCHEMA
        prompt = _VOCAB_PROMPT.format(key=key, reading=reading or "（未知）", meaning=body.meaning or "（未知）",
                                      what="词", schema=json.dumps(schema, ensure_ascii=False))
    else:
        schema = _GRAMMAR_SCHEMA
        prompt = _GRAMMAR_PROMPT.format(key=key, meaning=body.meaning or "（未知）",
                                        what="语法", schema=json.dumps(schema, ensure_ascii=False))

    detail = None
    for attempt in range(2):  # the model now and then returns broken JSON
        try:
            raw = await get_llm_client().analyze(prompt, schema)
            detail = _clean(json.loads(_strip_fence(raw)))
            if detail["examples"]:
                break
        except Exception as e:
            logger.warning("Card detail for %s %s, attempt %d: %s", body.type, key, attempt + 1, e)
        detail = None
    if detail is None:
        raise HTTPException(status_code=502, detail="例句暂时没生成出来，稍后再试")

    await db.execute(
        insert(CardDetail)
        .values(type=body.type, key=key, reading=reading, detail=detail, model=get_settings().LLM_MODEL)
        .on_conflict_do_nothing()
    )
    await db.commit()
    return detail
