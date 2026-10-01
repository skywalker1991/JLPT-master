"""Review scheduling with FSRS, and how a card is shown.

Each word or grammar point keeps its own memory state: stability (how many
days until the chance of recalling it falls to the target) and difficulty.
A review is only 会 / 不会, and the next review follows from the state.
Nothing outside review — reading, exams, follow-up questions — moves it.

A day's work is finite: what is due today, plus a few new cards (a limit the
person sets), then it is done.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fsrs import Card, Rating, Scheduler, State

from app.models.db import AtomSrsState

# A card this stable is "familiar": its front changes from the word marked in
# the sentence to the sentence with the word blanked out, and the translation.
FAMILIAR_DAYS = 7.0


def scheduler(desired_retention: float) -> Scheduler:
    # No same-day learning steps: a card answered 不会 comes back in this
    # session (the client re-queues it once) and then follows FSRS by days.
    return Scheduler(
        desired_retention=min(max(desired_retention, 0.7), 0.97),
        learning_steps=(),
        relearning_steps=(),
        enable_fuzzing=True,
    )


def to_card(srs: AtomSrsState | None) -> Card:
    if srs is None or srs.stability is None:
        return Card()
    return Card(
        state=State(srs.state or 2),
        step=None,
        stability=srs.stability,
        difficulty=srs.difficulty,
        due=srs.next_review,
        last_review=srs.last_review,
    )


def review(srs: AtomSrsState, knew: bool, desired_retention: float, now: datetime | None = None) -> AtomSrsState:
    """Apply one 会 / 不会 to the card's state, in place."""
    now = now or datetime.now(timezone.utc)
    card, _ = scheduler(desired_retention).review_card(
        to_card(srs if srs.stability is not None else None),
        Rating.Good if knew else Rating.Again,
        now,
    )
    srs.stability = card.stability
    srs.difficulty = card.difficulty
    srs.state = int(card.state)
    srs.next_review = card.due
    srs.last_review = now
    srs.reps = (srs.reps or 0) + 1
    if not knew:
        srs.lapses = (srs.lapses or 0) + 1
    if srs.introduced_at is None:
        srs.introduced_at = now
    return srs


@dataclass
class Day:
    start: datetime
    end: datetime


def today(tz_offset_minutes: int, now: datetime | None = None) -> Day:
    """The person's local day, in UTC. `tz_offset_minutes` is the browser's
    getTimezoneOffset(): minutes to add to local time to get UTC (Tokyo -540)."""
    now = now or datetime.now(timezone.utc)
    offset = timedelta(minutes=max(-840, min(840, tz_offset_minutes)))
    local = now - offset
    start_local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    start = (start_local + offset).replace(tzinfo=timezone.utc)
    return Day(start=start, end=start + timedelta(days=1))


def front_mode(atom_type: str, stability: float | None, has_sentence: bool) -> str:
    """What the front of the card asks.

    word      — no sentence met yet: the word itself
    recognize — the sentence with the word marked: what does it mean here?
    cloze     — the sentence with it blanked out, and the translation: which word?
                (grammar always: every piece of the pattern is blanked)
    """
    if not has_sentence:
        return "word"
    if atom_type == "grammar":
        return "cloze"
    return "cloze" if (stability or 0) >= FAMILIAR_DAYS else "recognize"


def pick_sentence(count: int, reps: int) -> int:
    """Each review shows the next sentence met, round and round."""
    return reps % count if count else -1
