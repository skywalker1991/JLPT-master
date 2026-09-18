import asyncio
import json

from app.api import analysis as analysis_api
from app.api.analysis import _extract_completed_sentences
from app.schemas.analysis import AnalyzeRequest
from app.services.preprocessor import preprocessor


def test_split_keeps_quoted_exclamation_in_one_sentence():
    text = "「ここ、いいね！」と友達が言った。私もそう思った。\n困ったものだ"
    assert preprocessor.split_sentences(text) == [
        "「ここ、いいね！」と友達が言った。",
        "私もそう思った。",
        "困ったものだ",
    ]


def test_extract_ignores_braces_inside_strings():
    buf = '{"sentences": [{"index": 0, "text": "a", "usage": "名詞＋{の}"}, {"index": 1, "text": "b}"}, {"index": 2'
    got = _extract_completed_sentences(buf, 0)
    assert [s["index"] for s in got] == [0, 1]


class _FakeDB:
    def add(self, obj):
        obj.id = "00000000-0000-0000-0000-000000000000"

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def execute(self, stmt):
        self.saved = stmt.compile().params.get("session_data")


class _SkippingLLM:
    """First pass skips sentence 1 (and mislabels indexes 1-based); retry covers it."""

    def __init__(self):
        self.calls = 0

    async def analyze_stream(self, prompt, schema, image_base64=None):
        self.calls += 1
        if self.calls == 1:
            payload = {"sentences": [
                {"index": 1, "text": "一つ目。", "translation": "t0"},
                {"index": 3, "text": "三つ目。", "translation": "t2"},
            ]}
        else:
            payload = {"sentences": [{"index": 1, "text": "二つ目。", "translation": "t1"}]}
        text = json.dumps(payload, ensure_ascii=False)
        for i in range(0, len(text), 7):
            yield text[i:i + 7]


def _run(monkeypatch, llm, text):
    monkeypatch.setattr(analysis_api, "get_llm_client", lambda: llm)
    db = _FakeDB()

    async def go():
        resp = await analysis_api.analyze(AnalyzeRequest(text=text, type="text"), db=db)
        return [e async for e in resp.body_iterator]

    return asyncio.run(go()), db


def test_every_input_sentence_is_emitted_once(monkeypatch):
    events, db = _run(monkeypatch, _SkippingLLM(), "一つ目。二つ目。三つ目。")
    sentences = [json.loads(e["data"]) for e in events if e["event"] == "sentence"]
    by_index = {s["index"]: s for s in sentences}
    assert len(sentences) == 3
    assert [by_index[i]["text"] for i in range(3)] == ["一つ目。", "二つ目。", "三つ目。"]
    assert by_index[1]["translation"] == "t1"
    assert events[-1]["event"] == "done"
    assert [s["text"] for s in db.saved["sentences"]] == ["一つ目。", "二つ目。", "三つ目。"]


class _FailingLLM:
    async def analyze_stream(self, prompt, schema, image_base64=None):
        raise RuntimeError("boom")
        yield  # pragma: no cover


def test_llm_failure_still_emits_all_sentences(monkeypatch):
    events, _ = _run(monkeypatch, _FailingLLM(), "一つ目。二つ目。")
    sentences = [json.loads(e["data"]) for e in events if e["event"] == "sentence"]
    assert [s["text"] for s in sentences] == ["一つ目。", "二つ目。"]
