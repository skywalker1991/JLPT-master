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
from app.models.db import (
    async_session_factory, async_engine, Base,
    ExamPaper, ExamSection, ExamProblem, ExamItem,
)


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

        await db.commit()
        print(f"Imported: {title} ({level})")
        for sec in data.get("sections", []):
            total_items = sum(len(p.get("items", [])) for p in sec.get("problems", []))
            print(f"  [{sec['name']}] {len(sec.get('problems', []))} problems, {total_items} items")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/seed_exam.py <exam.json>")
        sys.exit(1)
    asyncio.run(seed(sys.argv[1]))
