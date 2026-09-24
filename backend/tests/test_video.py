import pytest
from fastapi import HTTPException

from app.api.video import _pick_language, _extract_video_id


class _Lang:
    def __init__(self, code): self.language_code = code


class _Transcript:
    def __init__(self, codes): self.translation_languages = [_Lang(c) for c in codes]


def test_picks_the_chinese_code_the_video_actually_offers():
    assert _pick_language(_Transcript(["en", "zh-Hant"]), ["zh-Hans", "zh-CN", "zh", "zh-Hant"]) == "zh-Hant"
    assert _pick_language(_Transcript(["zh-Hans", "zh-Hant"]), ["zh-Hans", "zh-CN", "zh", "zh-Hant"]) == "zh-Hans"


def test_returns_none_when_no_chinese_is_offered():
    assert _pick_language(_Transcript(["en", "ko"]), ["zh-Hans", "zh-Hant"]) is None


def test_video_id_from_the_usual_url_shapes():
    for url in ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ",
                "https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"]:
        assert _extract_video_id(url) == "dQw4w9WgXcQ"
    assert _extract_video_id("https://example.com/video") is None


import asyncio
from app.api import video as video_api


class _FakeDB:
    """Enough of a session for the cache path."""
    def __init__(self, cached=None): self.cached, self.merged, self.committed = cached, None, False
    async def get(self, model, key): return self.cached
    async def merge(self, obj): self.merged = obj
    async def commit(self): self.committed = True
    async def rollback(self): pass


def test_a_cached_video_is_served_without_touching_youtube(monkeypatch):
    class Row: subtitles = [{"start": 0, "duration": 1, "text": "テスト。", "zh": None, "en": None}]
    async def boom(_): raise AssertionError("should not fetch")
    monkeypatch.setattr(video_api, "_fetch_from_youtube", boom)
    out = asyncio.run(video_api.get_subtitles(url="https://youtu.be/dQw4w9WgXcQ", refresh=False, db=_FakeDB(Row())))
    assert out["cached"] is True and out["subtitles"][0]["text"] == "テスト。"


def test_a_new_video_is_fetched_then_cached(monkeypatch):
    entries = [{"start": 0, "duration": 1, "text": "新しい。", "zh": None, "en": None}]
    async def fake(vid): return entries
    monkeypatch.setattr(video_api, "_fetch_from_youtube", fake)
    db = _FakeDB(None)
    out = asyncio.run(video_api.get_subtitles(url="https://youtu.be/dQw4w9WgXcQ", refresh=False, db=db))
    assert out["cached"] is False and out["subtitles"] == entries
    assert db.committed and db.merged.video_id == "dQw4w9WgXcQ"


def test_refresh_re_fetches_even_when_cached(monkeypatch):
    class Row: subtitles = [{"text": "古い。"}]
    async def fake(vid): return [{"text": "新しい。"}]
    monkeypatch.setattr(video_api, "_fetch_from_youtube", fake)
    out = asyncio.run(video_api.get_subtitles(url="dQw4w9WgXcQ", refresh=True, db=_FakeDB(Row())))
    assert out["subtitles"][0]["text"] == "新しい。" and out["cached"] is False


# --- Client-fetched subtitles (the phone does the YouTube calls) --------------

def _player_response(*, ja_kinds=("asr", None), translations=("zh-Hant", "en")):
    """A player response shaped like YouTube's, with the caption tracks we care
    about. Two Japanese tracks by default: auto-generated and human-written."""
    tracks = [
        {"languageCode": "ja", "kind": k, "baseUrl": f"https://www.youtube.com/api/timedtext?v=X&lang=ja&fmt=srv3&k={k}"}
        for k in ja_kinds
    ]
    return {"captions": {"playerCaptionsTracklistRenderer": {
        "captionTracks": tracks,
        "translationLanguages": [{"languageCode": c} for c in translations],
    }}}


def _events(*texts, start_ms=0):
    return {"events": [
        {"tStartMs": start_ms + i * 1000, "dDurationMs": 900, "segs": [{"utf8": t}]}
        for i, t in enumerate(texts)
    ]}


def test_prepare_prefers_the_human_written_japanese_track():
    tracks = video_api._track_urls(_player_response(ja_kinds=("asr", None)))
    # The human track is the one without kind="asr"
    assert "k=None" in tracks["ja"]


def test_prepare_falls_back_to_the_auto_generated_track():
    tracks = video_api._track_urls(_player_response(ja_kinds=("asr",)))
    assert "k=asr" in tracks["ja"]


def test_prepare_asks_for_json_overriding_the_srv3_in_the_base_url():
    tracks = video_api._track_urls(_player_response())
    assert "fmt=json3" in tracks["ja"] and "srv3" not in tracks["ja"]


def test_prepare_picks_a_chinese_code_the_video_actually_offers():
    # zh-Hans is our first choice but this video only offers zh-Hant
    tracks = video_api._track_urls(_player_response(translations=("zh-Hant", "en")))
    assert "tlang=zh-Hant" in tracks["zh"]


def test_prepare_returns_no_translation_url_when_none_is_offered():
    tracks = video_api._track_urls(_player_response(translations=()))
    assert tracks["zh"] is None and tracks["en"] is None


def test_prepare_rejects_a_video_without_japanese():
    pr = {"captions": {"playerCaptionsTracklistRenderer": {
        "captionTracks": [{"languageCode": "en", "baseUrl": "u"}], "translationLanguages": []}}}
    with pytest.raises(HTTPException) as e:
        video_api._track_urls(pr)
    assert e.value.status_code == 404


def test_ingest_lines_up_translations_with_the_japanese():
    entries = video_api._merge_tracks(
        _events("おはよう", "元気ですか"), _events("早上好", "你好吗"), _events("Morning", "How are you"))
    assert [e["text"] for e in entries] == ["おはよう", "元気ですか"]
    assert entries[1]["zh"] == "你好吗" and entries[1]["en"] == "How are you"


def test_ingest_tolerates_a_shorter_translation_track():
    entries = video_api._merge_tracks(_events("一", "二", "三"), _events("1"), None)
    assert entries[0]["zh"] == "1" and entries[2]["zh"] is None


def test_ingest_drops_blank_events_and_converts_to_seconds():
    payload = {"events": [
        {"tStartMs": 2500, "dDurationMs": 1500, "segs": [{"utf8": " こんにちは "}]},
        {"tStartMs": 4000, "dDurationMs": 500, "segs": [{"utf8": "  "}]},
        {"tStartMs": 5000, "dDurationMs": 500},
    ]}
    entries = video_api._merge_tracks(payload, None, None)
    assert len(entries) == 1
    assert entries[0] == {"start": 2.5, "duration": 1.5, "text": "こんにちは", "zh": None, "en": None}


def test_ingest_rejects_an_empty_japanese_track():
    with pytest.raises(HTTPException) as e:
        video_api._merge_tracks({"events": []}, None, None)
    assert e.value.status_code == 400


def test_ingest_rejects_a_bogus_video_id():
    with pytest.raises(HTTPException) as e:
        video_api._validated_id("../../etc/passwd")
    assert e.value.status_code == 400


def test_ingest_stores_what_the_client_fetched():
    db = _FakeDB(None)
    req = video_api.IngestRequest(video_id="sEgFKu8Y3AU", ja=_events("こんにちは"), zh=_events("你好"))
    out = asyncio.run(video_api.ingest_subtitles(req, db=db))
    assert out["count"] == 1 and db.committed
    assert db.merged.subtitles[0]["zh"] == "你好"
