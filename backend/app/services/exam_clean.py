"""Put the text into the characters it is meant to be written in.

These PDFs set a lot of their kanji as Kangxi radicals: 「⼈」 is U+2F08, not
the 人 anyone types. The two are identical on the page and different
everywhere else — searching for 人 does not find them, a dictionary lookup
misses, and the same word stored from two papers can be two different
strings.

Extraction has always folded them to match on and sliced from the original,
which is right for matching and wrong for keeping: what went into the bank
was the original, and 15,489 characters of it across 1,279 questions were
these.

Only that block is folded. Full-width punctuation is not a mistake — 「（）」
and 「：」 are how Japanese is written, and the paper's own 「１・２・３・４」
is its text. NFKC over the lot would turn all of it half-width, which is why
the fold has to be by code block rather than by whether NFKC changes
anything.
"""
from __future__ import annotations

import re
import unicodedata

#: Kangxi Radicals, and the CJK Radicals Supplement below it. Both exist to
#: write radicals in a dictionary; a radical inside a sentence is a
#: typesetting accident, every time.
RADICALS = ((0x2E80, 0x2EFF), (0x2F00, 0x2FDF))


#: The radicals Unicode gives no fold for. NFKC maps most of the two blocks
#: onto their ideograph and simply returns these unchanged, so they survived
#: the first pass — 395 occurrences of 「⻑」 alone, the radical form of 長,
#: which every 「社⻑」 and 「部⻑」 in the bank was written with.
#:
#: Read off the character's own Unicode name, which says what it draws: CJK
#: RADICAL LONG ONE is 長, CJK RADICAL CIVILIAN is 民. Listed rather than
#: derived because there is no property that gives the mapping, and twelve
#: entries covering everything in the corpus is smaller than the machinery
#: to look them up.
UNMAPPED = {
    "\u2ed1": "長",   # CJK RADICAL LONG ONE
    "\u2ea0": "民",   # CJK RADICAL CIVILIAN
    "\u2ec4": "西",   # CJK RADICAL WEST TWO
    "\u2ed8": "青",   # CJK RADICAL BLUE
    "\u2eed": "歯",   # CJK RADICAL J-SIMPLIFIED TOOTH
    "\u2ee9": "黄",   # CJK RADICAL SIMPLIFIED YELLOW
    "\u2ee4": "鬼",   # CJK RADICAL GHOST
    "\u2eeb": "斉",   # CJK RADICAL J-SIMPLIFIED EVEN
    "\u2ee8": "麦",   # CJK RADICAL SIMPLIFIED WHEAT
    "\u2eef": "竜",   # CJK RADICAL J-SIMPLIFIED DRAGON
    "\u2ef2": "亀",   # CJK RADICAL J-SIMPLIFIED TURTLE
    "\u2e92": "巳",   # CJK RADICAL SNAKE
}


def _is_radical(char: str) -> bool:
    point = ord(char)
    return any(low <= point <= high for low, high in RADICALS)


#: A run of COMBINING LONG STROKE OVERLAY. It is what the text layer makes of
#: a dash drawn as a line: 「事実は小説よりも奇なり」————と言われる comes
#: out as 「…奇なり」̶̶̶̶と — four strike-through marks hanging off the
#: closing quote, which strike through whatever they land on.
_STROKES = re.compile(r"\u0336+")
_WIDE_DIGIT = "０１２３４５６７８９"


def _dash(match: re.Match) -> str:
    """What the stroke stood for, told from what is either side of it.

    Between digits it is the hyphen in a telephone number — 「０２４̶８８１
    ̶６４５６」 — and anywhere else the long dash Japanese sets as 「――」.
    """
    text, start, end = match.string, match.start(), match.end()
    before = text[start - 1] if start else ""
    after = text[end] if end < len(text) else ""
    if before.isdigit() and after.isdigit():
        return "－" if before in _WIDE_DIGIT else "-"
    return "――"


#: Punctuation the text layer spells with a look-alike from another script.
#: The page shows the same mark either way; a search, a comparison, or a
#: reader copying the text does not. 2019年12月 was typeset for vertical
#: printing and gives its notes as 「交易︓ここでは」; 2012年12月 writes
#: 「ひこ•田中」 with a bullet; 2013年07月's 〈私〉 is the mathematical pair.
_LOOKALIKE = str.maketrans({
    "\ufe10": "，", "\ufe11": "、", "\ufe12": "。", "\ufe13": "：",
    "\ufe14": "；", "\ufe15": "！", "\ufe16": "？", "\ufe19": "…",
    "\u2329": "〈", "\u232a": "〉",
})

#: Japanese separates the parts of a name or a compound with 中黒 「・」.
#: Not applied to the Chinese translation, where 「·」 is the right mark.
_NAME_DOT = re.compile(r"[\u2022\u00b7]")
_MINUS = re.compile(r"\u2212")


def _dash_or_wide(match: re.Match) -> str:
    dash = _dash(match)
    return "－" if dash == "――" else dash


def clean(text: str | None, *, japanese: bool = True) -> str | None:
    """The text written in the characters it is meant to be written in.

    Radical code points as the kanji they draw, a dash the text layer
    turned into strike-through marks as the dash it was, and punctuation in
    the one spelling the bank uses for it.
    """
    if not text:
        return text
    if "\u0336" in text:
        text = _STROKES.sub(_dash, text)
    # A minus sign between digits is the hyphen in 「03−1234」, 「4−７歳」.
    if "\u2212" in text:
        text = _MINUS.sub(_dash_or_wide, text)
    if any(ord(c) in _LOOKALIKE for c in text):
        text = text.translate(_LOOKALIKE)
    if japanese and _NAME_DOT.search(text):
        text = _NAME_DOT.sub("・", text)
    if not any(_is_radical(c) for c in text):
        return text
    return "".join(
        UNMAPPED.get(c) or unicodedata.normalize("NFKC", c) if _is_radical(c) else c
        for c in text
    )


#: Print furniture the reader sets inside the text: the margin tabs
#: 「文字・語彙」「文法」「読解」 one character a line or at a line's end
#: (2024年07月 「…考えていた。 読\n解\n」), and furigana lines of spaced
#: kana groups (「いっし せんぱくあ」 over 一矢・浅薄). A line of one kana group
#: is left alone — a wrapped sentence can end a line that way.
_TAB_LINE = re.compile(r"(?m)^[^\S\n]*[⽂文字語彙法読解][^\S\n]*\n?")
_TAB_AT_END = re.compile(r"(?m)(?<=\S)[^\S\n]+[⽂文字語彙法読解][^\S\n]*$")
_RUBY_LINE = re.compile(r"(?m)^[^\S\n]*[ぁ-ゖ]+(?:[^\S\n]+[ぁ-ゖ]+)+[^\S\n]*\n?")


def strip_furniture(text: str | None) -> str | None:
    """The text without the margin tabs and furigana the page set into it."""
    if not text:
        return text
    stripped = _RUBY_LINE.sub("", _TAB_AT_END.sub("", _TAB_LINE.sub("", text)))
    return stripped if stripped != text else text


def clean_paper(paper) -> int:
    """Clean every piece of text on a paper. Returns how much moved."""
    moved = 0

    def fix(holder, field, japanese=True, furniture=False):
        nonlocal moved
        before = getattr(holder, field, None)
        after = clean(before, japanese=japanese)
        if furniture:
            after = strip_furniture(after)
        if after != before:
            setattr(holder, field, after)
            moved += 1

    for _section, problem in paper.problems():
        for field in ("instruction", "passage"):
            fix(problem, field, furniture=True)
        fix(problem, "transcript")
        fix(problem, "passage_translation", japanese=False)
        for item in problem.items:
            for field in ("stem", "passage"):
                fix(item, field, furniture=True)
            fix(item, "transcript")
            if item.options:
                options = {k: clean(v) for k, v in item.options.items()}
                if options != item.options:
                    item.options = options
                    moved += 1
    return moved
