"""Cutting a paper into 問題 and reading one at a time.

Splitting is deterministic because the anchors barely move, and it buys what
matters more: a block small enough to read carefully, a retry that costs one
問題 rather than forty pages, and a failure that names the 問題.

The check on what comes back is not structural. A stem the model composed
reads perfectly and satisfies every rule about option counts and numbering, so
requiring every stem and option to appear in the source is the only thing
between a fluent invention and the question bank.
"""
from app.services.exam_extract import (
    build_problem, check_verbatim, guess_type, item_number, normalise,
)
from app.services.exam_split import Block, split_problems

PAPER = """
2019 年7 月新日本語能力試験 N1
問題1 ＿＿の言葉の読み方として最もよいものを、１２３４から一つ選びなさい。（1*6）
1. あの態度には猛烈に腹が立った。
1 もれつ 2 きょうれつ 3 きょれつ 4 もうれつ
問題６ 次の文の ★ に入る最もよいものを、１２３４から一つ選びなさい。（1*5）
36. X医院は、患者を [_1_] [_2_] [_3★_] [_4_] 近々予約制を導入するらしい。
読解
問題８ 次の（１）から（４）の文章を読んで、後の問いに対する答えとして最もよいものを選びなさい。
46. 想像力を鍛えることについて、筆者はどのように考えているか。
第三部分 聽解
問題１ 問題１では、まず質問を聞いてください。
1番 市役所で女の人と男の人が話しています。
問題３ 問題３では、問題用紙に何も印刷されていません。
"""


def block(text, section="言語知識", name="問題1", number=1):
    return Block(section=section, name=name, number=number, text=text, start=0)


# --- splitting ----------------------------------------------------------------

def test_a_paper_is_cut_at_its_problem_headings():
    names = [b.name for b in split_problems(PAPER)]
    assert names == ["問題1", "問題6", "問題8", "問題1", "問題3"]


def test_a_heading_restated_by_its_own_instruction_is_not_a_second_block():
    """Every heading is followed by "問題１では、…" repeating it."""
    text = "問題１ 問題１では、まず質問を聞いてください。\n1番 …"
    assert len(split_problems(text)) == 1


def test_numbers_are_read_half_width_full_width_or_spaced():
    text = "問題1 あ\n問題２ い\n問題 3 う"
    assert [b.number for b in split_problems(text)] == [1, 2, 3]


def test_sections_follow_the_markers_the_paper_prints():
    blocks = split_problems(PAPER)
    assert [b.section for b in blocks] == ["言語知識", "言語知識", "読解", "聴解", "聴解"]


def test_listening_numbering_starting_over_is_not_read_as_a_repeat():
    """問題1 exists in both booklets and means different things."""
    blocks = split_problems(PAPER)
    listening = [b for b in blocks if b.section == "聴解"]
    assert listening[0].name == "問題1"
    assert listening[0].text != blocks[0].text


# --- question types -------------------------------------------------------------

def test_the_type_comes_from_the_instruction_since_the_paper_never_names_it():
    assert guess_type(block("問題1 ＿＿の言葉の読み方として最もよいものを")) == "kanji_reading"
    assert guess_type(block("問題3 の言葉に意味が最も近いものを")) == "synonym"
    assert guess_type(block("問題6 次の文の ★ に入る最もよいものを")) == "sentence_order"
    assert guess_type(block("問題4 次の言葉の使い方として")) == "usage"


def test_anything_in_the_listening_booklet_is_a_listening_problem():
    assert guess_type(block("問題3 何も印刷されていません", section="聴解")) == "listening"


# --- item numbers ----------------------------------------------------------------

def test_an_item_number_is_read_however_it_was_printed():
    """Told to copy verbatim, the model returns what the page shows. A strict
    read that drops "1." unkeys a whole 問題 from its answers."""
    assert item_number(1) == 1
    assert item_number("1") == 1
    assert item_number("1.") == 1
    assert item_number("１．") == 1
    assert item_number("(3)") == 3


def test_an_item_with_no_number_is_left_unnumbered():
    assert item_number(None) is None
    assert item_number("") is None


# --- verbatim ---------------------------------------------------------------------

SOURCE = "1. あの態度には猛烈に腹が立った。\n1 もれつ 2 きょうれつ 3 きょれつ 4 もうれつ"


def problem_with(stem, options):
    return build_problem(
        block(SOURCE),
        {"type": "kanji_reading", "items": [{"num": 1, "stem": stem, "options": options}]},
        seq=1,
    )


def test_text_copied_from_the_source_passes():
    p = problem_with("あの態度には猛烈に腹が立った。", {"1": "もれつ", "2": "きょうれつ"})
    assert check_verbatim(p, SOURCE) == []


def test_a_stem_the_model_wrote_itself_is_caught():
    """Fluent, plausible, and never printed — no structural rule sees it."""
    p = problem_with("あの態度にはとても腹が立ちました。", {"1": "もれつ"})
    found = check_verbatim(p, SOURCE)
    assert found and "题干" in found[0]


def test_an_invented_option_is_caught():
    p = problem_with("あの態度には猛烈に腹が立った。", {"1": "もれつ", "2": "まったくちがう"})
    found = check_verbatim(p, SOURCE)
    assert len(found) == 1 and "选项2" in found[0]


def test_spacing_and_width_differences_are_not_treated_as_changes():
    """The same character is printed half-width one year and full-width the
    next, and line breaks land wherever the column ends."""
    p = problem_with("あの態度には 猛烈に腹が立った 。", {"1": "もれつ"})
    assert check_verbatim(p, SOURCE) == []


def test_blank_markup_the_model_was_asked_to_add_is_not_treated_as_invented():
    source = "36. X医院は、患者を ＿＿＿ ＿＿＿ ＿＿＿ ＿＿＿ 近々予約制を導入するらしい。"
    p = build_problem(
        block(source),
        {"type": "sentence_order", "items": [{
            "num": 36,
            "stem": "X医院は、患者を [_1_] [_2_] [_3★_] [_4_] 近々予約制を導入するらしい。",
            "options": {}, "meta": {"star_position": 3},
        }]},
        seq=1,
    )
    assert check_verbatim(p, source) == []


def test_the_starred_blank_survives_into_the_item():
    p = build_problem(
        block("x"),
        {"type": "sentence_order", "items": [{"num": 36, "stem": "…[_3★_]…", "meta": {"star_position": 3}}]},
        seq=1,
    )
    assert p.items[0].meta["star_position"] == 3


def test_normalise_drops_only_spacing_and_markup_never_content():
    """Whitespace, blanks and punctuation go; a （注） annotation is text the
    page really carries and has to keep matching."""
    assert normalise("あの　態度 には[_1_]★") == "あの態度には"
    assert normalise("（注）性善説") == "注性善説"
