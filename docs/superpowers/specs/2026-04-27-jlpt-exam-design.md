# JLPT 模拟考试模块设计文档

> 版本：v1.0 · 2026-04-27

---

## 一、背景与目标

用户学习 JLPT 的方式是：在纸质或 PDF 试卷上做题，做完后逐题检查，对不理解的题目深入分析。这个"做完 → 检查 → 理解"的流程是内化发生的核心时刻。

本模块的目标是将这个已有学习行为无缝接入知识库系统：
- 在系统内答题（消除截图/粘贴的摩擦）
- 算分、定位错题
- 对错题触发 AI 深度分析（四选项对比）
- 将分析中发现的语法关系建议入库（用户主动确认）

**核心原则**：学习发生在过程中，不在结果里。做错了 → 想知道为什么 → 主动确认有价值的知识，每一步都需要认知参与，系统不代劳判断。

---

## 二、数据模型

新增 6 张表，遵循现有代码风格（UUID 主键、PostgreSQL、JSONB 存结构数据）。

### exam_papers
```sql
id          UUID PK
title       TEXT NOT NULL          -- "JLPT N2 2024年7月"
level       VARCHAR(5) NOT NULL    -- N1 | N2 | N3 | N4 | N5
source      TEXT                   -- 来源说明（可选）
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

### exam_sections
```sql
id          UUID PK
paper_id    UUID FK → exam_papers (CASCADE)
name        VARCHAR(50) NOT NULL   -- "文法" | "読解" | "聴解" | "文字・語彙"
order       INTEGER NOT NULL       -- 节内顺序
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

### exam_questions
```sql
id             UUID PK
section_id     UUID FK → exam_sections (CASCADE)
type           VARCHAR(20) NOT NULL  -- grammar | reading | listening | ordering
stem           TEXT NOT NULL         -- 题干
options        JSONB NOT NULL        -- {"A": "のに", "B": "くせに", "C": "...", "D": "..."}
correct_answer VARCHAR(1) NOT NULL   -- A | B | C | D
order          INTEGER NOT NULL
created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
```

### question_analyses
```sql
id             UUID PK
question_id    UUID FK → exam_questions (CASCADE) UNIQUE
session_data   JSONB                 -- AI 分析结果 + 追问历史（共享，题目维度）
relations_suggested JSONB            -- 语法关系建议列表（共享）
created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
```

**注意**：`question_analyses` 属于题目，不属于用户。分析结果是客观的（正确解析不因人而异），对所有用户共享。

### exam_attempts
```sql
id           UUID PK
paper_id     UUID FK → exam_papers (CASCADE)
status       VARCHAR(20) NOT NULL DEFAULT 'in_progress'  -- in_progress | completed
score        JSONB                -- {"文法": {"correct": 8, "total": 13}, "total": {...}}
started_at   TIMESTAMPTZ NOT NULL DEFAULT now()
completed_at TIMESTAMPTZ
```

### attempt_answers
```sql
attempt_id   UUID FK → exam_attempts (CASCADE)
question_id  UUID FK → exam_questions (CASCADE)
user_answer  VARCHAR(1) NOT NULL   -- A | B | C | D
is_correct   BOOLEAN NOT NULL
PRIMARY KEY (attempt_id, question_id)
```

---

## 三、数据导入

PDF 试卷不通过系统自动处理。流程：

1. 用户手动整理题目，参照以下 JSON 格式创建文件
2. 运行 seed 脚本写入数据库

**JSON 格式**：
```json
{
  "title": "JLPT N2 2024年7月",
  "level": "N2",
  "source": "官方真题",
  "sections": [
    {
      "name": "文法",
      "questions": [
        {
          "type": "grammar",
          "stem": "彼は病気な___、学校に来た。",
          "options": {"A": "のに", "B": "くせに", "C": "にもかかわらず", "D": "から"},
          "correct_answer": "A"
        }
      ]
    }
  ]
}
```

**判重**：按 `title + level` 判断是否已导入，重复时提示用户。

---

## 四、答题流程

### API 端点

```
GET  /api/exams                              → 试卷列表
GET  /api/exams/{id}                         → 试卷详情（含分节和题目，不含正确答案）
POST /api/exams/{id}/attempts                → 开始新的答题，返回 attempt_id
GET  /api/attempts/{id}                      → 当前答题进度（哪些节已提交、各节得分）
PUT  /api/attempts/{id}/answers              → 提交单题答案 {question_id, answer}
POST /api/attempts/{id}/sections/{sid}/submit → 提交本节，返回本节得分 + 对错详情
```

### 分节独立提交

- 用户可以只做文法节，跳过阅读，之后再回来
- 每节提交后立即计算本节得分，更新 `exam_attempts.score`
- attempt 无需显式"完成"——用户做完想做的节即结束
- 未提交的节不影响已提交节的得分

### 前端布局（JlptPage）

```
┌─────────────────────────────────────────┐
│  试卷列表  →  选一份  →  开始/继续答题    │
├──────────┬──────────────────────────────┤
│ 题号导航  │  题干                         │
│（左侧）   │                               │
│ 1 ✓      │  ○ A. のに                    │
│ 2 ●      │  ● B. くせに  ← 已选          │
│ 3 …      │  ○ C. にもかかわらず           │
│          │  ○ D. から                    │
│          │                               │
│          │  [上一题]  [下一题]            │
├──────────┴──────────────────────────────┤
│  [提交本节]                               │
└─────────────────────────────────────────┘
```

提交后进入结果页：

```
文法节：8/13 ✓
───────────────
第1题  ✓  A. のに
第2题  ✗  你选了B，正确是A  [分析]
第3题  ✓  C. にもかかわらず
...
```

---

## 五、AI 分析与缓存

### 触发时机

用户点击错题旁的"分析"按钮：

```
GET /api/questions/{id}/analysis
  → 若 question_analyses 已存在：直接返回缓存
  → 若不存在：调用 LLM 生成，存入 question_analyses，返回
```

### 分析内容（grammar 类型）

复用现有 `jlpt_grammar` 分析模板，输出：
- 正确答案解释（为什么选 A）
- 四个选项逐一分析（每项语法含义、为什么不对）
- `relations_suggested`：选项间的语法关系建议

**relations_suggested 格式**：
```json
[
  {
    "from": "のに",
    "to": "くせに",
    "type": "nuance",
    "note": "都表逆接，のに含遗憾/惊讶，くせに含批评/责怪"
  },
  {
    "from": "のに",
    "to": "にもかかわらず",
    "type": "quasi_synonym",
    "note": "书面语 vs 口语，にもかかわらず更正式"
  }
]
```

**关系类型**（4 种）：
- `quasi_synonym`：近义，功能相同，使用条件不同
- `casual_form`：口语/缩约形式（例：てしまう↔ちゃう）
- `nuance`：语感差异（情绪、立场不同）
- `scope_diff`：适用范围/条件不同（例：うちに↔あいだに）

### 追问

分析结果页底部有追问输入框，复用现有 followup 机制，追问历史追加到 `question_analyses.session_data`。追问内容对所有用户共享（单用户系统，无需隔离）。

---

## 六、关系建议与入库

### 数据分层

```
question_analyses.relations_suggested
  → 属于题目，客观，所有用户共享
  → 仅是建议，不自动写入任何用户的知识库

atom_relations / atoms
  → 属于用户的个人知识图谱
  → 需要用户主动确认
```

### 确认流程

分析结果页显示关系建议卡片：

```
┌──────────────────────────────┐
│ 发现语法关联                  │
│                              │
│ のに ↔ くせに                │
│ 类型：语感差异                │
│ "都表逆接，のに含遗憾，       │
│  くせに含批评"                │
│                              │
│ [确认入库]  [跳过]            │
└──────────────────────────────┘
```

点"确认入库"：
1. 检查 `atoms` 表中是否已有这两个 atom（按 key 查找）
2. 不存在则创建
3. 写入 `atom_relations`
4. 记录 `traces`（来源：exam_question）

**这个确认动作本身就是学习**——用户主动判断"这个关系对我有价值"，是认知参与的一部分。

---

## 七、与现有系统的关系

| 现有模块 | 关系 |
|---------|------|
| AnalysisPage | 独立入口（粘贴文本/截图），不变 |
| atoms / atom_relations | 共用，入库流程一致 |
| jlpt_grammar 分析模板 | 直接复用 |
| followup 机制 | 直接复用 |
| Qdrant 相似检索 | 入库时关系发现（独立于本模块） |

---

## 八、实现优先级

### MVP（最小可用）
1. 数据模型建表 + seed 脚本
2. 答题 API（开始/答题/分节提交/得分）
3. JlptPage 答题 UI + 结果页
4. 题目分析 API（懒生成 + 缓存）
5. 分析结果展示 + 追问

### 后续迭代
- 关系建议确认 UI（入库流程）
- 阅读题、听力题的分析模板
- 多次 attempt 历史对比
- 单题正确率统计（基于所有用户的 attempt_answers）
