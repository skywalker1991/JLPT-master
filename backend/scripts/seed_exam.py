#!/usr/bin/env python3
"""
Import a structured exam JSON (output of convert_exam.py) into the database.

Usage:
    python scripts/seed_exam.py path/to/exam.json

Skips if a paper with the same title + level already exists.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from app.models.db import async_session_factory, async_engine, Base, ExamPaper, ExamSection, ExamQuestion, ExamAnswerKey


async def seed(path: str) -> None:
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    title = data["title"]
    level = data["level"]

    async with async_session_factory() as db:
        existing = await db.execute(
            select(ExamPaper).where(ExamPaper.title == title, ExamPaper.level == level)
        )
        if existing.scalar_one_or_none():
            print(f"Already exists: {title} ({level}), skipping.")
            return

        # Derive source from filename if JSON has placeholder "出典" or is absent
        source = data.get("source") or ""
        if not source or source == "出典":
            # Expect filenames like 2023-07-N2.json → "2023年7月"
            stem = Path(path).stem
            parts = stem.split("-")
            if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
                source = f"{parts[0]}年{parts[1]}月"
            else:
                source = stem

        paper = ExamPaper(title=title, level=level, source=source)
        db.add(paper)
        await db.flush()

        for sec_idx, sec_data in enumerate(data.get("sections", [])):
            section = ExamSection(
                paper_id=paper.id,
                name=sec_data["name"],
                seq=sec_idx + 1,
            )
            db.add(section)
            await db.flush()

            for q_data in sec_data.get("questions", []):
                question = ExamQuestion(
                    section_id=section.id,
                    type=q_data["type"],
                    stem=q_data.get("stem", ""),
                    passage=q_data.get("passage"),
                    options=q_data.get("options", {}),
                    meta=q_data.get("meta"),
                    seq=q_data.get("seq", 0),
                )
                db.add(question)
                await db.flush()

                correct = q_data.get("correct_answer", "").strip()
                if correct:
                    db.add(ExamAnswerKey(question_id=question.id, correct_answer=correct))

        await db.commit()
        print(f"Imported: {title} ({level})")
        for sec in data.get("sections", []):
            print(f"  [{sec['name']}] {len(sec.get('questions', []))} questions")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/seed_exam.py <exam.json>")
        sys.exit(1)
    asyncio.run(seed(sys.argv[1]))
