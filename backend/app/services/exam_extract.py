"""Turn one 問題 block into items, and refuse anything the source does not say.

Reading a whole paper in one call invites drift and gives a failure nowhere to
point. A block at a time is small enough to read carefully, names the 問題 when
something is wrong, and makes a retry cost one 問題 rather than forty pages.

The check that matters is not structural. Every stem and option is required to
appear in the source text, after normalising away spacing and the markup the
model is asked to add — across the 862 stems and options already imported, not
one was absent, so anything that cannot be found is the model having written
rather than copied. Structural rules (four options, one ★, contiguous
numbering) are applied separately by exam_validation; this is the one that
catches a plausible sentence that was never printed.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field

from app.services.exam_canonical import CanonicalItem, CanonicalProblem, Provenance
from app.services.exam_split import Block
from app.services.llm.factory import get_exam_client

logger = logging.getLogger(__name__)

EXTRACTOR = "block-v1"

#: Types keyed off what the instruction says, since the paper never names them.
_TYPE_RULES = (
    (re.compile(r"読み⽅|読み方"), "kanji_reading"),
    (re.compile(r"意味が最も近い"), "synonym"),
    (re.compile(r"使い⽅|使い方"), "usage"),
    (re.compile(r"★"), "sentence_order"),
    (re.compile(r"⽂章を読んで.*[0-9０-９]+\s*から\s*[0-9０-９]+\s*の中に⼊る|文章を読んで.*の中に入る"), "passage_fill"),
    (re.compile(r"（ ）に⼊れる|（ ）に入れる|\( ?\)に⼊れる"), "vocab_fill"),
    (re.compile(r"⽂章を読んで|文章を読んで|右のページ|意⾒⽂|意見文"), "reading_comp"),
)

PROMPT = """从下面这段 JLPT 试题中提取出所有小题，输出 JSON。

要求：
- stem 和 options 必须**逐字照抄原文**，不要改写、补全或修正，包括标点
- 题号用原文中的编号（可能是半角、全角，或带「．」）
- 排序题：stem 中的空格保留成 [_1_] [_2_] [_3_] [_4_]，★ 所在的空写成 [_N★_]，
  并在 meta.star_position 填该空的序号（1-4）
- 听力题若题目用纸上没有印选项，options 留空对象 {{}}
- 听力「N番」下若有「質問1」「質問2」两问，算作**两个小题**，num 按番号顺延
  （例：3番有質問1和質問2，则它们是本題組的第3、第4小题），
  并在 meta 里记 {{"ban": 3, "question": 1}} 和 {{"ban": 3, "question": 2}}
- 若本题组有共同的文章或说明，放进 passage / instruction，不要重复进每个小题

只输出 JSON：
{{"type": "{type_hint}",
  "instruction": "本题组的指示语",
  "passage": "共同文章，没有则留空",
  "items": [{{"num": 1, "stem": "…", "options": {{"1": "…", "2": "…", "3": "…", "4": "…"}},
              "meta": {{}}}}]}}

原文：
{text}"""


def guess_type(block: Block) -> str:
    """What kind of 問題 this is, from the instruction above it."""
    if block.section == "聴解":
        return "listening"
    head = block.text[:200]
    for pattern, kind in _TYPE_RULES:
        if pattern.search(head):
            return kind
    if re.search(r"⽂法形式|文法形式|に⼊れるのに最もよい|に入れるのに最もよい", head):
        return "grammar_fill"
    return "unknown"


def normalise(text: str) -> str:
    """Strip away everything the model is allowed to change.

    Whitespace, the blank and ★ markup it is asked to insert, and the
    full/half-width difference the same character is printed in from one
    sitting to the next.
    """
    text = unicodedata.normalize("NFKC", text or "")
    text = re.sub(r"\[_\d+★?_\]", "", text)
    text = re.sub(r"[\s　]+", "", text)
    text = re.sub(r"[_＿※★（）()「」『』、。，．・]", "", text)
    return text


@dataclass
class BlockResult:
    problem: CanonicalProblem | None
    invented: list[str] = field(default_factory=list)   # text not found in the source
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.problem is not None and not self.invented and not self.error


#: 聴解 problems that print nothing carry only a list of 番 numbers, which is
#: the only evidence those items exist at all.
_BAN = re.compile(r"([0-9０-９]{1,2})\s*番")


def check_invented_blanks(problem: CanonicalProblem, source: str) -> list[str]:
    """Empty items conjured out of an instruction.

    A 聴解 問題 that prints nothing is a real case — the page lists "1番 2番
    3番 …" and nothing else — but an item with no stem and no options slips
    past every other check: verbatim matching has nothing to match and the
    four-option rule exempts listening. So the count has to be backed by 番
    numbers actually printed, or the block genuinely has no items to extract.
    """
    blank = [i for i in problem.items if not (i.stem or "").strip() and not i.options]
    if not blank:
        return []
    printed = len({int(n.translate(str.maketrans("０１２３４５６７８９", "0123456789")))
                   for n in _BAN.findall(source)})
    if len(blank) <= printed:
        return []
    return [
        f"{problem.name}：提取出 {len(blank)} 个没有题干也没有选项的小题，"
        f"但原文只列出 {printed} 个番号"
    ]


def check_verbatim(problem: CanonicalProblem, source: str) -> list[str]:
    """Stems and options that do not appear in the source.

    Not a style check: a stem the model composed reads perfectly and would
    pass every structural rule, so this is the only thing standing between a
    fluent invention and the question bank.
    """
    haystack = normalise(source)
    missing = []
    for item in problem.items:
        for label, value in [("题干", item.stem), *((f"选项{k}", v) for k, v in item.options.items())]:
            needle = normalise(value)
            if len(needle) < 2:
                continue
            if needle not in haystack:
                missing.append(f"第{item.num}题 {label}：原文中找不到「{(value or '')[:30]}」")
    return missing


def item_number(raw) -> int | None:
    """The printed item number, however it was printed.

    Asked to copy verbatim, the model returns what the page shows — "1", "1.",
    "１" — and the number is what every answer is keyed by, so a strict read
    that drops "1." silently unkeys the whole 問題.
    """
    if isinstance(raw, int):
        return raw
    digits = re.sub(r"[^0-9]", "", unicodedata.normalize("NFKC", str(raw or "")))
    return int(digits) if digits else None


def build_problem(block: Block, payload: dict, seq: int, source_name: str | None = None) -> CanonicalProblem:
    items = []
    for index, raw in enumerate(payload.get("items") or [], start=1):
        items.append(CanonicalItem(
            num=item_number(raw.get("num")),
            seq=index,
            stem=raw.get("stem") or "",
            options={str(k): str(v) for k, v in (raw.get("options") or {}).items()},
            meta=raw.get("meta") or {},
            provenance=Provenance(source=source_name, extractor=EXTRACTOR),
        ))
    return CanonicalProblem(
        name=block.name,
        type=payload.get("type") or guess_type(block),
        seq=seq,
        instruction=payload.get("instruction") or None,
        passage=payload.get("passage") or None,
        items=items,
    )


async def extract_block(
    block: Block, seq: int, *, source_name: str | None = None, feedback: str | None = None,
) -> BlockResult:
    """Read one 問題. `feedback` is what went wrong last time, for a retry."""
    prompt = PROMPT.format(type_hint=guess_type(block), text=block.text)
    if feedback:
        prompt += f"\n\n上一次提取存在以下问题，请修正后重新输出：\n{feedback}"

    try:
        chunks = []
        async for chunk in get_exam_client().analyze_stream(prompt, {}):
            chunks.append(chunk)
        raw = "".join(chunks).strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].removeprefix("json").strip()
        payload = json.loads(raw)
    except Exception as e:
        logger.warning("Could not read %s: %s", block.name, e)
        return BlockResult(None, error=f"{block.name} 提取失败：{e}")

    problem = build_problem(block, payload, seq, source_name)
    return BlockResult(problem, invented=(
        check_verbatim(problem, block.text) + check_invented_blanks(problem, block.text)
    ))


async def extract_block_with_retry(
    block: Block, seq: int, *, source_name: str | None = None, attempts: int = 2,
) -> BlockResult:
    """Re-read a block that failed its checks, telling it what was wrong.

    Scoped to the one 問題: a paper is not re-read because one block came back
    badly, and a block that keeps failing names itself.
    """
    result = await extract_block(block, seq, source_name=source_name)
    for _ in range(attempts - 1):
        if result.ok:
            return result
        feedback = "\n".join(result.invented) if result.invented else (result.error or "")
        result = await extract_block(block, seq, source_name=source_name, feedback=feedback)
    return result
