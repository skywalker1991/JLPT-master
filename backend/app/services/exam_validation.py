"""Check a parsed exam paper before a human is asked to look at it.

Extraction from PDF is more reliable than it feels — across the two N1 papers
already imported, every one of 214 items has exactly four options, a correct
answer, and the item counts match the standard shape. What it gets wrong is
quieter: one 並べ替え item lost its ★ (so it cannot be scored at all), and
問題7 landed under 言語知識（文法） in one paper and 読解 in the other from the
same input. Neither was caught by review.

So checks come in two kinds:

  HARD   Violates the definition of the question type, whatever the year.
         Four options, exactly one ★, contiguous numbering, an answer in
         range. These are worth re-running the問題 for, unattended.

  SOFT   Differs from papers of this level seen so far. Real papers do vary,
         so these only ask a human to confirm — and confirming teaches the
         baseline, so the same variation is not queried twice.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Literal

Severity = Literal["hard", "soft"]

#: Types whose stem must carry exactly one ★ marking the numbered blank.
STAR_TYPES = {"sentence_order"}

#: Listening items are often answered from audio alone, with nothing printed.
AUDIO_ONLY_TYPES = {"listening"}


def _booklet(problem: dict) -> str:
    """JLPT ships as two booklets, and 聴解 restarts its 問題 numbering at 1."""
    return "聴解" if problem.get("type") == "listening" else "筆記"


def _numbering_scope(problem: dict) -> str:
    """Where an item number has to be unique.

    In the written booklet numbering runs unbroken across every 問題 (1…59).
    In 聴解 each 問題 starts again at 一番, so uniqueness is only within the
    問題 — checking the booklet as a whole reports every listening item as a
    duplicate.
    """
    if problem.get("type") == "listening":
        return f"聴解 {problem.get('name')}"
    return "筆記"


def baseline_key(problem: dict) -> str:
    """問題1 exists in both booklets and means different things in each."""
    return f"{_booklet(problem)}/{problem.get('name')}"


@dataclass
class Finding:
    severity: Severity
    where: str          # e.g. "問題6 / 第39题"
    message: str
    problem_name: str | None = None   # which問題 to re-run, for hard findings


@dataclass
class Report:
    findings: list[Finding] = field(default_factory=list)

    @property
    def hard(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "hard"]

    @property
    def soft(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "soft"]

    @property
    def clean(self) -> bool:
        """Nothing at all — the paper can be imported without being looked at."""
        return not self.findings

    @property
    def problems_to_retry(self) -> list[str]:
        return sorted({f.problem_name for f in self.hard if f.problem_name})

    def add(self, severity: Severity, where: str, message: str, problem_name: str | None = None) -> None:
        self.findings.append(Finding(severity, where, message, problem_name))


def _option_count(options: Any) -> int:
    if isinstance(options, dict):
        return len(options)
    if isinstance(options, list):
        return len(options)
    return 0


def _expected_options(items: list[dict]) -> int:
    """How many options this 問題 prints per question.

    Four almost everywhere, but 聴解問題4 is 即時応答 — one line of audio and
    three replies — so a fixed four files thirteen findings a paper against
    questions that are perfectly correct. What is actually true is that the
    questions inside one 問題 all have the same number, so the 問題 is asked
    rather than told: the commonest count is the shape, and an item that
    departs from it is the one worth looking at.
    """
    counts = Counter(
        n for n in (_option_count(i.get("options")) for i in items) if n
    )
    return counts.most_common(1)[0][0] if counts else 4


def check_hard(paper: dict) -> Report:
    """Violations of what a question type means. Year-independent."""
    report = Report()
    seen_nums: dict[str, Counter[int]] = {}

    for section in paper.get("sections") or []:
        for problem in section.get("problems") or []:
            pname = problem.get("name") or "?"
            ptype = problem.get("type") or ""
            items = problem.get("items") or []

            if not items:
                report.add("hard", pname, "题组没有任何小题", pname)
                continue

            expected_opts = _expected_options(items)

            for item in items:
                num = item.get("num")
                where = f"{pname} / 第{num}题"
                if num is None:
                    report.add("hard", pname, "小题缺 num", pname)
                else:
                    seen_nums.setdefault(_numbering_scope(problem), Counter())[num] += 1

                # Audio-only listening items legitimately print no options.
                n_opts = _option_count(item.get("options"))
                if ptype in AUDIO_ONLY_TYPES and n_opts == 0:
                    pass
                elif n_opts != expected_opts:
                    report.add(
                        "hard", where,
                        f"选项数为 {n_opts}，同组其他题是 {expected_opts}", pname,
                    )

                answer = str(item.get("correct_answer") or "")
                if not answer:
                    report.add("hard", where, "缺正确答案", pname)
                elif answer not in {"1", "2", "3", "4"}:
                    report.add("hard", where, f"正确答案「{answer}」不在 1-4 内", pname)

                if ptype in STAR_TYPES:
                    stars = (item.get("stem") or "").count("★")
                    if stars != 1:
                        report.add(
                            "hard", where,
                            f"排序题的 ★ 出现 {stars} 次，应恰好 1 次——缺了就无法判分",
                            pname,
                        )

    for scope, nums_seen in seen_nums.items():
        for num, count in sorted(nums_seen.items()):
            if count > 1:
                report.add("hard", f"{scope} 第{num}题", f"题号重复出现 {count} 次")
        nums = sorted(nums_seen)
        missing = [n for n in range(nums[0], nums[-1] + 1) if n not in nums_seen]
        if missing:
            preview = ", ".join(map(str, missing[:10]))
            more = f" 等 {len(missing)} 个" if len(missing) > 10 else ""
            report.add("hard", scope, f"题号不连续，缺 {preview}{more}")

    return report


def check_soft(paper: dict, baseline: dict[str, dict] | None) -> Report:
    """Differences from papers of this level seen before. Papers really do
    vary, so these ask rather than block; with no baseline yet, everything is
    new and nothing is worth asking about."""
    report = Report()
    if not baseline:
        return report

    for section in paper.get("sections") or []:
        for problem in section.get("problems") or []:
            pname = problem.get("name") or "?"
            known = baseline.get(baseline_key(problem))
            if known is None:
                report.add("soft", pname, "这个問題在该级别的已有卷子中没见过，请确认题型")
                continue

            count = len(problem.get("items") or [])
            if count != known["item_count"]:
                report.add(
                    "soft", pname,
                    f"本卷 {count} 题，该级别以往是 {known['item_count']} 题",
                )
            ptype = problem.get("type")
            if ptype != known["type"]:
                report.add("soft", pname, f"题型为 {ptype}，以往是 {known['type']}")
            if section.get("name") != known["section"]:
                report.add(
                    "soft", pname,
                    f"归在「{section.get('name')}」，以往归在「{known['section']}」",
                )

    present = {
        baseline_key(p)
        for s in paper.get("sections") or []
        for p in s.get("problems") or []
    }
    for key in baseline:
        if key not in present:
            report.add("soft", key, "该级别以往有这个問題，本卷没有")

    return report


def validate(paper: dict, baseline: dict[str, dict] | None = None) -> Report:
    report = check_hard(paper)
    report.findings.extend(check_soft(paper, baseline).findings)
    return report


def learn_baseline(papers: list[dict]) -> dict[str, dict]:
    """The shape of a level, taken from papers already accepted for it.

    Papers vary, so the most common value wins rather than the first or last;
    each confirmed paper makes the baseline a little less likely to nag about
    a variation that is in fact normal.
    """
    counts: dict[str, Counter] = {}
    types: dict[str, Counter] = {}
    sections: dict[str, Counter] = {}

    for paper in papers:
        for section in paper.get("sections") or []:
            for problem in section.get("problems") or []:
                if not problem.get("name"):
                    continue
                key = baseline_key(problem)
                counts.setdefault(key, Counter())[len(problem.get("items") or [])] += 1
                types.setdefault(key, Counter())[problem.get("type")] += 1
                sections.setdefault(key, Counter())[section.get("name")] += 1

    return {
        pname: {
            "item_count": counts[pname].most_common(1)[0][0],
            "type": types[pname].most_common(1)[0][0],
            "section": sections[pname].most_common(1)[0][0],
            "seen_in": sum(counts[pname].values()),
        }
        for pname in counts
    }
