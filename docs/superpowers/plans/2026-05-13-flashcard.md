# 内化学习 — 卡牌记忆功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现基于知识库原子的卡牌记忆功能——智能优先队列 + 主动召回翻转 + Tinder 式左右划拨 + 等级差异化卡牌视觉。

**Architecture:** 后端新增 `/api/internalize/queue`（优先级排序）和 `/api/internalize/trace`（写轨迹），前端用 Framer Motion v11 实现拖拽划拨、3D 翻转、N1 传说降临动画，复用现有 `traces` 表，不新建任何 DB 表。

**Tech Stack:** FastAPI + async SQLAlchemy + PostgreSQL（JSONB Trace.detail）；React + TypeScript + Framer Motion v11 + Tailwind CSS。

---

## 文件结构

**新建：**
- `backend/app/api/internalize.py` — 队列和轨迹两个端点
- `backend/app/services/internalize_service.py` — 优先级分数纯函数（可单元测试）
- `backend/tests/__init__.py` — 测试包
- `backend/tests/test_internalize.py` — 优先级逻辑单元测试
- `backend/requirements-dev.txt` — pytest 开发依赖
- `frontend/src/components/internalize/SessionSetup.tsx` — 会话开始设置页
- `frontend/src/components/internalize/FlashCard.tsx` — 单张卡牌（视觉+翻转+拖拽+等级动画）
- `frontend/src/components/internalize/CardDeck.tsx` — 卡堆管理（队列+三张叠放+会话状态）
- `frontend/src/components/internalize/SessionResult.tsx` — 会话结果页

**修改：**
- `backend/app/main.py` — 注册 internalize router
- `frontend/src/types/index.ts` — 新增 internalize 类型
- `frontend/src/services/api.ts` — 新增 getInternalizeQueue / postInternalizeTrace
- `frontend/src/pages/InternalizePage.tsx` — 替换占位，组合三个 internalize 组件

---

## Task 1: 后端 — 优先级纯函数 + 单元测试

**Files:**
- Create: `backend/app/services/internalize_service.py`
- Create: `backend/requirements-dev.txt`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_internalize.py`

- [ ] **Step 1: 创建 internalize_service.py（纯函数，不依赖 DB）**

```python
# backend/app/services/internalize_service.py
import math

JLPT_TAGS = {"N1", "N2", "N3", "N4", "N5"}


def priority_score(fail_count: int, review_count: int, days_since: float) -> float:
    """
    优先级分数 [0, 1]，值越高越优先复习。
    - fail_rate: 历史失败率（0~1）
    - days_decay: 距上次复习的时间衰减（14天半衰期）
    从未复习的原子：days_since=999，接近最高优先级。
    """
    fail_rate = fail_count / max(review_count, 1)
    days_decay = 1 - math.exp(-days_since / 14.0)
    return fail_rate * 0.6 + days_decay * 0.4


def extract_jlpt_level(tags: list[str]) -> str | None:
    """从标签列表中提取 JLPT 等级（如 'N2'），无则返回 None。"""
    for tag in tags:
        if tag in JLPT_TAGS:
            return tag
    return None
```

- [ ] **Step 2: 创建 requirements-dev.txt**

```
# backend/requirements-dev.txt
pytest>=8.0.0
pytest-asyncio>=0.24.0
```

- [ ] **Step 3: 创建 tests/__init__.py（空文件）**

```python
# backend/tests/__init__.py
```

- [ ] **Step 4: 写失败测试**

```python
# backend/tests/test_internalize.py
import pytest
from app.services.internalize_service import priority_score, extract_jlpt_level


def test_never_reviewed_atom_has_high_priority():
    score = priority_score(fail_count=0, review_count=0, days_since=999)
    assert score > 0.39  # days_decay 接近 1，0.4*1 = 0.4


def test_all_correct_recently_has_low_priority():
    score = priority_score(fail_count=0, review_count=10, days_since=0)
    assert score < 0.01


def test_all_failed_recently_medium_priority():
    score = priority_score(fail_count=5, review_count=5, days_since=0)
    assert abs(score - 0.6) < 0.01  # fail_rate=1, days_decay=0


def test_all_failed_14_days_ago_high_priority():
    score = priority_score(fail_count=5, review_count=5, days_since=14)
    # fail_rate=1 → 0.6; days_decay=1-e^{-1}≈0.632 → 0.4*0.632≈0.253
    assert score > 0.85


def test_extract_jlpt_level_finds_n2():
    assert extract_jlpt_level(["N2", "verb"]) == "N2"


def test_extract_jlpt_level_returns_none_when_absent():
    assert extract_jlpt_level(["verb", "common"]) is None
```

- [ ] **Step 5: 安装 pytest 并运行测试（预期失败，因为实现还没写）**

```bash
cd /Users/dairui/JLPT-master/backend
pip install pytest pytest-asyncio
python -m pytest tests/test_internalize.py -v
```

预期：6 个测试失败，错误为 `ModuleNotFoundError: No module named 'app'`（还没建模块）。

- [ ] **Step 6: 运行测试（预期通过）**

```bash
cd /Users/dairui/JLPT-master/backend
PYTHONPATH=. python -m pytest tests/test_internalize.py -v
```

预期输出：`6 passed`。

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/internalize_service.py backend/requirements-dev.txt backend/tests/
git commit -m "feat: add internalize priority scoring service with tests"
```

---

## Task 2: 后端 — Queue 端点

**Files:**
- Create: `backend/app/api/internalize.py`

- [ ] **Step 1: 创建 internalize.py**

```python
# backend/app/api/internalize.py
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, case, exists, and_, Float, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Atom, AtomProperty, AtomTag, Trace, get_db
from app.services import atom_service
from app.services.internalize_service import priority_score, extract_jlpt_level, JLPT_TAGS

router = APIRouter(tags=["internalize"])


@router.get("/internalize/queue")
async def get_queue(
    limit: int = Query(default=20, ge=1, le=200),
    prompt: str = Query(default="meaning"),
    tag: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    返回按优先级排序的原子复习队列。
    优先级 = fail_rate * 0.6 + days_decay * 0.4
    从未复习的原子具有最高优先级（days_since=999）。
    """
    # 评审统计子查询
    review_stats = (
        select(
            Trace.atom_id,
            func.count().label("review_count"),
            func.sum(
                case(
                    (Trace.detail["result"].astext == "unknown", 1),
                    else_=0,
                )
            ).label("fail_count"),
            func.max(Trace.created_at).label("last_review"),
        )
        .where(Trace.action == "review")
        .group_by(Trace.atom_id)
        .subquery("review_stats")
    )

    days_since_expr = func.coalesce(
        func.extract("epoch", func.now() - review_stats.c.last_review) / 86400.0,
        999.0,
    )
    fail_rate_expr = func.coalesce(
        func.cast(review_stats.c.fail_count, Float)
        / func.greatest(func.cast(review_stats.c.review_count, Float), 1.0),
        0.0,
    )
    priority_expr = (
        fail_rate_expr * 0.6
        + (1 - func.exp(-days_since_expr / 14.0)) * 0.4
    )

    query = (
        select(Atom, priority_expr.label("priority"))
        .outerjoin(review_stats, review_stats.c.atom_id == Atom.id)
        .order_by(priority_expr.desc())
        .limit(limit)
    )

    if tag:
        query = query.where(
            exists(
                select(AtomTag.atom_id).where(
                    and_(AtomTag.atom_id == Atom.id, AtomTag.tag == tag)
                )
            )
        )

    result = await db.execute(query)
    rows = result.all()

    if not rows:
        return {"cards": []}

    atom_ids = [row.Atom.id for row in rows]
    atoms_map = {row.Atom.id: row.Atom for row in rows}

    # 一次查询所有 properties
    props_result = await db.execute(
        select(AtomProperty)
        .where(AtomProperty.atom_id.in_(atom_ids))
        .order_by(AtomProperty.atom_id, AtomProperty.created_at)
    )
    props_by_atom: dict[UUID, list[AtomProperty]] = {}
    for p in props_result.scalars().all():
        props_by_atom.setdefault(p.atom_id, []).append(p)

    # 一次查询所有 tags
    tags_result = await db.execute(
        select(AtomTag).where(AtomTag.atom_id.in_(atom_ids))
    )
    tags_by_atom: dict[UUID, list[str]] = {}
    for t in tags_result.scalars().all():
        tags_by_atom.setdefault(t.atom_id, []).append(t.tag)

    cards = []
    for atom_id in atom_ids:
        atom = atoms_map[atom_id]
        props = props_by_atom.get(atom_id, [])
        tags = tags_by_atom.get(atom_id, [])

        jlpt_level = extract_jlpt_level(tags)
        prompt_value = next((p.value for p in props if p.kind == prompt), None)

        cards.append(
            {
                "id": str(atom_id),
                "type": atom.type,
                "key": atom.key,
                "jlpt_level": jlpt_level,
                "prompt_value": prompt_value,
                "properties": [
                    {"kind": p.kind, "value": p.value} for p in props
                ],
            }
        )

    return {"cards": cards}
```

- [ ] **Step 2: 手动验证语法正确**

```bash
cd /Users/dairui/JLPT-master/backend
PYTHONPATH=. python -c "from app.api.internalize import router; print('OK')"
```

预期：`OK`

---

## Task 3: 后端 — Trace 端点 + 注册路由

**Files:**
- Modify: `backend/app/api/internalize.py`（追加端点）
- Modify: `backend/app/main.py`

- [ ] **Step 1: 在 internalize.py 末尾追加 trace 端点**

在 `backend/app/api/internalize.py` 文件末尾追加：

```python
@router.post("/internalize/trace", status_code=201)
async def record_trace(body: dict, db: AsyncSession = Depends(get_db)):
    """记录一次卡牌划拨结果到 traces 表。"""
    atom_id_str = body.get("atom_id")
    result = body.get("result")
    prompt_type = body.get("prompt_type", "meaning")

    if result not in ("know", "unknown"):
        raise HTTPException(status_code=422, detail="result must be 'know' or 'unknown'")

    try:
        atom_id = UUID(atom_id_str)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="invalid atom_id")

    atom = await atom_service.get_atom_by_id(db, atom_id)
    if atom is None:
        raise HTTPException(status_code=404, detail="Atom not found")

    await atom_service.add_trace(
        db, atom_id, "review", {"result": result, "prompt_type": prompt_type}
    )
    await db.commit()
    return {"ok": True}
```

- [ ] **Step 2: 在 main.py 中注册 internalize router**

打开 `backend/app/main.py`，找到以下导入行：

```python
from app.api import analysis, atoms, dictionary, exam, tts, video
```

改为：

```python
from app.api import analysis, atoms, dictionary, exam, internalize, tts, video
```

找到以下注册行：

```python
app.include_router(video.router, prefix="/api")
```

在其后追加：

```python
app.include_router(internalize.router, prefix="/api")
```

- [ ] **Step 3: 启动后端并验证两个端点可访问**

```bash
cd /Users/dairui/JLPT-master/backend
PYTHONPATH=. uvicorn app.main:app --reload --port 8000
```

另开终端：

```bash
curl -s http://localhost:8000/api/internalize/queue?limit=5 | python3 -m json.tool
```

预期：`{"cards": [...]}` 或 `{"cards": []}（知识库为空时）`

```bash
curl -s -X POST http://localhost:8000/api/internalize/trace \
  -H "Content-Type: application/json" \
  -d '{"atom_id": "00000000-0000-0000-0000-000000000000", "result": "know"}' | python3 -m json.tool
```

预期：`{"detail": "Atom not found"}` (404，说明端点正确响应)

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/internalize.py backend/app/main.py
git commit -m "feat: add internalize queue and trace endpoints"
```

---

## Task 4: 前端 — Types + API 函数

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: 在 types/index.ts 末尾追加 internalize 类型**

```typescript
// Internalize
export interface InternalizeProperty {
  kind: string
  value: string
}

export interface InternalizeCard {
  id: string
  type: 'vocabulary' | 'grammar'
  key: string
  jlpt_level: 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | null
  prompt_value: string | null
  properties: InternalizeProperty[]
}

export interface InternalizeQueueResponse {
  cards: InternalizeCard[]
}

export type SwipeResult = 'know' | 'unknown'

export interface SessionConfig {
  limit: number
  promptType: string
  tag: string
}
```

- [ ] **Step 2: 在 services/api.ts 末尾追加 internalize 函数**

```typescript
// ---- Internalize ----

import type { InternalizeQueueResponse } from '../types'

export async function getInternalizeQueue(params: {
  limit: number
  prompt: string
  tag?: string
}): Promise<InternalizeQueueResponse> {
  const qs = new URLSearchParams({ limit: String(params.limit), prompt: params.prompt })
  if (params.tag) qs.set('tag', params.tag)
  return request<InternalizeQueueResponse>(`/api/internalize/queue?${qs}`)
}

export async function postInternalizeTrace(
  atomId: string,
  result: 'know' | 'unknown',
  promptType: string,
): Promise<void> {
  await request<{ ok: boolean }>('/api/internalize/trace', {
    method: 'POST',
    body: JSON.stringify({ atom_id: atomId, result, prompt_type: promptType }),
  })
}
```

注意：`import type { InternalizeQueueResponse }` 需要移到文件顶部已有的 import 块中。实际操作时，在文件顶部的类型 import 中加入 `InternalizeQueueResponse`，不需要在函数附近再写 import。

- [ ] **Step 3: 验证 TypeScript 编译无报错**

```bash
cd /Users/dairui/JLPT-master/frontend
npx tsc --noEmit
```

预期：无错误输出。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat: add internalize types and API client functions"
```

---

## Task 5: 前端 — SessionSetup 组件

**Files:**
- Create: `frontend/src/components/internalize/SessionSetup.tsx`

- [ ] **Step 1: 创建 SessionSetup.tsx**

```tsx
// frontend/src/components/internalize/SessionSetup.tsx
import { useState } from 'react'
import clsx from 'clsx'
import type { SessionConfig } from '../../types'

interface Props {
  onStart: (config: SessionConfig) => void
}

const PRESET_LIMITS = [10, 20, 50]

const PROMPT_OPTIONS = [
  { value: 'meaning', label: '中文释义' },
  { value: 'reading', label: '读音' },
  { value: 'example', label: '例句' },
]

const JLPT_TAGS = ['N1', 'N2', 'N3', 'N4', 'N5']

export default function SessionSetup({ onStart }: Props) {
  const [limit, setLimit] = useState(20)
  const [customLimit, setCustomLimit] = useState('')
  const [promptType, setPromptType] = useState('meaning')
  const [tag, setTag] = useState('')

  const effectiveLimit = customLimit ? Math.max(1, Math.min(200, parseInt(customLimit) || 20)) : limit

  function handleStart() {
    onStart({ limit: effectiveLimit, promptType, tag: tag.trim() })
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8 gap-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-fg">卡牌复习</h2>
        <p className="text-fg-muted text-sm mt-1">从知识库中抽取最需要复习的卡牌</p>
      </div>

      {/* 数量 */}
      <div className="w-full max-w-sm space-y-2">
        <label className="text-sm font-medium text-fg">复习数量</label>
        <div className="flex gap-2">
          {PRESET_LIMITS.map((n) => (
            <button
              key={n}
              onClick={() => { setLimit(n); setCustomLimit('') }}
              className={clsx(
                'btn flex-1',
                limit === n && !customLimit ? 'btn-primary' : 'btn-ghost border border-border',
              )}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={200}
            placeholder="自定义"
            value={customLimit}
            onChange={(e) => setCustomLimit(e.target.value)}
            className="input w-20 text-center"
          />
        </div>
      </div>

      {/* 提示属性 */}
      <div className="w-full max-w-sm space-y-2">
        <label className="text-sm font-medium text-fg">正面提示</label>
        <div className="flex gap-2">
          {PROMPT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPromptType(opt.value)}
              className={clsx(
                'btn flex-1',
                promptType === opt.value ? 'btn-primary' : 'btn-ghost border border-border',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 标签过滤（可选） */}
      <div className="w-full max-w-sm space-y-2">
        <label className="text-sm font-medium text-fg">
          级别筛选 <span className="text-fg-subtle font-normal">（可选）</span>
        </label>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setTag('')}
            className={clsx('btn', !tag ? 'btn-primary' : 'btn-ghost border border-border')}
          >
            全部
          </button>
          {JLPT_TAGS.map((t) => (
            <button
              key={t}
              onClick={() => setTag(t === tag ? '' : t)}
              className={clsx('btn', tag === t ? 'btn-primary' : 'btn-ghost border border-border')}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <button onClick={handleStart} className="btn-primary px-8 py-3 text-base">
        开始复习
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/internalize/SessionSetup.tsx
git commit -m "feat: add internalize session setup screen"
```

---

## Task 6: 前端 — FlashCard 组件（视觉 + 翻转 + 拖拽 + 等级样式）

**Files:**
- Create: `frontend/src/components/internalize/FlashCard.tsx`

这是最核心的组件，分三个阶段：先做卡牌视觉和翻转，再加拖拽手势，最后加等级动画。全部在同一个文件完成。

- [ ] **Step 1: 创建 FlashCard.tsx（完整实现）**

```tsx
// frontend/src/components/internalize/FlashCard.tsx
import { useRef, useState } from 'react'
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  AnimatePresence,
} from 'framer-motion'
import clsx from 'clsx'
import type { InternalizeCard, SwipeResult } from '../../types'

interface Props {
  card: InternalizeCard
  stackIndex: number      // 0=顶部可交互, 1=第二张, 2=第三张
  promptType: string
  onSwipe: (result: SwipeResult) => void
}

// 按 JLPT 等级返回卡牌样式配置
function getCardStyle(level: string | null, type: string) {
  const typeGradient =
    type === 'vocabulary'
      ? 'from-blue-50 to-blue-100'
      : 'from-violet-50 to-violet-100'

  switch (level) {
    case 'N1':
      return {
        border: 'border-yellow-400',
        bg: `bg-gradient-to-br ${typeGradient}`,
        glow: 'shadow-[0_0_20px_4px_rgba(234,179,8,0.3)]',
        particle: true,
        label: 'text-yellow-700',
      }
    case 'N2':
      return {
        border: 'border-slate-400',
        bg: `bg-gradient-to-br ${typeGradient}`,
        glow: 'shadow-[0_0_12px_2px_rgba(148,163,184,0.3)]',
        particle: false,
        label: 'text-slate-700',
      }
    case 'N3':
      return {
        border: 'border-amber-500',
        bg: `bg-gradient-to-br ${typeGradient}`,
        glow: '',
        particle: false,
        label: 'text-amber-700',
      }
    case 'N4':
      return {
        border: 'border-amber-300',
        bg: `bg-gradient-to-br from-amber-50 ${type === 'vocabulary' ? 'to-blue-50' : 'to-violet-50'}`,
        glow: '',
        particle: false,
        label: 'text-amber-600',
      }
    default: // N5 或无等级
      return {
        border: 'border-gray-200',
        bg: 'bg-white',
        glow: '',
        particle: false,
        label: 'text-gray-500',
      }
  }
}

// N2 扫光动画（CSS keyframe 通过 style 注入）
function ShimmerOverlay() {
  return (
    <motion.div
      className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none"
      animate={{ opacity: [0, 0.6, 0] }}
      transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full animate-[shimmer_2s_ease-in-out_infinite]" />
    </motion.div>
  )
}

// N1 粒子边框效果
function GoldParticles() {
  const particles = Array.from({ length: 8 })
  return (
    <div className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden">
      {particles.map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-yellow-400"
          style={{
            top: `${Math.random() * 100}%`,
            left: `${Math.random() * 100}%`,
          }}
          animate={{
            opacity: [0, 1, 0],
            scale: [0, 1.5, 0],
            y: [0, -20],
          }}
          transition={{
            duration: 1.5 + Math.random(),
            repeat: Infinity,
            delay: i * 0.3,
          }}
        />
      ))}
    </div>
  )
}

// 卡牌内容（正面和背面共用的外壳，通过 rotateY 翻转）
function CardFace({
  children,
  backface,
}: {
  children: React.ReactNode
  backface: boolean
}) {
  return (
    <div
      className="absolute inset-0 rounded-2xl p-6 flex flex-col"
      style={{
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: backface ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}
    >
      {children}
    </div>
  )
}

export default function FlashCard({ card, stackIndex, promptType, onSwipe }: Props) {
  const [isFlipped, setIsFlipped] = useState(false)
  const swipeDirRef = useRef<'left' | 'right' | null>(null)
  const isTop = stackIndex === 0

  const x = useMotionValue(0)
  const rotate = useTransform(x, [-220, 0, 220], [-18, 0, 18])
  const leftOverlayOpacity = useTransform(x, [-220, -60, 0], [1, 0.8, 0])
  const rightOverlayOpacity = useTransform(x, [0, 60, 220], [0, 0.8, 1])

  const style = getCardStyle(card.jlpt_level, card.type)

  // 堆叠层偏移
  const stackVariants = {
    0: { scale: 1, y: 0, opacity: 1 },
    1: { scale: 0.95, y: 10, opacity: 1 },
    2: { scale: 0.90, y: 20, opacity: 0.7 },
  } as Record<number, object>
  const stackAnim = stackVariants[stackIndex] ?? stackVariants[2]

  // N1 降临动画：首次作为顶牌时特殊进入
  const isN1 = card.jlpt_level === 'N1'
  const initialAnim = isTop && isN1
    ? { y: -120, scale: 1.2, opacity: 0 }
    : { opacity: 1 }
  const enterTransition = isTop && isN1
    ? { type: 'spring', stiffness: 200, damping: 18, duration: 0.6 }
    : { type: 'spring', stiffness: 300, damping: 28 }

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const { offset, velocity } = info
    if (offset.x > 80 || velocity.x > 500) {
      swipeDirRef.current = 'right'
      onSwipe('know')
    } else if (offset.x < -80 || velocity.x < -500) {
      swipeDirRef.current = 'left'
      // 短震动后触发划出
      animate(x, [x.get(), x.get() - 10, x.get() + 7, x.get() - 4, 0], {
        duration: 0.22,
      }).then(() => onSwipe('unknown'))
    } else {
      animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 })
    }
  }

  function handleTap() {
    if (isTop && Math.abs(x.get()) < 5) {
      setIsFlipped((f) => !f)
    }
  }

  const propertyGroups = card.properties.reduce<Record<string, string[]>>((acc, p) => {
    acc[p.kind] = acc[p.kind] ?? []
    acc[p.kind].push(p.value)
    return acc
  }, {})

  return (
    <>
      {/* N1 暗场光环（只在 N1 顶牌首次出现时） */}
      {isTop && isN1 && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.35, 0] }}
          transition={{ duration: 0.8, times: [0, 0.3, 1] }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <motion.div
            className="w-40 h-40 rounded-full bg-yellow-300/60"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 4] }}
            transition={{ duration: 0.6 }}
            style={{ filter: 'blur(20px)' }}
          />
        </motion.div>
      )}

      <motion.div
        className="absolute inset-x-4 top-4 bottom-4"
        style={{ x: isTop ? x : 0, rotate: isTop ? rotate : 0, zIndex: 30 - stackIndex * 10 }}
        initial={initialAnim}
        animate={stackAnim}
        transition={enterTransition}
        drag={isTop ? 'x' : false}
        dragConstraints={{ left: -300, right: 300 }}
        dragElastic={0.15}
        onDragEnd={isTop ? handleDragEnd : undefined}
        onTap={handleTap}
        custom={swipeDirRef.current}
        variants={{
          exit: (dir: 'left' | 'right' | null) => ({
            x: dir === 'right' ? 600 : dir === 'left' ? -600 : 0,
            rotate: dir === 'right' ? 20 : -20,
            opacity: 0,
            transition: { duration: 0.28, ease: 'easeIn' },
          }),
        }}
        exit="exit"
      >
        {/* 卡牌主体（3D 翻转容器） */}
        <div
          className="relative w-full h-full"
          style={{ perspective: '1000px' }}
        >
          <motion.div
            className="relative w-full h-full"
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* 正面 */}
            <CardFace backface={false}>
              <div
                className={clsx(
                  'absolute inset-0 rounded-2xl border-2',
                  style.border,
                  style.bg,
                  style.glow,
                )}
              />
              {style.particle && <GoldParticles />}
              {card.jlpt_level === 'N2' && <ShimmerOverlay />}

              {/* 内容层（相对定位，在背景之上） */}
              <div className="relative flex flex-col h-full">
                {/* 顶部标签行 */}
                <div className="flex items-center justify-between mb-4">
                  <span className={clsx(
                    'text-xs font-semibold px-2 py-0.5 rounded-md',
                    card.type === 'vocabulary'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-violet-100 text-violet-700',
                  )}>
                    {card.type === 'vocabulary' ? '词汇' : '语法'}
                  </span>
                  {card.jlpt_level && (
                    <span className={clsx('text-xs font-bold', style.label)}>
                      {card.jlpt_level}
                    </span>
                  )}
                </div>

                {/* 提示内容（居中大字） */}
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                  <p className="text-4xl font-bold text-fg leading-tight">
                    {card.prompt_value ?? card.key}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {promptType === 'meaning' ? '中文释义' : promptType === 'reading' ? '读音' : '例句'}
                  </p>
                </div>

                {/* 底部提示 */}
                <p className="text-center text-xs text-fg-subtle">点击翻转查看</p>
              </div>
            </CardFace>

            {/* 背面 */}
            <CardFace backface={true}>
              <div className={clsx('absolute inset-0 rounded-2xl border-2', style.border, style.bg)} />
              <div className="relative flex flex-col h-full gap-3 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold text-fg">{card.key}</p>
                  {card.jlpt_level && (
                    <span className={clsx('text-xs font-bold', style.label)}>
                      {card.jlpt_level}
                    </span>
                  )}
                </div>

                {Object.entries(propertyGroups).map(([kind, values]) => (
                  <div key={kind} className="space-y-1">
                    <p className="text-2xs font-semibold text-fg-subtle uppercase tracking-wide">
                      {kind}
                    </p>
                    {values.map((v, i) => (
                      <p key={i} className="text-sm text-fg">{v}</p>
                    ))}
                  </div>
                ))}
              </div>
            </CardFace>
          </motion.div>
        </div>

        {/* 左划遮罩（不会） */}
        {isTop && (
          <motion.div
            className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none"
            style={{ opacity: leftOverlayOpacity }}
          >
            <div className="absolute inset-0 rounded-2xl bg-red-400/30" />
            <span className="relative text-4xl font-black text-red-600 rotate-[-15deg]">不会</span>
          </motion.div>
        )}

        {/* 右划遮罩（会） */}
        {isTop && (
          <motion.div
            className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none"
            style={{ opacity: rightOverlayOpacity }}
          >
            <div className="absolute inset-0 rounded-2xl bg-green-400/30" />
            <span className="relative text-4xl font-black text-green-600 rotate-[15deg]">会</span>
          </motion.div>
        )}
      </motion.div>
    </>
  )
}
```

- [ ] **Step 2: 在 tailwind.config.js 中添加 shimmer keyframe（如果尚未存在）**

打开 `frontend/tailwind.config.js`，找到 `theme.extend`，添加：

```js
theme: {
  extend: {
    // ...existing...
    keyframes: {
      shimmer: {
        '0%': { transform: 'translateX(-100%)' },
        '100%': { transform: 'translateX(200%)' },
      },
    },
    animation: {
      shimmer: 'shimmer 2s ease-in-out infinite',
    },
  },
},
```

- [ ] **Step 3: 验证 TypeScript 编译无报错**

```bash
cd /Users/dairui/JLPT-master/frontend
npx tsc --noEmit
```

预期：无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/internalize/FlashCard.tsx frontend/tailwind.config.js
git commit -m "feat: add FlashCard component with flip, drag, level styling, and N1 animation"
```

---

## Task 7: 前端 — CardDeck 组件（卡堆 + 会话管理）

**Files:**
- Create: `frontend/src/components/internalize/CardDeck.tsx`

- [ ] **Step 1: 创建 CardDeck.tsx**

```tsx
// frontend/src/components/internalize/CardDeck.tsx
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import FlashCard from './FlashCard'
import { getInternalizeQueue, postInternalizeTrace } from '../../services/api'
import type { InternalizeCard, SwipeResult, SessionConfig } from '../../types'

type Phase = 'loading' | 'shuffle' | 'playing' | 'done'

interface Props {
  config: SessionConfig
  onDone: (results: { know: number; unknown: number }) => void
}

// 洗牌动画：4 张占位卡片扇开再合拢
function ShuffleAnimation({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute w-32 h-44 rounded-xl bg-surface border border-border shadow-card"
          initial={{ rotate: 0, x: 0, y: 0 }}
          animate={{
            rotate: [0, (i - 1.5) * 18, 0],
            x: [0, (i - 1.5) * 30, 0],
            y: [0, -10, 0],
          }}
          transition={{ duration: 0.6, times: [0, 0.5, 1], ease: 'easeInOut', delay: 0.1 }}
          onAnimationComplete={i === 3 ? onComplete : undefined}
        />
      ))}
    </div>
  )
}

export default function CardDeck({ config, onDone }: Props) {
  const [cards, setCards] = useState<InternalizeCard[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [results, setResults] = useState({ know: 0, unknown: 0 })

  useEffect(() => {
    getInternalizeQueue({
      limit: config.limit,
      prompt: config.promptType,
      tag: config.tag || undefined,
    })
      .then((res) => {
        setCards(res.cards)
        setPhase('shuffle')
      })
      .catch(() => setPhase('done'))
  }, [config])

  const handleSwipe = useCallback(
    (result: SwipeResult, cardId: string) => {
      // 立即更新 UI（乐观更新）
      setCurrentIndex((prev) => {
        const next = prev + 1
        return next
      })
      setResults((prev) => ({
        know: result === 'know' ? prev.know + 1 : prev.know,
        unknown: result === 'unknown' ? prev.unknown + 1 : prev.unknown,
      }))

      // 后台写 trace（不阻塞 UI）
      postInternalizeTrace(cardId, result, config.promptType).catch(console.error)
    },
    [config.promptType],
  )

  // 全部划完后通知父组件
  useEffect(() => {
    if (phase === 'playing' && cards.length > 0 && currentIndex >= cards.length) {
      setPhase('done')
      onDone(results)
    }
  }, [currentIndex, cards.length, phase, results, onDone])

  const visibleCards = cards.slice(currentIndex, currentIndex + 3)

  return (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
      {phase === 'loading' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-fg-muted text-sm">加载中...</p>
        </div>
      )}

      {phase === 'shuffle' && (
        <ShuffleAnimation onComplete={() => setPhase('playing')} />
      )}

      {phase === 'playing' && (
        <>
          {/* 进度条 */}
          <div className="px-6 pt-4 pb-2">
            <div className="flex items-center justify-between text-xs text-fg-subtle mb-1">
              <span>{currentIndex} / {cards.length}</span>
              <span>
                <span className="text-green-600 font-medium">{results.know} 会</span>
                {' · '}
                <span className="text-red-500 font-medium">{results.unknown} 不会</span>
              </span>
            </div>
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-accent rounded-full"
                animate={{ width: `${(currentIndex / cards.length) * 100}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 30 }}
              />
            </div>
          </div>

          {/* 卡堆区域 */}
          <div className="relative flex-1">
            <AnimatePresence>
              {[...visibleCards].reverse().map((card, reverseIdx) => {
                const stackIndex = visibleCards.length - 1 - reverseIdx
                return (
                  <FlashCard
                    key={card.id}
                    card={card}
                    stackIndex={stackIndex}
                    promptType={config.promptType}
                    onSwipe={(result) => handleSwipe(result, card.id)}
                  />
                )
              })}
            </AnimatePresence>
          </div>

          {/* 操作提示 */}
          <div className="flex items-center justify-center gap-8 py-4 text-xs text-fg-subtle">
            <span>← 不会</span>
            <span>点击翻转</span>
            <span>会 →</span>
          </div>
        </>
      )}

      {/* 空库提示 */}
      {phase === 'playing' && cards.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-fg-muted">知识库暂无原子，先去分析一些内容吧</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd /Users/dairui/JLPT-master/frontend
npx tsc --noEmit
```

预期：无错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/internalize/CardDeck.tsx
git commit -m "feat: add CardDeck component with shuffle animation and session management"
```

---

## Task 8: 前端 — SessionResult 组件

**Files:**
- Create: `frontend/src/components/internalize/SessionResult.tsx`

- [ ] **Step 1: 创建 SessionResult.tsx**

```tsx
// frontend/src/components/internalize/SessionResult.tsx
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

interface Props {
  results: { know: number; unknown: number }
  onRestart: () => void
  onExit: () => void
}

function CountUp({ target, className }: { target: number; className?: string }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (target === 0) return
    let current = 0
    const step = Math.max(1, Math.ceil(target / 30))
    const timer = setInterval(() => {
      current = Math.min(current + step, target)
      setDisplay(current)
      if (current >= target) clearInterval(timer)
    }, 30)
    return () => clearInterval(timer)
  }, [target])

  return <span className={className}>{display}</span>
}

export default function SessionResult({ results, onRestart, onExit }: Props) {
  const total = results.know + results.unknown
  const knowPct = total > 0 ? Math.round((results.know / total) * 100) : 0

  return (
    <motion.div
      className="flex flex-col items-center justify-center h-full px-6 gap-8"
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 24 }}
    >
      <h2 className="text-2xl font-bold text-fg">本轮完成</h2>

      <div className="flex gap-8">
        <div className="text-center">
          <CountUp
            target={results.know}
            className="text-5xl font-black text-green-500"
          />
          <p className="text-sm text-fg-muted mt-1">会</p>
        </div>
        <div className="text-4xl font-light text-fg-subtle flex items-center">/</div>
        <div className="text-center">
          <CountUp
            target={results.unknown}
            className="text-5xl font-black text-red-400"
          />
          <p className="text-sm text-fg-muted mt-1">不会</p>
        </div>
      </div>

      {/* 正确率条 */}
      {total > 0 && (
        <div className="w-full max-w-xs space-y-1">
          <div className="flex justify-between text-xs text-fg-subtle">
            <span>掌握率</span>
            <span>{knowPct}%</span>
          </div>
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-green-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${knowPct}%` }}
              transition={{ delay: 0.4, duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={onRestart} className="btn-primary">
          再来一轮
        </button>
        <button onClick={onExit} className="btn-ghost border border-border">
          完成
        </button>
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/internalize/SessionResult.tsx
git commit -m "feat: add SessionResult component with count-up animation"
```

---

## Task 9: 前端 — 组合 InternalizePage

**Files:**
- Modify: `frontend/src/pages/InternalizePage.tsx`

- [ ] **Step 1: 替换占位页面**

```tsx
// frontend/src/pages/InternalizePage.tsx
import { useState } from 'react'
import SessionSetup from '../components/internalize/SessionSetup'
import CardDeck from '../components/internalize/CardDeck'
import SessionResult from '../components/internalize/SessionResult'
import type { SessionConfig } from '../types'

type PagePhase = 'setup' | 'playing' | 'result'

export default function InternalizePage() {
  const [phase, setPhase] = useState<PagePhase>('setup')
  const [config, setConfig] = useState<SessionConfig>({ limit: 20, promptType: 'meaning', tag: '' })
  const [results, setResults] = useState({ know: 0, unknown: 0 })

  function handleStart(cfg: SessionConfig) {
    setConfig(cfg)
    setResults({ know: 0, unknown: 0 })
    setPhase('playing')
  }

  function handleDone(res: { know: number; unknown: number }) {
    setResults(res)
    setPhase('result')
  }

  function handleRestart() {
    setPhase('playing')
    setResults({ know: 0, unknown: 0 })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {phase === 'setup' && <SessionSetup onStart={handleStart} />}
      {phase === 'playing' && (
        <CardDeck key={JSON.stringify(config)} config={config} onDone={handleDone} />
      )}
      {phase === 'result' && (
        <SessionResult results={results} onRestart={handleRestart} onExit={() => setPhase('setup')} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd /Users/dairui/JLPT-master/frontend
npx tsc --noEmit
```

预期：无错误。

- [ ] **Step 3: 启动前后端，人工测试完整流程**

```bash
# 终端 1
cd /Users/dairui/JLPT-master/backend
PYTHONPATH=. uvicorn app.main:app --reload --port 8000

# 终端 2
cd /Users/dairui/JLPT-master/frontend
npm run dev
```

打开 http://localhost:5173/internalize，验证：
1. 设置页正常显示，数量/提示/级别选择正常
2. 点击开始，洗牌动画播放
3. 卡牌正面显示提示属性，点击翻转 → 背面属性列表
4. 左划卡片飞出左侧（先震动），右划飞出右侧
5. 拖拽中出现"不会 / 会"遮罩
6. 所有卡划完后显示结果页，数字递增动画
7. "再来一轮"返回卡堆，"完成"返回设置页
8. 知识库中有 N1 词汇时，验证金色粒子边框和降临动画

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/InternalizePage.tsx
git commit -m "feat: wire up InternalizePage with setup/play/result flow"
```
