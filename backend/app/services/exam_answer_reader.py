"""Read an answer sheet, by pattern where that works and by model where it doesn't.

Answer sheets change shape between sittings in ways that break pattern
matching quietly. 2019年07月 moved the ranges and their digits each onto one
line, split a ten-item range across two runs of five, and wrote "1 正解：4"
where 2018 wrote "1、正解：2" — three changes, each of which produced fewer
answers rather than an error, which is the worst way for this to fail: the
paper imports looking complete and cannot score the items that went missing.

Chasing that with more patterns does not scale to dozens of papers from
however many publishers. So the pattern parser stays as a fast path — it is
free and instant on layouts already seen — and a model reads the sheet when
the result does not add up.

What makes handing this to a model safe is that the check does not come from
the model. A paper has a known number of items; answers are 1 to 4; two
sources have to agree. Those hold whatever the layout is, so a misread is
caught the same way whether a regex or a model produced it.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.services.exam_answers import AnswerKey, parse_answer_sheet
from app.services.llm.factory import get_exam_client

logger = logging.getLogger(__name__)

PROMPT = """这是一份 JLPT 答案表的文本，请解析出全部答案。

版式说明（不同年份差异很大，以实际文本为准）：
- 笔试题按区间给出，如「1-6」后面跟连写的数字「442132」，逐位对应
- 数字分组不一定与区间对齐，可能一个区间被拆成几段、也可能几个区间连在一段里；
  先把该块的数字全部拼接，再按区间宽度依次切分
- 排序题形如「36→1423」或「36、答案：1423」，是四个选项的完整顺序，放进 orders
- 听力在「问题N」之下，每个问题内部从 1 重新编号，放进 listening，键为 "问题号-番号"

该卷听力各问题的题量（来自试题，必须据此切分）：{counts}
该卷笔试题号范围：{written_range}

只输出 JSON，不要任何说明文字：
{{"written": {{"1": "4"}}, "orders": {{"36": "1423"}}, "listening": {{"1-1": "2"}}}}

答案表原文：
{sheet}"""


@dataclass
class ReadResult:
    key: AnswerKey
    method: str            # 'pattern' | 'model' | 'pattern+model'
    agreed: bool | None    # whether the two readings matched, when both ran
    notes: list[str]


def _expected_written(paper_item_count: int) -> str:
    return f"约 {paper_item_count} 题" if paper_item_count else "未知"


def _looks_complete(key: AnswerKey, written_expected: int, listening_expected: int) -> bool:
    """Enough of the sheet to trust it without a second opinion."""
    if written_expected and len(key.written) < written_expected:
        return False
    if listening_expected and len(key.listening) < listening_expected:
        return False
    return bool(key.written or key.listening)


def _from_payload(data: dict) -> AnswerKey:
    key = AnswerKey()
    for num, answer in (data.get("written") or {}).items():
        if str(answer) in "1234" and str(answer):
            key.written[int(num)] = str(answer)
    for num, order in (data.get("orders") or {}).items():
        order = str(order)
        if len(order) == 4 and set(order) <= set("1234"):
            key.orders[int(num)] = order
    for slot, answer in (data.get("listening") or {}).items():
        if "-" not in str(slot):
            continue
        group, index = str(slot).split("-", 1)
        if group.isdigit() and index.isdigit() and str(answer) in "1234":
            key.listening[(int(group), int(index))] = str(answer)
    return key


async def read_with_model(
    sheet_text: str,
    *,
    listening_counts: dict[int, int] | None = None,
    written_expected: int = 0,
) -> AnswerKey:
    client = get_exam_client()
    prompt = PROMPT.format(
        counts=listening_counts or "未知",
        written_range=_expected_written(written_expected),
        sheet=sheet_text,
    )
    chunks = []
    async for chunk in client.analyze_stream(prompt, {}):
        chunks.append(chunk)
    raw = "".join(chunks).strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].removeprefix("json").strip()
    return _from_payload(json.loads(raw))


def compare(a: AnswerKey, b: AnswerKey) -> list[str]:
    """Where two readings of one sheet differ."""
    notes = []
    for num in sorted(set(a.written) & set(b.written)):
        if a.written[num] != b.written[num]:
            notes.append(f"第{num}题：规则读出 {a.written[num]}，模型读出 {b.written[num]}")
    for num in sorted(set(a.orders) & set(b.orders)):
        if a.orders[num] != b.orders[num]:
            notes.append(f"第{num}题语序：规则 {a.orders[num]}，模型 {b.orders[num]}")
    for slot in sorted(set(a.listening) & set(b.listening)):
        if a.listening[slot] != b.listening[slot]:
            notes.append(f"听力 問題{slot[0]} 第{slot[1]}番：规则 {a.listening[slot]}，模型 {b.listening[slot]}")
    return notes


async def read_answer_sheet(
    sheet_text: str,
    *,
    listening_counts: dict[int, int] | None = None,
    written_expected: int = 0,
    always_verify: bool = False,
) -> ReadResult:
    """Read a sheet, falling back to the model and checking one against the other.

    `always_verify` runs both even when the patterns look complete, which is
    what an unfamiliar publisher is worth: the readings are independent, so
    agreement is real evidence and a disagreement names the item.
    """
    listening_expected = sum((listening_counts or {}).values())
    pattern = parse_answer_sheet(sheet_text, listening_counts=listening_counts)
    complete = _looks_complete(pattern, written_expected, listening_expected)

    if complete and not always_verify:
        return ReadResult(pattern, "pattern", None, [])

    try:
        model = await read_with_model(
            sheet_text,
            listening_counts=listening_counts,
            written_expected=written_expected,
        )
    except Exception as e:
        logger.warning("Model could not read the answer sheet: %s", e)
        note = "模型解析失败，仅用规则结果" if complete else "模型解析失败，且规则结果不完整"
        return ReadResult(pattern, "pattern", None, [note])

    if not complete:
        notes = compare(pattern, model) if pattern.written else []
        # The patterns fell short, so the model's reading is the one to keep —
        # but a disagreement on what both did read is still worth surfacing.
        return ReadResult(model, "model", not notes, notes)

    differences = compare(pattern, model)
    return ReadResult(pattern, "pattern+model", not differences, differences)
