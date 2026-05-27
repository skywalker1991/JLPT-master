# 内化学习：无限卡牌复习重构

**日期：** 2026-05-27  
**状态：** 已批准，待实现

---

## 背景

现有卡牌复习是"有终点的会话"模式：先配置张数/类型，刷完一批后进入结果页。这与移动端"随时打开随时刷"的日常使用场景不符，摩擦太高。

本次重构目标：改为 Tinder 式无限流，配置和统计内嵌页面，骨子里是 Leitner 间隔复习，UI 感知是无限随机。

---

## 心智模型

**外部感受：** 无限随机流，随时打开随时刷，没有"结束"概念。

**内部机制：** 每张牌有 SRS 状态（Box 0~5），划"会"升级延长复习间隔，划"不会"降回 Box 1 短时间内重现。无限流 = 今日到期的牌 + 新词补充，UI 不暴露任何 box/due date 概念。

### Leitner Box 间隔

| Box | 含义 | 划"会"后间隔 | 划"不会" |
|-----|------|------------|---------|
| 0 | 新词 | 首次见 → Box 1 | — |
| 1 | 学习中 | 1 小时 | 停留 Box 1，10 分钟后重现 |
| 2 | 短期 | 1 天 | 降回 Box 1 |
| 3 | 中期 | 3 天 | 降回 Box 1 |
| 4 | 长期 | 7 天 | 降回 Box 1 |
| 5 | 掌握 | 14 天 | 降回 Box 1 |

---

## 数据模型

### 新表：`atom_srs_state`

```sql
CREATE TABLE atom_srs_state (
  atom_id      UUID PRIMARY KEY REFERENCES atoms(id),
  box_level    SMALLINT NOT NULL DEFAULT 0,  -- 0~5
  next_review  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

没有记录的 atom 视为 Box 0（新词）。

### API 变化

| 端点 | 变化 |
|------|------|
| `GET /api/internalize/queue` | 优先返回 `next_review <= now` 的牌；不足时补 Box 0 新词；参数增加 `levels`（多选 JLPT 级别） |
| `POST /api/internalize/trace` | 同时更新 `atom_srs_state`（box_level + next_review） |
| `GET /api/internalize/stats` | 新接口，返回今日和总体统计 |

### Stats 接口返回结构

```json
{
  "today": { "know": 12, "unknown": 5, "total": 17 },
  "total": { "know": 342, "unknown": 128, "mastery_pct": 73 },
  "distribution": { "box0": 180, "box1": 42, "box2": 28, "box3": 15, "box4": 8, "box5": 5 }
}
```

---

## 前端架构

### Phase 状态简化

```ts
// 之前
type PagePhase = 'home' | 'setup' | 'playing' | 'result'

// 之后
type PagePhase = 'home' | 'playing'
```

### 组件变化

| 组件 | 动作 |
|------|------|
| `SessionSetup.tsx` | 删除 |
| `SessionResult.tsx` | 删除 |
| `CardDeck.tsx` | 重构为 `InfiniteCardDeck.tsx` |
| `FlashCard.tsx` | 改造（新样式 + 翻牌后判定） |
| `StatsBar.tsx` | 新增 |
| `ConfigSheet.tsx` | 新增 |

### 页面布局（playing 状态）

```
┌─────────────────────────┐
│  卡牌复习           ⚙️  │  header
├─────────────────────────┤
│     StatsBar            │  今日/总体切换
│                         │
│    InfiniteCardDeck      │  flex-1，卡堆主体
│                         │
└─────────────────────────┘
       ConfigSheet（底部 sheet，⚙️ 触发）
```

### InfiniteCardDeck 队列机制

```ts
// 本地队列，< 5 张时自动预取下一批（每批 20 张）
// 用户感知不到加载，队列始终有牌
const [queue, setQueue] = useState<InternalizeCard[]>([])
const [head, setHead] = useState(0)  // 当前顶牌索引

useEffect(() => {
  if (queue.length - head < 5) fetchNextBatch()
}, [head])
```

### ConfigSheet 配置项

- **提示模式**：词义模式 / 读音模式（单选）
- **JLPT 级别**：全部 / N1 / N2 / N3 / N4 / N5（多选）

配置变更 → 清空队列 → 用新参数重新拉取。

### StatsBar

```ts
type StatsMode = 'today' | 'total'
// 点击切换
// today：本地计数（当前打开以来）
// total：从 /api/internalize/stats 拉取
```

显示格式：
- 今日：`今日  会 12  不会 5`
- 总体：`总体  掌握 73%  学习中 42`

---

## 卡牌设计

### 尺寸

移动端优化，从 `w-56 h-80` 改为 `w-72 h-[420px]`（或按视口动态计算）。

### 识别模式（两种）

| 模式 | 正面显示 | 背面主角 |
|------|---------|---------|
| 词义模式 | 裸汉字（无假名） | ruby 标注 + 汉字 → 中文含义 |
| 读音模式 | 裸汉字（无假名） | ruby 标注 + 汉字 → 假名（最大） |

两种模式正面外观完全相同，区别在配置层。

### 正面布局

```
┌──────────────────────┐
│ [词汇]          N3   │  ← 顶部标签行
│                      │
│                      │
│       学習            │  ← 大字，垂直居中偏上
│                      │
│                      │
│                      │
└──────────────────────┘
```

- 主词：`text-5xl font-bold`，垂直居中
- 无任何提示文字，干净

### 背面布局（统一，不分模式）

```
┌──────────────────────┐
│ [词汇]          N3   │  ← 顶部标签行（与正面一致）
│                      │
│   ﾞがくしゅう         │  ← ruby 小字，悬于汉字上方
│      学習             │  ← 与正面同等大小、同等位置
│                      │
│ ─────────────────    │
│ 学习；学习             │  ← 中文含义，中等字体
│                      │
│ 毎日学習している      │  ← 例句（日），小
│ 每天都在学习          │  ← 例句（中），更小
│                      │
│ 名詞                  │  ← 用法信息，最小
│ ─────────────────    │
│  ← 不会      会 →    │  ← 划牌方向提示
└──────────────────────┘
```

**翻牌前后视觉一致性：** 正面的词在哪个位置，背面的词就在相同位置，翻转时视觉不跳。

**ruby 标注实现：**
```tsx
<ruby>学習<rt>がくしゅう</rt></ruby>
```

### 交互机制（关键变化）

- **翻牌前**：拖动手势无效，卡牌只响应点击（翻牌）
- **翻牌后**：左划 = 不会，右划 = 会
- 左右划提示在翻牌后才显示（`← 不会` / `会 →`）

### 保留现有视觉效果

- N1 金粒子 + 暗场光环
- N2 扫光动画
- JLPT 等级配色系统

---

## 不做的事

- 不暴露 box level 或 due date 给用户
- 不做"今日任务完成"的硬性结束点（可以无限刷，统计行体现进度感）
- 不做打字/输入判定（属于其他练习模式）
