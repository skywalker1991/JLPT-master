"""What kind of question each 問題 is, by its number.

The instruction cannot always say. 問題2 (文脈規定, vocabulary) and 問題5
(文法形式の判断, grammar) are both printed as 「（ ）に入れるのに最もよいもの
を」, so a rule keyed on the instruction has to guess between them, and guessing
wrong sends 「と引きかえに」 into the vocabulary half of the knowledge base.

The number settles it. 問題5 of 言語知識 is 文法形式の判断 in every sitting —
that is what the number means in the test's own format, not a pattern noticed
in these three papers.

The table is per level, because the numbering is: what is 問題5 in N1 is not
問題5 in N2. A level with no table falls back to reading the instruction, which
is what every 問題 outside 言語知識 does anyway — 読解 and 聴解 say plainly what
they are.
"""
from __future__ import annotations

import re

BY_NUMBER: dict[str, dict[int, str]] = {
    "N1": {
        1: "kanji_reading",    # 漢字読み
        2: "vocab_fill",       # 文脈規定
        3: "synonym",          # 言い換え類義
        4: "usage",            # 用法
        5: "grammar_fill",     # 文法形式の判断
        6: "sentence_order",   # 文の組み立て
        7: "passage_fill",     # 文章の文法
    },
}

#: 読解's six 問題 are all answered the same way and score in the same part,
#: so they are one type — except the last. 問題13 is 情報検索: a notice, a
#: timetable, a fee table, where the question is to find something in the
#: arrangement rather than to understand a text. It is the one reading type
#: that needs the page kept as printed, which is why it is worth telling
#: apart when the other five are not.
READING_BY_NUMBER: dict[str, dict[int, str]] = {
    "N1": {13: "info_search"},
}


def _number(name: str) -> int | None:
    digits = re.sub(
        r"[^0-9]", "", name.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    )
    return int(digits) if digits else None


def type_by_number(level: str | None, section: str, problem_name: str) -> str | None:
    """The type this 問題 number means, or None where the number says nothing.

    The number decides which half of the written booklet it is in as well as
    what it is, so the section is only consulted to keep 聴解 out: its
    numbering starts over, and its 問題1 is not 漢字読み.

    Not taken from the section, because where 読解 begins is not reliably
    printed. 2013年07月 repeats 「読解」 as a divider inside the booklet and
    2016年12月 prints it only on the cover, so a split keyed on the word put
    that sitting's 問題8 to 問題13 under 言語知識 — and 問題13 was never
    recognised as 情報検索, so its page was not kept.
    """
    if "聴解" in section:
        return None
    number = _number(problem_name)
    if not number:
        return None
    return (BY_NUMBER.get(level or "", {}).get(number)
            or READING_BY_NUMBER.get(level or "", {}).get(number))


#: The four parts a paper is practised in. N1 runs 170 minutes and almost
#: nobody sits it whole, so the part is the unit someone actually picks up:
#: 文字・語彙 on a commute, 読解 at a desk.
#:
#: Derived from the question type rather than from the 問題 number, because the
#: app already scores accuracy in exactly these four buckets by type — a second
#: rule keyed on numbering could only drift away from the first. It also
#: survives a level whose numbering differs.
VOCAB = "言語知識（文字・語彙）"
GRAMMAR = "言語知識（文法）"
READING = "読解"
LISTENING = "聴解"

_PART_OF_TYPE = {
    "kanji_reading": VOCAB, "vocab_fill": VOCAB, "synonym": VOCAB, "usage": VOCAB,
    "grammar_fill": GRAMMAR, "sentence_order": GRAMMAR, "passage_fill": GRAMMAR,
    "reading_comp": READING, "info_search": READING,
    "listening": LISTENING,
}


def part_of_type(problem_type: str) -> str | None:
    """Which of the four parts this 問題 belongs to, or None if unrecognised."""
    return _PART_OF_TYPE.get(problem_type)


#: What a level's paper is, taken from the 公式問題集 rather than from the
#: reprints.
#:
#: The reprints are the only material there is enough of to build a bank
#: from, and they are retyped by hand: 2013年07月's 情報検索 lists its checks
#: as ①②②④⑤⑥⑦③⑤, and 第69題 asks about 「上記①〜⑨以外」. A shape learned
#: from thirty of them learns their mistakes too — the average of the
#: reprints is not the exam.
#:
#: This is read off 『日本語能力試験公式問題集 第二集』(2018), which is the
#: real thing, and used to check the reprints rather than to extract from
#: them. Its own booklets are typeset unlike the reprints — 読解 is set
#: vertically, the numbers are drawn in a font subsetted per page — so
#: reading them is a separate job that this deliberately does not do.
#:
#: 聴解's counts are what that sitting printed; a 番 more or less is normal
#: and only a large gap is worth a word. The written half does not vary.
N1_WRITTEN = {
    1: 6,    # 漢字読み            1–6
    2: 7,    # 文脈規定            7–13
    3: 6,    # 言い換え類義        14–19
    4: 6,    # 用法                20–25
    5: 10,   # 文法形式の判断      26–35
    6: 5,    # 文の組み立て        36–40
    7: 5,    # 文章の文法          41–45
    8: 4,    # 内容理解・短文      46–49
    9: 9,    # 内容理解・中文      50–58
    10: 4,   # 内容理解・長文      59–62
    11: 2,   # 統合理解            63–64
    12: 4,   # 主張理解・長文      65–68
    13: 2,   # 情報検索            69–70
}

N1_LISTENING = {
    1: 6,    # 課題理解
    2: 7,    # ポイント理解
    3: 6,    # 概要理解
    4: 14,   # 即時応答
    5: 4,    # 統合理解 — three 番, the last asking two questions
}

OFFICIAL_SHAPE = {"N1": {"written": N1_WRITTEN, "listening": N1_LISTENING}}


def expected_items(level: str | None, section: str, problem_name: str) -> int | None:
    """How many questions this 問題 holds on a real paper, if it is known."""
    shape = OFFICIAL_SHAPE.get(level or "")
    number = _number(problem_name)
    if not shape or not number:
        return None
    half = "listening" if section == "聴解" else "written"
    return shape[half].get(number)
