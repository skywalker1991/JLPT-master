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
from collections import Counter
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

**最重要：stem 和 options 必须逐字照抄原文**，不改写、不补全、不修正错别字、不调整标点。
提取结果会和原文做逐字比对，对不上的会被打回。

已知的坑（都真实出现过，请逐条注意）：

1. 题号写法不统一：可能是「1」「1.」「１．」「(1)」。num 只填数字，不要带符号。
1b. 原文里 __这样包起来的词__ 是试卷上加了下划线的地方，标出题目问的是哪个词。
   **必须原样保留这对下划线标记**，它决定了这道题在问什么。
2. 选项可能排成 2×2（1、2 在一行，3、4 在下一行）。按 1234 的编号读，
   不要按视觉上的列去读，否则会变成 1、3、2、4。
3. 排序题（問題6 一类）：stem 里的空格写成 [_1_] [_2_] [_3_] [_4_]，
   ★ 所在的那个空写成 [_N★_]，并在 meta.star_position 填该空序号（1-4）。
   ★ 决定答案填哪个空，丢了这道题就无法判分。
4. 聴解「N番」下若有「質問1」「質問2」两问，算**两个**小题，num 按番号顺延，
   meta 记 {{"ban": 番号, "question": 第几问}}。这时番数和小题数不相等。
5. 聴解有些題組试卷上什么都不印：
   - 若只列了「1番 2番 3番…」，就按列出的番号产出对应数量的空小题（stem 和 options 留空）
   - 若连番号都没列，**产出空的 items 数组**，不要根据说明文字推测有几题
   绝不要凭空补出没有依据的小题。
6. 読解的「（注）…」是正文的一部分，属于 passage，不是页眉页脚，不要丢。
7. 页码、「（1*6）」这类配分标记不属于任何字段，忽略即可。
8. 若本题组有共同的文章或指示语，放进 passage / instruction，不要重复进每个小题。

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
    text = text.replace("__", "")      # the underline marker, added on both sides
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


#: An item number as papers print them: at the start of a line, one or two
#: digits, optionally followed by a separator. Deliberately loose — this is
#: counting, not parsing, and a false positive costs a query while a missed one
#: costs a question.
_ITEM_NUMBER = re.compile(r"(?:^|\n)\s*([0-9]{1,2}|[０-９]{1,2})\s*[.．、]?\s*(?=\S)", re.M)


def check_missing_items(problem: CanonicalProblem, source: str) -> list[str]:
    """Numbers printed in the source that never became an item.

    Every other check passes when the model simply skips a question: verbatim
    matching has nothing to say about text that was not returned, and the
    structural rules only inspect what is there. Counting the numbers on the
    page catches a dropped item whatever the reason — a layout nobody
    anticipated, a page break, a long passage running out of attention — which
    is what enumerating traps in a prompt can never do.
    """
    if not problem.items:
        return []

    extracted = {i.num for i in problem.items if i.num is not None}
    if not extracted:
        return []

    printed = set()
    for match in _ITEM_NUMBER.finditer(source):
        value = int(match.group(1).translate(str.maketrans("０１２３４５６７８９", "0123456789")))
        printed.add(value)

    # Only numbers inside the run this 問題 covers: option markers and page
    # numbers use the same shapes, and nothing outside the range is ours.
    low, high = min(extracted), max(extracted)
    expected = {n for n in printed if low <= n <= high}
    missing = sorted(expected - extracted)
    if not missing:
        return []
    return [
        f"{problem.name}：原文中出现了第 {', '.join(map(str, missing[:10]))} 题的编号，"
        f"但没有提取到对应的小题"
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
        check_verbatim(problem, block.text)
        + check_invented_blanks(problem, block.text)
        + check_missing_items(problem, block.text)
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


#: How a cloze blank is written once it has been found. The paper prints it as
#: a bare number in the running text — 「テレビを 41 と書いていた」 — which is
#: indistinguishable from any other number until the item numbers say which
#: ones are blanks.
BLANK = "【{}】"

_STANDALONE = re.compile(r"(?<![0-9０-９])([0-9０-９]{1,3})(?![0-9０-９])")


def mark_blanks(problem: CanonicalProblem) -> list[str]:
    """Mark the cloze blanks in a passage, and say which ones are not there.

    短文填空 prints its questions inside the passage rather than as stems, so
    every item comes out of extraction with an empty stem and the reader is
    left with five sets of options and no way to tell which gap each belongs
    to. The gaps are the item numbers, printed in order, so they can be found
    without asking a model — and a number that is not there is worth saying,
    because it means the passage lost a gap on the way in.
    """
    nums = [i.num for i in problem.items if i.num is not None]
    if not problem.passage or not nums:
        return []

    wanted = set(nums)
    seen: Counter[int] = Counter()

    def replace(match: re.Match) -> str:
        number = int(match.group(1).translate(str.maketrans("０１２３４５６７８９", "0123456789")))
        if number not in wanted:
            return match.group(0)
        seen[number] += 1
        # Only the first: a footnote marker or a figure could repeat the
        # number later, and the gap is the one printed first.
        return BLANK.format(number) if seen[number] == 1 else match.group(0)

    problem.passage = _STANDALONE.sub(replace, problem.passage)

    return [
        f"第{num}题：文章里找不到对应的空"
        for num in nums if not seen[num]
    ]


#: How a paper separates several texts printed under one 問題: a bracketed
#: number on its own line, or a bare A / B for the 意見文 pair. Half and full
#: width both appear, sometimes in the same 問題 — 2018年07月's 問題8 runs
#: (1) (2) (3) （４）.
_SEPARATOR = re.compile(
    r"(?:^|\n)[^\S\n]*(?:[(（][0-9０-９][)）]|[ABＡＢ])[^\S\n]*(?=\n)"
)


def _segments(text: str) -> list[str]:
    """The text cut at its separators, the first piece dropped as preamble."""
    cuts = [m.start() for m in _SEPARATOR.finditer(text)]
    if len(cuts) < 2:
        return []
    bounds = cuts + [len(text)]
    return [text[bounds[i]:bounds[i + 1]].strip() for i in range(len(cuts))]


def _where(num: int, stem: str, source: str) -> int | None:
    """Where in the source this question is printed.

    The number at the start of a line is how every paper opens a question. It
    can also occur inside a passage, so the stem decides between candidates —
    and the number alone is the fallback, because a stem the model tidied would
    otherwise lose the question its position.
    """
    opening = re.compile(rf"(?:^|\n)[^\S\n]*{num}(?![0-9])[^\S\n]*[、.．]?[^\S\n]*(?=\S)")
    hits = [m.start() for m in opening.finditer(source)]
    if not hits:
        return None
    head = normalise(stem)[:6]
    if head:
        for hit in hits:
            if head in normalise(source[hit:hit + 120]):
                return hit
    return hits[0]


def split_passages(problem: CanonicalProblem, source: str) -> list[str]:
    """Give each question the one text it is about.

    読解問題8 prints four unrelated passages under a single heading, 問題9
    three, and 問題11 an A and a B. Extraction returns them as one `passage`,
    which is faithful to the page and useless to answer from: 第46题 is about
    the first of the four and shows all four.

    Split on the page's own separators rather than on meaning, and place each
    question by where its number is printed. Nothing is assigned unless every
    question lands and the passage cuts the same way the source does — a
    partial split is worse than none, because a question shown the wrong text
    looks answerable and is not.
    """
    if not problem.passage or len(problem.items) < 2:
        return []

    in_source = _segments(source)
    in_passage = _segments(problem.passage)
    if len(in_source) < 2 or len(in_source) != len(in_passage):
        return []

    bounds = [source.index(seg[:20]) if seg[:20] in source else -1 for seg in in_source]
    if any(b < 0 for b in bounds):
        return []

    placed: dict[int, int] = {}
    for index, item in enumerate(problem.items):
        if item.num is None:
            return []
        at = _where(item.num, item.stem, source)
        if at is None:
            return [f"{problem.name}：第{item.num}题在原文中找不到，无法判断属于哪一篇"]
        # The question belongs to the last text that starts before it.
        which = max((i for i, b in enumerate(bounds) if b <= at), default=None)
        if which is None:
            return [f"{problem.name}：第{item.num}题排在第一篇文章之前"]
        placed[index] = which

    # Several texts under one heading do not always mean several questions'
    # worth of reading. 問題8 prints four unrelated passages, each with its own
    # question after it; 問題11 prints an A and a B on one topic and then asks
    # how they compare, so both questions need both texts and neither text has
    # a question of its own. What separates them is exactly that: a text with
    # no question after it is not a text anyone is asked about alone.
    if len(set(placed.values())) != len(in_passage):
        return []

    for index, which in placed.items():
        problem.items[index].passage = in_passage[which]
    return []
