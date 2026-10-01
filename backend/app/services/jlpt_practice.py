"""The question types a learner practises, and what makes one practice unit.

The test's own numbering names them: in N1, 問題1–7 are 言語知識, 8–13 読解,
and 聴解 starts again at 問題1. 読解 and 聴解 are one stored type each
(reading_comp, listening), but a learner thinks of 内容理解（短文）and 統合理解
as different things to practise, and they are — so practice goes by number.

A unit is what is answered together: one question for most of 言語知識, a
whole text with its questions for 文章の文法 and 読解, one 番 for 聴解.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Category:
    id: str
    label: str
    part: str        # 言語知識 / 読解 / 聴解 — the scored part it counts towards
    listening: bool
    number: int
    grouped: bool    # answered as a passage / 番 with its questions


N1: list[Category] = [
    Category("q1", "漢字読み", "言語知識", False, 1, False),
    Category("q2", "文脈規定", "言語知識", False, 2, False),
    Category("q3", "言い換え類義", "言語知識", False, 3, False),
    Category("q4", "用法", "言語知識", False, 4, False),
    Category("q5", "文法形式", "言語知識", False, 5, False),
    Category("q6", "文の組み立て", "言語知識", False, 6, False),
    Category("q7", "文章の文法", "言語知識", False, 7, True),
    Category("q8", "内容理解（短文）", "読解", False, 8, True),
    Category("q9", "内容理解（中文）", "読解", False, 9, True),
    Category("q10", "内容理解（長文）", "読解", False, 10, True),
    Category("q11", "統合理解", "読解", False, 11, True),
    Category("q12", "主張理解", "読解", False, 12, True),
    Category("q13", "情報検索", "読解", False, 13, True),
    Category("l1", "課題理解", "聴解", True, 1, True),
    Category("l2", "ポイント理解", "聴解", True, 2, True),
    Category("l3", "概要理解", "聴解", True, 3, True),
    Category("l4", "即時応答", "聴解", True, 4, True),
    Category("l5", "統合理解", "聴解", True, 5, True),
]

BY_ID = {c.id: c for c in N1}


def problem_number(name: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", (name or "").translate(str.maketrans("０１２３４５６７８９", "0123456789")))
    return int(digits) if digits else None


def category_of(section_name: str, problem_name: str) -> Category | None:
    """The practice category of a 問題, from its section and number."""
    number = problem_number(problem_name)
    if number is None:
        return None
    listening = "聴解" in (section_name or "")
    return BY_ID.get(f"{'l' if listening else 'q'}{number}")


# Each scored part of N1 is out of 60, with a minimum of 19; 100 of 180 passes.
PART_MAX = 60
PART_MIN = 19
PASS_TOTAL = 100
PARTS = ("言語知識", "読解", "聴解")


def scaled(correct: int, total: int) -> int:
    """A part's raw share scaled to its 60 points. The official conversion is
    not published; this is an estimate and is shown as one."""
    return round(PART_MAX * correct / total) if total else 0


def part_of_section(section_name: str) -> str:
    if "聴解" in section_name:
        return "聴解"
    if "読解" in section_name:
        return "読解"
    return "言語知識"


def paper_label(source: str | None, title: str) -> str:
    """「2025年7月」 from 「2025年07月」 (or the title when source is empty)."""
    m = re.search(r"(\d{4})年0?(\d{1,2})月", source or title or "")
    return f"{m.group(1)}年{int(m.group(2))}月" if m else (source or title)
