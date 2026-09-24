"""Taking the listening half out of the 解析 booklet.

The question paper does not carry it: 聴解問題3 and 問題4 print nothing at all,
so a sitting imported from the 試題 alone is nineteen questions short. The
booklet has every 番 with its answer, options and dialogue, and it is regular
enough to cut without a model — which matters, because a misplaced boundary
would attach one dialogue to another question's number.
"""
from app.services.exam_listening import parse_listening


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
