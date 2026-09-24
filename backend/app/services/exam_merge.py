"""Put the answers onto the paper.

Answers arrive separately from the questions and in three different shapes —
a grid of ranges, a full ordering for 並べ替え, and a per-item 正解 line in the
解析 booklet — so joining them up is its own step, downstream of extraction
and upstream of import.

It works on a `CanonicalPaper` and an `AnswerKey`, not on files. A new source
layout is a change to the extractor and the answer parser; this does not move.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from app.services.exam_answers import AnswerKey, resolve_order_answer
from app.services.exam_canonical import CanonicalPaper


@dataclass
class MergeReport:
    answered: int = 0
    unanswered: int = 0
    orders_applied: int = 0
    conflicts: list[str] = None          # sources disagreeing with no majority
    notes: list[str] = None
    outvoted: Counter = None             # how often each source lost a majority

    def __post_init__(self):
        self.conflicts = self.conflicts or []
        self.notes = self.notes or []
        self.outvoted = self.outvoted if self.outvoted is not None else Counter()


def merge_answers(
    paper: CanonicalPaper,
    sheet: AnswerKey | None = None,
    explanations: AnswerKey | None = None,
    grid: AnswerKey | None = None,
) -> MergeReport:
    """Write answers onto the paper in place, and say what did not land.

    A sitting can carry three statements of the same answer: the answer sheet,
    the per-item 正解 lines in the 解析 booklet, and the summary table printed
    at the front of that booklet. They are counted rather than ranked, because
    ranking them means picking a side by rule and filing a wrong answer
    silently — and a wrong answer is wrong on every future attempt.

    A majority settles it and the dissent is noted. A tie does not: the item is
    left unanswered until someone looks. Two sources disagreeing is always a
    tie, which is the common case and the conservative one.
    """
    report = MergeReport()

    sources = [
        (name, key) for name, key in (
            ("答案表", sheet), ("解析", explanations), ("解析册答案页", grid),
        ) if key is not None
    ]

    orders: dict[int, str] = {}
    for num in {n for _, key in sources for n in key.orders}:
        chosen = _settle(
            {name: key.orders[num] for name, key in sources if num in key.orders},
            f"第{num}题语序", report,
        )
        if chosen:
            orders[num] = chosen

    for _, problem, item in paper.items():
        if problem.type == "listening":
            group = _problem_number(problem.name)
            slot = (group, item.seq)
            answer = _settle(
                {name: key.listening[slot] for name, key in sources if slot in key.listening},
                f"{problem.name} 第{item.seq}题", report,
            ) if group else None
        elif problem.type == "sentence_order":
            answer = _apply_order(item, orders, report)
        elif item.num is None:
            answer = None
        else:
            answer = _settle(
                {name: key.written[item.num] for name, key in sources if item.num in key.written},
                f"第{item.num}题", report,
            )

        if answer:
            item.correct_answer = answer
            report.answered += 1
        else:
            report.unanswered += 1

    # A source that has already been outvoted inside this very paper is the one
    # to doubt first when only two sources are left and they disagree. Saying so
    # costs nothing and is what a reviewer would otherwise have to work out by
    # reading every other finding.
    for name, times in report.outvoted.most_common():
        report.notes.append(f"{name} 有 {times} 处被其他来源以多数否决，剩下的分歧可优先怀疑它")

    if report.unanswered:
        report.notes.append(f"{report.unanswered} 题没有答案，可入库但这些题无法判分")
    return report


def _settle(votes: dict[str, str], what: str, report: MergeReport) -> str | None:
    """What the sources say, where they say different things.

    Agreement is the usual case and passes straight through. Otherwise a strict
    majority wins and the odd source out is named, so a reviewer can see which
    file to distrust; anything short of a majority is left for a person.
    """
    if not votes:
        return None

    tally = Counter(votes.values()).most_common()
    if len(tally) == 1:
        return tally[0][0]

    said = "，".join(f"{name}={value}" for name, value in votes.items())
    if tally[0][1] == tally[1][1]:
        report.conflicts.append(f"{what}：{said}（各源矛盾且无多数，暂不填答案，请人工判定）")
        return None

    for name, value in votes.items():
        if value != tally[0][0]:
            report.outvoted[name] += 1
    report.notes.append(f"{what}：{said}，按多数取 {tally[0][0]}")
    return tally[0][0]


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
