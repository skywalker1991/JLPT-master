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


def test_a_dialogue_that_says_shitsumon_is_not_two_questions():
    """2012年12月 問題1 4番 discusses 質問項目 twice; split as a two-question
    番 it pushed every later dialogue one question down."""
    from app.services.exam_ingest import _expand
    from app.services.exam_listening import ListeningItem
    talk = ListeningItem(problem=1, ban=4, answer="2", options={}, transcript="→M:質問項目を作ります。\\n→F:質問の数は？", answers=[], at=0)
    pair = ListeningItem(problem=5, ban=3, answer=None, options={}, transcript="→F:…\\n質問１ 女の人は…\\n質問２ 男の人は…", answers=["2", "1"], at=0)
    assert len(_expand([talk])) == 1
    assert [s.answer for s in _expand([pair])] == ["2", "1"]


def _booklet(*blocks):
    return "听力文本\n" + "\n".join(blocks)


def _ban(n, scene="会社で男の人と女の人が話しています。"):
    return f"{n} 番 {scene}\n→M:はい。\n→F:ええ。\n答え:1"


def test_a_space_after_ban_is_a_heading_even_before_a_particle():
    """2010年07月: 「1 番 女の人が…」 — the guard read 番の and refused it."""
    from app.services.exam_listening import parse_listening
    text = _booklet("問題1", _ban(1, "女の人が電話で話しています。"), _ban(2, "男の人と女の人が話しています。"))
    assert [i.ban for i in parse_listening(text)] == [1, 2]


def test_an_unread_heading_is_found_where_the_numbering_starts_again():
    """2010年07月's 「問題4 応答問題」 and 2011年07月's missing 問題3 put two
    問題 under one heading."""
    from app.services.exam_listening import parse_listening
    text = _booklet("問題1", _ban(1), _ban(2), "問題4 応答問題", _ban(1), "問題2", _ban(1), _ban(2), _ban(1), _ban(2))
    assert [(i.problem, i.ban) for i in parse_listening(text)] == [
        (1, 1), (1, 2), (4, 1), (2, 1), (2, 2), (3, 1), (3, 2)]


def test_a_ban_quoted_in_the_instructions_gives_way_to_the_real_one():
    """2018年12月 問題5: 「1 番、2 番 問題用紙に何も印刷されていません」."""
    from app.services.exam_listening import parse_listening
    text = _booklet("問題5", "1 番、2 番\n問題用紙に何も印刷されていません。", _ban(1), _ban(2))
    items = parse_listening(text)
    assert [(i.problem, i.ban) for i in items] == [(5, 1), (5, 2)]
    assert "話しています" in items[0].transcript


def test_a_skipped_ban_leaves_its_question_empty_rather_than_shifting_the_rest():
    """2022年12月's booklet has no 「2番」: matched by position, questions 2–4
    took 3番–5番's dialogue."""
    from app.services.exam_canonical import CanonicalItem, CanonicalPaper, CanonicalProblem, CanonicalSection
    from app.services.exam_ingest import IngestReport, _fill_listening
    from app.services.exam_sources import Role, Source
    text = "听力文本\n問題1\n" + "\n".join(
        f"{n} 番 正解:1\n会社で男の人と女の人が話しています。第{n}番\n→M:" + "はい、そうですね。" * 30 + "\n→F:ええ。" for n in (1, 3, 4, 5))
    problem = CanonicalProblem(name="問題1", type="listening", seq=1,
                               items=[CanonicalItem(num=n, seq=n) for n in range(1, 6)])
    paper = CanonicalPaper(level="N1", title="t", source="s",
                           sections=[CanonicalSection(name="聴解", seq=1, problems=[problem])])
    source = Source(filename="解析.pdf", text=text, page_count=1, text_pages=1)
    source.role = Role.EXPLANATIONS
    _fill_listening(paper, [source], IngestReport())
    said = {i.num: i.transcript for i in problem.items}
    assert "第3番" in said[3] and "第5番" in said[5] and not said[2]


def test_options_are_read_past_a_page_number_and_the_next_heading():
    """2010年07月 ends a 番 with its options, 「答え：３」, the page number
    「49」, a stray 「番」 and the next heading — read as option 4 = 9, and
    the transcript cut a line short."""
    from app.services.exam_listening import _options_and_transcript, _take_answers
    body = ("あの、何か書くもの拝借してもよろしいですか。\n"
            "１、じゃあ、拝見しましょう。\n２、これでよろしければ。\n３、すぐお返しします。\n"
            "答え：３\n49\n番\n問題4 応答問題\n")
    answers, body = _take_answers(body)
    options, transcript = _options_and_transcript(body)
    assert answers == ["3"]
    assert sorted(options) == ["1", "2", "3"]
    assert transcript == "あの、何か書くもの拝借してもよろしいですか。"


def test_options_printed_before_the_dialogue_are_not_taken_as_trailing():
    """2018年07月 問題5 3番 prints both option sets first; scanning back past
    the dialogue found them and cut the transcript by a wrong count."""
    from app.services.exam_listening import _options_and_transcript
    body = "質問1\n1 赤山\n2 青山\n3 緑山\n4 白山\nラジオを聞いて夫婦が話しています。\n男：じゃ、行こう。\n女：うん。\n質問1 二人は…\n55\n"
    options, transcript = _options_and_transcript(body)
    assert "女：うん。" in transcript


def test_headings_with_no_space_as_utterances_or_circled_past_nine():
    """2013年12月: 「2会社で…」, a bare utterance over its options, ⑩."""
    from app.services.exam_listening import _LOOSE_BAN, _digits
    assert _digits("⑩") == "10"
    found = [m.group(1) for m in _LOOSE_BAN.finditer(
        "\n2会社で課長と女の社員が話しています。\n"
        "\n1 あの、すみません。こちらの椅子を拝借したいんですが。\n1 どうぞ。\n2 はい。\n3 いいえ。\n"
        "\n１ 電話してきたならいいじゃない。\n")]
    assert found[:2] == ["2", "1"] and "１" not in found


def test_options_are_read_however_the_booklet_lays_them_out():
    from app.services.exam_listening import _options_and_transcript
    same_line = "話しています。\n男：…\n何について話していますか。\n1．古い民家を守る 2．古い民家の活用 3．町の歴史 4．観光の問題"
    assert _options_and_transcript(same_line)[0]["4"] == "観光の問題"
    run_on = "…目を通しといてね。1.あ、読んでおきます。\n2.はい、見ておきました。\n3.なんで?"
    options, transcript = _options_and_transcript(run_on)
    assert options == {"1": "あ、読んでおきます。", "2": "はい、見ておきました。", "3": "なんで?"}
    assert transcript == "…目を通しといてね。"
    speaker = "…どうぞ。\nM：１．あ、遠慮なく。\n２．いえいえ。\n３．またね。"
    assert _options_and_transcript(speaker)[0]["1"] == "あ、遠慮なく。"
    two_columns = "女の人は何について話していますか。\n1 赤\n3 青\n2 白\n4 黒"
    assert _options_and_transcript(two_columns)[0] == {"1": "赤", "2": "白", "3": "青", "4": "黒"}
    unnumbered = "男：…\n女の人は何について話していますか。\n新しい店\n古い店\n近い店\n遠い店"
    assert _options_and_transcript(unnumbered) == ({"1": "新しい店", "2": "古い店", "3": "近い店", "4": "遠い店"},
                                                   "男：…\n女の人は何について話していますか。")


def test_an_answer_printed_in_the_transcript_is_taken_out_but_dialogue_is_not():
    from app.services.exam_listening import _clean
    text = ("男：でも、今はこの会社に入って正解だったって思ってるよ。\n正解３\n、正解：3\n質問 1 正解 2\n"
            "正解 質問1：3 質問2：2\n答え：『ネオ銀行の再生』\nF：「正解!」と言いたいとこだけど")
    assert _clean(text) == "男：でも、今はこの会社に入って正解だったって思ってるよ。\nF：「正解!」と言いたいとこだけど"
