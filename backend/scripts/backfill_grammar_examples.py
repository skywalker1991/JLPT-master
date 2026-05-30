"""
为没有例句的 grammar atom 批量补充至少 2 个例句。
用法：cd backend && python -m scripts.backfill_grammar_examples
"""
import asyncio
import json
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

from sqlalchemy import select, text
from app.models.db import async_session_factory
from app.models.db import Atom, AtomProperty
from app.services.llm.factory import get_llm_client

PROMPT = """\
你是日语语法专家。请为以下日语语法点提供 2 个地道的日语例句及中文翻译，体现该语法的典型用法。

语法点：{key}

要求：
- 每个例句是完整的日语句子
- 例句应覆盖不同语境
- 翻译使用中文

直接输出 JSON：
{{"examples": [{{"ja": "日语例句", "zh": "中文翻译"}}, {{"ja": "日语例句", "zh": "中文翻译"}}]}}
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "examples": {
            "type": "array",
            "minItems": 2,
            "items": {
                "type": "object",
                "properties": {
                    "ja": {"type": "string"},
                    "zh": {"type": "string"},
                },
                "required": ["ja", "zh"],
            },
        },
    },
    "required": ["examples"],
}


async def main():
    async with async_session_factory() as db:
        rows = (await db.execute(text("""
            SELECT a.id, a.key
            FROM atoms a
            WHERE a.type = 'grammar'
            AND a.id NOT IN (
                SELECT DISTINCT atom_id FROM atom_properties WHERE kind = 'example'
            )
            ORDER BY a.created_at
        """))).all()

    if not rows:
        print("所有 grammar atom 均已有例句，无需补全。")
        return

    print(f"找到 {len(rows)} 条 grammar atom 缺少例句，开始补全…")
    llm = get_llm_client()

    for atom_id, key in rows:
        print(f"  处理：{key} ({atom_id})")
        try:
            prompt = PROMPT.format(key=key)
            raw = await llm.analyze(prompt, SCHEMA)
            data = json.loads(raw) if isinstance(raw, str) else raw
            examples = data.get("examples", [])[:2]
            if not examples:
                print(f"    ⚠ AI 未返回例句，跳过")
                continue

            async with async_session_factory() as db:
                for ex in examples:
                    ja = ex.get("ja", "")
                    zh = ex.get("zh", "")
                    value = f"{ja}｜{zh}" if zh else ja
                    db.add(AtomProperty(
                        atom_id=atom_id,
                        kind="example",
                        value=value,
                        source_type="ai",
                    ))
                await db.commit()
            print(f"    ✓ 已写入 {len(examples)} 条例句")
        except Exception as e:
            print(f"    ✗ 失败：{e}")

    print("完成。")


if __name__ == "__main__":
    asyncio.run(main())
