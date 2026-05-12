import pytest
from app.services.internalize_service import priority_score, extract_jlpt_level


def test_never_reviewed_atom_has_high_priority():
    score = priority_score(fail_count=0, review_count=0, days_since=999)
    assert score > 0.39  # days_decay 接近 1，0.4*1 = 0.4


def test_all_correct_recently_has_low_priority():
    score = priority_score(fail_count=0, review_count=10, days_since=0)
    assert score < 0.01


def test_all_failed_recently_medium_priority():
    score = priority_score(fail_count=5, review_count=5, days_since=0)
    assert abs(score - 0.6) < 0.01  # fail_rate=1, days_decay=0


def test_all_failed_14_days_ago_high_priority():
    score = priority_score(fail_count=5, review_count=5, days_since=14)
    # fail_rate=1 → 0.6; days_decay=1-e^{-1}≈0.632 → 0.4*0.632≈0.253
    assert score > 0.85


def test_extract_jlpt_level_finds_n2():
    assert extract_jlpt_level(["N2", "verb"]) == "N2"


def test_extract_jlpt_level_returns_none_when_absent():
    assert extract_jlpt_level(["verb", "common"]) is None
