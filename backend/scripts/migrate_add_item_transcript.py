#!/usr/bin/env python3
"""Add transcript column to exam_items table."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.models.db import async_engine


async def migrate():
    async with async_engine.begin() as conn:
        await conn.execute(text(
            "ALTER TABLE exam_items ADD COLUMN IF NOT EXISTS transcript TEXT"
        ))
    print("Done: exam_items.transcript added.")


if __name__ == "__main__":
    asyncio.run(migrate())
