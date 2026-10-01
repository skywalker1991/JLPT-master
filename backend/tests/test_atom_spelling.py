from app.services.atom_service import same_word_other_spelling as same


def test_kana_spelling_of_the_same_word():
    assert same("分かる", "わかる", "わかる", "わかる")
    assert same("わかる", "わかる", "分かる", "ワカル")  # katakana reading counts too


def test_shared_kanji_with_same_reading():
    assert same("落ち着く", "おちつく", "落着く", "おちつく")


def test_homophones_are_different_words():
    assert not same("橋", "はし", "箸", "はし")


def test_different_reading_is_never_the_same_word():
    assert not same("分かる", "わかる", "分ける", "わける")


def test_same_spelling_is_not_an_other_spelling():
    assert not same("市場", "いちば", "市場", "しじょう")
