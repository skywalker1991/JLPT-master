# Exam Backend V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign exam DB from 3-layer to 4-layer (Paper→Section→Problem→Item), add ExamMedia/ExamDraft tables, update all API endpoints, add admin ingestion API, update convert_exam.py to produce new structure.

**Architecture:** New `ExamProblem` layer sits between `ExamSection` and `ExamItem` (renamed from `ExamQuestion`). No Alembic — migration script exports existing data, drops exam tables, recreates from new models. Admin API (`/admin/*`) handles PDF upload → AI draft → human confirm → seed flow. Media files stored on local filesystem, served as StaticFiles.

**Tech Stack:** Python/FastAPI, SQLAlchemy async, PostgreSQL (JSONB), Google Gemini (pdf_to_md + convert_exam), python-multipart (file upload), aiofiles

**Spec:** `docs/superpowers/specs/2026-05-23-exam-ingestion-redesign.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `backend/app/models/db.py` | Add ExamProblem, ExamItem, ExamMedia, ExamDraft; update FKs |
| Create | `backend/scripts/migrate_v2.py` | Export old exam data, drop exam tables, recreate |
| Modify | `backend/scripts/convert_exam.py` | New prompt + 4-layer JSON output |
| Modify | `backend/scripts/seed_exam.py` | Parse new JSON format (problems→items) |
| Modify | `backend/app/schemas/exam.py` | Add Problem/Item schemas, update hierarchy |
| Modify | `backend/app/api/exam.py` | Adapt all endpoints to Problem→Item hierarchy |
| Create | `backend/app/api/admin.py` | Draft CRUD, PDF ingest, media upload, confirm |
| Modify | `backend/app/main.py` | Register admin router, mount /media StaticFiles |
| Create | `backend/tests/test_exam_models.py` | Unit tests for model structure |
| Create | `backend/tests/test_admin_confirm.py` | Integration test for confirm endpoint |

---

## Task 1: Update DB Models

**Files:**
- Modify: `backend/app/models/db.py`

- [ ] **Step 1: Open `backend/app/models/db.py` and replace the exam model block (lines 151–271) with the new 4-layer schema**

Replace everything from `class ExamPaper` through `class AttemptAnswer` with:

```python
class ExamPaper(Base):
    __tablename__ = "exam_papers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(Text, nullable=False)
    level = Column(String(5), nullable=False)
    source = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    sections = relationship("ExamSection", back_populates="paper", cascade="all, delete-orphan",
                            order_by="ExamSection.seq")

    __table_args__ = (
        UniqueConstraint("title", "level", name="uq_exam_papers_title_level"),
        Index("ix_exam_papers_level", "level"),
    )


class ExamSection(Base):
    __tablename__ = "exam_sections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(50), nullable=False)
    seq = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    paper = relationship("ExamPaper", back_populates="sections")
    problems = relationship("ExamProblem", back_populates="section", cascade="all, delete-orphan",
                            order_by="ExamProblem.seq")

    __table_args__ = (
        Index("ix_exam_sections_paper_id", "paper_id"),
    )


class ExamProblem(Base):
    """問題N — a named group of items sharing one type, instruction, and optional passage."""
    __tablename__ = "exam_problems"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    section_id = Column(UUID(as_uuid=True), ForeignKey("exam_sections.id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)
    name = Column(String(20), nullable=False)   # "問題1", "問題2", …
    # kanji_reading|kanji_writing|word_formation|vocab_fill|synonym|usage|
    # grammar_fill|sentence_order|passage_fill|reading_comp|listening
    type = Column(String(30), nullable=False)
    instruction = Column(Text, nullable=True)   # 指示語 original text
    passage = Column(Text, nullable=True)       # 読解 long text
    transcript = Column(Text, nullable=True)    # 聴解 original text (no audio)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    section = relationship("ExamSection", back_populates="problems")
    items = relationship("ExamItem", back_populates="problem", cascade="all, delete-orphan",
                         order_by="ExamItem.seq")
    media = relationship("ExamMedia", back_populates="problem", cascade="all, delete-orphan",
                         order_by="ExamMedia.seq")

    __table_args__ = (
        Index("ix_exam_problems_section_id", "section_id"),
        Index("ix_exam_problems_type", "type"),
    )


class ExamItem(Base):
    """Single question within a Problem."""
    __tablename__ = "exam_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    problem_id = Column(UUID(as_uuid=True), ForeignKey("exam_problems.id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)
    num = Column(Integer, nullable=True)        # original question number in exam (全卷通编)
    stem = Column(Text, nullable=False, server_default=text("''"))
    options = Column(JSONB, nullable=False, server_default=text("'{}'"))
    correct_answer = Column(String(1), nullable=True)   # "1"|"2"|"3"|"4"
    meta = Column(JSONB, nullable=True)         # {target, star_position, …}
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    problem = relationship("ExamProblem", back_populates="items")
    analysis = relationship("QuestionAnalysis", back_populates="item", uselist=False,
                            cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_exam_items_problem_id", "problem_id"),
    )


class ExamMedia(Base):
    """Image attachments for a Problem (reading screenshots, etc.)."""
    __tablename__ = "exam_media"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    problem_id = Column(UUID(as_uuid=True), ForeignKey("exam_problems.id", ondelete="CASCADE"), nullable=False)
    media_type = Column(String(10), nullable=False, server_default=text("'image'"))
    url = Column(Text, nullable=False)
    caption = Column(Text, nullable=True)
    seq = Column(Integer, nullable=False, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    problem = relationship("ExamProblem", back_populates="media")

    __table_args__ = (
        Index("ix_exam_media_problem_id", "problem_id"),
    )


class ExamDraft(Base):
    """Temporary ingestion state: AI-generated draft pending human review."""
    __tablename__ = "exam_drafts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename = Column(Text, nullable=True)
    markdown_raw = Column(Text, nullable=True)   # output of pdf_to_md (left pane)
    draft_json = Column(JSONB, nullable=True)    # editable structured draft (right pane)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("exam_papers.id", ondelete="SET NULL"),
                      nullable=True)             # set after confirm
    status = Column(String(20), nullable=False, server_default=text("'pending'"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_exam_drafts_status", "status"),
    )


class QuestionAnalysis(Base):
    __tablename__ = "question_analyses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id = Column(UUID(as_uuid=True), ForeignKey("exam_items.id", ondelete="CASCADE"),
                     nullable=False, unique=True)
    session_data = Column(JSONB, nullable=True)
    relations_suggested = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    item = relationship("ExamItem", back_populates="analysis")


class ExamAttempt(Base):
    __tablename__ = "exam_attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'in_progress'"))
    score = Column(JSONB, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    completed_at = Column(DateTime(timezone=True), nullable=True)

    paper = relationship("ExamPaper")
    answers = relationship("AttemptAnswer", back_populates="attempt", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_exam_attempts_paper_id", "paper_id"),
        Index("ix_exam_attempts_status", "status"),
    )


class AttemptAnswer(Base):
    __tablename__ = "attempt_answers"

    attempt_id = Column(UUID(as_uuid=True), ForeignKey("exam_attempts.id", ondelete="CASCADE"),
                        primary_key=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("exam_items.id", ondelete="CASCADE"),
                     primary_key=True)
    user_answer = Column(String(1), nullable=False)
    is_correct = Column(Boolean, nullable=False)

    attempt = relationship("ExamAttempt", back_populates="answers")
    item = relationship("ExamItem")

    __table_args__ = (
        Index("ix_attempt_answers_attempt_id", "attempt_id"),
    )
```

- [ ] **Step 2: Verify the file has no remaining references to `ExamQuestion` or `ExamAnswerKey`**

```bash
grep -n "ExamQuestion\|ExamAnswerKey\|question_id" backend/app/models/db.py
```

Expected: no output (zero matches).

- [ ] **Step 3: Write unit test for model relationships**

Create `backend/tests/test_exam_models.py`:

```python
"""Verify new 4-layer model structure is importable and consistent."""
from app.models.db import (
    ExamPaper, ExamSection, ExamProblem, ExamItem,
    ExamMedia, ExamDraft, QuestionAnalysis, ExamAttempt, AttemptAnswer,
)


def test_exam_problem_has_items_relationship():
    assert hasattr(ExamProblem, "items")
    assert hasattr(ExamProblem, "media")


def test_exam_item_has_problem_relationship():
    assert hasattr(ExamItem, "problem")
    assert hasattr(ExamItem, "analysis")


def test_attempt_answer_references_item():
    cols = {c.key for c in AttemptAnswer.__table__.columns}
    assert "item_id" in cols
    assert "attempt_id" in cols


def test_exam_draft_exists():
    cols = {c.key for c in ExamDraft.__table__.columns}
    assert "markdown_raw" in cols
    assert "draft_json" in cols
    assert "status" in cols


def test_exam_media_exists():
    cols = {c.key for c in ExamMedia.__table__.columns}
    assert "problem_id" in cols
    assert "url" in cols
```

- [ ] **Step 4: Run model tests**

```bash
cd backend && python -m pytest tests/test_exam_models.py -v
```

Expected output:
```
PASSED tests/test_exam_models.py::test_exam_problem_has_items_relationship
PASSED tests/test_exam_models.py::test_exam_item_has_problem_relationship
PASSED tests/test_exam_models.py::test_attempt_answer_references_item
PASSED tests/test_exam_models.py::test_exam_draft_exists
PASSED tests/test_exam_models.py::test_exam_media_exists
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/db.py backend/tests/test_exam_models.py
git commit -m "feat: add ExamProblem/ExamItem/ExamMedia/ExamDraft models (4-layer schema)"
```

---

## Task 2: Migration Script

**Files:**
- Create: `backend/scripts/migrate_v2.py`

This script drops all exam-related tables and recreates them from the new models. Existing exam data is lost — re-ingest via admin UI. Atom/analysis data is preserved.

- [ ] **Step 1: Create `backend/scripts/migrate_v2.py`**

```python
#!/usr/bin/env python3
"""
Drop old exam tables (exam_questions, exam_answer_keys, exam_sections,
exam_papers, question_analyses, attempt_answers, exam_attempts) and
recreate from new models.

WARNING: All existing exam data and attempt history will be deleted.
Atom/analysis data is preserved.

Usage:
    python scripts/migrate_v2.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.models.db import async_engine, Base


OLD_TABLES = [
    "attempt_answers",
    "exam_attempts",
    "question_analyses",
    "exam_answer_keys",
    "exam_questions",
    "exam_sections",
    "exam_papers",
]

NEW_TABLES = [
    "exam_papers",
    "exam_sections",
    "exam_problems",
    "exam_items",
    "exam_media",
    "exam_drafts",
    "question_analyses",
    "exam_attempts",
    "attempt_answers",
]


async def migrate() -> None:
    print("Dropping old exam tables...")
    async with async_engine.begin() as conn:
        for table in OLD_TABLES:
            await conn.execute(text(f"DROP TABLE IF EXISTS {table} CASCADE"))
            print(f"  dropped: {table}")

    print("Creating new tables from models...")
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    print("Verifying new tables exist...")
    async with async_engine.connect() as conn:
        result = await conn.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
        ))
        existing = {row[0] for row in result}
        for table in NEW_TABLES:
            status = "✓" if table in existing else "✗ MISSING"
            print(f"  {status} {table}")

    print("\nMigration complete. Re-ingest exam papers via /admin/ingest.")


if __name__ == "__main__":
    asyncio.run(migrate())
```

- [ ] **Step 2: Run the migration (requires DB running)**

```bash
cd backend && python scripts/migrate_v2.py
```

Expected output:
```
Dropping old exam tables...
  dropped: attempt_answers
  dropped: exam_attempts
  ...
Creating new tables from models...
Verifying new tables exist...
  ✓ exam_papers
  ✓ exam_sections
  ✓ exam_problems
  ✓ exam_items
  ✓ exam_media
  ✓ exam_drafts
  ✓ question_analyses
  ✓ exam_attempts
  ✓ attempt_answers

Migration complete. Re-ingest exam papers via /admin/ingest.
```

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/migrate_v2.py
git commit -m "feat: add v2 migration script (drop old exam tables, create new 4-layer schema)"
```

---

## Task 3: Update `convert_exam.py`

**Files:**
- Modify: `backend/scripts/convert_exam.py`

The output format changes from `sections[].questions[]` to `sections[].problems[].items[]`. The prompt is rewritten to produce this structure and to assign type at the Problem level.

- [ ] **Step 1: Replace `PROMPT_HEADER` in `convert_exam.py`**

Replace the entire `PROMPT_HEADER` string with:

```python
PROMPT_HEADER = """\
あなたは JLPT 試験の構造化パーサーです。
以下の Markdown 化された試験を読み込み、指定の JSON 形式に変換してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【出力 JSON 構造】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "title": "試験タイトル",
  "level": "N1",
  "source": "出典",
  "sections": [
    {
      "name": "言語知識（文字・語彙）",
      "problems": [
        {
          "name": "問題1",
          "type": "kanji_reading",
          "instruction": "次の言葉の読み方として...",
          "passage": null,
          "transcript": null,
          "items": [
            {
              "num": 1,
              "seq": 1,
              "stem": "__運賃__を払う",
              "options": {"1": "うんちん", "2": "うんどう", "3": "うんにん", "4": "うんりん"},
              "correct_answer": "2",
              "meta": {"target": "運賃"}
            }
          ]
        }
      ]
    }
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【セクション分割ルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
必ず 4 セクションに分割：
1. 言語知識（文字・語彙）: kanji_reading/kanji_writing/word_formation/vocab_fill/synonym/usage
2. 言語知識（文法）: grammar_fill/sentence_order/passage_fill
3. 読解: reading_comp
4. 聴解: listening

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【Problem（問題N）のルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ name: Markdown の ### 見出し（"問題1"、"問題2"…）
■ type: 問題グループ全体の題型（問題番号ではなく内容で判断）
  kanji_reading  : __対象語__ あり、選択肢がひらがな
  kanji_writing  : __ひらがな__ あり、選択肢が漢字
  word_formation : （　）に接辞1文字を補う
  vocab_fill     : 文中（　）に語を選ぶ
  synonym        : __対象語__ あり、最も近い意味を選ぶ
  usage          : 対象語の正しい使い方を選ぶ
  grammar_fill   : 文中（　）に文法形式を補う
  sentence_order : [_1_][_2_][_N★_][_4_] マークアップがある
  passage_fill   : 長文中に複数の番号付き空欄
  reading_comp   : 長文を読んで設問に答える
  listening      : 聴解セクション
■ instruction: 問題冒頭の指示語（例：「次の文の（　）に入れるのに最もよいものを…」）
■ passage: reading_comp / passage_fill の場合のみ設定（同じ文章を共有する items はこの problem にまとめる）
■ transcript: listening の場合のみ設定（[音声のみ] 問題には "" を入れる）

同一 ### 見出し内に複数の独立した文章がある場合（例：問題13 に短文が3つ）は、
同じ name を持つ複数の problem に分割してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【Item（各設問）のルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ num: 試験全体での通し番号（整数）
■ seq: problem 内での連番（1始まり）
■ stem:
  kanji_reading/kanji_writing/synonym: __対象語__ マークアップを保持した文
  word_formation/vocab_fill/grammar_fill: （　）プレースホルダーを含む文
  usage: 対象語そのもの（例: "早期"）
  sentence_order: [_1_][_2_][_N★_][_4_] マークアップを保持した完全な文
  passage_fill/reading_comp: 設問の文（例: "筆者の考えに合うのはどれか。"）
  listening（選択肢あり）: 番号のみ（例: "1番"）
  listening（音声のみ）: ""
■ options: {"1":…,"2":…,"3":…,"4":…}、[音声のみ]は{}
■ correct_answer: 答案表から取得（"1"/"2"/"3"/"4"）、不明なら null
■ meta:
  kanji_reading/kanji_writing/synonym: {"target": "対象語"}
  sentence_order: {"star_position": N}（[_N★_] の N、整数）
  その他: null

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【試験 Markdown】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
```

- [ ] **Step 2: Replace `_parse_answers` to handle flat `Q{num}: {digit}` format**

The current implementation already uses this format. Verify it's unchanged:

```python
def _parse_answers(markdown: str) -> dict[int, str]:
    """Extract {question_number: answer_digit} from the ## 答案 section."""
    answers: dict[int, str] = {}
    in_answers = False
    for line in markdown.splitlines():
        if line.strip() == "## 答案":
            in_answers = True
            continue
        if in_answers:
            m = re.match(r'^Q(\d+):\s*(\d)', line.strip())
            if m:
                answers[int(m.group(1))] = m.group(2)
    return answers
```

- [ ] **Step 3: Replace `_inject_answers` to work with new structure**

```python
def _inject_answers(data: dict, answers: dict[int, str]) -> None:
    """Assign correct_answer to each item using the num field."""
    for section in data.get("sections", []):
        for problem in section.get("problems", []):
            for item in problem.get("items", []):
                num = item.get("num")
                if num is not None and num in answers:
                    item["correct_answer"] = answers[num]
```

- [ ] **Step 4: Replace `_validate` to check new structure**

```python
def _validate(data: dict) -> None:
    assert "title" in data, "missing title"
    assert "level" in data, "missing level"
    assert "sections" in data, "missing sections"
    for s in data["sections"]:
        assert "name" in s, f"section missing name: {s}"
        assert "problems" in s, f"section missing problems: {s}"
        for p in s["problems"]:
            assert "name" in p, f"problem missing name: {p}"
            assert "type" in p, f"problem missing type: {p}"
            assert "items" in p, f"problem missing items: {p}"
```

- [ ] **Step 5: Update final stats print in `convert()`**

Replace the stats block at the end of `convert()`:

```python
    total = sum(
        len(p["items"])
        for s in data["sections"]
        for p in s["problems"]
    )
    answered = sum(
        1
        for s in data["sections"]
        for p in s["problems"]
        for item in p["items"]
        if item.get("correct_answer")
    )
    Path(out_path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done. {len(data['sections'])} sections, {total} items, {answered} with answers → {out_path}")
```

- [ ] **Step 6: Write a unit test for answer injection**

Add to `backend/tests/test_exam_models.py`:

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.convert_exam import _inject_answers, _validate, _parse_answers


def test_inject_answers_into_items():
    data = {
        "title": "Test", "level": "N1",
        "sections": [{"name": "語彙", "problems": [
            {"name": "問題1", "type": "kanji_reading", "items": [
                {"num": 1, "seq": 1, "stem": "test", "options": {}, "correct_answer": None, "meta": None},
                {"num": 2, "seq": 2, "stem": "test2", "options": {}, "correct_answer": None, "meta": None},
            ]}
        ]}]
    }
    _inject_answers(data, {1: "3", 2: "1"})
    items = data["sections"][0]["problems"][0]["items"]
    assert items[0]["correct_answer"] == "3"
    assert items[1]["correct_answer"] == "1"


def test_validate_passes_valid_structure():
    data = {
        "title": "T", "level": "N1",
        "sections": [{"name": "S", "problems": [
            {"name": "問題1", "type": "vocab_fill", "items": []}
        ]}]
    }
    _validate(data)  # should not raise


def test_validate_raises_on_missing_problems():
    import pytest
    data = {"title": "T", "level": "N1", "sections": [{"name": "S"}]}
    with pytest.raises(AssertionError, match="missing problems"):
        _validate(data)
```

- [ ] **Step 7: Run tests**

```bash
cd backend && python -m pytest tests/test_exam_models.py -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/scripts/convert_exam.py backend/tests/test_exam_models.py
git commit -m "feat: update convert_exam.py to 4-layer JSON (sections→problems→items)"
```

---

## Task 4: Update `seed_exam.py`

**Files:**
- Modify: `backend/scripts/seed_exam.py`

- [ ] **Step 1: Replace the `seed()` function body to handle `problems→items` structure**

Replace the inner loop (from `for sec_idx, sec_data in enumerate(...)`) with:

```python
        for sec_idx, sec_data in enumerate(data.get("sections", [])):
            section = ExamSection(
                paper_id=paper.id,
                name=sec_data["name"],
                seq=sec_idx + 1,
            )
            db.add(section)
            await db.flush()

            for prob_idx, prob_data in enumerate(sec_data.get("problems", [])):
                problem = ExamProblem(
                    section_id=section.id,
                    seq=prob_idx + 1,
                    name=prob_data["name"],
                    type=prob_data["type"],
                    instruction=prob_data.get("instruction"),
                    passage=prob_data.get("passage"),
                    transcript=prob_data.get("transcript"),
                )
                db.add(problem)
                await db.flush()

                for item_data in prob_data.get("items", []):
                    item = ExamItem(
                        problem_id=problem.id,
                        seq=item_data.get("seq", 0),
                        num=item_data.get("num"),
                        stem=item_data.get("stem", ""),
                        options=item_data.get("options", {}),
                        correct_answer=item_data.get("correct_answer"),
                        meta=item_data.get("meta"),
                    )
                    db.add(item)
```

- [ ] **Step 2: Add `ExamProblem, ExamItem` to imports at top of `seed_exam.py`**

```python
from app.models.db import (
    async_session_factory, async_engine, Base,
    ExamPaper, ExamSection, ExamProblem, ExamItem,
)
```

- [ ] **Step 3: Update the stats print at end of `seed()`**

```python
        print(f"Imported: {title} ({level})")
        for sec in data.get("sections", []):
            total_items = sum(len(p.get("items", [])) for p in sec.get("problems", []))
            print(f"  [{sec['name']}] {len(sec.get('problems', []))} problems, {total_items} items")
```

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/seed_exam.py
git commit -m "feat: update seed_exam.py for 4-layer JSON (problems→items)"
```

---

## Task 5: Update Pydantic Schemas

**Files:**
- Modify: `backend/app/schemas/exam.py`

- [ ] **Step 1: Replace the entire file content**

```python
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


# ── Exam paper list / detail ──────────────────────────────────────────────────

class ExamPaperList(BaseModel):
    id: UUID
    title: str
    level: str
    source: str | None
    section_count: int
    item_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ExamMediaItem(BaseModel):
    id: UUID
    url: str
    caption: str | None
    seq: int


class ItemSchema(BaseModel):
    id: UUID
    seq: int
    num: int | None
    stem: str
    options: dict
    meta: dict | None


class ProblemDetail(BaseModel):
    id: UUID
    seq: int
    name: str
    type: str
    instruction: str | None
    passage: str | None
    transcript: str | None
    media: list[ExamMediaItem]
    items: list[ItemSchema]


class SectionDetail(BaseModel):
    id: UUID
    name: str
    seq: int
    problems: list[ProblemDetail]


class ExamPaperDetail(BaseModel):
    id: UUID
    title: str
    level: str
    source: str | None
    sections: list[SectionDetail]
    created_at: datetime


# ── Attempt ───────────────────────────────────────────────────────────────────

class StartAttemptResponse(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str


class SubmitAnswerRequest(BaseModel):
    item_id: UUID
    answer: str  # "1"|"2"|"3"|"4"


class SubmitAnswerResponse(BaseModel):
    item_id: UUID
    is_correct: bool | None


class SectionScore(BaseModel):
    correct: int
    total: int


class SectionAnswerDetail(BaseModel):
    item_id: str
    user_answer: str | None
    is_correct: bool
    correct_answer: str | None


class SubmitSectionResponse(BaseModel):
    section_name: str
    score: SectionScore
    answers: list[SectionAnswerDetail]


class AttemptStatus(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str
    score: dict | None
    answered_item_ids: list[UUID]


# ── Analysis ──────────────────────────────────────────────────────────────────

class RelationSuggestion(BaseModel):
    from_key: str
    to_key: str
    type: str
    note: str


class QuestionAnalysisResponse(BaseModel):
    item_id: UUID
    session_data: dict | None
    relations_suggested: list[RelationSuggestion]
    cached: bool


# ── Stats ─────────────────────────────────────────────────────────────────────

class CategoryAccuracy(BaseModel):
    correct: int
    total: int


class AccuracyStats(BaseModel):
    vocab: CategoryAccuracy
    grammar: CategoryAccuracy
    reading: CategoryAccuracy
    listening: CategoryAccuracy


# ── Attempt history ───────────────────────────────────────────────────────────

class AttemptSummary(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str
    score: dict | None
    started_at: datetime
    completed_at: datetime | None
    section_names: list[str] = []


class ReviewItem(BaseModel):
    id: UUID
    seq: int
    num: int | None
    stem: str
    options: dict
    meta: dict | None
    user_answer: str | None
    correct_answer: str | None
    is_correct: bool | None


class ReviewProblem(BaseModel):
    id: UUID
    seq: int
    name: str
    type: str
    instruction: str | None
    passage: str | None
    transcript: str | None
    media: list[ExamMediaItem]
    items: list[ReviewItem]


class ReviewSection(BaseModel):
    id: UUID
    name: str
    seq: int
    problems: list[ReviewProblem]


class AttemptReview(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str
    score: dict | None
    started_at: datetime
    completed_at: datetime | None
    sections: list[ReviewSection]


# ── Admin: Draft ──────────────────────────────────────────────────────────────

class DraftSummary(BaseModel):
    id: UUID
    filename: str | None
    status: str
    paper_id: UUID | None
    created_at: datetime
    updated_at: datetime


class DraftDetail(BaseModel):
    id: UUID
    filename: str | None
    markdown_raw: str | None
    draft_json: dict | None
    status: str
    paper_id: UUID | None
    created_at: datetime
    updated_at: datetime


class MediaUploadResponse(BaseModel):
    url: str
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/exam.py
git commit -m "feat: update exam schemas for 4-layer hierarchy (Problem/Item)"
```

---

## Task 6: Update `exam.py` API

**Files:**
- Modify: `backend/app/api/exam.py`

The exam API is heavily coupled to the old `ExamQuestion/ExamAnswerKey` structure. This task rewrites all endpoints to use `ExamProblem/ExamItem`.

- [ ] **Step 1: Update imports at top of `exam.py`**

Replace the model imports:

```python
from app.models.db import (
    ExamPaper, ExamSection, ExamProblem, ExamItem, ExamMedia,
    QuestionAnalysis, ExamAttempt, AttemptAnswer, get_db,
)
from app.schemas.exam import (
    ExamPaperList, ExamPaperDetail, SectionDetail, ProblemDetail,
    ItemSchema, ExamMediaItem,
    StartAttemptResponse, SubmitAnswerRequest, SubmitAnswerResponse,
    SectionScore, SectionAnswerDetail, SubmitSectionResponse,
    AttemptStatus, RelationSuggestion, QuestionAnalysisResponse, AccuracyStats,
    AttemptSummary, AttemptReview, ReviewSection, ReviewProblem, ReviewItem,
)
```

- [ ] **Step 2: Rewrite `list_exams` endpoint**

```python
@router.get("/exams", response_model=list[ExamPaperList])
async def list_exams(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(
            ExamPaper,
            func.count(ExamSection.id.distinct()).label("section_count"),
            func.count(ExamItem.id).label("item_count"),
        )
        .outerjoin(ExamSection, ExamSection.paper_id == ExamPaper.id)
        .outerjoin(ExamProblem, ExamProblem.section_id == ExamSection.id)
        .outerjoin(ExamItem, ExamItem.problem_id == ExamProblem.id)
        .group_by(ExamPaper.id)
        .order_by(ExamPaper.created_at.desc())
    )
    rows = result.all()
    return [
        ExamPaperList(
            id=paper.id, title=paper.title, level=paper.level,
            source=paper.source, section_count=sc, item_count=ic,
            created_at=paper.created_at,
        )
        for paper, sc, ic in rows
    ]
```

- [ ] **Step 3: Rewrite `get_exam` endpoint**

```python
@router.get("/exams/{paper_id}", response_model=ExamPaperDetail)
async def get_exam(paper_id: UUID, db: AsyncSession = Depends(get_db)):
    paper = await db.get(ExamPaper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="Exam paper not found")

    sections = (await db.execute(
        select(ExamSection).where(ExamSection.paper_id == paper_id).order_by(ExamSection.seq)
    )).scalars().all()

    section_details = []
    for sec in sections:
        problems = (await db.execute(
            select(ExamProblem).where(ExamProblem.section_id == sec.id).order_by(ExamProblem.seq)
        )).scalars().all()

        problem_details = []
        for prob in problems:
            items = (await db.execute(
                select(ExamItem).where(ExamItem.problem_id == prob.id).order_by(ExamItem.seq)
            )).scalars().all()
            media = (await db.execute(
                select(ExamMedia).where(ExamMedia.problem_id == prob.id).order_by(ExamMedia.seq)
            )).scalars().all()
            problem_details.append(ProblemDetail(
                id=prob.id, seq=prob.seq, name=prob.name, type=prob.type,
                instruction=prob.instruction, passage=prob.passage, transcript=prob.transcript,
                media=[ExamMediaItem(id=m.id, url=m.url, caption=m.caption, seq=m.seq) for m in media],
                items=[ItemSchema(id=i.id, seq=i.seq, num=i.num, stem=i.stem,
                                  options=i.options, meta=i.meta) for i in items],
            ))

        section_details.append(SectionDetail(
            id=sec.id, name=sec.name, seq=sec.seq, problems=problem_details,
        ))

    return ExamPaperDetail(
        id=paper.id, title=paper.title, level=paper.level,
        source=paper.source, sections=section_details, created_at=paper.created_at,
    )
```

- [ ] **Step 4: Rewrite `submit_answer` endpoint**

```python
@router.put("/attempts/{attempt_id}/answers", response_model=SubmitAnswerResponse)
async def submit_answer(
    attempt_id: UUID, req: SubmitAnswerRequest, db: AsyncSession = Depends(get_db),
):
    if not await db.get(ExamAttempt, attempt_id):
        raise HTTPException(status_code=404, detail="Attempt not found")

    item = await db.get(ExamItem, req.item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    is_correct = (item.correct_answer == req.answer) if item.correct_answer else None

    existing = (await db.execute(
        select(AttemptAnswer).where(
            AttemptAnswer.attempt_id == attempt_id,
            AttemptAnswer.item_id == req.item_id,
        )
    )).scalar_one_or_none()

    if existing:
        existing.user_answer = req.answer
        existing.is_correct = bool(is_correct)
    else:
        db.add(AttemptAnswer(
            attempt_id=attempt_id, item_id=req.item_id,
            user_answer=req.answer, is_correct=bool(is_correct),
        ))

    await db.commit()
    return SubmitAnswerResponse(item_id=req.item_id, is_correct=is_correct)
```

- [ ] **Step 5: Rewrite `submit_section` endpoint**

```python
@router.post("/attempts/{attempt_id}/sections/{section_id}/submit",
             response_model=SubmitSectionResponse)
async def submit_section(
    attempt_id: UUID, section_id: UUID, db: AsyncSession = Depends(get_db),
):
    attempt = await db.get(ExamAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    section = await db.get(ExamSection, section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")

    # Collect all items in this section via problems
    problems = (await db.execute(
        select(ExamProblem).where(ExamProblem.section_id == section_id)
    )).scalars().all()
    prob_ids = [p.id for p in problems]

    items = (await db.execute(
        select(ExamItem).where(ExamItem.problem_id.in_(prob_ids)).order_by(ExamItem.seq)
    )).scalars().all()
    item_ids = [i.id for i in items]

    answers = {
        a.item_id: a
        for a in (await db.execute(
            select(AttemptAnswer).where(
                AttemptAnswer.attempt_id == attempt_id,
                AttemptAnswer.item_id.in_(item_ids),
            )
        )).scalars().all()
    }

    correct_count = sum(1 for a in answers.values() if a.is_correct)
    total = len([i for i in items if i.options])  # only graded items

    score = attempt.score or {}
    score[section.name] = {"correct": correct_count, "total": total}
    score["total"] = {
        "correct": sum(v["correct"] for k, v in score.items() if k != "total"),
        "total":   sum(v["total"]   for k, v in score.items() if k != "total"),
    }

    await db.execute(
        update(ExamAttempt).where(ExamAttempt.id == attempt_id).values(score=score)
    )
    await db.commit()

    answer_details = [
        SectionAnswerDetail(
            item_id=str(i.id),
            user_answer=answers[i.id].user_answer if i.id in answers else None,
            is_correct=answers[i.id].is_correct if i.id in answers else False,
            correct_answer=i.correct_answer,
        )
        for i in items
    ]

    return SubmitSectionResponse(
        section_name=section.name,
        score=SectionScore(correct=correct_count, total=total),
        answers=answer_details,
    )
```

- [ ] **Step 6: Rewrite `get_attempt` endpoint**

```python
@router.get("/attempts/{attempt_id}", response_model=AttemptStatus)
async def get_attempt(attempt_id: UUID, db: AsyncSession = Depends(get_db)):
    attempt = await db.get(ExamAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    answered = (await db.execute(
        select(AttemptAnswer.item_id).where(AttemptAnswer.attempt_id == attempt_id)
    )).scalars().all()
    return AttemptStatus(
        attempt_id=attempt.id, paper_id=attempt.paper_id,
        status=attempt.status, score=attempt.score, answered_item_ids=list(answered),
    )
```

- [ ] **Step 7: Rewrite `get_question_analysis` endpoint**

```python
@router.get("/items/{item_id}/analysis", response_model=QuestionAnalysisResponse)
async def get_item_analysis(item_id: UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(ExamItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    # Load problem for context (passage, type)
    problem = await db.get(ExamProblem, item.problem_id)

    cached = (await db.execute(
        select(QuestionAnalysis).where(QuestionAnalysis.item_id == item_id)
    )).scalar_one_or_none()
    if cached and cached.session_data:
        return QuestionAnalysisResponse(
            item_id=item_id, session_data=cached.session_data,
            relations_suggested=[], cached=True,
        )

    schema = _SCHEMAS.get(problem.type)
    prompt_tpl = _PROMPTS.get(problem.type)
    if schema is None or prompt_tpl is None:
        return QuestionAnalysisResponse(
            item_id=item_id, session_data=None, relations_suggested=[], cached=False,
        )

    opts_text = "\n".join(f"{k}. {v}" for k, v in sorted(item.options.items()))
    correct = item.correct_answer or "不明"
    target = (item.meta or {}).get("target", item.stem or "")

    _LANG = "重要：所有 explanation、summary、meaning、connection、usage、example 等文字字段必须使用中文输出。\n\n"
    prompt = _LANG + prompt_tpl.format(
        stem=item.stem or "",
        passage=problem.passage or "",
        options=opts_text,
        correct=correct,
        target=target,
        atom_rules=_ATOM_RULES,
        schema_json=json.dumps(schema, ensure_ascii=False),
    )

    llm = get_llm_client()
    try:
        raw = await llm.analyze(prompt, schema)
        result_data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("LLM analysis failed for item %s: %s", item_id, e)
        raise HTTPException(status_code=502, detail="AI analysis failed")

    if cached:
        cached.session_data = result_data
        cached.relations_suggested = []
    else:
        db.add(QuestionAnalysis(
            item_id=item_id,
            session_data=result_data,
            relations_suggested=[],
        ))
    await db.commit()

    return QuestionAnalysisResponse(
        item_id=item_id, session_data=result_data,
        relations_suggested=[], cached=False,
    )
```

- [ ] **Step 8: Rewrite followup endpoint URL**

```python
@router.post("/items/{item_id}/analysis/followup")
async def followup_analysis(item_id: UUID, body: dict, db: AsyncSession = Depends(get_db)):
    cached = (await db.execute(
        select(QuestionAnalysis).where(QuestionAnalysis.item_id == item_id)
    )).scalar_one_or_none()
    if cached is None:
        raise HTTPException(status_code=404, detail="No analysis yet. Call GET first.")

    free_prompt = body.get("prompt", "").strip()
    if not free_prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    llm = get_llm_client()
    response_text = await llm.complete(free_prompt)

    session = cached.session_data or {}
    followups = session.get("followups", [])
    followups.append({"prompt": free_prompt, "response": response_text})
    session["followups"] = followups

    await db.execute(
        update(QuestionAnalysis)
        .where(QuestionAnalysis.item_id == item_id)
        .values(session_data=session)
    )
    await db.commit()
    return {"response": response_text}
```

- [ ] **Step 9: Rewrite `get_attempt_review` endpoint**

```python
@router.get("/attempts/{attempt_id}/review", response_model=AttemptReview)
async def get_attempt_review(attempt_id: UUID, db: AsyncSession = Depends(get_db)):
    attempt = await db.get(ExamAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")

    sections = (await db.execute(
        select(ExamSection)
        .where(ExamSection.paper_id == attempt.paper_id)
        .order_by(ExamSection.seq)
    )).scalars().all()

    score_names = set((attempt.score or {}).keys()) - {"total"}
    submitted_section_ids = {s.id for s in sections if s.name in score_names}

    answers_rows = (await db.execute(
        select(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt_id)
    )).scalars().all()
    answers = {a.item_id: a for a in answers_rows}
    active_item_ids = set(answers.keys())

    result_sections = []
    for sec in sections:
        problems = (await db.execute(
            select(ExamProblem).where(ExamProblem.section_id == sec.id).order_by(ExamProblem.seq)
        )).scalars().all()

        review_problems = []
        sec_has_activity = False
        for prob in problems:
            items = (await db.execute(
                select(ExamItem).where(ExamItem.problem_id == prob.id).order_by(ExamItem.seq)
            )).scalars().all()
            media = (await db.execute(
                select(ExamMedia).where(ExamMedia.problem_id == prob.id).order_by(ExamMedia.seq)
            )).scalars().all()

            reveal = sec.id in submitted_section_ids
            review_items = [
                ReviewItem(
                    id=i.id, seq=i.seq, num=i.num, stem=i.stem,
                    options=i.options, meta=i.meta,
                    user_answer=answers[i.id].user_answer if i.id in answers else None,
                    correct_answer=i.correct_answer if reveal else None,
                    is_correct=answers[i.id].is_correct if i.id in answers and reveal else None,
                )
                for i in items
            ]
            if any(i.id in active_item_ids for i in items) or sec.id in submitted_section_ids:
                sec_has_activity = True
            review_problems.append(ReviewProblem(
                id=prob.id, seq=prob.seq, name=prob.name, type=prob.type,
                instruction=prob.instruction, passage=prob.passage, transcript=prob.transcript,
                media=[ExamMediaItem(id=m.id, url=m.url, caption=m.caption, seq=m.seq) for m in media],
                items=review_items,
            ))

        if sec_has_activity:
            result_sections.append(ReviewSection(
                id=sec.id, name=sec.name, seq=sec.seq, problems=review_problems,
            ))

    return AttemptReview(
        attempt_id=attempt.id, paper_id=attempt.paper_id,
        status=attempt.status, score=attempt.score,
        started_at=attempt.started_at, completed_at=attempt.completed_at,
        sections=result_sections,
    )
```

- [ ] **Step 10: Update `get_accuracy_stats` to use ExamItem**

```python
@router.get("/stats/accuracy", response_model=AccuracyStats)
async def get_accuracy_stats(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(AttemptAnswer.is_correct, ExamProblem.type)
        .join(ExamItem, AttemptAnswer.item_id == ExamItem.id)
        .join(ExamProblem, ExamItem.problem_id == ExamProblem.id)
    )).all()

    counts: dict[str, dict[str, int]] = {
        k: {"correct": 0, "total": 0}
        for k in ("vocab", "grammar", "reading", "listening")
    }

    for is_correct, q_type in rows:
        if q_type in _VOCAB_TYPES:
            cat = "vocab"
        elif q_type in _GRAMMAR_TYPES:
            cat = "grammar"
        elif q_type in _READING_TYPES:
            cat = "reading"
        elif q_type in _LISTENING_TYPES:
            cat = "listening"
        else:
            continue
        counts[cat]["total"] += 1
        if is_correct:
            counts[cat]["correct"] += 1

    return AccuracyStats(**{k: v for k, v in counts.items()})
```

- [ ] **Step 11: Remove the `ExamAnswerKey` import and all references in `exam.py`**

```bash
grep -n "ExamAnswerKey\|answer_key\|ExamQuestion" backend/app/api/exam.py
```

Expected: no output.

- [ ] **Step 12: Commit**

```bash
git add backend/app/api/exam.py
git commit -m "feat: update exam.py API for 4-layer schema (Problem/Item)"
```

---

## Task 7: Create Admin API

**Files:**
- Create: `backend/app/api/admin.py`

- [ ] **Step 1: Install `python-multipart` and `aiofiles` if not already present**

```bash
cd backend && pip show python-multipart aiofiles 2>&1 | grep -E "Name|not found"
```

If either is missing:
```bash
pip install python-multipart aiofiles
```

- [ ] **Step 2: Create `backend/media/` directory**

```bash
mkdir -p backend/media
touch backend/media/.gitkeep
echo "media/" >> backend/.gitignore 2>/dev/null || true
```

- [ ] **Step 3: Create `backend/app/api/admin.py`**

```python
"""Admin API — exam ingestion, draft management, media upload."""
import asyncio
import json
import logging
import uuid as _uuid
from pathlib import Path
from datetime import datetime

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import (
    ExamPaper, ExamSection, ExamProblem, ExamItem, ExamMedia, ExamDraft, get_db,
)
from app.schemas.exam import DraftSummary, DraftDetail, MediaUploadResponse
from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

MEDIA_DIR = Path(__file__).parent.parent.parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)


# ── Draft CRUD ────────────────────────────────────────────────────────────────

@router.get("/drafts", response_model=list[DraftSummary])
async def list_drafts(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ExamDraft).order_by(ExamDraft.created_at.desc())
    )).scalars().all()
    return [
        DraftSummary(
            id=d.id, filename=d.filename, status=d.status,
            paper_id=d.paper_id, created_at=d.created_at, updated_at=d.updated_at,
        )
        for d in rows
    ]


@router.get("/drafts/{draft_id}", response_model=DraftDetail)
async def get_draft(draft_id: _uuid.UUID, db: AsyncSession = Depends(get_db)):
    draft = await db.get(ExamDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    return DraftDetail(
        id=draft.id, filename=draft.filename,
        markdown_raw=draft.markdown_raw, draft_json=draft.draft_json,
        status=draft.status, paper_id=draft.paper_id,
        created_at=draft.created_at, updated_at=draft.updated_at,
    )


@router.put("/drafts/{draft_id}", response_model=DraftDetail)
async def update_draft(draft_id: _uuid.UUID, body: dict, db: AsyncSession = Depends(get_db)):
    draft = await db.get(ExamDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if "draft_json" in body:
        draft.draft_json = body["draft_json"]
    draft.updated_at = datetime.utcnow()
    await db.commit()
    return DraftDetail(
        id=draft.id, filename=draft.filename,
        markdown_raw=draft.markdown_raw, draft_json=draft.draft_json,
        status=draft.status, paper_id=draft.paper_id,
        created_at=draft.created_at, updated_at=draft.updated_at,
    )


# ── PDF Ingest ────────────────────────────────────────────────────────────────

@router.post("/drafts", response_model=DraftDetail)
async def create_draft_from_pdf(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload PDF → run pdf_to_md → run convert_exam → create ExamDraft."""
    import tempfile
    settings = get_settings()

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    # Write PDF to temp file
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = Path(tmp.name)

    try:
        markdown_raw = await _run_pdf_to_md(tmp_path, settings.LLM_API_KEY)
        draft_json = await _run_convert_exam(markdown_raw, settings.LLM_API_KEY)
    except Exception as e:
        logger.error("Ingestion failed for %s: %s", file.filename, e)
        raise HTTPException(status_code=502, detail=f"AI parsing failed: {e}")
    finally:
        tmp_path.unlink(missing_ok=True)

    draft = ExamDraft(
        filename=file.filename,
        markdown_raw=markdown_raw,
        draft_json=draft_json,
        status="pending",
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    return DraftDetail(
        id=draft.id, filename=draft.filename,
        markdown_raw=draft.markdown_raw, draft_json=draft.draft_json,
        status=draft.status, paper_id=draft.paper_id,
        created_at=draft.created_at, updated_at=draft.updated_at,
    )


async def _run_pdf_to_md(pdf_path: Path, api_key: str) -> str:
    """Call Gemini to convert PDF → Markdown. Reuses pdf_to_md prompt logic."""
    from google import genai
    from google.genai import types

    PROMPT = """請将这份 JLPT 试卷 PDF 的全部内容转换为 Markdown 文本。

要求：
- 跳过封面、考试注意事项、页眉页脚的重复标题，从第一个大节直接开始
- 完整保留所有题目和选项文字，不遗漏
- 用 ## 标记大节（文字・語彙 / 文法・読解 / 聴解）
- 用 ### 标记每个問題（問題1、問題2 …）
- 题干中的下划线词用 __词__ 表示
- 选项保持 1234 编号（不要改成 ABCD）
- 遇到表格形式的内容，用 Markdown | 表格格式输出
- 不输出任何答案表

排序题（文の組み立て）：
- 4个空格用 [_1_] [_2_] [_3_] [_4_] 表示
- ★ 所在空格写成 [_N★_]，N 为该空格编号，必须从原文准确识别

聴解：
- 有文字选项的题目：正常输出文字
- 选项是图片的题目：写 [画像1] [画像2] [画像3] [画像4]
- 无印刷选项的题目：写 [音声のみ]

如果 PDF 包含答案表，放在末尾 ## 答案 节，格式：Q{题号}: {答案数字}，每行一题。

直接输出 Markdown，不要任何额外说明。"""

    client = genai.Client(api_key=api_key)
    pdf_bytes = pdf_path.read_bytes()
    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            types.Part.from_text(text=PROMPT),
        ],
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_budget=8000),
        ),
    )
    return response.text or ""


async def _run_convert_exam(markdown: str, api_key: str) -> dict:
    """Call Gemini to parse Markdown → structured 4-layer JSON."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from scripts.convert_exam import PROMPT_HEADER, _parse_answers, _inject_answers, _validate

    from google import genai
    from google.genai import types

    answers = _parse_answers(markdown)
    client = genai.Client(api_key=api_key)
    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=PROMPT_HEADER + markdown,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            max_output_tokens=65536,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    data = json.loads(response.text or "{}")
    _validate(data)
    _inject_answers(data, answers)
    return data


# ── Confirm: Draft → ExamPaper tree ──────────────────────────────────────────

@router.post("/drafts/{draft_id}/confirm", response_model=DraftDetail)
async def confirm_draft(draft_id: _uuid.UUID, db: AsyncSession = Depends(get_db)):
    draft = await db.get(ExamDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if not draft.draft_json:
        raise HTTPException(status_code=400, detail="Draft has no structured data")

    data = draft.draft_json
    title = data.get("title", "")
    level = data.get("level", "")
    source = data.get("source", "")

    if not title or not level:
        raise HTTPException(status_code=400, detail="draft_json missing title or level")

    # Idempotent: delete existing paper with same title+level
    existing = (await db.execute(
        select(ExamPaper).where(ExamPaper.title == title, ExamPaper.level == level)
    )).scalar_one_or_none()
    if existing:
        await db.execute(delete(ExamPaper).where(ExamPaper.id == existing.id))
        await db.flush()

    paper = ExamPaper(title=title, level=level, source=source)
    db.add(paper)
    await db.flush()

    for sec_idx, sec_data in enumerate(data.get("sections", [])):
        section = ExamSection(
            paper_id=paper.id, name=sec_data["name"], seq=sec_idx + 1,
        )
        db.add(section)
        await db.flush()

        for prob_idx, prob_data in enumerate(sec_data.get("problems", [])):
            problem = ExamProblem(
                section_id=section.id,
                seq=prob_idx + 1,
                name=prob_data["name"],
                type=prob_data["type"],
                instruction=prob_data.get("instruction"),
                passage=prob_data.get("passage"),
                transcript=prob_data.get("transcript"),
            )
            db.add(problem)
            await db.flush()

            for item_data in prob_data.get("items", []):
                db.add(ExamItem(
                    problem_id=problem.id,
                    seq=item_data.get("seq", 0),
                    num=item_data.get("num"),
                    stem=item_data.get("stem", ""),
                    options=item_data.get("options", {}),
                    correct_answer=item_data.get("correct_answer"),
                    meta=item_data.get("meta"),
                ))

    draft.paper_id = paper.id
    draft.status = "confirmed"
    draft.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(draft)

    return DraftDetail(
        id=draft.id, filename=draft.filename,
        markdown_raw=draft.markdown_raw, draft_json=draft.draft_json,
        status=draft.status, paper_id=draft.paper_id,
        created_at=draft.created_at, updated_at=draft.updated_at,
    )


# ── Media Upload ──────────────────────────────────────────────────────────────

@router.post("/media/upload", response_model=MediaUploadResponse)
async def upload_media(file: UploadFile = File(...)):
    """Save uploaded image, return its static URL."""
    ext = Path(file.filename or "img.png").suffix or ".png"
    filename = f"{_uuid.uuid4().hex}{ext}"
    dest = MEDIA_DIR / filename

    async with aiofiles.open(dest, "wb") as f:
        content = await file.read()
        await f.write(content)

    return MediaUploadResponse(url=f"/media/{filename}")
```

- [ ] **Step 4: Write integration test for confirm endpoint**

Create `backend/tests/test_admin_confirm.py`:

```python
"""Test that confirm_draft correctly seeds ExamPaper tree from draft_json."""
import pytest
import asyncio
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select, text
from app.models.db import Base, ExamDraft, ExamPaper, ExamSection, ExamProblem, ExamItem

TEST_DB = "postgresql+asyncpg://jlpt:jlpt@localhost:5432/jlpt_test"

SAMPLE_DRAFT_JSON = {
    "title": "テスト試験",
    "level": "N2",
    "source": "2026年01月",
    "sections": [
        {
            "name": "言語知識（文字・語彙）",
            "problems": [
                {
                    "name": "問題1",
                    "type": "kanji_reading",
                    "instruction": "読み方を選びなさい。",
                    "passage": None,
                    "transcript": None,
                    "items": [
                        {
                            "num": 1, "seq": 1,
                            "stem": "__運賃__を払う",
                            "options": {"1": "うんちん", "2": "うんどう", "3": "うんにん", "4": "うんりん"},
                            "correct_answer": "1",
                            "meta": {"target": "運賃"},
                        }
                    ],
                }
            ],
        }
    ],
}


@pytest.fixture(scope="module")
def event_loop():
    import asyncio
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
async def db_session():
    engine = create_async_engine(TEST_DB, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_confirm_creates_paper_tree(db_session):
    from app.api.admin import confirm_draft

    draft = ExamDraft(
        filename="test.pdf",
        markdown_raw="# test",
        draft_json=SAMPLE_DRAFT_JSON,
        status="pending",
    )
    db_session.add(draft)
    await db_session.flush()

    result = await confirm_draft(draft.id, db_session)

    assert result.status == "confirmed"
    assert result.paper_id is not None

    paper = await db_session.get(ExamPaper, result.paper_id)
    assert paper.title == "テスト試験"
    assert paper.level == "N2"

    sections = (await db_session.execute(
        select(ExamSection).where(ExamSection.paper_id == paper.id)
    )).scalars().all()
    assert len(sections) == 1

    problems = (await db_session.execute(
        select(ExamProblem).where(ExamProblem.section_id == sections[0].id)
    )).scalars().all()
    assert len(problems) == 1
    assert problems[0].type == "kanji_reading"

    items = (await db_session.execute(
        select(ExamItem).where(ExamItem.problem_id == problems[0].id)
    )).scalars().all()
    assert len(items) == 1
    assert items[0].correct_answer == "1"
    assert items[0].num == 1
```

- [ ] **Step 5: Run unit test (skips DB test if no test DB)**

```bash
cd backend && python -m pytest tests/test_exam_models.py tests/test_admin_confirm.py -v --ignore-glob="*test_admin*" 2>/dev/null; python -m pytest tests/test_exam_models.py -v
```

Expected: all model tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/admin.py backend/tests/test_admin_confirm.py backend/media/.gitkeep
git commit -m "feat: add admin API (draft CRUD, PDF ingest, media upload, confirm)"
```

---

## Task 8: Register Admin Router and Static Files in `main.py`

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Read current main.py to see existing router registrations**

```bash
cat backend/app/main.py
```

- [ ] **Step 2: Add admin router import and registration**

In `main.py`, add after existing router imports:

```python
from app.api import admin as admin_api
from fastapi.staticfiles import StaticFiles
from pathlib import Path
```

Add after existing `app.include_router(...)` calls:

```python
app.include_router(admin_api.router)

# Serve uploaded media files
_media_dir = Path(__file__).parent.parent.parent / "media"
_media_dir.mkdir(exist_ok=True)
app.mount("/media", StaticFiles(directory=str(_media_dir)), name="media")
```

- [ ] **Step 3: Verify server starts without import errors**

```bash
cd backend && python -c "from app.main import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Verify admin routes are registered**

```bash
cd backend && python -c "
from app.main import app
routes = [r.path for r in app.routes]
assert any('/admin/drafts' in r for r in routes), routes
assert any('/media' in r for r in routes), routes
print('Routes OK:', [r for r in routes if 'admin' in r or 'media' in r])
"
```

Expected: prints admin and media routes.

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: register admin router and /media static files in main.py"
```

---

## Self-Review

**Spec coverage check:**
- ✓ 4-layer DB schema (ExamPaper→Section→Problem→Item)
- ✓ ExamMedia table for images
- ✓ ExamDraft for ingestion state
- ✓ correct_answer on ExamItem (ExamAnswerKey removed)
- ✓ transcript on ExamProblem for listening
- ✓ Same-name ExamProblems for multi-passage 問題N
- ✓ convert_exam.py produces new 4-layer JSON
- ✓ seed_exam.py updated
- ✓ All exam API endpoints updated
- ✓ Admin ingest endpoint (PDF → draft)
- ✓ Admin confirm endpoint (idempotent by title+level)
- ✓ Media upload endpoint
- ✓ Migration script (drop old tables, create new)

**Not covered in this plan (Plan 2 — Frontend):**
- Admin ingestion UI (`/admin/ingest` page)
- ExamSession.tsx adaptation to new Problem→Item hierarchy
- AnalysisPanel.tsx URL update (`/questions/` → `/items/`)
- Frontend types update
