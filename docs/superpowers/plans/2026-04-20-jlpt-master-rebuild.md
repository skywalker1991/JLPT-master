# JLPT Master — 全栈重建实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零重建 JLPT Master，实现基于三概念知识模型（原子/属性/关系）的 AI 日语学习系统，支持 AI 驱动的句子分析、流式输出、人工筛选入库、知识库管理。

**Architecture:** FastAPI 后端作为唯一数据入口，Vite+React 前端纯 SPA 通过 API 交互。PostgreSQL 存储结构化知识，Qdrant 做语法原子语义匹配。AI（Gemini）在 Janome 预处理结果约束下做判断，JMdict 仅作独立查词工具。

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 async, Pydantic v2, Janome, sentence-transformers, Qdrant, google-generativeai, Vite, React 18, TypeScript, Tailwind CSS, Framer Motion, Docker Compose.

---

## 文件结构总览

```
JLPT-master/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py               # FastAPI app, lifespan, CORS, routers
│       ├── config.py             # pydantic-settings BaseSettings
│       ├── models/
│       │   └── db.py             # SQLAlchemy ORM models + engine + session
│       ├── schemas/
│       │   ├── analysis.py       # AI 输出 Pydantic schemas
│       │   └── atoms.py          # 知识库 API request/response schemas
│       ├── services/
│       │   ├── preprocessor.py   # Janome 形态素分析
│       │   ├── llm/
│       │   │   ├── base.py       # LLMClient 抽象接口
│       │   │   ├── gemini.py     # Gemini 实现
│       │   │   └── factory.py    # 按配置创建 client 的工厂
│       │   ├── embedding.py      # sentence-transformers 本地向量
│       │   ├── qdrant_service.py # Qdrant collection 管理 + 搜索
│       │   ├── dictionary.py     # JMdict XML 解析 + 查词
│       │   └── atom_service.py   # 原子 CRUD + 查重 + maturity 计算
│       ├── prompts/
│       │   └── templates.py      # 所有 Prompt 模板字符串
│       └── api/
│           ├── analysis.py       # /preprocess, /analyze (SSE), /analyses/*
│           ├── atoms.py          # /atoms, /atoms/{id}/*
│           └── dictionary.py     # /dictionary/{word}
├── migrations/
│   └── 001_initial.sql           # 完整建表 SQL（含索引）
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx               # BrowserRouter + 路由定义
        ├── types/
        │   └── index.ts          # 所有 TypeScript 类型
        ├── services/
        │   └── api.ts            # 所有后端 API 调用（含 SSE stream）
        ├── hooks/
        │   ├── useAnalysis.ts    # 分析流程状态管理
        │   └── useAtoms.ts       # 知识库列表状态管理
        ├── components/
        │   ├── shared/
        │   │   ├── Layout.tsx    # 整体布局（侧边栏 + 主区域）
        │   │   └── Sidebar.tsx   # 导航侧边栏
        │   ├── analysis/
        │   │   ├── AnalysisInput.tsx   # 文本输入 + 类型选择 + 触发
        │   │   ├── SentenceCard.tsx    # 单句分析卡片（含入库按钮）
        │   │   ├── VocabChip.tsx       # 可展开词汇项 + 入库流程
        │   │   ├── GrammarCard.tsx     # 语法模式卡片 + 入库流程
        │   │   └── FollowupPanel.tsx   # 追问模板面板
        │   └── atoms/
        │       ├── AtomList.tsx        # 知识库列表（含搜索/过滤）
        │       ├── AtomCard.tsx        # 单原子卡片（列表项）
        │       └── AtomDetailView.tsx  # 原子详情（属性/关系/轨迹）
        └── pages/
            ├── AnalysisPage.tsx        # 分析页（输入 + SSE 流 + 追问）
            ├── KnowledgeBasePage.tsx   # 知识库页
            └── AtomDetailPage.tsx      # 原子详情页
```

---

## Task 1: 项目基础设施（Docker Compose + 迁移 SQL）

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `migrations/001_initial.sql`

- [ ] **Step 1: 创建 docker-compose.yml**

```yaml
# docker-compose.yml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: jlpt
      POSTGRES_PASSWORD: jlpt
      POSTGRES_DB: jlpt
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U jlpt"]
      interval: 5s
      timeout: 5s
      retries: 5

  qdrant:
    image: qdrant/qdrant:latest
    volumes:
      - qdrant_data:/qdrant/storage
    ports:
      - "6333:6333"

  backend:
    build: ./backend
    depends_on:
      postgres:
        condition: service_healthy
      qdrant:
        condition: service_started
    environment:
      DATABASE_URL: postgresql+asyncpg://jlpt:jlpt@postgres:5432/jlpt
      QDRANT_URL: http://qdrant:6333
    env_file:
      - .env
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app
      - model_cache:/root/.cache

  frontend:
    build: ./frontend
    depends_on:
      - backend
    ports:
      - "5173:80"

volumes:
  postgres_data:
  qdrant_data:
  model_cache:
```

- [ ] **Step 2: 创建 .env.example**

```bash
# .env.example — 复制为 .env 并填入值
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.0-flash
LLM_API_KEY=your_api_key_here
TARGET_LEVEL=N2
EMBEDDING_MODEL=paraphrase-multilingual-MiniLM-L12-v2
```

- [ ] **Step 3: 创建完整迁移 SQL**

```sql
-- migrations/001_initial.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 核心模型
CREATE TABLE atoms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(20) NOT NULL,
  key         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT  atoms_type_check CHECK (type IN ('vocabulary', 'grammar')),
  UNIQUE(type, key)
);
CREATE INDEX idx_atoms_type ON atoms(type);

CREATE TABLE atom_properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  kind        VARCHAR(50) NOT NULL,
  value       TEXT NOT NULL,
  source_type VARCHAR(20) NOT NULL,
  source_ref  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_properties_atom ON atom_properties(atom_id);
CREATE INDEX idx_properties_kind ON atom_properties(atom_id, kind);

CREATE TABLE atom_relations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  to_id       UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL,
  note        JSONB,
  source_type VARCHAR(20) NOT NULL,
  source_ref  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(from_id, to_id, type),
  CHECK (from_id != to_id)
);
CREATE INDEX idx_relations_from ON atom_relations(from_id);
CREATE INDEX idx_relations_to   ON atom_relations(to_id);

-- 应用层
CREATE TABLE atom_tags (
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  tag         VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (atom_id, tag)
);
CREATE INDEX idx_tags_tag ON atom_tags(tag);

CREATE TABLE traces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  action      VARCHAR(30) NOT NULL,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_traces_atom    ON traces(atom_id);
CREATE INDEX idx_traces_action  ON traces(action);
CREATE INDEX idx_traces_created ON traces(created_at DESC);

CREATE TABLE analyses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  input_type    VARCHAR(20) NOT NULL,
  input_content TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  session_data  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_analyses_status  ON analyses(status);
CREATE INDEX idx_analyses_created ON analyses(created_at DESC);

CREATE TABLE analysis_atoms (
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  PRIMARY KEY (analysis_id, atom_id)
);
CREATE INDEX idx_analysis_atoms_atom ON analysis_atoms(atom_id);
```

- [ ] **Step 4: 验证 Docker 能启动数据库**

```bash
cd /Users/dairui/JLPT-master
cp .env.example .env  # 先不填 API key，测试 DB 即可
docker compose up -d postgres qdrant
docker compose ps
# 预期: postgres healthy, qdrant running
docker compose exec postgres psql -U jlpt -c "\dt"
# 预期: 列出所有表
```

---

## Task 2: 后端基础配置 + ORM 模型

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/models/db.py`

- [ ] **Step 1: 创建 requirements.txt**

```
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pydantic>=2.9.0
pydantic-settings>=2.6.0
asyncpg>=0.30.0
sqlalchemy[asyncio]>=2.0.36
janome>=0.5.0
qdrant-client>=1.12.0
sentence-transformers>=3.3.0
google-generativeai>=0.8.0
openai>=1.57.0
sse-starlette>=2.1.0
python-multipart>=0.0.20
httpx>=0.28.0
python-dotenv>=1.0.0
aiofiles>=24.1.0
pytest>=8.0.0
pytest-asyncio>=0.24.0
httpx>=0.28.0
```

- [ ] **Step 2: 创建 config.py**

```python
# backend/app/config.py
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://jlpt:jlpt@localhost:5432/jlpt"
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_COLLECTION: str = "grammar_atoms"
    LLM_PROVIDER: str = "gemini"
    LLM_MODEL: str = "gemini-2.0-flash"
    LLM_API_KEY: str = ""
    EMBEDDING_MODEL: str = "paraphrase-multilingual-MiniLM-L12-v2"
    JMDICT_PATH: str = "/app/data/JMdict_e.xml"
    TARGET_LEVEL: str = "N2"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 3: 创建 db.py（SQLAlchemy 2.0 async）**

```python
# backend/app/models/db.py
import uuid
from datetime import datetime
from sqlalchemy import (
    UUID, VARCHAR, TEXT, TIMESTAMPTZ, Boolean, Index,
    UniqueConstraint, CheckConstraint, ForeignKey, text
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.config import get_settings


class Base(DeclarativeBase):
    pass


class Atom(Base):
    __tablename__ = "atoms"
    __table_args__ = (UniqueConstraint("type", "key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(VARCHAR(20), nullable=False)
    key: Mapped[str] = mapped_column(TEXT, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False, server_default=text("now()"))

    properties: Mapped[list["AtomProperty"]] = relationship(back_populates="atom", cascade="all, delete-orphan")
    tags: Mapped[list["AtomTag"]] = relationship(back_populates="atom", cascade="all, delete-orphan")
    traces: Mapped[list["Trace"]] = relationship(back_populates="atom", cascade="all, delete-orphan")


class AtomProperty(Base):
    __tablename__ = "atom_properties"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    atom_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(VARCHAR(50), nullable=False)
    value: Mapped[str] = mapped_column(TEXT, nullable=False)
    source_type: Mapped[str] = mapped_column(VARCHAR(20), nullable=False)
    source_ref: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False, server_default=text("now()"))

    atom: Mapped["Atom"] = relationship(back_populates="properties")


class AtomRelation(Base):
    __tablename__ = "atom_relations"
    __table_args__ = (
        UniqueConstraint("from_id", "to_id", "type"),
        CheckConstraint("from_id != to_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    from_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), nullable=False)
    to_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(VARCHAR(30), nullable=False)
    note: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    source_type: Mapped[str] = mapped_column(VARCHAR(20), nullable=False)
    source_ref: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False, server_default=text("now()"))


class AtomTag(Base):
    __tablename__ = "atom_tags"
    __table_args__ = (UniqueConstraint("atom_id", "tag"),)

    atom_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), primary_key=True)
    tag: Mapped[str] = mapped_column(VARCHAR(100), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False, server_default=text("now()"))

    atom: Mapped["Atom"] = relationship(back_populates="tags")


class Trace(Base):
    __tablename__ = "traces"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    atom_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), nullable=False)
    action: Mapped[str] = mapped_column(VARCHAR(30), nullable=False)
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False, server_default=text("now()"))

    atom: Mapped["Atom"] = relationship(back_populates="traces")


class Analysis(Base):
    __tablename__ = "analyses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    input_type: Mapped[str] = mapped_column(VARCHAR(20), nullable=False)
    input_content: Mapped[str] = mapped_column(TEXT, nullable=False)
    status: Mapped[str] = mapped_column(VARCHAR(20), nullable=False, server_default="in_progress")
    session_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, nullable=False, server_default=text("now()"))


class AnalysisAtom(Base):
    __tablename__ = "analysis_atoms"

    analysis_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("analyses.id", ondelete="CASCADE"), primary_key=True)
    atom_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), primary_key=True)


def _create_engine():
    return create_async_engine(get_settings().DATABASE_URL, echo=False)


async_engine = _create_engine()
async_session_factory = async_sessionmaker(async_engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        yield session
```

- [ ] **Step 4: 安装依赖并验证导入**

```bash
cd /Users/dairui/JLPT-master/backend
python -m venv venv && source venv/bin/activate
pip install fastapi uvicorn[standard] pydantic pydantic-settings asyncpg "sqlalchemy[asyncio]"
python -c "from app.config import get_settings; print(get_settings().LLM_PROVIDER)"
# 预期: gemini
```

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/app/config.py backend/app/models/db.py
git commit -m "feat: backend config and SQLAlchemy ORM models"
```

---

## Task 3: Pydantic Schemas（AI 输出 + API）

**Files:**
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/schemas/analysis.py`
- Create: `backend/app/schemas/atoms.py`

- [ ] **Step 1: 创建 analysis.py（AI 输出 schemas）**

```python
# backend/app/schemas/analysis.py
from pydantic import BaseModel


class VocabItem(BaseModel):
    surface: str
    base: str
    reading: str | None = None
    meaning: str
    part_of_speech: str | None = None
    jlpt_level: str | None = None
    register: str | None = None
    usage: str | None = None
    nuance: str | None = None
    example: str | None = None


class GrammarItem(BaseModel):
    pattern: str
    meaning: str
    connection: str | None = None
    jlpt_level: str | None = None
    register: str | None = None
    usage: str | None = None
    nuance: str | None = None
    example: str | None = None


class SentenceAnalysis(BaseModel):
    index: int
    text: str
    translation: str
    vocab: list[VocabItem] = []
    grammar: list[GrammarItem] = []


class FreeTextResult(BaseModel):
    sentences: list[SentenceAnalysis]


class OptionAnalysis(BaseModel):
    option: str
    is_correct: bool
    explanation: str
    grammar: GrammarItem


class GrammarQuizResult(BaseModel):
    question: str
    correct_answer: str
    completed_sentence: SentenceAnalysis
    options_analysis: list[OptionAnalysis]


class OrderingQuizResult(BaseModel):
    question: str
    correct_order: list[str]
    explanation: str
    completed_sentence: SentenceAnalysis


class ReadingQuestion(BaseModel):
    question: str
    correct_answer: str
    options_analysis: list[OptionAnalysis]


class ReadingResult(BaseModel):
    sentences: list[SentenceAnalysis]
    questions: list[ReadingQuestion]


class OralFeature(BaseModel):
    expression: str
    standard_form: str
    explanation: str


class ListeningResult(BaseModel):
    sentences: list[SentenceAnalysis]
    oral_features: list[OralFeature]


class ComparisonResult(BaseModel):
    atom_a: str
    atom_b: str
    similarity: str
    difference: str
    example_a: str
    example_b: str
    relation_type: str


class UsageResult(BaseModel):
    atom_key: str
    usage: str
    register: str | None = None


class DerivativeItem(BaseModel):
    form: str
    register: str
    explanation: str


class DerivativeResult(BaseModel):
    atom_key: str
    derivatives: list[DerivativeItem]


class ExampleResult(BaseModel):
    atom_key: str
    examples: list[str]


# Request schemas
class AnalyzeRequest(BaseModel):
    text: str | None = None
    image: str | None = None
    type: str = "text"


class PreprocessRequest(BaseModel):
    text: str


class FollowupRequest(BaseModel):
    template: str
    params: dict


class TokenInfo(BaseModel):
    surface: str
    base: str
    pos: str
    reading: str


class PreprocessedSentence(BaseModel):
    index: int
    text: str
    tokens: list[TokenInfo]


class PreprocessResponse(BaseModel):
    sentences: list[PreprocessedSentence]
```

- [ ] **Step 2: 创建 atoms.py（知识库 API schemas）**

```python
# backend/app/schemas/atoms.py
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


class PropertyInput(BaseModel):
    kind: str
    value: str


class CreateAtomRequest(BaseModel):
    type: str
    key: str
    properties: list[PropertyInput] = []
    analysis_id: UUID | None = None


class AddPropertiesRequest(BaseModel):
    properties: list[PropertyInput]
    analysis_id: UUID | None = None


class CreateRelationRequest(BaseModel):
    target_atom_id: UUID
    type: str
    note: dict | None = None


class PropertyResponse(BaseModel):
    id: UUID
    kind: str
    value: str
    source_type: str
    source_ref: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RelationResponse(BaseModel):
    id: UUID
    target: dict
    type: str
    note: dict | None
    direction: str
    created_at: datetime


class AtomListItem(BaseModel):
    id: UUID
    type: str
    key: str
    property_count: int
    relation_count: int
    maturity: float
    created_at: datetime


class AtomDetail(BaseModel):
    atom: dict
    properties: list[PropertyResponse]
    relations: list[RelationResponse]
    analyses: list[dict]
    traces_summary: dict


class SimilarCandidate(BaseModel):
    atom_id: UUID
    key: str
    meaning: str | None
    score: float


class CreateAtomResponse(BaseModel):
    atom_id: UUID | None = None
    status: str
    existing_properties: list[PropertyResponse] | None = None
    candidates: list[SimilarCandidate] | None = None


class AddPropertiesResponse(BaseModel):
    added: int
    skipped: int


class RelationCreateResponse(BaseModel):
    relation_id: UUID
    status: str
```

- [ ] **Step 3: 验证 schemas 可正确实例化**

```bash
cd /Users/dairui/JLPT-master/backend
source venv/bin/activate
python -c "
from app.schemas.analysis import FreeTextResult, VocabItem, SentenceAnalysis
s = SentenceAnalysis(index=0, text='test', translation='テスト', vocab=[], grammar=[])
print(s.model_dump())
"
# 预期: dict with all fields
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas/
git commit -m "feat: Pydantic schemas for AI output and API contracts"
```

---

## Task 4: 形态素分析服务（Janome）

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/preprocessor.py`

- [ ] **Step 1: 安装 Janome**

```bash
cd /Users/dairui/JLPT-master/backend && source venv/bin/activate
pip install janome
```

- [ ] **Step 2: 创建 preprocessor.py**

```python
# backend/app/services/preprocessor.py
import re
from janome.tokenizer import Tokenizer as JanomeTokenizer
from app.schemas.analysis import TokenInfo, PreprocessedSentence, PreprocessResponse

_KATAKANA = re.compile(r'[\u30A0-\u30FF]')

def _kata_to_hira(text: str) -> str:
    """片假名 → 平假名"""
    return ''.join(
        chr(ord(c) - 0x60) if '\u30A1' <= c <= '\u30F6' else c
        for c in text
    )


class Preprocessor:
    def __init__(self):
        self._tokenizer: JanomeTokenizer | None = None

    @property
    def tokenizer(self) -> JanomeTokenizer:
        if self._tokenizer is None:
            self._tokenizer = JanomeTokenizer()
        return self._tokenizer

    def split_sentences(self, text: str) -> list[str]:
        """按句末标点和换行分句，过滤空句"""
        parts = re.split(r'(?<=[。！？\n])', text)
        return [p.strip() for p in parts if p.strip()]

    def tokenize(self, sentence: str) -> list[TokenInfo]:
        tokens = []
        for token in self.tokenizer.tokenize(sentence):
            pos_parts = token.part_of_speech.split(',')
            pos = pos_parts[0] if pos_parts else ''
            reading = token.reading if token.reading != '*' else token.surface
            tokens.append(TokenInfo(
                surface=token.surface,
                base=token.base_form if token.base_form != '*' else token.surface,
                pos=pos,
                reading=_kata_to_hira(reading),
            ))
        return tokens

    def preprocess(self, text: str) -> PreprocessResponse:
        sentences = self.split_sentences(text)
        result = []
        for i, s in enumerate(sentences):
            tokens = self.tokenize(s)
            result.append(PreprocessedSentence(index=i, text=s, tokens=tokens))
        return PreprocessResponse(sentences=result)


preprocessor = Preprocessor()
```

- [ ] **Step 3: 验证分词正确性**

```bash
cd /Users/dairui/JLPT-master/backend && source venv/bin/activate
python -c "
from app.services.preprocessor import preprocessor
result = preprocessor.preprocess('昨日、学校へ行きました。とても楽しかった。')
for s in result.sentences:
    print(f'句子 {s.index}: {s.text}')
    for t in s.tokens:
        print(f'  {t.surface} -> {t.base} ({t.pos}) [{t.reading}]')
"
# 预期: 两句，正确分词
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/preprocessor.py
git commit -m "feat: Janome Japanese morphological analysis service"
```

---

## Task 5: LLM 抽象 + Gemini 实现

**Files:**
- Create: `backend/app/services/llm/__init__.py`
- Create: `backend/app/services/llm/base.py`
- Create: `backend/app/services/llm/gemini.py`
- Create: `backend/app/services/llm/factory.py`

- [ ] **Step 1: 创建 base.py（抽象接口）**

```python
# backend/app/services/llm/base.py
from abc import ABC, abstractmethod
from typing import AsyncIterator


class LLMClient(ABC):
    @abstractmethod
    async def analyze_stream(self, prompt: str) -> AsyncIterator[str]:
        """流式返回分析结果的 JSON 字符串片段"""
        ...

    @abstractmethod
    async def analyze(self, prompt: str) -> str:
        """单次调用，返回完整 JSON 字符串"""
        ...

    @abstractmethod
    async def complete(self, prompt: str) -> str:
        """简单文本补全"""
        ...
```

- [ ] **Step 2: 创建 gemini.py**

```python
# backend/app/services/llm/gemini.py
import json
from typing import AsyncIterator
import google.generativeai as genai
from app.services.llm.base import LLMClient


class GeminiClient(LLMClient):
    def __init__(self, api_key: str, model: str):
        genai.configure(api_key=api_key)
        self._model_name = model
        self._model = genai.GenerativeModel(model)

    async def analyze_stream(self, prompt: str) -> AsyncIterator[str]:
        response = await self._model.generate_content_async(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
            ),
            stream=True,
        )
        async for chunk in response:
            if chunk.text:
                yield chunk.text

    async def analyze(self, prompt: str) -> str:
        response = await self._model.generate_content_async(
            prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
            ),
        )
        return response.text

    async def complete(self, prompt: str) -> str:
        response = await self._model.generate_content_async(prompt)
        return response.text
```

- [ ] **Step 3: 创建 factory.py**

```python
# backend/app/services/llm/factory.py
from app.config import get_settings
from app.services.llm.base import LLMClient
from app.services.llm.gemini import GeminiClient

_llm_client: LLMClient | None = None


def get_llm_client() -> LLMClient:
    global _llm_client
    if _llm_client is None:
        s = get_settings()
        if s.LLM_PROVIDER == "gemini":
            _llm_client = GeminiClient(api_key=s.LLM_API_KEY, model=s.LLM_MODEL)
        else:
            raise ValueError(f"Unknown LLM_PROVIDER: {s.LLM_PROVIDER}")
    return _llm_client
```

- [ ] **Step 4: 安装依赖验证**

```bash
pip install google-generativeai
python -c "from app.services.llm.factory import get_llm_client; print('ok')"
# 预期: ok
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/llm/
git commit -m "feat: LLM abstract client with Gemini implementation"
```

---

## Task 6: Embedding 服务 + Qdrant 服务

**Files:**
- Create: `backend/app/services/embedding.py`
- Create: `backend/app/services/qdrant_service.py`

- [ ] **Step 1: 创建 embedding.py**

```python
# backend/app/services/embedding.py
from sentence_transformers import SentenceTransformer
from app.config import get_settings


class EmbeddingService:
    def __init__(self):
        self._model: SentenceTransformer | None = None

    @property
    def model(self) -> SentenceTransformer:
        if self._model is None:
            self._model = SentenceTransformer(get_settings().EMBEDDING_MODEL)
        return self._model

    def embed(self, text: str) -> list[float]:
        return self.model.encode(text).tolist()

    def vector_size(self) -> int:
        return self.model.get_sentence_embedding_dimension()


embedding_service = EmbeddingService()
```

- [ ] **Step 2: 创建 qdrant_service.py**

```python
# backend/app/services/qdrant_service.py
import logging
import uuid
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct, Filter, FieldCondition,
    MatchValue, ScoredPoint
)
from app.config import get_settings
from app.services.embedding import embedding_service

logger = logging.getLogger(__name__)


class QdrantService:
    def __init__(self):
        self._client: AsyncQdrantClient | None = None

    @property
    def client(self) -> AsyncQdrantClient:
        if self._client is None:
            self._client = AsyncQdrantClient(url=get_settings().QDRANT_URL)
        return self._client

    @property
    def collection(self) -> str:
        return get_settings().QDRANT_COLLECTION

    async def ensure_collection(self):
        """启动时确保 collection 存在"""
        try:
            collections = await self.client.get_collections()
            names = [c.name for c in collections.collections]
            if self.collection not in names:
                size = embedding_service.vector_size()
                await self.client.create_collection(
                    collection_name=self.collection,
                    vectors_config=VectorParams(size=size, distance=Distance.COSINE),
                )
                logger.info(f"Created Qdrant collection: {self.collection}")
        except Exception as e:
            logger.warning(f"Qdrant ensure_collection failed: {e}")

    async def upsert_grammar_atom(self, atom_id: uuid.UUID, key: str, meaning: str):
        """入库语法原子向量，失败不阻塞"""
        try:
            text = f"{key} {meaning}"
            vector = embedding_service.embed(text)
            await self.client.upsert(
                collection_name=self.collection,
                points=[PointStruct(
                    id=str(atom_id),
                    vector=vector,
                    payload={"key": key, "meaning": meaning},
                )],
            )
        except Exception as e:
            logger.warning(f"Qdrant upsert failed for {atom_id}: {e}")

    async def search_similar(
        self, query: str, limit: int = 5, score_threshold: float = 0.75
    ) -> list[dict]:
        """语义检索相似语法原子"""
        try:
            vector = embedding_service.embed(query)
            results = await self.client.search(
                collection_name=self.collection,
                query_vector=vector,
                limit=limit,
                score_threshold=score_threshold,
            )
            return [
                {
                    "id": r.id,
                    "key": r.payload.get("key", ""),
                    "meaning": r.payload.get("meaning", ""),
                    "score": r.score,
                }
                for r in results
            ]
        except Exception as e:
            logger.warning(f"Qdrant search failed: {e}")
            return []


qdrant_service = QdrantService()
```

- [ ] **Step 3: 验证 Qdrant 连接**

```bash
# 确保 Qdrant 容器在运行
docker compose up -d qdrant
pip install qdrant-client sentence-transformers
python -c "
import asyncio
from app.services.qdrant_service import qdrant_service
asyncio.run(qdrant_service.ensure_collection())
print('Qdrant OK')
"
# 预期: Qdrant OK
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/embedding.py backend/app/services/qdrant_service.py
git commit -m "feat: local embedding service and Qdrant grammar atom search"
```

---

## Task 7: Prompt 模板

**Files:**
- Create: `backend/app/prompts/__init__.py`
- Create: `backend/app/prompts/templates.py`

- [ ] **Step 1: 创建所有 Prompt 模板**

```python
# backend/app/prompts/templates.py

_GRAMMAR_FORMAT_RULES = """
语法 pattern 格式要求：
- 以「〜」开头（使用全角波浪线 〜）
- 动词部分用基本形（〜てしまう，不是 〜てしまいます）
- 不包含具体词汇（〜てしまう，不是 食べてしまう）
- 仅在必要时使用标记：V（动词）、A（形容词）、N（名词）
"""

FREE_TEXT_ANALYSIS = """
你是一位专业的日语教师，正在帮助一位目标级别为 {target_level} 的中文母语学习者分析日语文本。

## 任务
对以下日语文本逐句分析，输出结构化的学习内容。

## 原文
{input_text}

## 要求

1. 逐句处理，每句包含：原文、中文翻译、值得学习的词汇、语法模式

2. 词汇提取（宁多勿少）：
   - 仅过滤纯功能词（助词は、が、を、に，助动词です、ます）
   - 动词、形容词、副词、名词、副助词、接续词都保留
   - 不设数量上限

3. 语法识别（宁多勿少）：
   - 尽可能多识别语法模式，不设数量上限
   - 不限级别，从基础到高级都提取
{grammar_rules}

4. 每个词汇提供：surface（原文形式）、base（辞书形）、reading（平假名读音）、meaning（该句中具体含义）、part_of_speech、jlpt_level（N1~N5，不确定为 null）、register（口語/書面/正式，明显时填写）、usage（值得注意时填写）、nuance（值得注意时填写）、example（以该词为中心的短例句）

5. 每个语法提供：pattern（标准形）、meaning（含义）、connection（接续方式）、jlpt_level、register、usage、nuance、example（以该语法为中心的短例句）

## 输出格式（严格 JSON）
{schema_json}
""".format(grammar_rules=_GRAMMAR_FORMAT_RULES, input_text="{input_text}", target_level="{target_level}", schema_json="{schema_json}")

JLPT_GRAMMAR_QUIZ = """
你是一位 JLPT 考试辅导教师，帮助中文母语学习者分析语法题。

## 题目
{question_text}

## 要求
1. 给出正确答案
2. 将正确选项填入空白，对完整句子做词汇+语法分析（宁多勿少）
3. 对每个选项给出完整语法分析：标准形、含义、接续方式、语体、使用条件、语感、例句
4. 说明每个选项在本题中对或错的原因，重点说明各选项区别
{grammar_rules}

## 输出格式（严格 JSON）
{schema_json}
""".format(grammar_rules=_GRAMMAR_FORMAT_RULES, question_text="{question_text}", schema_json="{schema_json}")

JLPT_ORDERING_QUIZ = """
你是一位 JLPT 考试辅导教师，帮助中文母语学习者分析排序题。

## 题目
{question_text}

## 要求
1. 给出正确排序
2. 解释排序依据（接续规则、语法结构）
3. 对排序后的完整句子做词汇+语法分析（宁多勿少）
{grammar_rules}

## 输出格式（严格 JSON）
{schema_json}
""".format(grammar_rules=_GRAMMAR_FORMAT_RULES, question_text="{question_text}", schema_json="{schema_json}")

JLPT_READING = """
你是一位 JLPT 考试辅导教师，帮助中文母语学习者分析阅读题。

## 文章
{passage_text}

## 问题
{questions}

## 要求
1. 对文章逐句分析（翻译 + 词汇 + 语法，宁多勿少）
2. 对每道题给出正确答案和选项分析

## 输出格式（严格 JSON）
{schema_json}
"""

JLPT_LISTENING = """
你是一位 JLPT 考试辅导教师，帮助中文母语学习者分析听力题。

## 听力原文
{transcript}

## 要求
1. 对原文逐句分析（翻译 + 词汇 + 语法，宁多勿少）
2. 专项分析口语表现：缩约形、省略、语气词
   - 每个口语表现：表现形式、标准形式、解释

## 输出格式（严格 JSON）
{schema_json}
"""

FOLLOWUP_COMPARISON = """
对比以下两个日语表达的区别：
A: {atom_a}
B: {atom_b}

请说明：相同点、核心区别、各给一个典型例句，以及建议的关系类型（从以下选择：synonym / formal_casual / derivative / contrast / nuance）

## 输出格式（严格 JSON）
{schema_json}
"""

FOLLOWUP_USAGE = """
详细说明「{atom_key}」的使用条件和语体。
在什么场景下使用？什么场景下不能用？和近义表达有什么关键区别？

## 输出格式（严格 JSON）
{schema_json}
"""

FOLLOWUP_DERIVATIVE = """
列出「{atom_key}」的所有常见变形（口语形、正式形、缩约形等）。
每个变形说明：变形形式、语体、与原形的关系。

## 输出格式（严格 JSON）
{schema_json}
"""

FOLLOWUP_EXAMPLE = """
为「{atom_key}」生成 3 个以它为中心的短例句，展示不同的使用场景。
例句要自然、有代表性，并附中文翻译。

## 输出格式（严格 JSON）
{schema_json}
"""

RELATION_DISCOVERY = """
以下两个日语表达可能相关：
A: {atom_a_key} — {atom_a_meaning}
B: {atom_b_key} — {atom_b_meaning}

请简要说明它们的关系和核心区别（不超过100字）。

## 输出格式（严格 JSON）
{schema_json}
"""
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/prompts/
git commit -m "feat: all prompt templates with grammar format rules"
```

---

## Task 8: 原子服务（查重 + 入库 + maturity）

**Files:**
- Create: `backend/app/services/atom_service.py`

- [ ] **Step 1: 创建 atom_service.py**

```python
# backend/app/services/atom_service.py
import re
import uuid
import logging
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.db import Atom, AtomProperty, AtomRelation, AtomTag, Trace, Analysis, AnalysisAtom
from app.schemas.atoms import PropertyInput

logger = logging.getLogger(__name__)

VALID_KINDS = {
    "reading", "meaning", "part_of_speech", "jlpt_level",
    "register", "usage", "nuance", "oral_form", "connection", "example", "note"
}

VALID_RELATION_TYPES = {"synonym", "formal_casual", "derivative", "contrast", "nuance"}

JLPT_PATTERN = re.compile(r'^N[1-5]$')


def normalize_grammar_key(key: str) -> str:
    """统一语法 key 格式"""
    key = re.sub(r'[~～]', '〜', key)
    key = re.sub(r'\s+', '', key)
    return key.strip()


def validate_jlpt_level(level: str | None) -> str | None:
    if level and JLPT_PATTERN.match(level):
        return level
    return None


def validate_kind(kind: str) -> bool:
    return kind in VALID_KINDS


async def get_atom_by_key(db: AsyncSession, type: str, key: str) -> Atom | None:
    result = await db.execute(
        select(Atom).where(Atom.type == type, Atom.key == key)
    )
    return result.scalar_one_or_none()


async def create_atom(db: AsyncSession, type: str, key: str) -> Atom:
    atom = Atom(type=type, key=key)
    db.add(atom)
    await db.flush()  # get id without commit
    return atom


async def get_properties(db: AsyncSession, atom_id: uuid.UUID) -> list[AtomProperty]:
    result = await db.execute(
        select(AtomProperty).where(AtomProperty.atom_id == atom_id)
        .order_by(AtomProperty.created_at)
    )
    return result.scalars().all()


async def add_properties(
    db: AsyncSession,
    atom_id: uuid.UUID,
    properties: list[PropertyInput],
    source_type: str,
    source_ref: uuid.UUID | None,
) -> tuple[int, int]:
    """添加属性，按 kind+value 去重。返回 (added, skipped)"""
    existing = await get_properties(db, atom_id)
    existing_set = {(p.kind, p.value) for p in existing}

    added, skipped = 0, 0
    for prop in properties:
        if not validate_kind(prop.kind):
            logger.debug(f"Skipping invalid kind: {prop.kind}")
            continue
        if (prop.kind, prop.value) in existing_set:
            skipped += 1
            continue
        db.add(AtomProperty(
            atom_id=atom_id,
            kind=prop.kind,
            value=prop.value,
            source_type=source_type,
            source_ref=source_ref,
        ))
        existing_set.add((prop.kind, prop.value))
        added += 1

    return added, skipped


async def get_relations(db: AsyncSession, atom_id: uuid.UUID) -> list[dict]:
    """双向查询关系"""
    result = await db.execute(
        select(AtomRelation, Atom).where(
            or_(AtomRelation.from_id == atom_id, AtomRelation.to_id == atom_id)
        ).join(Atom, Atom.id != atom_id)
    )
    # 手动处理双向
    rows = await db.execute(
        select(AtomRelation).where(
            or_(AtomRelation.from_id == atom_id, AtomRelation.to_id == atom_id)
        )
    )
    relations = rows.scalars().all()
    result_list = []
    for r in relations:
        target_id = r.to_id if r.from_id == atom_id else r.from_id
        direction = "from" if r.from_id == atom_id else "to"
        target = await db.get(Atom, target_id)
        if target:
            result_list.append({
                "id": r.id,
                "target": {"id": target.id, "type": target.type, "key": target.key},
                "type": r.type,
                "note": r.note,
                "direction": direction,
                "created_at": r.created_at,
            })
    return result_list


async def add_relation(
    db: AsyncSession,
    from_id: uuid.UUID,
    to_id: uuid.UUID,
    type: str,
    note: dict | None,
    source_type: str,
    source_ref: uuid.UUID | None,
) -> tuple[uuid.UUID, str]:
    """建立关系，去重检查。返回 (relation_id, 'created'|'exists')"""
    existing = await db.execute(
        select(AtomRelation).where(
            AtomRelation.from_id == from_id,
            AtomRelation.to_id == to_id,
            AtomRelation.type == type,
        )
    )
    existing_relation = existing.scalar_one_or_none()
    if existing_relation:
        return existing_relation.id, "exists"

    relation = AtomRelation(
        from_id=from_id,
        to_id=to_id,
        type=type,
        note=note,
        source_type=source_type,
        source_ref=source_ref,
    )
    db.add(relation)
    await db.flush()
    return relation.id, "created"


async def add_trace(
    db: AsyncSession,
    atom_id: uuid.UUID,
    action: str,
    detail: dict | None = None,
):
    db.add(Trace(atom_id=atom_id, action=action, detail=detail))


async def link_atom_to_analysis(
    db: AsyncSession, atom_id: uuid.UUID, analysis_id: uuid.UUID
):
    existing = await db.execute(
        select(AnalysisAtom).where(
            AnalysisAtom.analysis_id == analysis_id,
            AnalysisAtom.atom_id == atom_id,
        )
    )
    if not existing.scalar_one_or_none():
        db.add(AnalysisAtom(analysis_id=analysis_id, atom_id=atom_id))


async def count_properties_and_relations(
    db: AsyncSession, atom_id: uuid.UUID
) -> tuple[int, int]:
    p_count = await db.scalar(
        select(func.count()).where(AtomProperty.atom_id == atom_id)
    )
    r_count = await db.scalar(
        select(func.count()).where(
            or_(AtomRelation.from_id == atom_id, AtomRelation.to_id == atom_id)
        )
    )
    return p_count or 0, r_count or 0


def compute_maturity(property_count: int, relation_count: int) -> float:
    """maturity = property_count × 0.6 + relation_count × 0.4，归一化到 0-100"""
    raw = property_count * 0.6 + relation_count * 0.4
    max_raw = 20 * 0.6 + 10 * 0.4  # 假设最大 20 属性 10 关系
    return min(100.0, round(raw / max_raw * 100, 1))
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/atom_service.py
git commit -m "feat: atom service with dedup, maturity calculation"
```

---

## Task 9: API 路由 — 分析模块

**Files:**
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/analysis.py`

- [ ] **Step 1: 创建 analysis.py**

```python
# backend/app/api/analysis.py
import json
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.db import Analysis, get_db
from app.schemas.analysis import (
    PreprocessRequest, PreprocessResponse,
    AnalyzeRequest, FollowupRequest
)
from app.services.preprocessor import preprocessor
from app.services.llm.factory import get_llm_client
from app.prompts.templates import FREE_TEXT_ANALYSIS
from app.config import get_settings
import asyncio

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/preprocess", response_model=PreprocessResponse)
async def preprocess_text(req: PreprocessRequest):
    """本地预处理，毫秒级，不调 AI"""
    return preprocessor.preprocess(req.text)


async def _sse_generator(analysis_id: uuid.UUID, prompt: str):
    """SSE 流生成器，逐行 yield"""
    llm = get_llm_client()
    try:
        buffer = ""
        async for chunk in llm.analyze_stream(prompt):
            buffer += chunk
            # 尝试提取完整 JSON 对象并发送
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        logger.error(f"SSE stream error for analysis {analysis_id}: {e}")
        yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"


@router.post("/analyze")
async def analyze(req: AnalyzeRequest, db: AsyncSession = Depends(get_db)):
    """AI 分析，SSE 流式返回"""
    settings = get_settings()

    # 本地预处理
    preprocess_result = None
    if req.text:
        preprocess_result = preprocessor.preprocess(req.text)

    # 创建分析记录
    analysis = Analysis(
        input_type=req.type,
        input_content=req.text or "",
        status="in_progress",
        session_data={"preprocess": preprocess_result.model_dump() if preprocess_result else None},
    )
    db.add(analysis)
    await db.commit()
    await db.refresh(analysis)

    # 构建 Prompt（自由文本为例）
    from app.schemas.analysis import FreeTextResult
    schema_json = json.dumps(FreeTextResult.model_json_schema(), ensure_ascii=False)
    prompt = FREE_TEXT_ANALYSIS.format(
        target_level=settings.TARGET_LEVEL,
        input_text=req.text or "",
        schema_json=schema_json,
    )

    async def event_stream():
        yield f"data: {{\"analysis_id\": \"{analysis.id}\"}}\n\n"
        async for event in _sse_generator(analysis.id, prompt):
            yield event

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/analyses/{analysis_id}/followup")
async def followup(
    analysis_id: uuid.UUID,
    req: FollowupRequest,
    db: AsyncSession = Depends(get_db),
):
    """追问，非流式返回"""
    analysis = await db.get(Analysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    from app.prompts import templates as tmpl
    from app.schemas.analysis import ComparisonResult, UsageResult, DerivativeResult, ExampleResult

    template_map = {
        "comparison": (tmpl.FOLLOWUP_COMPARISON, ComparisonResult),
        "usage":      (tmpl.FOLLOWUP_USAGE, UsageResult),
        "derivative": (tmpl.FOLLOWUP_DERIVATIVE, DerivativeResult),
        "example":    (tmpl.FOLLOWUP_EXAMPLE, ExampleResult),
    }

    if req.template not in template_map:
        raise HTTPException(status_code=400, detail=f"Unknown template: {req.template}")

    tpl_str, schema_cls = template_map[req.template]
    schema_json = json.dumps(schema_cls.model_json_schema(), ensure_ascii=False)
    prompt = tpl_str.format(**req.params, schema_json=schema_json)

    llm = get_llm_client()
    raw = await llm.analyze(prompt)
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned invalid JSON")

    # 追加到 session_data
    session_data = analysis.session_data or {}
    followups = session_data.get("followups", [])
    followups.append({"template": req.template, "params": req.params, "result": result})
    session_data["followups"] = followups
    analysis.session_data = session_data
    await db.commit()

    return result


@router.post("/analyses/{analysis_id}/complete")
async def complete_analysis(analysis_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    analysis = await db.get(Analysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    analysis.status = "completed"
    analysis.session_data = None
    await db.commit()
    return {"status": "completed"}


@router.get("/analyses")
async def list_analyses(
    status: str | None = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import select, func
    q = select(Analysis)
    if status:
        q = q.where(Analysis.status == status)
    total = await db.scalar(select(func.count()).select_from(q.subquery()))
    q = q.order_by(Analysis.created_at.desc()).offset((page - 1) * limit).limit(limit)
    rows = await db.execute(q)
    items = rows.scalars().all()
    return {
        "items": [
            {"id": str(a.id), "input_type": a.input_type, "status": a.status, "created_at": a.created_at}
            for a in items
        ],
        "total": total,
    }


@router.get("/analyses/{analysis_id}")
async def get_analysis(analysis_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    analysis = await db.get(Analysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return {
        "id": str(analysis.id),
        "input_type": analysis.input_type,
        "input_content": analysis.input_content,
        "status": analysis.status,
        "session_data": analysis.session_data,
        "created_at": analysis.created_at,
    }


@router.delete("/analyses/{analysis_id}", status_code=204)
async def delete_analysis(analysis_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    analysis = await db.get(Analysis, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    await db.delete(analysis)
    await db.commit()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/api/analysis.py backend/app/api/__init__.py
git commit -m "feat: analysis API with SSE streaming and followup"
```

---

## Task 10: API 路由 — 知识库 + 词典

**Files:**
- Create: `backend/app/api/atoms.py`
- Create: `backend/app/api/dictionary.py`
- Create: `backend/app/services/dictionary.py`

- [ ] **Step 1: 创建 atoms.py（知识库路由）**

实现所有 `/atoms` 端点（POST /atoms, GET /atoms, GET /atoms/{id}, POST /atoms/{id}/properties, POST /atoms/{id}/relations, GET /atoms/{id}/relations, POST /atoms/{id}/tags, DELETE /atoms/{id}/tags/{tag}, DELETE /atoms/{id}）。

关键逻辑 POST /atoms:
1. Grammar key 正则化（`normalize_grammar_key`）
2. 精确匹配（`get_atom_by_key`）→ 已存在则返回 `exists`
3. 语法类型：Qdrant 语义搜索 → score > 0.95 视为已存在，0.75~0.95 返回 `similar`
4. 否则创建原子 + 写属性 + link 分析记录 + trace(added) → 返回 `created`

- [ ] **Step 2: 创建 dictionary.py（JMdict 服务 + 路由）**

JMdict 是 XML 格式。解析时用 xml.etree.ElementTree，构建 `{kanji_or_kana: entry}` 索引。`/dictionary/{word}` 直接 lookup 返回。

- [ ] **Step 3: 创建 main.py**

```python
# backend/app/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import analysis, atoms, dictionary
from app.models.db import async_engine, Base
from app.services.qdrant_service import qdrant_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await qdrant_service.ensure_collection()
    yield


app = FastAPI(title="JLPT Master API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analysis.router, prefix="/api")
app.include_router(atoms.router, prefix="/api")
app.include_router(dictionary.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 4: 本地启动验证**

```bash
cd /Users/dairui/JLPT-master/backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
# 访问 http://localhost:8000/health 预期: {"status":"ok"}
# 访问 http://localhost:8000/docs 查看所有端点
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/ backend/app/services/dictionary.py backend/app/main.py
git commit -m "feat: complete backend API - atoms, dictionary, main app"
```

---

## Task 11: 前端基础配置

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`

- [ ] **Step 1: 创建 package.json（含所有依赖）**

```json
{
  "name": "jlpt-master-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "framer-motion": "^11.15.0",
    "clsx": "^2.1.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vite": "^6.0.5"
  }
}
```

- [ ] **Step 2: 创建 vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
```

- [ ] **Step 3: 安装依赖验证**

```bash
cd /Users/dairui/JLPT-master/frontend
npm install
npm run dev
# 预期: Vite 开发服务器在 http://localhost:5173 启动
```

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "feat: Vite+React frontend base configuration"
```

---

## Task 12: 前端核心类型 + API 服务层

**Files:**
- Create: `frontend/src/types/index.ts`
- Create: `frontend/src/services/api.ts`

- [ ] **Step 1: 创建所有 TypeScript 类型（见 types/index.ts 设计）**

- [ ] **Step 2: 创建 api.ts（SSE streaming + 所有 API 调用）**

SSE parsing 关键代码：
```typescript
export async function* analyzeStream(req: AnalyzeRequest): AsyncGenerator<SentenceAnalysis | { analysis_id: string }> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let jsonBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        // 累积 JSON，尝试解析完整的 SentenceAnalysis
        try {
          const parsed = JSON.parse(data);
          yield parsed;
        } catch {
          jsonBuffer += data;
          try {
            const parsed = JSON.parse(jsonBuffer);
            yield parsed;
            jsonBuffer = '';
          } catch {
            // continue accumulating
          }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/ frontend/src/services/
git commit -m "feat: TypeScript types and API service layer with SSE streaming"
```

---

## Task 13: 前端组件 — 布局 + 分析模块

**Files:**
- Create: `frontend/src/components/shared/Layout.tsx`
- Create: `frontend/src/components/shared/Sidebar.tsx`
- Create: `frontend/src/components/analysis/AnalysisInput.tsx`
- Create: `frontend/src/components/analysis/SentenceCard.tsx`
- Create: `frontend/src/components/analysis/VocabChip.tsx`
- Create: `frontend/src/components/analysis/GrammarCard.tsx`
- Create: `frontend/src/components/analysis/FollowupPanel.tsx`
- Create: `frontend/src/hooks/useAnalysis.ts`

关键设计：
- 暗色主题：`bg-[#0f1117]` 背景，`bg-[#1a1d27]` 卡片
- JLPT 级别徽章颜色：N1 红，N2 橙，N3 黄，N4 绿，N5 蓝
- SentenceCard 的 VocabChip/GrammarCard 点击展开，显示所有属性字段
- [入库] 按钮调用 `createAtom`，根据 `status` 显示：
  - `created` → 绿色"已入库"
  - `exists` → 黄色"已在库中" + 链接
  - `similar` → 弹出候选列表让用户选择

- [ ] **Step 1: 实现所有分析组件（完整代码）**

- [ ] **Step 2: 浏览器验证**

```bash
cd /Users/dairui/JLPT-master/frontend && npm run dev
# 访问 http://localhost:5173
# 检查: 侧边栏导航正常，输入框可输入，暗色主题正确
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ frontend/src/hooks/
git commit -m "feat: layout, sidebar, and analysis components"
```

---

## Task 14: 前端组件 — 知识库 + 页面

**Files:**
- Create: `frontend/src/components/atoms/AtomList.tsx`
- Create: `frontend/src/components/atoms/AtomCard.tsx`
- Create: `frontend/src/components/atoms/AtomDetailView.tsx`
- Create: `frontend/src/hooks/useAtoms.ts`
- Create: `frontend/src/pages/AnalysisPage.tsx`
- Create: `frontend/src/pages/KnowledgeBasePage.tsx`
- Create: `frontend/src/pages/AtomDetailPage.tsx`
- Create: `frontend/src/App.tsx`

- [ ] **Step 1: 实现知识库组件和所有页面**

- [ ] **Step 2: 配置路由（App.tsx）**

```tsx
// src/App.tsx
import { Routes, Route } from 'react-router-dom'
import Layout from './components/shared/Layout'
import AnalysisPage from './pages/AnalysisPage'
import KnowledgeBasePage from './pages/KnowledgeBasePage'
import AtomDetailPage from './pages/AtomDetailPage'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<AnalysisPage />} />
        <Route path="/kb" element={<KnowledgeBasePage />} />
        <Route path="/kb/:id" element={<AtomDetailPage />} />
      </Routes>
    </Layout>
  )
}
```

- [ ] **Step 3: 端到端验证**

```bash
# 后端运行中 (port 8000)
# 前端运行中 (port 5173)
# 测试流程:
# 1. 粘贴日语文本 → 点击分析 → 验证流式 SSE 出现 SentenceCard
# 2. 点击词汇 [入库] → 验证返回 status
# 3. 访问 /kb → 验证知识库列表
# 4. 点击原子 → 验证详情页
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/
git commit -m "feat: knowledge base components and all pages - MVP complete"
```

---

## Task 15: Docker 完整验证

- [ ] **Step 1: 构建所有镜像**

```bash
cd /Users/dairui/JLPT-master
cp .env.example .env
# 填入 LLM_API_KEY
docker compose build
```

- [ ] **Step 2: 启动全栈验证**

```bash
docker compose up -d
docker compose ps
# 预期: 所有服务 healthy/running
curl http://localhost:8000/health
# 预期: {"status":"ok"}
# 访问 http://localhost:5173 验证前端正常
```

- [ ] **Step 3: 最终 Commit**

```bash
git add .
git commit -m "feat: JLPT Master MVP - complete full-stack rebuild"
```

---

## 注意事项

- 后台已有两个 agent 在运行（后端 + 前端），等它们完成后先 review 产出，再根据本计划补齐缺失部分
- 基础设施（Task 1: docker-compose, migrations）尚未执行，需要手动完成
- Task 10（atoms 路由完整实现）和 Task 12（SSE parsing 细节）是最复杂的，需要仔细验证
- 语法 key 正则化 + Qdrant 匹配分级 是核心差异化逻辑，不可遗漏

---

*计划创建日期: 2026-04-20*  
*依赖文档: VISION.md v0.5, ARCHITECTURE.md v0.5, DETAILED-DESIGN.md v0.7*
