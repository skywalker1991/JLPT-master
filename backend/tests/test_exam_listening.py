"""Taking the listening half out of the 解析 booklet.

The question paper does not carry it: 聴解問題3 and 問題4 print nothing at all,
so a sitting imported from the 試題 alone is nineteen questions short. The
booklet has every 番 with its answer, options and dialogue, and it is regular
enough to cut without a model — which matters, because a misplaced boundary
would attach one dialogue to another question's number.
"""
from app.services.exam_listening import _PROBLEM, _folded, parse_listening


def section(body: str) -> str:
    """A booklet: the written half, then the listening one."""
    return "第一部分 文字\n1 正解：2\n\n听力原文\n" + body

def test_a_page_number_between_options_does_not_cut_the_run():
    """The page number falls wherever the page breaks, regularly between two
    options. A run that ends there leaves the rest of the options sitting in
    the transcript."""
    items = parse_listening(section("""
問題3

1 番
正解：1
女の人が広告について話しています。
女の人は広告についてどのようにすべきだと言っていますか。
1 ウェブを中心に行うべきだ
50
2 ウェブとテレビで行うべきだ
3 新聞とウェブとテレビで行うべきだ
4 新聞に絞って行うべきだ
"""))
    only, = items
    assert len(only.options) == 4
    assert "新聞に絞って" not in only.transcript
    assert "50" not in only.transcript


def test_immediate_response_questions_have_three_options_not_four():
    """問題4 is 即時応答: one line of audio and three replies. Demanding a full
    set of four leaves the third reply inside the transcript."""
    items = parse_listening(section("""
問題4

1 番
正解：2
先輩、この資料、合計も書いたほうがよかったですか。
1 すみません、計算が間違ってましたか。
2 すみません、合計書かないほうがよかったんですね。
3 すみません、書き入れて出し直します。
"""))
    only, = items
    assert len(only.options) == 3
    assert only.transcript.startswith("先輩")


def test_a_heading_followed_by_a_particle_is_still_a_heading():
    """問題5 prints 「3 番 まず話を聞いてください」; a wide particle guard read
    that を as prose and dropped the question."""
    items = parse_listening(section("""
問題5

3 番 まず話を聞いてください。それから、二つの質問を聞いてください。
会社の研修で講師が話しています。
講師：成果を出すには。
"""))
    assert [(i.problem, i.ban) for i in items] == [(5, 3)]


def test_folding_keeps_every_offset_where_it_was():
    """A fold is used to find things and the original is what gets cut, so a
    fold that moves offsets cuts in the wrong place.

    NFKC writes 「…」 as three dots. 2013年07月's 解析 has eighteen of them,
    two before the 聴解 heading, so the cut landed four characters late and
    ate the 「問」 of 「問題 1」 — its six transcripts were counted under
    問題2 and six questions went into the bank with no transcript. Thirty-
    three of the thirty-five booklets shift by something.
    """
    text = "聴⼒原⽂…と…\n問題 1\n1 番"
    assert len(_folded(text)) == len(text)
    # And it still does the job it exists for: the Kangxi radicals fold.
    assert "聴力原文" in _folded(text)


def test_the_first_問題_is_found_after_an_ellipsis():
    """The 「問」 eaten by the shift left 問題1 invisible, and its transcripts
    were attributed to whichever heading came next."""
    folded = _folded("…" * 3 + "\n問題 1\n1 番\n")
    assert _PROBLEM.search(folded) is not None


def test_a_ban_run_on_from_the_last_sentence_is_still_a_ban():
    """2020年12月 prints 「…なければなりませんか。4 番：会社で」 with no break:
    3番 swallowed 4番, and every later question took its neighbour's
    dialogue."""
    from app.services.exam_listening import parse_listening
    text = (
        "听力原文\n問題1\n"
        "3 番：大学で男の人と女の人が話しています。\n男：3番目の人です。\n女：そうですか。\n"
        "男の人はこれから何をしなければなりませんか。4 番：会社で女の人と男の人が話しています。\n"
        "女：会議は？\n男：明日です。\n"
    )
    bans = [item.ban for item in parse_listening(text)]
    assert bans == [3, 4]


def test_a_control_character_between_the_number_and_ban_is_not_a_wall():
    """2010年07月 writes 「1\\x01 番」 — its whole 問題1 went unseen."""
    from app.services.exam_listening import parse_listening
    text = (
        "听力文本\n問題1\x01\n"
        "1\x01 番\x01 女の人が電話で話しています。\n→F:もしもし。\n→M:はい。\n答え:2\n"
        "2\x01 番\x01 会社で女の人と男の人が話しています。\n→F:田中さん。\n→M:はい。\n答え:1\n"
    )
    assert [item.ban for item in parse_listening(text)] == [1, 2]


def test_a_bare_number_setting_a_scene_heads_a_question_but_an_option_does_not():
    """2014年07月 numbers straight through and writes some headings as
    「17 テレビの…話して」, which is also how its option lines look."""
    from app.services.exam_listening import parse_listening
    lines = ["听力文本"]
    for n in range(1, 31):
        lines += [f"{n}. 会社で男の人と女の人が話しています。", "→F:はい。", "→M:ええ。",
                  "1  ペットが飼い主に似てくる", "2  飼い主がペットに似てくる"]
    lines += ["31 テレビの旅行番組で観光コースを紹介しています。", "→F:ええ。",
              "1、2回ぐらいのものがいいですね。", "32 市役所で男の人と係の人が話しています。", "→M:はい。"]
    bans = [item.ban for item in parse_listening("\n".join(lines))]
    assert bans == list(range(1, 33))
