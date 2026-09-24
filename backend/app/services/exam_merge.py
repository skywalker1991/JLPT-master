"""Put the answers onto the paper.

Answers arrive separately from the questions and in three different shapes —
a grid of ranges, a full ordering for 並べ替え, and a per-item 正解 line in the
解析 booklet — so joining them up is its own step, downstream of extraction
and upstream of import.

It works on a `CanonicalPaper` and an `AnswerKey`, not on files. A new source
layout is a change to the extractor and the answer parser; this does not move.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.services.exam_answers import AnswerKey, cross_check, resolve_order_answer
from app.services.exam_canonical import CanonicalPaper


@dataclass
class MergeReport:
    answered: int = 0
    unanswered: int = 0
    orders_applied: int = 0
    conflicts: list[str] = None          # two sources disagreeing
    notes: list[str] = None

    def __post_init__(self):
        self.conflicts = self.conflicts or []
        self.notes = self.notes or []


def merge_answers(
    paper: CanonicalPaper,
    sheet: AnswerKey | None = None,
    explanations: AnswerKey | None = None,
) -> MergeReport:
    """Write answers onto the paper in place, and say what did not land.

    The sheet is preferred where both cover an item — it covers the whole paper
    while the 解析 booklet only answers the parts it discusses — but a
    disagreement is reported rather than quietly resolved.
    """
    report = MergeReport()

    if sheet and explanations:
        for clash in cross_check(sheet, explanations):
            report.conflicts.append(
                f"第{clash.num}题：答案表={clash.sheet}，解析={clash.explanation}"
            )

    written: dict[int, str] = {}
    if explanations:
        written.update(explanations.written)
    if sheet:
        written.update(sheet.written)          # the sheet wins on overlap

    orders = sheet.orders if sheet else {}
    listening = sheet.listening if sheet else {}

    for _, problem, item in paper.items():
        if problem.type == "listening":
            group = _problem_number(problem.name)
            answer = listening.get((group, item.seq)) if group else None
        elif problem.type == "sentence_order":
            answer = _apply_order(item, orders, report)
        else:
            answer = written.get(item.num) if item.num is not None else None

        if answer:
            item.correct_answer = answer
            report.answered += 1
        else:
            report.unanswered += 1

    if report.unanswered:
        report.notes.append(f"{report.unanswered} 题没有答案，可入库但这些题无法判分")
    return report


def _problem_number(name: str) -> int | None:
    digits = "".join(c for c in name if c.isdigit())
    return int(digits) if digits else None


def _apply_order(item, orders: dict[int, str], report: MergeReport) -> str | None:
    """並べ替え needs both halves: the ordering, and which blank holds the ★."""
    order = orders.get(item.num) if item.num is not None else None
    if not order:
        return item.correct_answer

    item.answer_order = order
    report.orders_applied += 1

    star = item.meta.get("star_position")
    if not isinstance(star, int):
        report.notes.append(
            f"第{item.num}题：有完整语序 {order}，但不知道 ★ 在第几个空，无法定答案"
        )
        return item.correct_answer

    resolved = resolve_order_answer(order, star)
    if resolved is None:
        report.notes.append(f"第{item.num}题：★ 位置 {star} 超出语序 {order} 的范围")
    return resolved
