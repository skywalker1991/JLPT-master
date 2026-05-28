import math
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
    expected = 0.6 + (1 - math.exp(-1)) * 0.4  # ≈ 0.8528
    assert abs(score - expected) < 0.001


def test_extract_jlpt_level_finds_n2():
    assert extract_jlpt_level(["N2", "verb"]) == "N2"


def test_extract_jlpt_level_returns_none_when_absent():
    assert extract_jlpt_level(["verb", "common"]) is None


def test_extract_jlpt_level_returns_first_match():
    assert extract_jlpt_level(["N3", "N2"]) == "N3"


def test_extract_jlpt_level_empty_list():
    assert extract_jlpt_level([]) is None


from datetime import datetime, timezone, timedelta
from app.services.internalize_service import (
    next_review_after_know,
    next_review_after_unknown,
)

def test_know_from_box0_goes_to_box1():
    new_box, next_review = next_review_after_know(0)
    assert new_box == 1
    assert next_review > datetime.now(timezone.utc)

def test_know_from_box5_stays_at_box5():
    new_box, _ = next_review_after_know(5)
    assert new_box == 5

def test_know_box1_interval_is_1_hour():
    _, next_review = next_review_after_know(0)  # box 0 → box 1, interval = 1h
    delta = next_review - datetime.now(timezone.utc)
    assert timedelta(minutes=55) < delta < timedelta(minutes=65)

def test_know_box4_interval_is_7_days():
    _, next_review = next_review_after_know(3)  # box 3 → box 4, interval = 7d
    delta = next_review - datetime.now(timezone.utc)
    assert timedelta(days=6, hours=23) < delta < timedelta(days=7, hours=1)

def test_unknown_always_goes_to_box1():
    for box in range(6):
        new_box, _ = next_review_after_unknown(box)
        assert new_box == 1

def test_unknown_next_review_is_10_minutes():
    _, next_review = next_review_after_unknown(3)
    delta = next_review - datetime.now(timezone.utc)
    assert timedelta(minutes=9) < delta < timedelta(minutes=11)
