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


SESSION = {
    "sentences": [
        {"index": 0, "text": "私もそう思った。", "translation": "我也这么想。",
         "vocab": [{"surface": "思う", "reading": "おもう", "meaning": "想，认为"}],
         "grammar": [{"pattern": "〜も", "meaning": "也", "usage": "表示同类"}]},
    ],
    "followups": [
        {"template": "ask", "params": {"sentence_index": 0, "kind": "vocab", "target": "思う", "question": "和考える有什么区别？"},
         "result": {"response": "思う偏主观感受。"}},
        {"template": "ask", "params": {"sentence_index": 0, "kind": "grammar", "target": "〜も", "question": "别的"},
         "result": {"response": "无关"}},
    ],
}


def test_ask_prompt_with_referenced_items_and_sentence_history():
    prompt = analysis_api._build_ask_prompt(SESSION, {
        "sentence_index": 0, "question": "能一起用吗？",
        "targets": [{"kind": "vocab", "key": "思う"}, {"kind": "grammar", "key": "〜も"}]})
    assert "私もそう思った。" in prompt and "我也这么想。" in prompt
    assert "其中的单词「思う」、语法「〜も」" in prompt
    assert "想，认为" in prompt and "表示同类" in prompt                  # both items' analysis
    assert "和考える有什么区别？" in prompt and "无关" in prompt            # whole sentence thread as history
    assert '"new_items"' in prompt and "思う、〜も" in prompt               # asks for JSON, excludes analysed items


def test_ask_prompt_rejects_unknown_item_or_empty_question():
    base = {"sentence_index": 0, "question": "?"}
    assert analysis_api._build_ask_prompt(SESSION, {**base, "targets": [{"kind": "vocab", "key": "無い"}]}) is None
    assert analysis_api._build_ask_prompt(SESSION, {**base, "sentence_index": 3}) is None
    assert analysis_api._build_ask_prompt(SESSION, {**base, "question": "  "}) is None


def test_ask_prompt_about_the_whole_sentence():
    prompt = analysis_api._build_ask_prompt(SESSION, {"sentence_index": 0, "question": "口语里怎么说？"})
    assert "对这句话有疑问" in prompt and "口语里怎么说？" in prompt
    assert "已有的解析" not in prompt


def test_ask_prompt_reads_older_single_target_shape():
    prompt = analysis_api._build_ask_prompt(SESSION, {"sentence_index": 0, "kind": "vocab", "target": "思う", "question": "?"})
    assert "其中的单词「思う」" in prompt


def test_parse_ask_answer_extracts_new_items_and_drops_known():
    raw = json.dumps({"answer": "思う偏主观。", "new_items": [
        {"kind": "vocab", "key": "考える", "reading": "かんがえる", "meaning": "思考"},
        {"kind": "vocab", "key": "思う", "meaning": "想"},            # already analysed → dropped
        {"kind": "other", "key": "x", "meaning": "y"},                # bad kind → dropped
        {"kind": "grammar", "key": "〜と思う", "meaning": "我认为"},
    ]}, ensure_ascii=False)
    out = analysis_api._parse_ask_answer(raw, {"思う", "〜も"})
    assert out["response"] == "思う偏主观。"
    assert [i["key"] for i in out["new_items"]] == ["考える", "〜と思う"]
    assert out["new_items"][1]["reading"] is None


def test_parse_ask_answer_falls_back_to_plain_text():
    out = analysis_api._parse_ask_answer("就是普通的回答", set())
    assert out == {"response": "就是普通的回答", "new_items": []}


LONG_SESSION = {"sentences": [{"index": i, "text": f"第{i}文。", "translation": f"第{i}句"} for i in range(10)]}


def test_ask_prompt_includes_the_whole_passage_when_short():
    prompt = analysis_api._build_ask_prompt(
        SESSION, {"sentence_index": 0, "question": "これは何の話？"}, "私もそう思った。だから賛成した。")
    assert "这段文字（上下文）" in prompt and "だから賛成した。" in prompt   # neighbouring sentence, not just the asked one


def test_ask_prompt_falls_back_to_a_window_for_a_long_passage():
    long_text = "あ" * 3000
    prompt = analysis_api._build_ask_prompt(LONG_SESSION, {"sentence_index": 5, "question": "?"}, long_text)
    assert "…第3文。第4文。第5文。第6文。第7文。…" in prompt
    assert "あああ" not in prompt                                          # the raw long text isn't sent


def test_preprocess_batch_splits_each_text_independently():
    from app.schemas.analysis import PreprocessBatchRequest
    out = asyncio.run(analysis_api.preprocess_batch(
        PreprocessBatchRequest(texts=["「ここ、いいね！」と友達が言った。", "私もそう思った。"])))
    assert [len(r.sentences) for r in out.results] == [1, 1]
    assert out.results[0].sentences[0].text == "「ここ、いいね！」と友達が言った。"
    assert out.results[1].sentences[0].tokens[0].surface == "私"


def test_preprocess_batch_rejects_an_oversized_request():
    from app.schemas.analysis import PreprocessBatchRequest
    import pytest
    with pytest.raises(Exception):
        asyncio.run(analysis_api.preprocess_batch(PreprocessBatchRequest(texts=["あ"] * 501)))
