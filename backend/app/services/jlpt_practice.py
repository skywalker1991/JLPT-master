"""Each level's question types, timing and scoring, and what one practice unit is.

The test's own numbering names the types, but differently per level. N1 and
N2 number the whole written booklet straight through (N1 問題1–13, N2 問題1–14).
N3–N5 split it into 文字・語彙 and 文法・読解, each starting again at 問題1.
聴解 always starts again. So a type is identified by which numbering it is in
(`section`) and its number:

    w  — the written booklet numbered straight through (N1, N2)
    v  — 言語知識（文字・語彙）(N3–N5)
    g  — 言語知識（文法）・読解 (N3–N5)
    l  — 聴解

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
    part: str        # the scored part it counts towards
    section: str     # w / v / g / l, see above
    number: int
    grouped: bool    # answered as a passage / 番 with its questions

    @property
    def listening(self) -> bool:
        return self.section == "l"


@dataclass(frozen=True)
class Part:
    name: str
    max: int
    min: int         # 基準点: below this in any part fails the whole test


@dataclass(frozen=True)
class Level:
    written_minutes: int
    listening_minutes: int
    pass_total: int
    parts: tuple[Part, ...]
    categories: tuple[Category, ...]


def _c(section: str, number: int, label: str, part: str, grouped: bool = False) -> Category:
    return Category(f"{section}{number}", label, part, section, number, grouped)


_LISTEN_N1N2 = (
    _c("l", 1, "課題理解", "聴解", True), _c("l", 2, "ポイント理解", "聴解", True),
    _c("l", 3, "概要理解", "聴解", True), _c("l", 4, "即時応答", "聴解", True),
    _c("l", 5, "統合理解", "聴解", True),
)
_THREE_PARTS = (Part("言語知識", 60, 19), Part("読解", 60, 19), Part("聴解", 60, 19))
_TWO_PARTS = (Part("言語知識・読解", 120, 38), Part("聴解", 60, 19))

LEVELS: dict[str, Level] = {
    "N1": Level(110, 55, 100, _THREE_PARTS, (
        _c("w", 1, "漢字読み", "言語知識"), _c("w", 2, "文脈規定", "言語知識"),
        _c("w", 3, "言い換え類義", "言語知識"), _c("w", 4, "用法", "言語知識"),
        _c("w", 5, "文法形式", "言語知識"), _c("w", 6, "文の組み立て", "言語知識"),
        _c("w", 7, "文章の文法", "言語知識", True),
        _c("w", 8, "内容理解（短文）", "読解", True), _c("w", 9, "内容理解（中文）", "読解", True),
        _c("w", 10, "内容理解（長文）", "読解", True), _c("w", 11, "統合理解", "読解", True),
        _c("w", 12, "主張理解", "読解", True), _c("w", 13, "情報検索", "読解", True),
    ) + _LISTEN_N1N2),
    "N2": Level(105, 50, 90, _THREE_PARTS, (
        _c("w", 1, "漢字読み", "言語知識"), _c("w", 2, "表記", "言語知識"),
        _c("w", 3, "語形成", "言語知識"), _c("w", 4, "文脈規定", "言語知識"),
        _c("w", 5, "言い換え類義", "言語知識"), _c("w", 6, "用法", "言語知識"),
        _c("w", 7, "文法形式", "言語知識"), _c("w", 8, "文の組み立て", "言語知識"),
        _c("w", 9, "文章の文法", "言語知識", True),
        _c("w", 10, "内容理解（短文）", "読解", True), _c("w", 11, "内容理解（中文）", "読解", True),
        _c("w", 12, "統合理解", "読解", True), _c("w", 13, "主張理解", "読解", True),
        _c("w", 14, "情報検索", "読解", True),
    ) + _LISTEN_N1N2),
    "N3": Level(100, 40, 95, _THREE_PARTS, (
        _c("v", 1, "漢字読み", "言語知識"), _c("v", 2, "表記", "言語知識"),
        _c("v", 3, "文脈規定", "言語知識"), _c("v", 4, "言い換え類義", "言語知識"),
        _c("v", 5, "用法", "言語知識"),
        _c("g", 1, "文法形式", "言語知識"), _c("g", 2, "文の組み立て", "言語知識"),
        _c("g", 3, "文章の文法", "言語知識", True),
        _c("g", 4, "内容理解（短文）", "読解", True), _c("g", 5, "内容理解（中文）", "読解", True),
        _c("g", 6, "内容理解（長文）", "読解", True), _c("g", 7, "情報検索", "読解", True),
        _c("l", 1, "課題理解", "聴解", True), _c("l", 2, "ポイント理解", "聴解", True),
        _c("l", 3, "概要理解", "聴解", True), _c("l", 4, "発話表現", "聴解", True),
        _c("l", 5, "即時応答", "聴解", True),
    )),
    "N4": Level(80, 35, 90, _TWO_PARTS, (
        _c("v", 1, "漢字読み", "言語知識・読解"), _c("v", 2, "表記", "言語知識・読解"),
        _c("v", 3, "文脈規定", "言語知識・読解"), _c("v", 4, "言い換え類義", "言語知識・読解"),
        _c("v", 5, "用法", "言語知識・読解"),
        _c("g", 1, "文法形式", "言語知識・読解"), _c("g", 2, "文の組み立て", "言語知識・読解"),
        _c("g", 3, "文章の文法", "言語知識・読解", True),
        _c("g", 4, "内容理解（短文）", "言語知識・読解", True), _c("g", 5, "内容理解（中文）", "言語知識・読解", True),
        _c("g", 6, "情報検索", "言語知識・読解", True),
        _c("l", 1, "課題理解", "聴解", True), _c("l", 2, "ポイント理解", "聴解", True),
        _c("l", 3, "発話表現", "聴解", True), _c("l", 4, "即時応答", "聴解", True),
    )),
    "N5": Level(60, 30, 80, _TWO_PARTS, (
        _c("v", 1, "漢字読み", "言語知識・読解"), _c("v", 2, "表記", "言語知識・読解"),
        _c("v", 3, "文脈規定", "言語知識・読解"), _c("v", 4, "言い換え類義", "言語知識・読解"),
        _c("g", 1, "文法形式", "言語知識・読解"), _c("g", 2, "文の組み立て", "言語知識・読解"),
        _c("g", 3, "文章の文法", "言語知識・読解", True),
        _c("g", 4, "内容理解（短文）", "言語知識・読解", True), _c("g", 5, "内容理解（中文）", "言語知識・読解", True),
        _c("g", 6, "情報検索", "言語知識・読解", True),
        _c("l", 1, "課題理解", "聴解", True), _c("l", 2, "ポイント理解", "聴解", True),
        _c("l", 3, "発話表現", "聴解", True), _c("l", 4, "即時応答", "聴解", True),
    )),
}
LEVEL_ORDER = ["N1", "N2", "N3", "N4", "N5"]


def level_of(level: str | None) -> Level:
    return LEVELS.get((level or "N1").upper(), LEVELS["N1"])


def problem_number(name: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", (name or "").translate(str.maketrans("０１２３４５６７８９", "0123456789")))
    return int(digits) if digits else None


def section_kind(level: str | None, section_name: str) -> str:
    name = section_name or ""
    if "聴解" in name:
        return "l"
    if (level or "N1").upper() in ("N1", "N2"):
        return "w"
    return "v" if ("文字" in name or "語彙" in name) and "文法" not in name else "g"


def category_of(section_name: str, problem_name: str, level: str | None = "N1") -> Category | None:
    """The practice category of a 問題, from its level, section and number."""
    number = problem_number(problem_name)
    if number is None:
        return None
    cid = f"{section_kind(level, section_name)}{number}"
    return next((c for c in level_of(level).categories if c.id == cid), None)


def category_by_id(level: str | None, cid: str) -> Category | None:
    return next((c for c in level_of(level).categories if c.id == cid), None)


def scaled(correct: int, total: int, maximum: int = 60) -> int:
    """A part's raw share scaled to its points. The official conversion is
    not published; this is an estimate and is shown as one."""
    return round(maximum * correct / total) if total else 0


def paper_label(source: str | None, title: str) -> str:
    """「2025年7月」 from 「2025年07月」 (or the title when source is empty)."""
    m = re.search(r"(\d{4})年0?(\d{1,2})月", source or title or "")
    return f"{m.group(1)}年{int(m.group(2))}月" if m else (source or title)
