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


def _number(name: str) -> int | None:
    digits = re.sub(
        r"[^0-9]", "", name.translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    )
    return int(digits) if digits else None


def type_by_number(level: str | None, section: str, problem_name: str) -> str | None:
    """The type this 問題 number means, or None where the number says nothing."""
    if section != "言語知識":
        return None
    number = _number(problem_name)
    return BY_NUMBER.get(level or "", {}).get(number) if number else None
