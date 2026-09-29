"""What a person decided about a question, and how it is kept.

A ruling is kept apart from the paper it was made on, keyed by where the
question sits in the sitting — level, sitting, section, 問題, number — so it
outlives the paper being deleted and read in again. Every re-import lays the
rulings back over what the sources said.

One module, because three places make or apply rulings — an edit on an
imported paper, an edit on a draft before import, and ingest itself — and
the first two copies of this logic had already drifted: one knew about
options and one did not, and neither could say "deliberately left blank" in
a way the checks would hear.
"""
from __future__ import annotations

import json

from sqlalchemy import select

from app.models.db import ExamAdjudication

#: The vote a person casts. It sits among the other votes on a question, so
#: how far the answer is to be trusted is read off one place, and it is the
#: weightiest of them.
RULED = "人工判定"

#: Where an edit is a judgement about the paper rather than a tidy-up, and so
#: has to outlive the import it was made on.
RULED_FIELDS = ("correct_answer", "answer_order", "stem", "transcript", "options", "passage")

#: The same, for what belongs to a 問題 rather than to one of its questions —
#: the passage a 問題 prints once for all its questions, its instruction, a
#: dialogue it states once. Kept with no question number, since it is about
#: none of them in particular.
PROBLEM_FIELDS = ("passage", "instruction", "transcript")

#: A ruling that a question is not there at all. 2010年12月's reprinted paper
#: lists 聴解問題3 as 1番 to 6番 「(2*6)」, while its answer table, its 解析
#: and a separate scanned key all have five: the sixth is the reprint's,
#: not the test's, and kept it is a question with no dialogue and no answer.
REMOVED = "removed"

#: Fields whose ruling is also a statement about the answer, and so goes
#: among the votes.
ANSWER_FIELDS = ("correct_answer", "answer_order")


def encode(field: str, value) -> str | None:
    """A field's value as the ruling table stores it."""
    if value is None:
        return None
    if field == "options":
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def decode(field: str, text: str | None):
    """A ruling's value back into the field's own shape."""
    if text is None:
        return None
    if field == "options":
        return json.loads(text)
    return text


def with_ruling(votes: dict | None, field: str, value) -> dict:
    """The votes on a question once a person has ruled on this field.

    A ruling of "no answer" counts too — the material simply does not say,
    and somebody has looked and agreed — so it goes in as an empty vote
    rather than being left out, which is what the checks listen for.
    """
    votes = dict(votes or {})
    if field in ANSWER_FIELDS:
        votes[RULED] = "" if value is None else str(value)
    return votes


def ruled_blank(votes: dict | None) -> bool:
    """Whether a person has ruled that this question has no answer."""
    return (votes or {}).get(RULED) == ""


async def record(db, *, level: str, sitting: str, section: str, problem_name: str,
                 num, field: str, value, reason: str | None) -> None:
    """Keep a ruling, replacing any earlier one on the same field."""
    where = dict(level=level, sitting=sitting, section=section,
                 problem_name=problem_name, num=num, field=field)
    row = (await db.execute(select(ExamAdjudication).filter_by(**where))).scalars().first()
    if row is None:
        row = ExamAdjudication(**where)
        db.add(row)
    row.value = encode(field, value)
    row.reason = reason
    row.decided_by = "user"


async def load(db, level: str, sitting: str) -> dict:
    """Every ruling for a sitting, as ingest applies them."""
    rows = (await db.execute(
        select(ExamAdjudication).where(
            ExamAdjudication.level == level,
            ExamAdjudication.sitting == sitting,
        )
    )).scalars().all()
    return {
        (r.section, r.problem_name, r.num, r.field): (decode(r.field, r.value), r.reason)
        for r in rows
    }
