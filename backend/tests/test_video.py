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
