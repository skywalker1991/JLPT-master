# 前端架构说明

> 更新日期：2026年1月15日

## 技术栈
- **框架**: Next.js 16.1.1 (App Router + Turbopack)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **数据**: Server Actions + PostgreSQL
- **后端**: FastAPI (localhost:8000)

## 组件架构

### 组件层级关系

``` mermaid
graph TB
    subgraph "页面层 (App Router)"
        Page["/app/page.tsx<br/>📄 主页面<br/>• useState: inputText<br/>• useState: selectedSentenceId"]
    end
    
    subgraph "布局组件"
        TextInput["TextInputPanel<br/>📝 输入面板<br/>• 固定底部<br/>• onTextChange 回调"]
        
        subgraph "左侧面板"
            Segment["SegmentPanel<br/>📖 原文展示<br/>• 接收 text prop<br/>• 调用 segmentAction<br/>• 词性标注着色<br/>• 振假名显示<br/>• onSentenceClick 回调"]
        end
        
        subgraph "右侧面板"
            Analysis["AnalysisResultPanel<br/>📊 分析结果<br/>• 接收 text prop<br/>• 接收 selectedSentenceId<br/>• 调用 analyzeAction<br/>• 句子滚动高亮"]
        end
    end
    
    subgraph "分析子组件"
        Vocab["VocabList<br/>📚 词汇列表<br/>• 显示单词信息<br/>• 振假名"]
        Grammar["GrammarList<br/>📋 语法列表<br/>• 显示语法点"]
    end
    
    subgraph "Server Actions"
        SegmentAPI["segmentAction<br/>🔧 分词API<br/>POST /segment"]
        AnalyzeAPI["analyzeAction<br/>🔧 分析API<br/>POST /analyze"]
    end
    
    subgraph "工具函数"
        Utils["japanese-utils.ts<br/>• hasKanji<br/>• katakanaToHiragana<br/>• getPosColorClass<br/>• POS_COLORS"]
        Config["config.ts<br/>• API_CONFIG"]
    end
    
    Page -->|"text prop"| Segment
    Page -->|"text prop"| Analysis
    Page -->|"onTextChange"| TextInput
    Page -->|"selectedSentenceId prop"| Analysis
    Page -->|"onSentenceClick"| Segment
    
    TextInput -.->|"更新 inputText"| Page
    Segment -.->|"更新 selectedSentenceId"| Page
    
    Segment --> SegmentAPI
    Analysis --> AnalyzeAPI
    
    Analysis --> Vocab
    Analysis --> Grammar
    
    Segment --> Utils
    SegmentAPI --> Config
    AnalyzeAPI --> Config
    
    style Page fill:#e1f5ff
    style TextInput fill:#fff4e6
    style Segment fill:#e8f5e9
    style Analysis fill:#f3e5f5
    style Vocab fill:#fce4ec
    style Grammar fill:#fce4ec
    style SegmentAPI fill:#fff9c4
    style AnalyzeAPI fill:#fff9c4
    style Utils fill:#f5f5f5
    style Config fill:#f5f5f5
```

完整的 Mermaid 组件架构图请参考对话记录（含数据流向和交互关系）。

### 组件职责表

| 组件 | 路径 | 主要功能 | 状态/Props |
|------|------|----------|-----------|
| **Page** | `/app/page.tsx` | 状态管理、布局编排 | `inputText`, `selectedSentenceId` |
| **TextInputPanel** | `/components/analysis/TextInputPanel.tsx` | 用户输入 | `onTextChange` 回调 |
| **SegmentPanel** | `/components/analysis/SegmentPanel.tsx` | 原文分词展示 | `text`, `onSentenceClick` |
| **AnalysisResultPanel** | `/components/analysis/AnalysisResultPanel.tsx` | 分析结果聚合 | `text`, `selectedSentenceId` |
| **VocabList** | `/components/analysis/VocabList.tsx` | 词汇表格 | `words` 数组 |
| **GrammarList** | `/components/analysis/GrammarList.tsx` | 语法列表 | `grammar` 数组 |

## 数据流

### 1. 输入流程
```
用户输入文本 
  → TextInputPanel (表单提交) 
  → Page.setInputText (状态更新) 
  → 同时传递给 SegmentPanel 和 AnalysisResultPanel
```

### 2. 并行请求流程
```
SegmentPanel.useEffect 
  → segmentAction (POST /segment) 
  → 显示分词结果 + 词性标注

AnalysisResultPanel.useEffect 
  → analyzeAction (POST /analyze) 
  → 显示句子分析 + VocabList + GrammarList
```

### 3. 交互流程
```
用户点击左侧原文句子 
  → SegmentPanel.onSentenceClick 
  → Page.setSelectedSentenceId (状态更新) 
  → AnalysisResultPanel 滚动高亮对应句子
```

## 目录结构

```
apps/web/
├── app/
│   ├── page.tsx                  # 主页面（状态管理）
│   ├── layout.tsx                # 根布局
│   ├── globals.css               # 全局样式
│   └── lib/
│       ├── actions.ts            # Server Actions (segmentAction, analyzeAction)
│       ├── config.ts             # API 配置（BASE_URL, ENDPOINTS, MOCK）
│       └── japanese-utils.ts     # 日语处理工具函数
├── components/
│   └── analysis/
│       ├── TextInputPanel.tsx          # 输入面板
│       ├── SegmentPanel.tsx            # 原文展示面板
│       ├── AnalysisResultPanel.tsx     # 分析结果面板
│       ├── VocabList.tsx               # 词汇列表组件
│       └── GrammarList.tsx             # 语法列表组件
├── types/
│   └── analysis.ts               # TypeScript 类型定义
└── mock/
    └── response_*.json           # Mock 数据
```

## 核心特性

### 1. 词性标注着色
- 使用 Tailwind `decoration-*` 类为不同词性添加下划线颜色
- 颜色映射定义在 `japanese-utils.ts` 的 `POS_COLORS` 常量中
- 支持：名词、动词、形容词、副词、助词等多种词性

### 2. 振假名显示
- 仅为包含汉字的词添加 `<ruby>` 标签
- 使用 `hasKanji()` 检测汉字
- 使用 `katakanaToHiragana()` 转换片假名到平假名

### 3. 独立滚动区域
- 使用 Flexbox + `min-h-0` 实现左右面板独立滚动
- 布局采用 `grid-cols-2` 两列布局
- 每个面板使用 `overflow-y-auto` 允许独立滚动

### 4. Mock 模式
- 通过 `config.ts` 中的 `API_CONFIG.MOCK.ENABLED` 控制
- 可配置延迟时间（默认 500ms）
- 支持快速切换真实 API 和 Mock 数据

## 开发规范

### 组件命名
- 页面组件：`page.tsx`
- 布局组件：`*Panel.tsx` (如 `SegmentPanel`)
- 功能组件：`*List.tsx` (如 `VocabList`)

### 状态管理
- 使用 `useState` 管理页面级状态
- 通过 props 单向传递数据
- 通过回调函数向上传递事件

### 样式约定
- 使用 Tailwind 原子类
- 颜色语义化：
  - `bg-yellow-100` 高亮
  - `decoration-blue-500` 名词
  - `decoration-green-500` 动词
- 响应式布局：`grid-cols-2`, `h-screen`, `overflow-y-auto`

### Server Actions
- 文件位置：`app/lib/actions.ts`
- 命名规范：`*Action` (如 `segmentAction`)
- 必须标记：`"use server"` 指令
- 类型安全：返回类型使用 `types/analysis.ts` 中定义的接口

## 后续扩展

### 计划功能
- [ ] 用户词汇收藏功能
- [ ] 历史记录管理
- [ ] 导出分析结果（PDF/JSON）
- [ ] 暗色模式支持
- [ ] 移动端适配

### 技术债务
- [ ] 错误边界处理（Error Boundary）
- [ ] Loading 状态优化（骨架屏）
- [ ] SEO 元数据完善
- [ ] 单元测试覆盖（Jest + Testing Library）
- [ ] E2E 测试（Playwright）
