"""Where a word was met is recorded separately from what the word means.

The bug this guards against: an atom whose key is the dictionary form 尊ぶ but
whose meaning is 受到尊重 — the meaning of 尊ばれた, the form that happened to
appear in the text. Front and back of the card disagreeing like that teaches
the wrong thing, and it is hard to notice because it reads fluently.
"""
import asyncio

import pytest
from fastapi import HTTPException

from app.api import atoms as atoms_api
from app.schemas.atoms import CreateAtomRequest, OccurrenceInput

SENTENCE = "長年にわたって地域の人々に尊ばれてきた。"
OTHER = "古くから尊ぶべき伝統とされている。"


class _FakeDB:
    """Collects what would be written, so the recording logic can be tested
    without a database."""
    def __init__(self):
        self.added, self.committed, self.rows = [], False, []

    def add(self, obj): self.added.append(obj); self.rows.append(obj)
    async def flush(self): pass
    async def commit(self): self.committed = True

    async def execute(self, stmt):
        # Only used by record_occurrence's existence check.
        matches = self._matching(stmt)
        class _Res:
            def scalar_one_or_none(_self): return matches[0] if matches else None
        return _Res()

    def _matching(self, stmt):
        # Compare against what the caller staged, by (sentence, surface).
        wanted = getattr(self, "_probe", None)
        if wanted is None:
            return []
        return [r for r in self.rows
                if (r.sentence_text, r.surface) == wanted]


async def _record(db, atom_id, sentence, surface, meaning=None, index=None):
    """Drive the endpoint helper the way create_atom does."""
    req = CreateAtomRequest(
        type="vocabulary", key="尊ぶ",
        occurrence=OccurrenceInput(
            sentence_text=sentence, surface=surface,
            surface_meaning=meaning, sentence_index=index,
        ),
    )
    db._probe = (sentence, surface)
    await atoms_api._record_occurrence(db, atom_id, req)


def test_an_occurrence_keeps_the_form_and_the_sentence():
    db = _FakeDB()
    asyncio.run(_record(db, "a1", SENTENCE, "尊ばれた", "受到尊重", 2))
    assert len(db.rows) == 1
    row = db.rows[0]
    assert row.surface == "尊ばれた"
    assert row.surface_meaning == "受到尊重"
    assert row.sentence_text == SENTENCE
    assert row.sentence_index == 2


def test_meeting_the_word_again_elsewhere_adds_a_second_record():
    db = _FakeDB()
    asyncio.run(_record(db, "a1", SENTENCE, "尊ばれた", "受到尊重"))
    asyncio.run(_record(db, "a1", OTHER, "尊ぶべき", "应当尊敬的"))
    assert [r.surface for r in db.rows] == ["尊ばれた", "尊ぶべき"]


def test_the_same_word_in_the_same_sentence_is_recorded_once():
    """Re-analysing a text, or tapping a word twice, must not pile up."""
    db = _FakeDB()
    for _ in range(3):
        asyncio.run(_record(db, "a1", SENTENCE, "尊ばれた", "受到尊重"))
    assert len(db.rows) == 1


def test_nothing_is_recorded_when_the_caller_sends_no_occurrence():
    db = _FakeDB()
    req = CreateAtomRequest(type="vocabulary", key="尊ぶ")
    asyncio.run(atoms_api._record_occurrence(db, "a1", req))
    assert db.rows == []


def test_an_occurrence_needs_a_sentence():
    with pytest.raises(Exception):
        OccurrenceInput(surface="尊ばれた")


def test_surface_details_are_optional():
    """Not every path knows the inflected form — the sentence alone is useful."""
    occ = OccurrenceInput(sentence_text=SENTENCE)
    assert occ.surface is None and occ.surface_meaning is None


def test_the_sentence_translation_rides_along():
    """A Japanese sentence with no translation is a weak anchor when reviewing,
    and the analysis already produced one per sentence."""
    db = _FakeDB()
    req = CreateAtomRequest(
        type="vocabulary", key="尊ぶ",
        occurrence=OccurrenceInput(
            sentence_text=SENTENCE,
            sentence_translation="多年来一直受到当地居民的尊敬。",
            surface="尊ばれた",
        ),
    )
    db._probe = (SENTENCE, "尊ばれた")
    asyncio.run(atoms_api._record_occurrence(db, "a1", req))
    assert db.rows[0].sentence_translation == "多年来一直受到当地居民的尊敬。"


def test_a_translation_is_optional():
    """Video subtitles and older records may not have one."""
    occ = OccurrenceInput(sentence_text=SENTENCE)
    assert occ.sentence_translation is None
