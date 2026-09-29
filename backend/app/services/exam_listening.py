"""Take the listening half of a paper out of the 解析 booklet.

The question paper barely carries it. 聴解問題3 and 問題4 print nothing at all
— "問題３では、問題用紙に何も印刷されていません" — so a sitting imported from
the 試題 alone is missing nineteen questions outright, and the rest have
options but never the dialogue.

The booklet has all of it: per 番, the answer, the printed options, the scene,
the exchange, and the question asked at the end. It is regular enough to cut
deterministically, which keeps the model out of a step where a misplaced
boundary would attach one dialogue to another's question.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

#: Where the booklet stops explaining the written half.
#:
#: Measured across thirty sittings rather than guessed from three: twenty of
#: them head it 「听力文本」 and the rest 「听力原文」 or 「听力解析」. The word
#: after 听力 is the only thing that varies, so it is the only thing left open.
#: Matched on NFKC-folded text, which retires the Kangxi-radical variants
#: (⼒ ⽂) these PDFs are full of.
_SECTION = re.compile(r"[听聴]力\s*(?:原文|文本|解析|原稿)")

#: 問題N heading on its own line. 2014年7月 writes the Chinese 问题 and puts
#: the number on the same line as what follows, so the line-end anchor has to
#: give way to "nothing but the heading up to here".
#:
#: Matched a character at a time rather than as either whole word, because
#: these reprints mix the two scripts inside it: 2023年7月 and 2024年7月
#: write 「問题」, the Japanese 問 with the simplified 题. Read as 問題 or
#: 问题 and nothing else, those two headings went unseen and their 番 were
#: counted under the 問題 before them — thirteen questions in one, none in
#: the other. A colon may follow the number too, as 2015年12月 writes it.
#: A short title may follow on the same line — 2010年07月 heads 「問題4
#: 応答問題」, and missing it put fourteen 番 of 問題4 under 問題3.
_PROBLEM = re.compile(
    r"(?:^|\n)\s*[問问][題题]\s*([1-5１-５])\s*(?=[\n。、.：:]|$|[^\n]{0,8}問題[^\S\n]*\n)"
)

#: "1 番" begins a question. The answer may follow on the same line, on the
#: next one, or not at all — 2018年07月 breaks after 番, 2019年12月 does not,
#: and 2019年07月 goes straight into the options and states answers elsewhere.
#: So the 番 is the anchor and the answer is optional.
#:
#: The particle guard keeps 「一番好きな」 in a transcript from reading as a
#: heading, but it has to stay narrow: 問題5's 「3 番 まず話を聞いてください」
#: carries a を four characters later, and a wider window swallowed that
#: question whole.
#: 「1 番」, 「1番：」 — 2020年12月 puts a colon after it. The colon is allowed
#: but not required, and the particle guard is skipped when one is present,
#: since 「一番好きな」 never carries one. Likewise a space: 2010年07月 writes
#: 「1 番 女の人が…」, which the guard read as 番の and refused.
#:
#: 2020年12月's booklet also runs one question into the next without a
#: break — 「…なければなりませんか。4 番：会社で」 — and a heading only at a
#: line start let 3番 swallow 4番 whole. After a sentence end it counts too,
#: but only with the colon, which 「。3番目の」 in a dialogue never has.
_BAN = re.compile(
    r"(?:(?:^|\n)\s*|(?<=[。？?])[^\S\n]*(?=[0-9０-９]{1,2}\s*番\s*[：:]))"
    r"([0-9０-９]{1,2})\s*番(?:\s*[：:]|(?=[^\S\n])|(?![^\n]{0,2}[はにをがのでと]))"
)
#: An answer line, printed on a line of its own.
#:
#: Where it sits is not fixed and cannot be assumed: 2013年07月 puts it right
#: under the 番, 2011年12月 after the four options, and 2010年12月 at the very
#: end, past the question. What holds everywhere is that it occupies a whole
#: line — no line of dialogue is 「正解：2」 — so it is found by shape rather
#: than by position, and removed wherever it turns up. Leaving it in puts the
#: answer into the audio, which is then read aloud before the question.
#:
#: The variants, all real: the digit may be full width (2021年07月 writes
#: 「正解：３」, and an ASCII [1-4] missed it in eleven of thirty-five
#: booklets); 問題5's 統合理解 asks two questions about one conversation and
#: prints 「質問１正解：１」「質問２正解：４」, sometimes as 「質問１：正解：１」,
#: sometimes with the 問 misprinted as 間, and 2010年12月 puts both on one
#: line as 「答案：2、4」. 2012年07月 runs the dialogue on from it without a
#: break — 「正解：3 会社で男の⼈と…」 — so what follows the digits is kept
#: rather than the whole line being dropped.
_ANSWER_LINE = re.compile(
    r"^[^\S\n]*(?:[質质][問问間间]\s*[0-9０-９]\s*[：:]?\s*)?"
    r"(?:正解|答案|答え)\s*[：:]\s*([0-9０-９])"
    r"(?:\s*[、,，]\s*([0-9０-９]))?(?=[^\S\n]|$)"
)

#: The options printed under it, "１ ちぎれた部分を探す".
_OPTION = re.compile(r"(?:^|\n)\s*([1-4１-４])\s*[．.、]?\s*(\S[^\n]{0,60})")

#: A line of dialogue: speaker, then what they said.
_SPEECH = re.compile(r"(?:^|\n)\s*([男女⼥]\d?|M|F)\s*[：:]")

#: Kana. A Japanese transcript is full of them and a Chinese translation of it
#: has none, which is what tells the two halves apart — the words printed
#: between them cannot. 2023年7月 heads the whole section
#: 「听力原文翻译」, so a rule keyed on 「翻译」 fires at the title and calls
#: all 18,000 characters of Japanese a translation.
_KANA = re.compile(r"[ぁ-んァ-ヶ]")


def _kana_ratio(text: str) -> float:
    if not text:
        return 0.0
    return len(_KANA.findall(text)) / len(text)


def _digits(raw: str) -> str:
    return raw.translate(str.maketrans("０１２３４５６７８９", "0123456789"))


@dataclass
class ListeningItem:
    problem: int          # 問題1..5
    ban: int              # 番 within that 問題
    answer: str | None
    options: dict[str, str] = field(default_factory=dict)
    transcript: str = ""
    #: One per question this 番 asks. Usually one; 問題5's 統合理解 asks two
    #: about a single conversation, and they have different answers.
    answers: list[str] = field(default_factory=list)
    #: Where the 番 begins in the whole text it was read from, so the page it
    #: sits on can be named. The dialogue, its answer and — for the 問題 the
    #: paper prints nothing for — its options all come from here, not from
    #: the question paper.
    at: int = 0


def _folded(text: str) -> str:
    """The text as a pattern should see it, character for character.

    These PDFs write CJK as Kangxi radicals — 听⼒原⽂ is U+2F12 and U+2F42,
    not the characters anyone would type — so a pattern matching 力 or 文
    misses them. NFKC maps the radicals onto the ordinary ideographs.

    Only for finding things. What is returned to the caller is sliced out of
    the original, because the same fold would turn 「１・２・３・４」 half
    width and that is the paper's own text.

    Which is why this folds one character at a time and keeps any whose
    replacement is not also one character. Folding the whole string does not
    preserve offsets: 2013年07月's 解析 has eighteen 「…」, and NFKC writes
    each as three dots. Two of them fall before the 聴解 heading, so a cut
    made at a folded offset landed four characters late and ate the 「問」 of
    「問題 1」 — leaving its six transcripts to be counted under 問題2, and
    six questions in the paper with no transcript at all.

    The control character U+0001 these PDFs put at line ends is read as a
    space: 2010年07月 writes 「1\x01 番」, and a digit, a control character
    and 番 is not a heading to any pattern — its whole 問題1 went unseen.
    """
    return "".join(
        " " if ch == "\x01" else
        folded if len(folded := unicodedata.normalize("NFKC", ch)) == 1 else ch
        for ch in text
    )


def listening_section(text: str) -> tuple[str, str]:
    """The listening half, split into the Japanese and its translation.

    Returns (japanese, translation); the second is empty when the booklet does
    not carry one.
    """
    match = _SECTION.search(_folded(text))
    if not match:
        return "", ""
    body = text[match.start():]

    # Where the Japanese stops and its translation begins. Found by looking
    # for the point after which there is no more kana, rather than for a word
    # saying so: some booklets print 「听力原文翻译」 as the heading of the
    # whole section, and some print nothing at the join at all.
    window = 400
    blocks = [(i, body[i:i + window]) for i in range(0, len(body), window)]
    japanese = [i for i, block in blocks if _kana_ratio(block) > 0.05]
    if not japanese:
        return "", body
    end = japanese[-1] + window
    if end >= len(body) - window:
        return _trim_furniture(body), ""
    return _trim_furniture(body[:end]), body[end:]


def _trim_furniture(japanese: str) -> str:
    """Drop what the page carries after the last thing anyone says.

    The boundary above is found 400 characters at a time, which is coarse
    enough to overshoot: the last 番 of 2013年07月 came out with 「2013 年7 月
    日语能力考试N1 听力原文翻译」 on the end — the page header and the title
    of the section that follows, sitting inside the dialogue that is read
    aloud. Japanese is what is spoken, so a trailing line with no kana in it
    is furniture.
    """
    lines = japanese.split("\n")
    while lines and not _KANA.search(lines[-1]):
        lines.pop()
    return "\n".join(lines)


#: The page number, printed on its own line. It falls wherever the page breaks,
#: which is regularly between two options — "1 … / 50 / 2 …" — and a run of
#: options read as consecutive ends there, leaving the rest inside the
#: transcript. Nothing else in the booklet is a line of bare digits.
def _is_page_number(line: str) -> bool:
    return _digits(line.strip()).isdigit()


#: 問題4 is 即時応答: one line of audio and three replies, not four. Demanding
#: a full set leaves its third option inside the transcript and the transcript
#: inside the options.
MIN_OPTIONS = 3


#: …or the instructions for the next 番, 「まず話を聞いてください。…問題用紙の
#: 1から4の中から…選んでください」 (2018年12月 問題5).
_AFTER_OPTIONS = re.compile(
    r"^\s*(?:番|[問问][題题]\s*[0-9０-９].*|[質质][問问]\s*[0-9０-９２].*"
    r"|.*(?:問題[用⽤]紙|選んでください|話を聞いてください).*)\s*$"
)


def _take_options(lines: list[str], *, reverse: bool = False) -> tuple[dict[str, str], int]:
    """A run of consecutively numbered options taken from one end of the block."""
    options: dict[str, str] = {}
    sequence = list(reversed(lines)) if reverse else lines
    taken = 0

    if reverse:
        # Read backwards the run has to end at 1, but may start at 3 or 4.
        want = None
        for line in sequence:
            # A page number can come after the last option too — 2010年07月's
            # 「３、…／49」 — and read as an option it was 「4 = 9」, and the
            # transcript was cut a line short. Above 4 it cannot be an option.
            if _is_page_number(line) and (options or int(_digits(line.strip())) > 4):
                taken += 1
                continue
            # Nor is what can follow the last option before the next 番: a
            # stray 「番」, the next heading 「問題4 応答問題」 (2010年07月), the
            # 「質問２ …」 of a two-question 番.
            if not options and _AFTER_OPTIONS.match(line):
                taken += 1
                continue
            match = _OPTION.match("\n" + line)
            number = _digits(match.group(1)) if match else None
            if number and (want is None or number == str(want)):
                if want is None:
                    want = int(number)
                options[number] = match.group(2).strip()
                taken += 1
                want -= 1
                if want == 0:
                    break
            else:
                # Trailing means at the end. Scanning on up past the dialogue
                # found the set printed before it — 2018年07月 問題5 3番 — and
                # cut the transcript by a count that never included the lines
                # skipped on the way.
                break
        return (options if len(options) >= MIN_OPTIONS and "1" in options else {}), taken

    want = 1
    for line in sequence:
        if options and _is_page_number(line):
            taken += 1
            continue
        match = _OPTION.match("\n" + line)
        if match and _digits(match.group(1)) == str(want):
            options[str(want)] = match.group(2).strip()
            taken += 1
            want += 1
            if want > 4:
                break
        else:
            # Leading options start on the block's first line. Scanning past
            # the dialogue to find the set printed after it would report those
            # as leading, and cut the transcript from the wrong end.
            break
    return options, taken


def _options_and_transcript(body: str) -> tuple[dict[str, str], str]:
    """Split one 番 into its printed options and the dialogue.

    Which end the options sit at depends on the question type. 問題1, 2 and 5
    print them before the audio because they are read while listening; 問題3 is
    概要理解, where the options are only given afterwards, so they follow the
    transcript. Assuming one order empties the transcript of every 問題3.
    """
    lines = [l for l in body.split("\n") if l.strip()]

    leading, taken = _take_options(lines)
    if len(leading) >= MIN_OPTIONS:
        return leading, "\n".join(lines[taken:]).strip()

    trailing, taken_back = _take_options(lines, reverse=True)
    if len(trailing) >= MIN_OPTIONS:
        return trailing, "\n".join(lines[: len(lines) - taken_back]).strip()

    # Neither end has a full set — keep whichever was found and all the text,
    # rather than cutting the transcript on a guess.
    return (leading or trailing), "\n".join(lines[taken:] if leading else lines).strip()


def _take_answers(body: str) -> tuple[list[str], str]:
    """Pull every answer line out of one 番, and say what they were.

    Taken out before the options are read, so that removing a line from
    between the options and the dialogue puts the two back together — which
    is the order 2011年12月 prints them in.
    """
    answers: list[str] = []
    kept: list[str] = []
    for line in body.split("\n"):
        found = _ANSWER_LINE.match(line)
        if not found:
            kept.append(line)
            continue
        answers.extend(_digits(d) for d in found.groups() if d)
        rest = line[found.end():].strip()
        if rest:
            kept.append(rest)
    return answers, "\n".join(kept)


def _clean(transcript: str) -> str:
    return "\n".join(l for l in transcript.split("\n") if not _is_page_number(l))


#: How a 問題 heading is written where the booklet does not use digits:
#: 2013年12月 heads its listening 「問題⼀」「問題⼆」.
_CJK_NUM = {c: i for i, c in enumerate("一二三四五六七八九", start=1)}
_PROBLEM_CJK = re.compile(
    r"(?:^|\n)\s*[問问][題题]\s*([一二三四五六七八九])\s*(?=[\n。、.：:]|$)"
)

#: An item marker where the booklet does not print 「N番」. All three real
#: forms are a number at the head of a line and then something that is not
#: more text: 2014年07月 writes 「1.」, 2015年07月 「1、正解：3」, and
#: 2013年12月 the number by itself.
#: 2014年07月 also writes a bare 「17 テレビのニュースでアナウンサーが話して…」.
#: A number and a space is how an option line looks too — 「1  ペットが…」 —
#: so that form counts only where the line goes on to set the scene, which
#: an option never does.
_LOOSE_BAN = re.compile(
    r"(?:^|\n)[^\S\n]*([0-9０-９]{1,2})"
    r"(?:[^\S\n]*(?:[、.．]|(?=\n)|(?=[^\S\n]*(?:正解|答案)))|[^\S\n]+(?=[^\n]*(?:話して|紹介して|ています)))"
)


#: What a marker may be numbered, under each of the two styles. A booklet
#: numbers its items either inside every 問題 — never past fourteen — or
#: straight through the section, which for N1 ends short of forty. Above
#: that it is the page: both are a number alone on a line, 2013年12月's
#: 「１」 is a question and its 「45」 is a page, and only the value separates
#: them.
MAX_BAN = 20
MAX_BAN_FLAT = 40


def _flat_ok(numbers: list[int]) -> bool:
    """Whether these are one run straight through rather than per 問題.

    2014年07月 numbers its transcript 1 to 37 with no 問題 heading at all,
    so there are no restarts to divide it by — which is left to the paper,
    the only thing here that knows how many questions each 問題 holds.
    """
    if not 25 <= len(numbers) <= 45:
        return False
    rising = sum(1 for a, b in zip(numbers, numbers[1:]) if b > a)
    return rising >= len(numbers) - 3 and numbers[0] == 1


def _runs_ok(numbers: list[int]) -> bool:
    """Whether these look like item numbers rather than something else.

    Item numbers restart at 1 in every 問題 and climb by one; a page number
    sequence does neither once the pages are filtered out by value. A marker
    can still go missing where the number failed to extract, so a few breaks
    are tolerated — but only a few, since tolerating many would accept any
    run of digits at all.
    """
    if len(numbers) < 25:
        return False
    runs = breaks = 0
    expect = 1
    for n in numbers:
        if n == 1:
            runs += 1
            expect = 2
        elif n == expect:
            expect += 1
        else:
            breaks += 1
            expect = n + 1
    return 3 <= runs <= 6 and breaks <= len(numbers) // 10


def parse_listening(text: str) -> list[ListeningItem]:
    """Every 番 in the booklet, with its answer, options and dialogue."""
    section, _translation = listening_section(text)
    if not section:
        return []
    # listening_section cuts from the heading on; offsets inside it are
    # offsets from there.
    heading = _SECTION.search(_folded(text))
    offset = heading.start() if heading else 0

    # 問題 boundaries first, so a 番 is attributed to the right one — numbering
    # restarts at 一番 in every 問題.
    folded = _folded(section)
    # Both spellings, merged rather than one or the other: 2013年12月 heads
    # its first two 「問題⼀」「問題⼆」 and the rest 「問題3」, and taking only
    # the digits loses where the first two begin.
    problems = sorted(
        [(m.start(), int(_digits(m.group(1)))) for m in _PROBLEM.finditer(folded)]
        + [(m.start(), _CJK_NUM[m.group(1)]) for m in _PROBLEM_CJK.finditer(folded)]
    )

    def problem_at(position: int) -> int:
        if not problems:
            return 0
        # Before the first heading is the 問題 before it: 2012年07月 opens
        # its transcript straight on 「1 番」 and heads only 問題2 onwards,
        # and counting those six under 問題2 made it thirteen.
        current = max(problems[0][1] - 1, 1)
        for start, number in problems:
            if start > position:
                break
            current = number
        return current

    hits = list(_BAN.finditer(folded))
    if len(hits) < 25:
        # No 「N番」 in this booklet, or too few to be the whole section.
        # Fall back to the looser marker, but only if what it finds is
        # shaped like item numbers rather than like page numbers.
        every = list(_LOOSE_BAN.finditer(folded))
        per_problem = [m for m in every if int(_digits(m.group(1))) <= MAX_BAN]
        flat = [m for m in every if int(_digits(m.group(1))) <= MAX_BAN_FLAT]
        if _runs_ok([int(_digits(m.group(1))) for m in per_problem]):
            hits = per_problem
        elif _flat_ok([int(_digits(m.group(1))) for m in flat]):
            # One run, so a number that does not carry it on is not a
            # heading: 2014年07月's 34番 has a line 「1、2回ぐらいのものが
            # いいですね」, and taken as a heading it cut 34番 short and
            # began a thirty-eighth question.
            rising = []
            for m in flat:
                if not rising or int(_digits(m.group(1))) > int(_digits(rising[-1].group(1))):
                    rising.append(m)
            hits, problems = rising, []     # the paper divides it, not the booklet
    items: list[ListeningItem] = []
    for index, match in enumerate(hits):
        end = hits[index + 1].start() if index + 1 < len(hits) else len(section)
        body = section[match.end():end]
        # A 問題 heading inside this stretch means the 番 ended there.
        heading = _PROBLEM.search(body)
        if heading:
            body = body[:heading.start()]

        answers, body = _take_answers(body)

        options, transcript = _options_and_transcript(body)
        items.append(ListeningItem(
            problem=problem_at(match.start()) if problems else 0,
            ban=int(_digits(match.group(1))),
            answer=answers[0] if answers else None,
            options=options,
            transcript=_clean(transcript),
            answers=answers,
            at=offset + match.start(),
        ))

    return _restart_problems(_drop_quoted_headings(items))


def _drop_quoted_headings(items: list[ListeningItem]) -> list[ListeningItem]:
    """The same 番 twice in a row is a heading quoted in the instructions.

    2018年12月's 問題5 explains itself as 「1 番、2 番 問題用紙に何も…」, and
    the real 1番 is the one with a dialogue under it.
    """
    kept: list[ListeningItem] = []
    for item in items:
        if kept and (kept[-1].problem, kept[-1].ban) == (item.problem, item.ban):
            if len(item.transcript) > len(kept[-1].transcript):
                kept[-1] = item
            continue
        kept.append(item)
    return kept


def _restart_problems(items: list[ListeningItem]) -> list[ListeningItem]:
    """A 番 numbering that starts again is the next 問題.

    A heading can go unread — 2010年07月 heads 問題3 and then 問題5, and
    fourteen 番 of 問題4 were counted under 問題3, leaving 問題4 with no
    dialogue at all. Numbering restarts at 1番 in every 問題, so where it
    restarts without a heading, one was there.
    """
    heading = current = last_ban = None
    for item in items:
        if not item.problem:
            continue
        if item.problem != heading:           # a heading that was read
            heading = current = item.problem
        elif item.ban <= last_ban:            # one that was not
            current += 1
        item.problem = current
        last_ban = item.ban
    return items


def pick_transcript_source(sources) -> object | None:
    """The uploaded file best suited to supplying the listening half.

    Not simply "the 解析": a sitting can carry several booklets, and what
    matters is which one actually holds the 聴解 section and the most of it.
    Judged on the Japanese part alone, since the translated copy that follows
    would otherwise let a thin file outweigh a complete one.
    """
    best, best_size = None, 0
    for source in sources:
        japanese, _ = listening_section(source.text or "")
        if len(japanese) > best_size:
            best, best_size = source, len(japanese)
    return best if best_size > 1000 else None


def has_dialogue(item: ListeningItem) -> bool:
    """Whether a transcript actually contains an exchange.

    A 番 whose body is only a scene line has lost its dialogue somewhere, and
    synthesising audio from it would produce a clip with nothing in it.
    """
    return len(_SPEECH.findall(item.transcript)) >= 2


def dialogue_for(item, siblings) -> str | None:
    """The conversation this question is asked about.

    Usually its own. 聴解問題5's 統合理解 plays one conversation and asks two
    questions about it — the booklet prints them under a single 番 — so it is
    stored once, on the first, and the second finds it here.

    The one place that knows this. Anything reading `item.transcript` straight
    gets nothing for the second question: no dialogue to speak, and none to
    explain the answer with.
    """
    if item.transcript:
        return item.transcript
    ban = (item.meta or {}).get("ban")
    if ban is None:
        return None
    for other in siblings:
        if other is item:
            break
        if (other.meta or {}).get("ban") == ban and other.transcript:
            return other.transcript
    return None
