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
