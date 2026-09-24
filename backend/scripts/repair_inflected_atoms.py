"""Propose fixes for atoms that carry an inflected form's reading or meaning.

The analysis prompt used to leave `meaning` unqualified, so the model often
glossed the form it had just read rather than the dictionary form: 尊ぶ ended
up reading とうとばれた and meaning 受到尊重, which is 尊ばれる. The prompt is
fixed; this repairs what it already wrote.

Run with no arguments to write a proposal file and print it. Run with --apply
to write the reviewed proposals back.

    venv/bin/python scripts/repair_inflected_atoms.py
    venv/bin/python scripts/repair_inflected_atoms.py --apply
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select, update  # noqa: E402

from app.models.db import Atom, AtomProperty, async_session_factory  # noqa: E402
from app.services.llm.factory import get_llm_client  # noqa: E402

PROPOSALS = Path(__file__).parent / "repair_proposals.json"

PROMPT = """你是一名日语词典编纂专家。下面是某个日语学习系统知识库里的词条，其中一部分的
reading（读音）或 meaning（释义）被错误地写成了**句中活用形**的读音/释义，而不是
**辞書形本身**的。

例如错误数据：key=尊ぶ, reading=とうとばれた, meaning=受到尊重
正确应为：      key=尊ぶ, reading=とうとぶ,   meaning=尊敬，珍视

请逐条判断并输出修正结果。规则：
1. key 保持不变，不要改 key。
2. reading 必须是 key 这个辞書形的平假名读音。
3. meaning 必须是 key 辞書形**本身**的中文含义，去掉所有诸如
   「（动词X的被动形）」「(名词化)」「(连用形)」之类的活用说明。
4. 如果某条本来就是正确的，needs_fix 填 false，其余字段照抄原值。
5. 如果 key 本身就是活用形（如「やらない」「ついています」），无法只靠改读音修好，
   needs_fix 填 false，并在 note 里写 "key_is_inflected"。
6. 语法条目（type=grammar，key 以〜开头）通常没有 reading，reading 填空字符串。

待检查的词条：
{items}

直接输出 JSON，不要代码块。格式：
{{"results": [{{"key": "...", "needs_fix": true, "reading": "...", "meaning": "...", "note": ""}}]}}
"""


async def load_candidates(session):
    """Atoms whose stored reading or meaning looks like an inflected form."""
    import re
    infl_note = re.compile(r"[（(].*?(被动|使役|否定|过去|て形|た形|连用|中止|名词化|词干|活用|ば形|条件).*?[）)]")
    kana_infl = re.compile(r"(られた|れた|ている|てきた|なかった|した|して|った|ながら|ました|くなった|げに|られる)$")

    rows = (await session.execute(select(Atom))).scalars().all()
    out = []
    for atom in rows:
        props = (await session.execute(
            select(AtomProperty)
            .where(AtomProperty.atom_id == atom.id)
            .order_by(AtomProperty.created_at)
        )).scalars().all()
        reading = next((p for p in props if p.kind == "reading"), None)
        meaning = next((p for p in props if p.kind == "meaning"), None)
        r_val = reading.value if reading else ""
        m_val = meaning.value if meaning else ""
        if (m_val and infl_note.search(m_val)) or (r_val and kana_infl.search(r_val)):
            out.append({
                "atom_id": str(atom.id), "key": atom.key, "type": atom.type,
                "reading": r_val, "meaning": m_val,
                "reading_prop_id": str(reading.id) if reading else None,
                "meaning_prop_id": str(meaning.id) if meaning else None,
            })
    return out


async def propose():
    async with async_session_factory() as session:
        cands = await load_candidates(session)
    print(f"候选词条: {len(cands)}")
    if not cands:
        return

    listing = "\n".join(
        f"- key={c['key']} | type={c['type']} | reading={c['reading']} | meaning={c['meaning']}"
        for c in cands
    )
    client = get_llm_client()
    chunks = []
    async for chunk in client.analyze_stream(PROMPT.format(items=listing), {}):
        chunks.append(chunk)
    raw = "".join(chunks).strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].removeprefix("json").strip()
    results = {r["key"]: r for r in json.loads(raw)["results"]}

    proposals = []
    for c in cands:
        r = results.get(c["key"])
        if not r or not r.get("needs_fix"):
            continue
        change = {k: v for k, v in (
            ("reading", r.get("reading", "")), ("meaning", r.get("meaning", "")),
        ) if v and v != c[k]}
        if change:
            proposals.append({**c, "new": change})

    PROPOSALS.write_text(json.dumps(proposals, ensure_ascii=False, indent=2))
    skipped = [r for r in results.values() if r.get("note") == "key_is_inflected"]

    print(f"\n拟修改 {len(proposals)} 条：\n")
    for p in proposals:
        for field, new in p["new"].items():
            print(f"  {p['key'][:14]:16} {field:8} {str(p[field])[:26]:28} → {new[:34]}")
    if skipped:
        print(f"\nkey 本身是活用形，需人工决定（未处理）{len(skipped)} 条：")
        for r in skipped:
            print(f"  {r['key']}")
    print(f"\n提案已写入 {PROPOSALS.name}，确认后执行 --apply")


async def apply():
    proposals = json.loads(PROPOSALS.read_text())
    async with async_session_factory() as session:
        n = 0
        for p in proposals:
            for field, new in p["new"].items():
                prop_id = p[f"{field}_prop_id"]
                if not prop_id:
                    continue
                await session.execute(
                    update(AtomProperty).where(AtomProperty.id == prop_id).values(value=new)
                )
                n += 1
        await session.commit()
    print(f"已更新 {n} 个字段，覆盖 {len(proposals)} 个词条")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the reviewed proposals back")
    asyncio.run(apply() if ap.parse_args().apply else propose())
