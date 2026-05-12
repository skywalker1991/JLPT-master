# JLPT Master — 详细设计文档

> 基于创世文档（VISION.md v0.5）和技术架构文档（ARCHITECTURE.md v0.5），定义具体的数据结构、接口规范和实现细节。

---

## 一、数据库 Schema

### 1.1 核心模型

#### atoms（原子）

```sql
CREATE TABLE atoms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(20) NOT NULL,     -- 'vocabulary' | 'grammar'
  key         TEXT NOT NULL,             -- 辞书形（词汇）或标准形（语法）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(type, key)
);

CREATE INDEX idx_atoms_type ON atoms(type);
```

设计决策：
- 原子表只存身份信息（type + key），不存 meaning、reading、jlpt_level
- 这些信息全部作为属性存储，因为语言本身是多义的、多读音的、分类标准不统一的
- UNIQUE(type, key) 保证同一类型下不会有重复的原子

#### atom_properties（属性）

```sql
CREATE TABLE atom_properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  kind        VARCHAR(50) NOT NULL,
  value       TEXT NOT NULL,
  source_type VARCHAR(20) NOT NULL,     -- 'dictionary' | 'ai' | 'user'
  source_ref  UUID,                      -- 关联到分析记录（可空）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_properties_atom ON atom_properties(atom_id);
CREATE INDEX idx_properties_kind ON atom_properties(atom_id, kind);
```

设计决策：
- append-only：只做 INSERT，不做 UPDATE，知识生长轨迹可追溯
- kind 使用 VARCHAR，不用数据库枚举，应用层维护已知 kind 列表并做校验
- value 使用 TEXT，属性值都是简单文本，去重比较无歧义
- source_type 区分信息来源的可信度：dictionary > user > ai
- source_ref 可关联到分析记录，支持从属性追溯到原始上下文

kind 预定义列表（应用层校验）：

| kind | 适用类型 | 说明 | value 示例 |
|------|---------|------|-----------|
| reading | 词汇 | 读音 | けっきょく |
| meaning | 词汇/语法 | 释义 | 最终、结局 |
| part_of_speech | 词汇 | 词性 | 副词 |
| jlpt_level | 词汇/语法 | JLPT 级别 | N3 |
| register | 词汇/语法 | 语体 | 口语 |
| usage | 词汇/语法 | 使用条件 | 用于句首，暗含无奈 |
| nuance | 词汇/语法 | 语感 | 比最終的に更带感情色彩 |
| oral_form | 词汇/语法 | 口语变形 | けっきょくさ |
| connection | 语法 | 接续方式 | V-て + しまう |
| example | 词汇/语法 | 以该词/语法为中心的例句 | 甘いお菓子を食べた |
| note | 词汇/语法 | 笔记/语言思维 | 听力中常出现在转折前 |

example 是 AI 生成的以该词/语法为中心的短例句，不同于分析记录中的原文（原文可能很长且焦点不在该词上）。example 通过 source_ref 和同一次分析中的 meaning 等属性自然关联，表示"这个例句对应这个含义"。

kind 列表可扩展，但新增 kind 需要同时更新：kind 列表 + AI prompt + 前端展示。

#### atom_relations（关系）

```sql
CREATE TABLE atom_relations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  to_id       UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL,
  note        JSONB,
  source_type VARCHAR(20) NOT NULL,     -- 'ai' | 'user'
  source_ref  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(from_id, to_id, type),
  CHECK (from_id != to_id)
);

CREATE INDEX idx_relations_from ON atom_relations(from_id);
CREATE INDEX idx_relations_to ON atom_relations(to_id);
```

设计决策：
- 双向可查：A→B 存一条记录，查询时从任意一端都能找到另一端
- UNIQUE(from_id, to_id, type) 防止重复关系
- note 使用 JSONB 存 AI 生成的对比说明

type 预定义列表（应用层校验）：

| type | 说明 | 示例 |
|------|------|------|
| synonym | 近义对比 | から ↔ ので |
| formal_casual | 书面↔口语 | やはり ↔ やっぱり |
| derivative | 同根变形 | 〜てしまう ↔ 〜ちゃう |
| contrast | 使用条件差异 | 〜うちに ↔ 〜あいだに |
| nuance | 语感/情绪差异 | 結局 ↔ 最終的に |

type 列表可扩展，但起步时保持克制。

---

### 1.2 应用层

#### atom_tags（标签）

```sql
CREATE TABLE atom_tags (
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  tag         VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (atom_id, tag)
);

CREATE INDEX idx_tags_tag ON atom_tags(tag);
```

#### traces（轨迹）

```sql
CREATE TABLE traces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  action      VARCHAR(30) NOT NULL,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_traces_atom ON traces(atom_id);
CREATE INDEX idx_traces_action ON traces(action);
CREATE INDEX idx_traces_created ON traces(created_at DESC);
```

action 预定义列表：

| action | 触发时机 | detail 示例 | 阶段 |
|--------|---------|------------|------|
| added | 原子首次入库 | {"from_analysis": "uuid"} | MVP |
| duplicate_attempt | 重复入库尝试 | {"from_analysis": "uuid"} | MVP |
| property_added | 补充属性 | {"kind": "nuance"} | MVP |
| relation_created | 建立关系 | {"related_atom": "uuid", "type": "synonym"} | MVP |
| translation_drill | 翻译造句练习 | {"score": 85, "feedback": "..."} | 第二阶段 |
| comparison_drill | 对比练习 | {"correct": true} | 第二阶段 |
| review | 复习 | {"result": "remembered"} | 第二阶段 |

#### analyses（分析记录）

```sql
CREATE TABLE analyses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  input_type    VARCHAR(20) NOT NULL,
  input_content TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  session_data  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_analyses_status ON analyses(status);
CREATE INDEX idx_analyses_created ON analyses(created_at DESC);
```

设计决策：
- input_type：'text' | 'image' | 'jlpt_grammar' | 'jlpt_reading' | 'jlpt_ordering' | 'jlpt_listening'
- input_content：用户输入的原始内容，是用户筛选过的学习材料，本身是一种资产
- status：'in_progress'（进行中，session_data 保存会话状态）| 'completed'（完成，session_data 可清空）
- session_data：仅进行中时有值，存储 AI 分析结果和追问历史，用于恢复未完成的会话

#### analysis_atoms（分析记录-原子关联）

```sql
CREATE TABLE analysis_atoms (
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  PRIMARY KEY (analysis_id, atom_id)
);

CREATE INDEX idx_analysis_atoms_atom ON analysis_atoms(atom_id);
```

记录"从这次分析中入库了哪些原子"，支持：
- 从分析记录查看产出的原子
- 从原子追溯来源分析记录
- 重新分析同一内容时对比知识成长

---

### 1.3 语义检索（Qdrant）

#### grammar_atoms collection

```
Collection: grammar_atoms
  id:        原子 UUID（与 PostgreSQL atoms.id 一致）
  vector:    语义向量（维度取决于 embedding 模型）
  payload:
    key:     语法标准形
    meaning: 基础释义
```

设计决策：
- 仅存储语法原子的向量，词汇原子通过辞书形精确匹配
- 向量在语法原子入库时生成，MVP 不自动更新，支持用户手动触发重新生成
- payload 存储基础信息用于过滤和展示，不替代 PostgreSQL 中的完整数据
- Qdrant 写入失败不阻塞入库，后台重试

---

### 1.4 Schema 总览

```
核心模型（稳定，适用于一切语言）：
  atoms              type + key
  atom_properties    kind + value + source
  atom_relations     type + note + source

应用层（按需扩展）：
  atom_tags          tag
  traces             action + detail
  analyses           input + session state
  analysis_atoms     分析-原子关联

语义检索：
  Qdrant: grammar_atoms    vector + payload
```

---

## 二、AI 输出 Schema

AI 的职责是在本地预处理结果的约束下做判断。本地预处理（形态素分析）提供分词和辞书形，AI 在此基础上做**筛选、识别和增强**：

- 从分词结果中**筛选**出值得学习的词汇
- **识别**语法模式（分词器识别词，不识别语法）
- 为词汇和语法**增强**理解性信息（语感、用法、语体等）

每种操作有专用的 Schema，通过 Pydantic 约束 AI 必须按格式输出。

### 2.1 自由文本分析

```python
class VocabItem(BaseModel):
    surface: str              # 原文中的形式（食べちゃった）
    base: str                 # 辞书形（食べる）
    reading: str | None       # 读音（たべる），AI 不确定时为 null
    meaning: str              # 语境中的释义
    part_of_speech: str | None  # 词性
    jlpt_level: str | None    # JLPT 级别
    register: str | None      # 语体（口语/书面/正式）
    usage: str | None         # 使用条件
    nuance: str | None        # 语感
    example: str | None       # 以该词为中心的短例句

class GrammarItem(BaseModel):
    pattern: str              # 标准形（〜てしまう）
    meaning: str              # 释义
    connection: str | None    # 接续方式
    jlpt_level: str | None
    register: str | None
    usage: str | None
    nuance: str | None
    example: str | None       # 以该语法为中心的短例句

class SentenceAnalysis(BaseModel):
    index: int                # 句子序号
    text: str                 # 原文句子
    translation: str          # 中文翻译
    vocab: list[VocabItem]    # AI 筛选出的值得学习的词汇
    grammar: list[GrammarItem]  # AI 识别的语法模式

class FreeTextResult(BaseModel):
    sentences: list[SentenceAnalysis]
```

设计决策：
- 按句输出，和原文逐句对应，每个词汇/语法有明确的来源句
- VocabItem 包含全部字段（reading、meaning 等），因为词典不参与分析流程，AI 提供所有语言信息
- VocabItem.meaning 是语境中的释义（AI 给的），不是词典的通用释义
- AI 从分词结果中筛选词汇，过滤掉助词、基础词等噪声
- example 是 AI 生成的以该词/语法为中心的短例句，不同于原文长句
- 支持流式返回：逐句输出 SentenceAnalysis

### 2.2 JLPT 题型分析

#### 语法题

```python
class OptionAnalysis(BaseModel):
    option: str               # 选项内容
    is_correct: bool
    explanation: str          # 为什么对/错
    grammar: GrammarItem      # 该选项对应的完整语法信息（可入库）

class GrammarQuizResult(BaseModel):
    question: str             # 题目原文（含空）
    correct_answer: str       # 正确选项
    completed_sentence: SentenceAnalysis  # 填入正确答案后的完整句子分析（可入库）
    options_analysis: list[OptionAnalysis]  # 每个选项的语法分析（可入库）
```

#### 排序题

```python
class OrderingQuizResult(BaseModel):
    question: str             # 题目原文（含碎片选项）
    correct_order: list[str]  # 正确排序
    explanation: str          # 排序依据
    completed_sentence: SentenceAnalysis  # 排序后的完整句子分析（可入库）
```

#### 阅读题

```python
class ReadingQuestion(BaseModel):
    question: str
    correct_answer: str
    options_analysis: list[OptionAnalysis]

class ReadingResult(BaseModel):
    sentences: list[SentenceAnalysis]  # 复用自由文本的逐句分析
    questions: list[ReadingQuestion]
```

#### 听力题

```python
class OralFeature(BaseModel):
    expression: str           # 口语表现（じゃん、っす）
    standard_form: str        # 标准形式
    explanation: str

class ListeningResult(BaseModel):
    sentences: list[SentenceAnalysis]  # 逐句分析
    oral_features: list[OralFeature]   # 口语表现专项
```

### 2.3 追问模板

每种追问模板有专用 Schema，确保输出结构可预测。

#### 对比

```python
class ComparisonResult(BaseModel):
    atom_a: str               # 原子 A 的 key
    atom_b: str               # 原子 B 的 key
    similarity: str           # 相同点
    difference: str           # 核心区别
    example_a: str            # A 的用例
    example_b: str            # B 的用例
    relation_type: str        # 建议的关系类型（从五种中选）
```

#### 用法

```python
class UsageResult(BaseModel):
    atom_key: str
    usage: str                # 使用条件
    register: str | None
```

#### 变形

```python
class DerivativeItem(BaseModel):
    form: str                 # 变形（〜ちゃう）
    register: str             # 语体（口语）
    explanation: str

class DerivativeResult(BaseModel):
    atom_key: str
    derivatives: list[DerivativeItem]
```

#### 例句

```python
class ExampleResult(BaseModel):
    atom_key: str
    examples: list[str]       # 以该词/语法为中心的短例句，入库为 kind='example'
```

### 2.4 Schema 与知识库的映射

AI 输出通过转换层映射到知识库写入格式：

```
AI 输出字段          →  atom_properties.kind
─────────────────────────────────────────
VocabItem.reading         →  kind='reading'
VocabItem.meaning         →  kind='meaning'
VocabItem.part_of_speech  →  kind='part_of_speech'
VocabItem.jlpt_level      →  kind='jlpt_level'
VocabItem.register        →  kind='register'
VocabItem.usage           →  kind='usage'
VocabItem.nuance          →  kind='nuance'
VocabItem.example         →  kind='example'

GrammarItem.meaning       →  kind='meaning'
GrammarItem.connection    →  kind='connection'
GrammarItem.jlpt_level    →  kind='jlpt_level'
GrammarItem.register      →  kind='register'
GrammarItem.usage         →  kind='usage'
GrammarItem.nuance        →  kind='nuance'
GrammarItem.example       →  kind='example'

ComparisonResult          →  atom_relations（type 由 relation_type 指定）
DerivativeResult          →  atom_relations（type='derivative'）+ atom_properties（kind='oral_form'）
UsageResult               →  atom_properties（kind='usage' + kind='register'）
ExampleResult             →  atom_properties（kind='example'）
```

转换规则：遍历 AI 输出的非空字段，为每个字段创建对应的 atom_property 记录，source_type='ai'。

---

## 三、校验与转换规则

### 3.1 为什么需要转换

AI 输出和数据库存储的视角根本不同：

```
AI 输出：以句子为中心（一次任务的结果）
  "这个句子里有这些词和语法，它们在这个语境下是什么意思"

数据库：以原子为中心（持续生长的知识网络）
  "这个原子有哪些属性，从不同的句子中积累而来，和其他原子有什么关系"
```

转换层负责把一次性的任务结果，组织进持续生长的知识网络。

### 3.2 转换流程

```
AI 输出 SentenceAnalysis
        │
        ▼
Step 1: 校验
  ├── 必填字段非空（base/pattern、meaning）
  ├── kind 在预定义列表内
  ├── jlpt_level 格式合法（N1~N5 或空）
  └── 校验失败 → 丢弃该条目，静默处理，不阻塞整体
        │
        ▼
Step 2: 拆解（句子视角 → 原子视角）
  ├── 遍历 vocab 列表：每个 VocabItem → 原子候选 + 属性集合
  └── 遍历 grammar 列表：每个 GrammarItem → 原子候选 + 属性集合
        │
        ▼
Step 3: 返回前端展示
  用户看到逐句的分析结果，逐条判断 [入库] 或 [跳过]

────── 前后端交互边界 ──────
以下步骤在用户点击 [入库] 后触发（前端调用 POST /api/atoms）：

Step 4: 原子查重
  ├── 词汇 → 辞书形精确匹配 atoms 表
  ├── 语法 → 精确匹配 → 未命中则 Qdrant 语义检索
  │
  ├── 不存在 → 创建新原子
  ├── 已存在（精确匹配）→ 提示用户"已在库中"
  └── 发现相似（语义匹配）→ 展示相似原子，用户决定合并/关联/独立
        │
        ▼
Step 5: 属性去重
  遍历原子候选的属性集合：
  ├── 该原子已有相同 kind + 相同 value text → 跳过，不写入
  └── 不存在 → 写入 atom_properties
        │
        ▼
Step 6: 关联
  └── 原子 ↔ 分析记录 → 写入 analysis_atoms
        │
        ▼
Step 7: 轨迹
  ├── 新原子 → trace(action='added')
  ├── 已存在 → trace(action='duplicate_attempt')
  └── 补充属性 → trace(action='property_added')
```

### 3.3 校验规则

**规则校验（确定性，不依赖外部）：**

| 规则 | 失败处理 |
|------|---------|
| VocabItem.base 非空 | 丢弃该条目 |
| VocabItem.meaning 非空 | 丢弃该条目 |
| GrammarItem.pattern 非空 | 丢弃该条目 |
| GrammarItem.meaning 非空 | 丢弃该条目 |
| jlpt_level 格式 N1~N5 | 清空该字段，其余保留 |
| kind 在预定义列表内 | 丢弃该属性 |
| relation_type 在五种类型内 | 丢弃该关系 |

**语义校验（可选）：**

| 规则 | MVP 是否实现 |
|------|-------------|
| 辞书形是否合法（形态素分析器验证） | 是 |
| AI 交叉验证 | 否，预留 |

**原则：静默丢弃坏数据，不阻塞整体流程。**

### 3.4 属性去重规则

```
同一个原子下：
  kind 相同 + value 的文本内容完全相同 → 重复，不写入
  kind 相同 + value 文本不同 → 不同的观察，写入
  kind 不同 → 无关，写入
```

不做语义去重。"甜的"和"甘甜的"是不同的表述，各有价值，都保留。

### 3.5 追问结果的转换

追问模板的输出同样经过转换流程，但更简单：

| 追问类型 | 转换为 |
|---------|--------|
| ComparisonResult | 两个原子的属性 + 一条关系（atom_relations） |
| UsageResult | 原子的 kind='usage' 属性 + kind='register' 属性 |
| DerivativeResult | 原子的 kind='oral_form' 属性 + derivative 关系 |
| ExampleResult | 原子的 kind='example' 属性 |

追问产出的属性同样走去重逻辑。追问产出的关系检查是否已存在相同的 from_id + to_id + type。

---

## 四、API 端点设计

三个模块，对应用户的三个核心动作：分析内容、管理知识、查词。

### 4.1 分析模块

```
POST /api/preprocess
  纯本地处理，毫秒级返回，不调 AI，不创建分析记录
  输入：{ text: string }
  输出：{ sentences: [{ index, text, tokens: [{ surface, base, pos, reading }] }] }

POST /api/analyze
  本地预处理 + AI 分析，流式返回
  输入：{ text?: string, image?: base64, type: "text"|"image"|"jlpt_grammar"|"jlpt_reading"|"jlpt_ordering"|"jlpt_listening" }
  输出：SSE 流，逐句返回 SentenceAnalysis（自由文本）或对应题型的 Result
  副作用：创建分析记录（status='in_progress'）
  降级：AI 失败时，自由文本返回预处理结果；JLPT 题型返回错误

POST /api/analyses/{id}/followup
  基于分析上下文的追问探索
  输入：{ template: "comparison"|"usage"|"derivative"|"example"|"free", params: {...} }
  params 按模板：
    comparison: { atom_a: "から", atom_b: "ので" }
    usage:      { atom_key: "結局" }
    derivative: { atom_key: "〜てしまう" }
    example:    { atom_key: "結局" }
    free:       { question: "为什么这里用ので不用から？" }
  输出：对应模板的 Schema 结果
  副作用：追问历史追加到 session_data

POST /api/analyses/{id}/complete
  标记分析完成
  副作用：status → 'completed'，session_data 可清空

GET /api/analyses
  分析记录列表
  参数：?status=in_progress&page=1&limit=20
  输出：[{ id, input_type, status, created_at }]

GET /api/analyses/{id}
  分析记录详情（可用于恢复未完成的会话）
  输出：{ id, input_type, input_content, status, session_data, created_at }

DELETE /api/analyses/{id}
  删除分析记录及 analysis_atoms 关联
```

### 4.2 知识库模块

```
POST /api/atoms
  入库：查重 → 去重 → 写入
  输入：{ type, key, properties: [{ kind, value }], analysis_id? }
  处理：
    1. 原子查重（词汇精确匹配 / 语法精确+Qdrant语义匹配）
    2. 属性去重（同 kind + 同 value → 跳过）
    3. 写入 atoms + atom_properties + analysis_atoms + trace
  输出：
    { atom_id, status: "created" }                              新建成功
    { atom_id, status: "exists", existing_properties: [...] }   已存在
    { atom_id: null, status: "similar", candidates: [...] }     发现相似

  前端根据 status 展示不同交互：
    created → 入库成功
    exists → 提示"已在库中"，引导补充属性
    similar → 展示相似原子，用户选择合并/关联/独立创建

POST /api/atoms/{id}/properties
  补充属性
  输入：{ properties: [{ kind, value }], analysis_id? }
  处理：属性去重 → 写入 + trace(property_added)
  输出：{ added: number, skipped: number }

POST /api/atoms/{id}/relations
  建立关系
  输入：{ target_atom_id, type, note? }
  处理：关系去重 → 写入 + trace(relation_created)
  输出：{ relation_id, status: "created"|"exists" }

GET /api/atoms
  知识库列表
  参数：?type=vocabulary&tag=N2&search=結局&page=1&limit=20
  输出：{ items: [{ id, type, key, property_count, relation_count, maturity }], total }
  maturity 计算（MVP）：基于知识丰富度，不含掌握度（无练习功能）
    maturity = property_count × 0.6 + relation_count × 0.4（归一化到 0~100）

GET /api/atoms/{id}
  原子详情
  输出：{
    atom: { id, type, key, created_at },
    properties: [{ kind, value, source_type, source_ref, created_at }],  -- 按 source_ref 分组
    relations: [{ id, target: { id, type, key }, type, note }],
    analyses: [{ id, input_type, created_at }],  -- 关联的分析记录
    traces_summary: { added_at, duplicate_count, property_count }
  }

GET /api/atoms/{id}/relations
  原子的所有关系（双向查询：该原子作为 from_id 或 to_id 的关系都返回）
  输出：[{ id, target: { id, type, key }, type, note, direction: "from"|"to", created_at }]

POST /api/atoms/{id}/tags
  打标签
  输入：{ tag: string }

DELETE /api/atoms/{id}/tags/{tag}
  删标签

DELETE /api/atoms/{id}
  删除原子及其属性、关系、轨迹
```

### 4.3 词典模块

```
POST /api/preprocess
  已在分析模块中定义，分词结果可用于前端点击查词的辞书形定位

GET /api/dictionary/{word}
  词典查询
  输入：辞书形（URL 参数）
  输出：JMdict 完整词条（所有义项、所有读音、词性、JLPT 级别）
  特点：纯本地，即时返回
```

### 4.4 API 设计原则

- **前端无状态**：所有状态在后端，前端通过 API 获取
- **入库不自动**：POST /api/atoms 返回状态，前端根据状态引导用户操作，后端不做假设
- **幂等安全**：属性去重和关系去重保证重复调用不会产生脏数据
- **流式分析**：POST /api/analyze 通过 SSE 流式返回，前端逐句渲染

---

## 五、Prompt 模板

所有 Prompt 的共同原则：
- 通过 Pydantic JSON Schema 约束输出格式
- 词汇和语法的提取**宁多勿少**——用户是最终过滤器，多给选项让人选，比 AI 替人判断好
- meaning 要求给出**该语境下的具体含义**，不是词典的通用释义

### 5.1 自由文本分析

```
你是一位专业的日语教师，正在帮助一位目标级别为 {target_level} 的中文母语学习者分析日语文本。

## 任务

对以下日语文本逐句分析，输出结构化的学习内容。

## 原文

{input_text}

## 要求

1. 逐句处理，每句包含：原文、中文翻译、值得学习的词汇、语法模式

2. 词汇提取：
   - 尽可能多地提取有学习价值的词汇，宁多勿少
   - 仅过滤纯功能词（助词は、が、を、に，助动词です、ます）
   - 动词、形容词、副词、名词都应保留
   - 不设数量上限

3. 语法识别：
   - 尽可能多地识别语法模式，宁多勿少
   - 给出标准形（如 〜てしまう，不是 食べてしまった）
   - 不限级别，从基础到高级都提取
   - 不设数量上限

4. 每个词汇提供：surface（原文形式）、base（辞书形）、reading（平假名）、meaning（该句中的具体含义）、part_of_speech、jlpt_level（N1~N5，不确定可为 null）、register（口語/書面/正式，明显时填写）、usage（值得注意时填写）、nuance（值得注意时填写）、example（以该词为中心的短例句）

5. 每个语法提供：pattern（标准形）、meaning（含义）、connection（接续方式）、jlpt_level、register、usage、nuance、example（以该语法为中心的短例句）

## 输出格式

严格按以下 JSON 格式输出：
{schema_json}
```

### 5.2 JLPT 语法题

```
你是一位 JLPT 考试辅导教师，帮助中文母语学习者分析语法题。

## 题目

{question_text}

## 要求

1. 给出正确答案
2. 将正确选项填入空白，对完整句子做分析（词汇 + 语法，提取标准同上，宁多勿少）
3. 对每个选项给出完整的语法分析：标准形、含义、接续方式、语体、使用条件、语感、例句
4. 说明为什么该选项在这道题中对或错
5. 重点说明各选项之间的区别

## 输出格式

{schema_json}
```

### 5.3 JLPT 排序题

```
你是一位 JLPT 考试辅导教师，帮助中文母语学习者分析排序题。

## 题目

{question_text}

## 要求

1. 给出正确排序
2. 解释排序的依据（接续规则、语法结构）
3. 对排序后的完整句子做分析（词汇 + 语法，宁多勿少）

## 输出格式

{schema_json}
```

### 5.4 JLPT 阅读题

```
你是一位 JLPT 考试辅导教师，帮助中文母语学习者分析阅读题。

## 文章

{passage_text}

## 问题

{questions}

## 要求

1. 对文章逐句分析（翻译 + 词汇 + 语法，宁多勿少）
2. 对每道题给出正确答案和选项分析

## 输出格式

{schema_json}
```

### 5.5 JLPT 听力题

```
你是一位 JLPT 考试辅导教师，帮助中文母语学习者分析听力题。

## 听力原文

{transcript}

## 要求

1. 对原文逐句分析（翻译 + 词汇 + 语法，宁多勿少）
2. 专项分析口语表现：缩约形、省略、语气词等
   - 每个口语表现给出：表现形式、标准形式、解释

## 输出格式

{schema_json}
```

### 5.6 追问模板

#### 对比

```
对比以下两个日语表达的区别：
A: {atom_a}
B: {atom_b}

请说明：相同点、核心区别、各给一个例句、建议的关系类型（synonym/formal_casual/derivative/contrast/nuance）

输出格式：{schema_json}
```

#### 用法

```
详细说明「{atom_key}」的使用条件和语体。在什么场景下用？什么场景下不能用？

输出格式：{schema_json}
```

#### 变形

```
列出「{atom_key}」的所有变形（口语形、正式形、缩约形等），每个变形说明语体和与原形的关系。

输出格式：{schema_json}
```

#### 例句

```
为「{atom_key}」生成 3 个以它为中心的短例句，展示不同的使用场景。

输出格式：{schema_json}
```

### 5.7 关联发现（入库时）

```
以下两个日语表达可能相关：
A: {atom_a_key} - {atom_a_meaning}
B: {atom_b_key} - {atom_b_meaning}

请简要说明它们的关系和核心区别（不超过100字）。

输出格式：{schema_json}
```

---

## 六、语法提取容错机制

语法没有像词汇辞书形那样的标准化工具，是整个系统最难的技术问题。核心矛盾：AI 每次输出的语法 pattern 可能不一致，导致入库 key 不稳定、匹配失效。

### 6.1 MVP 方案：Prompt 约束 + 后端正则化

#### Prompt 约束

在所有涉及语法输出的 Prompt 中加入格式规范：

```
语法 pattern 格式要求：
- 以「〜」开头（使用全角波浪线）
- 动词部分用基本形表示（〜てしまう，不是 〜てしまいます）
- 不包含具体词汇（〜てしまう，不是 食べてしまう）
- 使用标准接续标记：V（动词）、A（形容词）、N（名词）仅在必要时使用
```

#### 后端正则化

AI 输出的 pattern 在写入前做标准化处理：

```
1. 统一波浪线：~ → 〜，～ → 〜
2. 去除前后空格
3. 去除多余的括号注释
4. 统一长音符：ー
```

这两步组合能消除大部分格式层面的不一致。

### 6.2 匹配策略

语法入库时的匹配分三级：

```
Step 1: 正则化后精确匹配
  AI 输出 「〜ちゃう」→ 正则化 → 精确查 atoms 表
  命中 → 已存在

Step 2: Qdrant 语义匹配
  精确未命中 → 向量检索相似语法
  返回相似度排序的候选列表

Step 3: 用户确认
  系统展示候选，用户判断：
  - 是同一个 → 合并
  - 不同但相关 → 新建 + 建立关系
  - 无关 → 新建
```

### 6.3 不可消除的不确定性

即使做了 Prompt 约束和正则化，仍然存在**语义层面的不确定性**——同一个句子 AI 可能识别出不同的语法点，这不是格式问题，是判断问题。

```
「食べてしまった」
  AI 调用 1：识别为 〜てしまう
  AI 调用 2：识别为 〜てしまう + 〜た
```

这种不确定性**不能靠技术消除，只能靠容错设计接受它**：

- 宁多勿少：AI 多识别出来的语法，用户可以跳过
- 人是最终裁判：用户决定入库什么
- 重复入库不是错误：trace 记录 duplicate_attempt，反而是学习信号

### 6.4 未来演进：语法词典

MVP 后可考虑维护一个标准语法列表（JLPT 全级别约 600-800 个语法点），AI 输出的 pattern 映射到标准列表中的最近匹配。这能进一步提升 key 的稳定性，但 MVP 阶段不做。

---

*文档版本：v0.7*
*创建日期：2026-04-20*
*依赖文档：VISION.md v0.5, ARCHITECTURE.md v0.5*
