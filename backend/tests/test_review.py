from datetime import datetime, timedelta, timezone

from app.models.db import AtomSrsState
from app.services import review_service as rs

NOW = datetime(2026, 10, 3, 1, 30, tzinfo=timezone.utc)  # 10:30 in Tokyo


def test_tokyo_day_starts_at_local_midnight():
    day = rs.today(-540, NOW)
    assert day.start == datetime(2026, 10, 2, 15, 0, tzinfo=timezone.utc)
    assert day.end - day.start == timedelta(days=1)


def test_new_card_known_comes_back_in_days_not_minutes():
    srs = rs.review(AtomSrsState(reps=0, lapses=0), True, 0.9, NOW)
    assert srs.reps == 1 and srs.lapses == 0 and srs.introduced_at == NOW
    assert srs.next_review - NOW >= timedelta(days=1)


def test_forgotten_card_is_a_lapse_and_due_sooner():
    good = rs.review(AtomSrsState(reps=0, lapses=0), True, 0.9, NOW)
    again = rs.review(AtomSrsState(reps=0, lapses=0), False, 0.9, NOW)
    assert again.lapses == 1
    assert again.next_review <= good.next_review


def test_stability_grows_with_each_success():
    srs = rs.review(AtomSrsState(reps=0, lapses=0), True, 0.9, NOW)
    first = srs.stability
    srs = rs.review(srs, True, 0.9, srs.next_review)
    assert srs.stability > first


def test_higher_target_recall_means_shorter_intervals():
    loose = rs.review(rs.review(AtomSrsState(reps=0, lapses=0), True, 0.8, NOW), True, 0.8, NOW + timedelta(days=3))
    tight = rs.review(rs.review(AtomSrsState(reps=0, lapses=0), True, 0.95, NOW), True, 0.95, NOW + timedelta(days=3))
    assert tight.next_review < loose.next_review


def test_front_of_card():
    assert rs.front_mode("vocabulary", None, False) == "word"
    assert rs.front_mode("vocabulary", 2.0, True) == "recognize"
    assert rs.front_mode("vocabulary", 8.0, True) == "cloze"
    assert rs.front_mode("grammar", 0.5, True) == "cloze"


def test_sentences_rotate():
    assert [rs.pick_sentence(3, r) for r in range(5)] == [0, 1, 2, 0, 1]
    assert rs.pick_sentence(0, 4) == -1
