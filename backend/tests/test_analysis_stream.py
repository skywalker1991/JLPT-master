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
    saved = None
    progress: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def add(self, obj):
        obj.id = "00000000-0000-0000-0000-000000000000"

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def execute(self, stmt):
        data = stmt.compile().params.get("session_data")
        if stmt.compile().params.get("status") == "completed":
            self.saved = data
        else:
            self.progress = self.progress + [len(data["sentences"])]


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


def _run(monkeypatch, llm, text, disconnect_after=None):
    monkeypatch.setattr(analysis_api, "get_llm_client", lambda: llm)
    db = _FakeDB()
    monkeypatch.setattr(analysis_api, "_session_factory", lambda: db)

    async def go():
        resp = await analysis_api.analyze(AnalyzeRequest(text=text, type="text"), db=db)
        events = []
        async for e in resp.body_iterator:
            events.append(e)
            if disconnect_after is not None and len(events) >= disconnect_after:
                break  # client went away (e.g. phone backgrounded the tab)
        await asyncio.gather(*analysis_api._background_tasks)
        return events

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


def test_stream_starts_with_analysis_id(monkeypatch):
    events, _ = _run(monkeypatch, _SkippingLLM(), "一つ目。二つ目。三つ目。")
    assert events[0]["event"] == "start"
    assert "analysis_id" in json.loads(events[0]["data"])


def test_job_finishes_after_client_disconnects(monkeypatch):
    events, db = _run(monkeypatch, _SkippingLLM(), "一つ目。二つ目。三つ目。", disconnect_after=2)
    assert len(events) == 2  # client saw only the start event and one sentence
    # ...but the job kept going, saved progress per sentence and the final result
    assert db.progress == [1, 2, 3]
    assert [s["text"] for s in db.saved["sentences"]] == ["一つ目。", "二つ目。", "三つ目。"]
    assert not analysis_api._jobs
