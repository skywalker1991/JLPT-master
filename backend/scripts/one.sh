#!/bin/bash
# 入一份卷子，并把需要人看的东西直接摊开
cd /Users/dairui/JLPT-master/backend
D="$1"; START=$(date +%s)
venv/bin/python -m scripts.ingest_batch "$D" 2>&1 | grep -viE "mupdf|AFC|^$" | tail -12
echo "── 耗时 $(( $(date +%s) - START )) 秒"
venv/bin/python - <<'PY' 2>&1 | tail -30
import asyncio, sys, json
from datetime import datetime, timedelta, timezone
sys.path.insert(0,'.')
from sqlalchemy import select
from app.models.db import async_session_factory
from app.models import db as M
async def main():
    async with async_session_factory() as s:
        # Only a draft this run left behind. Picking the newest unconfirmed
        # one reports whatever is still queued from an earlier sitting.
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
        d=(await s.execute(select(M.ExamDraft)
             .where(M.ExamDraft.status!='confirmed', M.ExamDraft.created_at > cutoff)
             .order_by(M.ExamDraft.created_at.desc()))).scalars().first()
        if not d: print("（本次无待处理草稿）"); return
        r=d.report or {}
        print(f"── 草稿 {d.id}")
        for k in ('hard','invented'):
            for x in (r.get(k) or []):
                print(f"  [{k}]", json.dumps(x,ensure_ascii=False) if not isinstance(x,str) else x)
        for x in (r.get('gaps') or []): print("  [gap]", x)
asyncio.run(main())
PY
