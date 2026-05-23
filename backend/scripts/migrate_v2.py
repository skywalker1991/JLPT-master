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
    "exam_media",
    "exam_drafts",
    "exam_items",
    "exam_problems",
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
    from app.models.db import (
        ExamPaper, ExamSection, ExamProblem, ExamItem,
        ExamMedia, ExamDraft, QuestionAnalysis, ExamAttempt, AttemptAnswer,
    )
    exam_models = [
        ExamPaper, ExamSection, ExamProblem, ExamItem,
        ExamMedia, ExamDraft, QuestionAnalysis, ExamAttempt, AttemptAnswer,
    ]
    exam_tables = [m.__table__ for m in exam_models]
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=exam_tables)

    print("Verifying new tables exist...")
    async with async_engine.connect() as conn:
        result = await conn.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
        ))
        existing = {row[0] for row in result}
        missing = [t for t in NEW_TABLES if t not in existing]
        for table in NEW_TABLES:
            status = "✓" if table in existing else "✗ MISSING"
            print(f"  {status} {table}")
        if missing:
            print(f"\nERROR: {len(missing)} table(s) missing after migration.")
            sys.exit(1)

    print("\nMigration complete. Re-ingest exam papers via /admin/ingest.")


if __name__ == "__main__":
    if "--yes" not in sys.argv:
        confirm = input("This will DELETE all exam data. Type 'yes' to continue: ")
        if confirm.strip() != "yes":
            print("Aborted.")
            sys.exit(0)
    asyncio.run(migrate())
