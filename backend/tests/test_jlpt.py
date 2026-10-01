from app.api.jlpt import _clean
from app.services import jlpt_practice as jp


def test_practice_category_by_section_and_number():
    assert jp.category_of("言語知識（文字・語彙）", "問題2").label == "文脈規定"
    assert jp.category_of("読解", "問題13").label == "情報検索"
    assert jp.category_of("聴解", "問題１").label == "課題理解"  # full-width digit, 聴解 restarts at 1
    assert jp.category_of("聴解", "問題9") is None


def test_parts_and_scaling():
    assert jp.scaled(22, 44) == 30 and jp.scaled(0, 0) == 0 and jp.scaled(30, 60, 120) == 60
    assert jp.paper_label("2025年07月", "") == "2025年7月"
    assert [p.name for p in jp.LEVELS["N4"].parts] == ["言語知識・読解", "聴解"]
    assert (jp.LEVELS["N2"].written_minutes, jp.LEVELS["N2"].pass_total) == (105, 90)


def test_each_level_numbers_its_own_way():
    # N2 numbers the written booklet straight through
    assert jp.category_of("読解", "問題14", "N2").label == "情報検索"
    assert jp.category_of("言語知識（文字・語彙）", "問題3", "N2").label == "語形成"
    # N3 starts again in each section of 言語知識
    assert jp.category_of("言語知識（文字・語彙）", "問題1", "N3").label == "漢字読み"
    assert jp.category_of("言語知識（文法）・読解", "問題1", "N3").label == "文法形式"
    assert jp.category_of("言語知識（文法）・読解", "問題7", "N3").label == "情報検索"
    assert jp.category_of("聴解", "問題4", "N3").label == "発話表現"
    assert jp.category_of("聴解", "問題5", "N4") is None


def test_clean_rejoins_printed_line_breaks():
    assert _clean("強調す\nることは。\n次の文。") == "強調することは。\n次の文。"
    assert _clean("__下線__の部分") == "下線の部分"
    assert _clean("です。\n（注１）琴線：心\nを動かす") == "です。\n（注１）琴線：心を動かす"


def test_option_keys_from_text_or_number():
    from app.api.exam import _option_keys
    opts = {"1": "ようか", "2": "よか", "3": "よが", "4": "__ようが__"}
    data = {"options_analysis": [{"option": "ようか"}, {"option": "2. よか"}, {"option": "３"}, {"option": "ようが"}, {"option": "?"}]}
    assert [o["option"] for o in _option_keys(data, opts)["options_analysis"]] == ["1", "2", "3", "4", "?"]
    # a slightly changed text takes its place in order
    data = {"options_analysis": [{"option": "も加えて"}, {"option": "でない限り"}, {"option": "3"}, {"option": "とは"}]}
    opts = {"1": "も含めて", "2": "でない限り", "3": "にしても", "4": "とは"}
    assert [o["option"] for o in _option_keys(data, opts)["options_analysis"]] == ["1", "2", "3", "4"]


def test_knowledge_marks_fake_options_and_fixes_kinds():
    from types import SimpleNamespace
    from app.api.exam import _tidy_knowledge
    item = SimpleNamespace(options={"1": "ようか", "2": "よか", "3": "よが", "4": "ようが"}, correct_answer="2")
    data = {"knowledge": [
        {"kind": "vocab", "key": "ようか", "from": "option", "option": "1"},
        {"kind": "vocab", "key": "余暇", "from": "option", "option": "2"},
        {"kind": "grammar", "key": "説く", "from": "sentence", "option": None},
        {"kind": "grammar", "key": "〜ものを", "from": "sentence", "option": None},
    ]}
    k = _tidy_knowledge(data, item, "kanji_reading")["knowledge"]
    assert [x.get("exists") for x in k[:2]] == [False, True]
    assert [x["kind"] for x in k[2:]] == ["vocab", "grammar"]
