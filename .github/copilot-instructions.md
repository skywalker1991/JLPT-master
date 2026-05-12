# JLPT 日语学习助手项目指南

## 项目概述

这是一个**日语文本/图片分析工具**，用于辅助 JLPT 学习者进行词汇积累和语法学习。系统采用前后端分离架构，支持文本输入或 OCR 图片识别，提供分词、词性标注、词典查询、语法分析，并具备收藏、复习、Anki 导出功能。

**设计哲学**：
- 分句/分词不依赖 LLM，保证首屏响应速度
- 前后端职责清晰：后端专注语言处理，前端专注交互展示
- 以"句子"为核心展示单元，所有分析结果围绕句子组织

## 架构分层

### 后端 (FastAPI + Python)
- **路径**: `apps/backend/`
- **核心职责**: 
  - 日语文本分词（使用 Janome，不依赖 LLM）
  - OCR 文本提取（通过 Gemini 多模态 API）
  - 结构化分析（词汇、语法通过 LLM 生成）
  - 分块重叠策略处理长文本（chunk_size=6, overlap=2）

**关键组件**:
- [api.py](../apps/backend/api.py): FastAPI 路由定义（`/segment`, `/analyze`）
- [service.py](../apps/backend/service.py): `JapaneseArticleAnalyzer` 核心分析逻辑
- [segmenter.py](../apps/backend/segmenter.py): 分句与分块算法
- [llm/gemini_client.py](../apps/backend/llm/gemini_client.py): Gemini API 封装，支持结构化输出

**环境变量**:
- 必须在 `apps/backend/.env` 设置 `GOOGLE_API_KEY`
- 配置通过 [config.py](../apps/backend/config.py) 中的 `Settings.from_env()` 加载

### 前端 (Next.js 16 App Router + TypeScript)
- **路径**: `apps/web/`
- **技术栈**: Next.js 16.1.1 + Turbopack + Tailwind CSS 4 + PostgreSQL
- **核心模式**: Server Actions（避免客户端直接调用后端 API）

**数据流**:
1. 用户在 [TextInputPanel](../apps/web/components/analysis/TextInputPanel.tsx) 输入文本
2. [page.tsx](../apps/web/app/page.tsx) 管理状态（`inputText`, `selectedSentenceId`）
3. 并行触发两个 Server Actions:
   - [segmentAction](../apps/web/app/lib/actions.ts): 分词结果 → [SegmentPanel](../apps/web/components/analysis/SegmentPanel.tsx)
   - [analyzeAction](../apps/web/app/lib/actions.ts): 词汇/语法分析 → [AnalysisResultPanel](../apps/web/components/analysis/AnalysisResultPanel.tsx)

**关键约定**:
- **词性标注**: 使用 [japanese-utils.ts](../apps/web/app/lib/japanese-utils.ts) 中的 `POS_COLORS` 映射，通过 Tailwind `decoration-*` 类着色
- **振假名显示**: 汉字词优先显示读音（见 `hasKanji()` 工具函数）
- **API 配置**: 通过 [config.ts](../apps/web/app/lib/config.ts) 统一管理后端地址（默认 `localhost:8000`）

### 数据库 (PostgreSQL)
- **Schema**: [schema.sql](../apps/web/app/db/schema.sql)
- **核心表**:
  - `favorite_vocab`: 收藏单词（surface/base/reading/meaning_zh）
  - `favorite_grammar`: 收藏语法（pattern/connection_jp/meaning_zh/example_sentences JSONB）
  - `review_progress`: 复习进度追踪（card_type/card_id/mastered/review_count）

**数据操作**:
- 所有数据库操作通过 Server Actions（[favorites.ts](../apps/web/app/lib/favorites.ts), [review.ts](../apps/web/app/lib/review.ts)）
- 使用 `pg` 模块直接查询，连接池在 [db.ts](../apps/web/app/lib/db.ts) 配置

## 开发工作流

### 启动服务
```bash
# 方式一：使用启动脚本（推荐）
./start.sh

# 方式二：手动分别启动
# 后端（需要先激活虚拟环境并加载 .env）
cd apps
source backend/venv/bin/activate
uvicorn backend.api:app --reload --host 0.0.0.0 --port 8000

# 前端
cd apps/web
pnpm dev
```

**服务地址**:
- 后端: `http://localhost:8000`（查看 API 文档: `/docs`）
- 前端: `http://localhost:3000`

### Mock 数据开发
在 [config.ts](../apps/web/app/lib/config.ts) 中设置 `MOCK.ENABLED = true`，使用 `mock/response_*.json` 文件跳过后端调用。

### 前端依赖管理
**使用 pnpm**（不要用 npm/yarn）:
```bash
cd apps/web
pnpm install
pnpm add <package>
```

## 项目特定模式

### 1. 分块重叠策略
长文本分析采用滑动窗口（见 [segmenter.py](../apps/backend/segmenter.py)）:
- `chunk_size=6`: 每块 6 个句子
- `overlap=2`: 相邻块重叠 2 个句子
- 后处理通过 `index` 合并重复句子分析，保留字段更完整的结果

### 2. LLM 结构化输出
使用 Pydantic schema 约束 Gemini API 输出（见 [schemas.py](../apps/backend/schemas.py)）:
```python
batch = llm.generate_structured(prompt, BatchAnalysis, image_base64=...)
```
返回的 `BatchAnalysis.sentences` 自动验证为 `List[SentenceAnalysis]`，确保类型安全。

### 3. Anki 导出格式
- 单词: `表层形式【读音】（基本形）[TAB]中文意思`
- 语法: `句型[TAB]<b>接续：</b>...`（支持 HTML 格式）
- 实现见 [anki-export.ts](../apps/web/app/lib/anki-export.ts)

### 4. 组件交互模式
- **句子点击高亮**: 用户点击 [SegmentPanel](../apps/web/components/analysis/SegmentPanel.tsx) 中的句子 → `onSentenceClick(id)` → [page.tsx](../apps/web/app/page.tsx) 更新 `selectedSentenceId` → [AnalysisResultPanel](../apps/web/components/analysis/AnalysisResultPanel.tsx) 滚动到对应句子并高亮
- **振假名切换**: 通过 `katakanaToHiragana()` 统一转换为平假名显示

## 常见调试场景

### 后端分析失败
1. 检查 `GOOGLE_API_KEY` 是否正确设置（[config.py](../apps/backend/config.py)）
2. 查看终端的详细错误栈（`traceback.format_exc()`）
3. 验证 Pydantic schema 是否与 LLM 输出匹配（见 [schemas.py](../apps/backend/schemas.py)）

### 前端 Server Action 错误
1. 打开浏览器开发者工具查看 Network 请求
2. 检查后端 8000 端口是否正常响应
3. 确认 [config.ts](../apps/web/app/lib/config.ts) 中的 `BASE_URL` 配置

### 数据库连接问题
1. 确保 PostgreSQL 服务运行
2. 检查 [db.ts](../apps/web/app/lib/db.ts) 中的连接字符串环境变量
3. 运行 [schema.sql](../apps/web/app/db/schema.sql) 初始化表结构

## 扩展多语言支持

当前项目针对日语优化，但架构预留扩展空间：
- 后端 Janome tokenizer 仅支持日语，需替换为语言无关分词器（如 spaCy）
- 前端 [japanese-utils.ts](../apps/web/app/lib/japanese-utils.ts) 中的 `hasKanji()`、`katakanaToHiragana()` 需抽象为语言特定模块
- 数据库 schema 增加 `language` 字段区分不同语言的收藏项

## 关键文档

- [前端架构说明](../doc/frontend-architecture-new.md): 组件关系图与数据流详解
- [AI 工作区 README](../AI_workspace/README.md): 项目设计目标与功能概览
- [API 契约](../doc/api-contract.md): 后端接口规范（待补充）

## 代码风格

- **中文注释**: 所有关键逻辑使用中文注释（项目面向中文用户）
- **类型安全**: 前端严格使用 TypeScript，后端使用 Pydantic 验证
- **错误处理**: 所有 Server Actions 返回 `{success, error}` 结构，避免未捕获异常
- **命名约定**: 
  - 组件文件使用 PascalCase（如 `VocabList.tsx`）
  - 工具函数文件使用 kebab-case（如 `japanese-utils.ts`）
  - 后端模块使用 snake_case（如 `gemini_client.py`）
