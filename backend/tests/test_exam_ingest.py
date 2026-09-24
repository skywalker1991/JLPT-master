"""A sitting from files to a checked paper.

Ingest used to take one PDF, so a sitting arriving as 試題 + 解析 + 答案表
either went in incomplete or was assembled by hand. What each file is gets
worked out rather than asked for, and none of them is required: a question
paper alone is a perfectly good import that cannot be scored yet, and saying
so beats refusing it.

The model is stubbed here. What these check is the wiring — which file feeds
which step, what happens when one is absent, and that the report says enough
to act on.
"""
import asyncio

import pytest

from app.services import exam_ingest
from app.services.exam_canonical import (
    CanonicalItem, CanonicalPaper, CanonicalProblem, CanonicalSection,
)
from app.services.exam_extract import BlockResult
from app.services.exam_ingest import IngestReport, _pick, ingest, read_sources
from app.services.exam_sources import Role, Source

QUESTIONS = """
問題1 ＿＿の言葉の読み方として最もよいものを、１２３４から一つ選びなさい。
1. あの態度には猛烈に腹が立った。
1 もれつ 2 きょうれつ 3 きょれつ 4 もうれつ
"""

ANSWER_SHEET = """
2019 年7 月N1 答案
1-2
41
"""

EXPLANATIONS = """
文字解析
1 正解：4
解析：对那种态度激烈地生气了。
2 正解：1
"""


def source(text, role, name="f.pdf", pages=10, text_pages=10):
    s = Source(filename=name, page_count=pages, text_pages=text_pages, text=text)
    s.role = role
    return s


def stub_pipeline(monkeypatch, *, items=2, block_error=None):
    """Return a fixed paper from extraction, so the wiring is what is tested."""
    async def fake_extract(block, seq, **kw):
        if block_error:
            return BlockResult(None, error=block_error)
        return BlockResult(CanonicalProblem(
            name=block.name, type="kanji_reading", seq=seq,
            items=[
                CanonicalItem(num=i, seq=i, stem="x",
                              options={str(k): f"選択肢{k}" for k in range(1, 5)})
                for i in range(1, items + 1)
            ],
        ))
    monkeypatch.setattr(exam_ingest, "extract_block_with_retry", fake_extract)

    async def fake_sheet(text, **kw):
        from app.services.exam_answer_reader import ReadResult
        from app.services.exam_answers import parse_answer_sheet
        return ReadResult(parse_answer_sheet(text), "pattern", None, [])
    monkeypatch.setattr(exam_ingest, "read_answer_sheet", fake_sheet)


def run(monkeypatch, sources, **kw):
    monkeypatch.setattr(exam_ingest, "read_sources", lambda files: sources)
    return asyncio.run(ingest([("x.pdf", b"")], **kw))


# --- what each file contributes -----------------------------------------------

def test_a_full_set_produces_a_paper_with_answers(monkeypatch):
    stub_pipeline(monkeypatch)
    paper, report = run(monkeypatch, [
        source(QUESTIONS, Role.QUESTIONS),
        source(ANSWER_SHEET, Role.ANSWER_SHEET),
        source(EXPLANATIONS, Role.EXPLANATIONS),
    ], source_label="2019年07月")
    assert paper is not None
    assert report.answers["answered"] == 2
    assert report.answers["unanswered"] == 0


def test_a_question_paper_alone_still_builds_a_paper(monkeypatch):
    """Refusing it would keep a paper out for a reason that only affects
    scoring."""
    stub_pipeline(monkeypatch)
    paper, report = run(monkeypatch, [source(QUESTIONS, Role.QUESTIONS)])
    assert paper is not None
    assert report.answers["unanswered"] == 2
    assert any("无法判分" in g for g in report.gaps)


def test_without_a_question_paper_nothing_can_be_built(monkeypatch):
    stub_pipeline(monkeypatch)
    paper, report = run(monkeypatch, [source(ANSWER_SHEET, Role.ANSWER_SHEET)])
    assert paper is None
    assert any("无法建卷" in n for n in report.notes + report.gaps)


def test_the_explanations_fill_answers_the_sheet_did_not_cover(monkeypatch):
    stub_pipeline(monkeypatch, items=2)
    _, report = run(monkeypatch, [
        source(QUESTIONS, Role.QUESTIONS),
        source(EXPLANATIONS, Role.EXPLANATIONS),
    ])
    assert report.answers["answered"] == 2


# --- the report ------------------------------------------------------------------

def test_the_report_names_every_file_and_what_it_was_taken_for(monkeypatch):
    stub_pipeline(monkeypatch)
    _, report = run(monkeypatch, [
        source(QUESTIONS, Role.QUESTIONS, name="試題.pdf"),
        source("", Role.SCANNED, name="扫描件.pdf", text_pages=1),
    ])
    roles = {s["filename"]: s["role"] for s in report.sources}
    assert roles["試題.pdf"] == "questions"
    assert roles["扫描件.pdf"] == "scanned"


def test_text_the_source_does_not_contain_is_reported(monkeypatch):
    async def inventing(block, seq, **kw):
        return BlockResult(
            CanonicalProblem(name=block.name, type="kanji_reading", seq=seq, items=[]),
            invented=["第1题 题干：原文中找不到「…」"],
        )
    monkeypatch.setattr(exam_ingest, "extract_block_with_retry", inventing)
    _, report = run(monkeypatch, [source(QUESTIONS, Role.QUESTIONS)])
    assert report.invented
    assert not report.clean


def test_a_block_that_could_not_be_read_is_reported_not_swallowed(monkeypatch):
    stub_pipeline(monkeypatch, block_error="問題1 提取失败：timeout")
    _, report = run(monkeypatch, [source(QUESTIONS, Role.QUESTIONS)])
    assert any("提取失败" in i for i in report.invented)


def test_a_clean_paper_is_importable_without_being_read(monkeypatch):
    stub_pipeline(monkeypatch)
    _, report = run(monkeypatch, [
        source(QUESTIONS, Role.QUESTIONS),
        source(ANSWER_SHEET, Role.ANSWER_SHEET),
        source(EXPLANATIONS, Role.EXPLANATIONS),
    ])
    assert report.clean


# --- choosing between files ------------------------------------------------------

def test_the_fuller_copy_wins_when_a_role_appears_twice():
    """A sitting often ships the paper twice, once as page scans."""
    thin = source("short", Role.QUESTIONS, name="scan.pdf")
    full = source(QUESTIONS, Role.QUESTIONS, name="text.pdf")
    assert _pick([thin, full], Role.QUESTIONS) is full


def test_asking_for_a_role_nobody_has_yields_nothing():
    assert _pick([source(QUESTIONS, Role.QUESTIONS)], Role.EXPLANATIONS) is None


def test_an_unreadable_upload_does_not_stop_the_others():
    """A corrupt file should cost its own contribution, not the sitting."""
    sources = read_sources([("broken.pdf", b"not a pdf")])
    assert len(sources) == 1 and sources[0].text == ""


# --- the report object ------------------------------------------------------------

def test_a_report_with_only_soft_findings_is_still_clean():
    """Papers vary between sittings; a difference is a question, not a defect."""
    report = IngestReport(soft=[{"where": "問題9", "message": "本卷 8 题，以往 9 题"}])
    assert report.clean


def test_a_report_with_a_hard_finding_is_not_clean():
    assert not IngestReport(hard=[{"where": "問題6", "message": "★ 缺失"}]).clean
