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
from dataclasses import dataclass, field

#: Where the booklet stops explaining the written half.
_SECTION = re.compile(r"[听聴][⼒力][原⽂文]{2}|[听聴][⼒力]解析")

#: 問題N heading on its own line, in either script.
_PROBLEM = re.compile(r"(?:^|\n)\s*(?:問題|问题)\s*([1-5１-５])\s*(?=\n|$)")

#: "1 番" begins a question. The answer may follow on the same line, on the
#: next one, or not at all — 2018年07月 breaks after 番, 2019年12月 does not,
#: and 2019年07月 goes straight into the options and states answers elsewhere.
#: So the 番 is the anchor and the answer is optional.
#:
#: The particle guard keeps 「一番好きな」 in a transcript from reading as a
#: heading, but it has to stay narrow: 問題5's 「3 番 まず話を聞いてください」
#: carries a を four characters later, and a wider window swallowed that
#: question whole.
_BAN = re.compile(r"(?:^|\n)\s*([0-9０-９]{1,2})\s*番(?![^\n]{0,2}[はにをがのでと])")
_ANSWER_AFTER = re.compile(r"^\s*(?:正解|答案)\s*[：:]\s*([1-4])")

#: The options printed under it, "１ ちぎれた部分を探す".
_OPTION = re.compile(r"(?:^|\n)\s*([1-4１-４])\s*[．.、]?\s*(\S[^\n]{0,60})")

#: A line of dialogue: speaker, then what they said.
_SPEECH = re.compile(r"(?:^|\n)\s*([男女⼥]\d?|M|F)\s*[：:]")

#: Some booklets print the whole listening section twice, once in Japanese and
#: once translated — 2019年12月 does, which read as every 番 existing twice.
#: The translation is worth keeping, just not as more questions.
#: Variant forms matter: the text layer uses Kangxi radicals (⼒ ⽂ ⼒) where
#: the ordinary characters would be expected, so both have to be accepted.
_TRANSLATION = re.compile(r"[听聴][⼒力][原⽂文]{2}翻译|[原⽂文]{2}翻译|翻译\s*$", re.M)


def _digits(raw: str) -> str:
    return raw.translate(str.maketrans("０１２３４５６７８９", "0123456789"))


@dataclass
class ListeningItem:
    problem: int          # 問題1..5
    ban: int              # 番 within that 問題
    answer: str | None
    options: dict[str, str] = field(default_factory=dict)
    transcript: str = ""


def listening_section(text: str) -> tuple[str, str]:
    """The listening half, split into the Japanese and its translation.

    Returns (japanese, translation); the second is empty when the booklet does
    not carry one.
    """
    match = _SECTION.search(text)
    if not match:
        return "", ""
    body = text[match.start():]
    translated = _TRANSLATION.search(body)
    if translated:
        return body[: translated.start()], body[translated.start():]
    return body, ""


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


def _take_options(lines: list[str], *, reverse: bool = False) -> tuple[dict[str, str], int]:
    """A run of consecutively numbered options taken from one end of the block."""
    options: dict[str, str] = {}
    sequence = list(reversed(lines)) if reverse else lines
    taken = 0

    if reverse:
        # Read backwards the run has to end at 1, but may start at 3 or 4.
        want = None
        for line in sequence:
            if options and _is_page_number(line):
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
            elif options:
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


def _clean(transcript: str) -> str:
    return "\n".join(l for l in transcript.split("\n") if not _is_page_number(l))


def parse_listening(text: str) -> list[ListeningItem]:
    """Every 番 in the booklet, with its answer, options and dialogue."""
    section, _translation = listening_section(text)
    if not section:
        return []

    # 問題 boundaries first, so a 番 is attributed to the right one — numbering
    # restarts at 一番 in every 問題.
    problems = [(m.start(), int(_digits(m.group(1)))) for m in _PROBLEM.finditer(section)]
    if not problems:
        return []

    def problem_at(position: int) -> int:
        current = problems[0][1]
        for start, number in problems:
            if start > position:
                break
            current = number
        return current

    hits = list(_BAN.finditer(section))
    items: list[ListeningItem] = []
    for index, match in enumerate(hits):
        end = hits[index + 1].start() if index + 1 < len(hits) else len(section)
        body = section[match.end():end]
        # A 問題 heading inside this stretch means the 番 ended there.
        heading = _PROBLEM.search(body)
        if heading:
            body = body[:heading.start()]

        answer = None
        found = _ANSWER_AFTER.match(body.lstrip("\n"))
        if found:
            answer = found.group(1)
            body = body.lstrip("\n")[found.end():]

        options, transcript = _options_and_transcript(body)
        items.append(ListeningItem(
            problem=problem_at(match.start()),
            ban=int(_digits(match.group(1))),
            answer=answer,
            options=options,
            transcript=_clean(transcript),
        ))
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
