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
