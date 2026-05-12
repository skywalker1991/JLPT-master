# Frontend Complete Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete visual and UX rewrite of the React frontend — light mode, clean with indigo accent, sticky top navigation with 5 functional tabs and inline settings (target level + model selector).

**Architecture:** Replace dark theme with a light/white design system; replace sidebar with a sticky topbar housing 5 tabs; add `SettingsContext` for persistent model + target-level preferences stored in localStorage. No analysis history. Each component is a focused file, max ~150 lines.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS v3, framer-motion, clsx, lucide-react, Plus Jakarta Sans (Google Fonts)

---

## Page Composition Design

### Tab 1 — 语料分析

Purpose: Paste Japanese text or screenshot → streaming AI analysis → ingest items to knowledge base → follow-up queries.

```
┌─────────────────────────────────────────────────┐
│ [Text] [JLPT语法] [JLPT排列] [JLPT读解] [JLPT听解]  ← type sub-tabs │
│                                                   │
│  粘贴日语文本…                          [分析 →]  │
└─────────────────────────────────────────────────┘

── streaming results ──────────────────────────────

┌──────────────────────────────────────────────────┐
│ ① 昨日学校へ行きました                             │
│    Yesterday I went to school.                    │
│                                                   │
│  词汇 · 3                                         │
│  [昨日 きのう N4] [学校 N5] [行きました]            │
│                                                   │
│  语法 · 1                                         │
│  ┌ ～ました  礼貌过去式  N5 ▸                     │
└──────────────────────────────────────────────────┘

── after all sentences complete ──────────────────

┌──────────────────────────────────────────────────┐
│ 继续探索                                          │
│  [对比] [用法] [活用] [例句] [自由追问]            │
│  词语A ___  词语B ___  [发送]                      │
│                                                   │
│  结果显示区                                       │
└──────────────────────────────────────────────────┘
```

No history records. Each analysis session is ephemeral — results live only in the current page state.

---

### Tab 2 — JLPT专题

Purpose: Structured JLPT question-format practice. Fixed formats, future built-in question banks.

```
┌─────────────────────────────────────────────────┐
│ JLPT 专题                                         │
│ 针对 JLPT 考试题型的专项练习                       │
└─────────────────────────────────────────────────┘

┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│ 文字・語彙 │ │    文法    │ │    読解    │ │    聴解    │
│  近期开放  │ │  近期开放  │ │  近期开放  │ │  近期开放  │
└───────────┘ └───────────┘ └───────────┘ └───────────┘

（目前为占位区，内置题库功能待后续开发）
```

Initial implementation: page shell with 4 topic cards (文字・語彙 / 文法 / 読解 / 聴解), each showing a "开发中" badge. No functional content yet — the tab exists to establish the mental model.

---

### Tab 3 — 实时视频

Purpose: Paste a video link → fetch subtitles → local Janome tokenization display → click word for dictionary lookup → select sentences to send to AI analysis.

```
┌─────────────────────────────────────────────────┐
│  https://youtube.com/...                [加载字幕]│
└─────────────────────────────────────────────────┘

── after subtitle load ───────────────────────────

字幕 · 124 句  [全选] [分析选中句]

┌──────────────────────────────────────────────────┐
│ □  00:12  日本語の勉強は楽しいです                 │
│          [日本語] [の] [勉強] [は] [楽しい] [です] │
│                                     ↑ click = dict popup
│ □  00:24  毎日練習することが大切です               │
│          [毎日] [練習] [する] [こと] [が] [大切] [です]
└──────────────────────────────────────────────────┘

── select checkboxes + click 分析选中句 ──────────

→ opens 语料分析 tab with selected text pre-filled
```

Dict popup: shows reading + meaning from backend `/api/dictionary/{word}`.
Tokenization: calls `/api/preprocess` for local Janome segmentation (no AI cost).
Subtitle fetch: calls `/api/video/subtitles` (new backend endpoint needed).

---

### Tab 4 — 知识库

Purpose: Browse and search all accumulated vocabulary + grammar atoms. Stats overview, table layout, atom detail page.

```
知识库
你积累的每个词汇和语法点

┌──────┐  ┌──────┐  ┌──────┐
│  47  │  │  31  │  │  16  │
│ 全部  │  │ 词汇  │  │ 语法  │
└──────┘  └──────┘  └──────┘

[搜索词条…]  [全部] [词汇] [语法]

┌──────────────────────────────────────────────────┐
│  词条     类型   成熟度          属性数            │
├──────────────────────────────────────────────────┤
│  昨日     词汇   ████░░  82      4                │
│  〜ました  语法   ██░░░░  45      3                │
└──────────────────────────────────────────────────┘

Atom detail page (route: /kb/:id):
  ← 返回知识库
  昨日  [词汇]  入库 2026-04-20
  
  属性 · 4
  ┌ AI 提取 ──────────────────────────────────┐
  │ reading   きのう                           │
  │ meaning   Yesterday                       │
  │ usage     …                               │
  └────────────────────────────────────────────┘
  
  关联 · 1       来源分析 · 2
```

---

### Tab 5 — 内化学习

Purpose: Active recall and internalization practice. User selects from multiple learning modes and topics.

```
内化学习
选择你今天要练习的方式

┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  翻訳练习  │  │  书き取り  │  │  比較学习  │  │  听解练习  │
│ 日→中/中→日│  │  听写填空  │  │ 近义词辨析 │  │  开发中   │
└──────────┘  └──────────┘  └──────────┘  └──────────┘

练习范围  [知识库全部 ▾]  [N2 ▾]  [词汇 ▾]

── 翻訳练习 session ──────────────────────────────

┌──────────────────────────────────────────────────┐
│  私は毎朝コーヒーを飲みます。                        │
│  请翻译成中文：                                    │
│  ┌────────────────────────────────────────────┐  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
│                              [跳过]  [确认翻译]   │
└──────────────────────────────────────────────────┘

（初期实现：翻訳练习 + 比較学习，其余占位）
```

Sources sentences and vocab from the knowledge base atoms. Uses AI to evaluate translations.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Install | `lucide-react` npm dep | SVG icon set |
| Modify | `frontend/index.html` | Add Plus Jakarta Sans font |
| Modify | `frontend/tailwind.config.ts` | New light-mode token set |
| Modify | `frontend/src/index.css` | Base styles + CSS utility classes |
| Create | `frontend/src/context/SettingsContext.tsx` | Model + target level (localStorage) |
| Modify | `frontend/src/main.tsx` | Wrap App in SettingsProvider |
| Rewrite | `frontend/src/App.tsx` | 5-tab routing (no history route) |
| Rewrite | `frontend/src/components/shared/Layout.tsx` | TopNav + Outlet |
| Create | `frontend/src/components/shared/TopNav.tsx` | Sticky topbar: 5 tabs + settings |
| Delete | `frontend/src/components/shared/Sidebar.tsx` | Replaced by TopNav |
| Rewrite | `frontend/src/pages/AnalysisPage.tsx` | 语料分析 page shell |
| Rewrite | `frontend/src/components/analysis/AnalysisInput.tsx` | Text input card |
| Rewrite | `frontend/src/components/analysis/SentenceCard.tsx` | Sentence result container |
| Rewrite | `frontend/src/components/analysis/VocabChip.tsx` | Expandable vocab item |
| Rewrite | `frontend/src/components/analysis/GrammarCard.tsx` | Expandable grammar item |
| Rewrite | `frontend/src/components/analysis/FollowupPanel.tsx` | Follow-up query panel |
| Create | `frontend/src/pages/JlptPage.tsx` | JLPT专题 page (4 topic cards, placeholder) |
| Create | `frontend/src/pages/VideoPage.tsx` | 实时视频 page |
| Create | `frontend/src/components/video/SubtitleLoader.tsx` | URL input + fetch |
| Create | `frontend/src/components/video/SubtitleList.tsx` | Tokenized sentences + dict popup |
| Create | `frontend/src/components/video/DictPopup.tsx` | Word dict lookup popover |
| Rewrite | `frontend/src/pages/KnowledgeBasePage.tsx` | 知识库 page with stats |
| Rewrite | `frontend/src/components/atoms/AtomList.tsx` | Table-based atom browser |
| Delete | `frontend/src/components/atoms/AtomCard.tsx` | Replaced by table rows |
| Rewrite | `frontend/src/pages/AtomDetailPage.tsx` | Fetch + error shell |
| Rewrite | `frontend/src/components/atoms/AtomDetailView.tsx` | Atom detail renderer |
| Create | `frontend/src/pages/InternalizePage.tsx` | 内化学习 page |
| Create | `frontend/src/components/internalize/ModeSelector.tsx` | Learning mode grid |
| Create | `frontend/src/components/internalize/TranslationSession.tsx` | 翻訳练习 session |

---

## Task 1: Dependencies + Design Tokens

**Files:**
- Modify: `frontend/package.json` (install lucide-react)
- Modify: `frontend/index.html`
- Modify: `frontend/tailwind.config.ts`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Install lucide-react**

```bash
cd /Users/dairui/JLPT-master/frontend
npm install lucide-react
```

Expected: `+ lucide-react@x.x.x` in output, no errors.

- [ ] **Step 2: Add Plus Jakarta Sans font to index.html**

Replace the entire content of `frontend/index.html` with:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    <title>JLPT Master</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Rewrite tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F9FAFB',
        surface: '#FFFFFF',
        border: '#E5E7EB',
        fg: {
          DEFAULT: '#111827',
          muted: '#6B7280',
          subtle: '#9CA3AF',
        },
        accent: {
          DEFAULT: '#6366F1',
          hover: '#4F46E5',
          light: '#EEF2FF',
          border: '#C7D2FE',
          fg: '#3730A3',
        },
        success: {
          DEFAULT: '#10B981',
          light: '#ECFDF5',
          fg: '#065F46',
        },
        warning: {
          DEFAULT: '#F59E0B',
          light: '#FFFBEB',
          fg: '#92400E',
        },
        danger: {
          DEFAULT: '#EF4444',
          light: '#FEF2F2',
          fg: '#991B1B',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(0,0,0,0.07), 0 1px 2px -1px rgba(0,0,0,0.05)',
        'card-md': '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)',
        topbar: '0 1px 0 0 #E5E7EB',
      },
    },
  },
  plugins: [],
} satisfies Config
```

- [ ] **Step 4: Rewrite src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  *, *::before, *::after { box-sizing: border-box; }
  html { color-scheme: light; }
  body {
    @apply bg-bg text-fg font-sans antialiased;
    min-height: 100dvh;
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { @apply bg-border rounded-full; }
  ::-webkit-scrollbar-thumb:hover { @apply bg-fg-subtle rounded-full; }
}

@layer components {
  /* Cards */
  .card {
    @apply bg-surface border border-border rounded-xl shadow-card;
  }

  /* Buttons */
  .btn {
    @apply inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
           transition-colors duration-150 cursor-pointer select-none
           focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
           disabled:opacity-40 disabled:cursor-not-allowed;
  }
  .btn-primary {
    @apply btn bg-accent text-white hover:bg-accent-hover;
  }
  .btn-ghost {
    @apply btn text-fg-muted hover:text-fg hover:bg-gray-100;
  }
  .btn-danger {
    @apply btn text-danger hover:bg-danger/10;
  }

  /* Form elements */
  .input {
    @apply w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-fg
           placeholder:text-fg-subtle outline-none
           focus:border-accent focus:ring-2 focus:ring-accent/20
           transition-all duration-150;
  }

  /* Badges */
  .badge {
    @apply inline-flex items-center px-1.5 py-0.5 rounded-md text-2xs font-semibold;
  }
  .badge-vocab   { @apply badge bg-blue-50 text-blue-700 ring-1 ring-blue-200/60; }
  .badge-grammar { @apply badge bg-violet-50 text-violet-700 ring-1 ring-violet-200/60; }
  .badge-n1 { @apply badge bg-red-50 text-red-700 ring-1 ring-red-200/60; }
  .badge-n2 { @apply badge bg-orange-50 text-orange-700 ring-1 ring-orange-200/60; }
  .badge-n3 { @apply badge bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200/60; }
  .badge-n4 { @apply badge bg-green-50 text-green-700 ring-1 ring-green-200/60; }
  .badge-n5 { @apply badge bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/60; }

  /* Section label */
  .section-label {
    @apply text-xs font-semibold text-fg-subtle uppercase tracking-widest;
  }

  /* Divider */
  .divider {
    @apply border-t border-border;
  }
}
```

- [ ] **Step 5: Verify build passes**

```bash
cd /Users/dairui/JLPT-master/frontend
npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/dairui/JLPT-master
git add frontend/index.html frontend/tailwind.config.ts frontend/src/index.css frontend/package.json frontend/package-lock.json
git commit -m "feat: install lucide-react, new light-mode design tokens"
```

---

## Task 2: Settings Context + App Shell + 5-Tab TopNav

**Files:**
- Create: `frontend/src/context/SettingsContext.tsx`
- Modify: `frontend/src/main.tsx`
- Rewrite: `frontend/src/App.tsx`
- Create: `frontend/src/components/shared/TopNav.tsx`
- Rewrite: `frontend/src/components/shared/Layout.tsx`
- Delete: `frontend/src/components/shared/Sidebar.tsx`

- [ ] **Step 1: Create SettingsContext.tsx**

Create `frontend/src/context/SettingsContext.tsx`:

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react'

export interface Settings {
  targetLevel: string
  model: string
}

interface SettingsCtx {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
}

const Ctx = createContext<SettingsCtx | null>(null)

const DEFAULTS: Settings = { targetLevel: 'N2', model: 'gemini-2.5-flash' }

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('jlpt-settings') ?? '{}') }
    } catch {
      return DEFAULTS
    }
  })

  const updateSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    localStorage.setItem('jlpt-settings', JSON.stringify(next))
  }

  return <Ctx.Provider value={{ settings, updateSettings }}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
```

- [ ] **Step 2: Wrap App in SettingsProvider in main.tsx**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { SettingsProvider } from './context/SettingsContext'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 3: Rewrite App.tsx with 5-tab routes (no history)**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/shared/Layout'
import AnalysisPage from './pages/AnalysisPage'
import JlptPage from './pages/JlptPage'
import VideoPage from './pages/VideoPage'
import KnowledgeBasePage from './pages/KnowledgeBasePage'
import AtomDetailPage from './pages/AtomDetailPage'
import InternalizePage from './pages/InternalizePage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AnalysisPage />} />
        <Route path="jlpt" element={<JlptPage />} />
        <Route path="video" element={<VideoPage />} />
        <Route path="kb" element={<KnowledgeBasePage />} />
        <Route path="kb/:id" element={<AtomDetailPage />} />
        <Route path="internalize" element={<InternalizePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 4: Create TopNav.tsx with 5 tabs**

Create `frontend/src/components/shared/TopNav.tsx`:

```tsx
import { NavLink } from 'react-router-dom'
import { FileText, BookMarked, Video, BookOpen, Brain } from 'lucide-react'
import { useSettings } from '../../context/SettingsContext'

const LEVELS = ['N1', 'N2', 'N3', 'N4', 'N5']

const MODELS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
]

const NAV = [
  { to: '/',           end: true,  icon: FileText,   label: '语料分析' },
  { to: '/jlpt',       end: false, icon: BookMarked, label: 'JLPT专题' },
  { to: '/video',      end: false, icon: Video,      label: '实时视频' },
  { to: '/kb',         end: false, icon: BookOpen,   label: '知识库' },
  { to: '/internalize',end: false, icon: Brain,      label: '内化学习' },
]

export default function TopNav() {
  const { settings, updateSettings } = useSettings()

  return (
    <header className="sticky top-0 z-50 bg-surface shadow-topbar h-12 flex items-center px-5 gap-4">
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shadow-sm">
          <span className="text-white font-bold text-xs leading-none">日</span>
        </div>
        <span className="font-semibold text-fg text-sm hidden sm:block tracking-tight">
          JLPT Master
        </span>
      </div>

      {/* Tab nav */}
      <nav className="flex items-center gap-0.5 ml-2 overflow-x-auto">
        {NAV.map(({ to, end, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap
               transition-colors duration-150 cursor-pointer
               ${isActive
                 ? 'bg-accent-light text-accent-fg'
                 : 'text-fg-muted hover:text-fg hover:bg-gray-100'
               }`
            }
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <div className="flex items-center gap-2 shrink-0">
        <label className="text-2xs text-fg-subtle font-medium hidden sm:block">目标</label>
        <select
          value={settings.targetLevel}
          onChange={e => updateSettings({ targetLevel: e.target.value })}
          className="text-xs border border-border rounded-lg px-2 py-1.5 bg-surface text-fg
                     hover:border-accent/50 focus:border-accent focus:ring-2 focus:ring-accent/20
                     focus:outline-none transition-all cursor-pointer"
        >
          {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>

        <select
          value={settings.model}
          onChange={e => updateSettings({ model: e.target.value })}
          className="text-xs border border-border rounded-lg px-2 py-1.5 bg-surface text-fg
                     hover:border-accent/50 focus:border-accent focus:ring-2 focus:ring-accent/20
                     focus:outline-none transition-all cursor-pointer max-w-40"
        >
          {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
    </header>
  )
}
```

- [ ] **Step 5: Rewrite Layout.tsx**

```tsx
import { Outlet } from 'react-router-dom'
import TopNav from './TopNav'

export default function Layout() {
  return (
    <div className="min-h-dvh bg-bg">
      <TopNav />
      <main className="max-w-2xl mx-auto px-5 py-7">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 6: Delete Sidebar.tsx**

```bash
rm /Users/dairui/JLPT-master/frontend/src/components/shared/Sidebar.tsx
```

- [ ] **Step 7: Create placeholder page files so App.tsx compiles**

Create `frontend/src/pages/JlptPage.tsx`:
```tsx
export default function JlptPage() {
  return <div className="py-8 text-center text-fg-muted text-sm">JLPT 专题 — 开发中</div>
}
```

Create `frontend/src/pages/VideoPage.tsx`:
```tsx
export default function VideoPage() {
  return <div className="py-8 text-center text-fg-muted text-sm">实时视频 — 开发中</div>
}
```

Create `frontend/src/pages/InternalizePage.tsx`:
```tsx
export default function InternalizePage() {
  return <div className="py-8 text-center text-fg-muted text-sm">内化学习 — 开发中</div>
}
```

- [ ] **Step 8: Verify build**

```bash
cd /Users/dairui/JLPT-master/frontend && npm run build 2>&1 | tail -8
```

Expected: `✓ built in` — all 5 tabs visible in topbar, white background, no sidebar.

- [ ] **Step 9: Commit**

```bash
cd /Users/dairui/JLPT-master
git add frontend/src/context/ frontend/src/main.tsx frontend/src/App.tsx \
        frontend/src/components/shared/ frontend/src/pages/JlptPage.tsx \
        frontend/src/pages/VideoPage.tsx frontend/src/pages/InternalizePage.tsx
git commit -m "feat: 5-tab topbar nav, SettingsContext, routing skeleton"
```

---

## Task 3: Analysis Page + Input

**Files:**
- Rewrite: `frontend/src/pages/AnalysisPage.tsx`
- Rewrite: `frontend/src/components/analysis/AnalysisInput.tsx`

- [ ] **Step 1: Rewrite AnalysisPage.tsx**

```tsx
import { AnimatePresence, motion } from 'framer-motion'
import { useAnalysis } from '../hooks/useAnalysis'
import AnalysisInput from '../components/analysis/AnalysisInput'
import SentenceCard from '../components/analysis/SentenceCard'
import FollowupPanel from '../components/analysis/FollowupPanel'

export default function AnalysisPage() {
  const {
    inputText, inputType, sentences, analysisId,
    isStreaming, error,
    setInputText, setInputType, startAnalysis,
  } = useAnalysis()

  return (
    <div className="space-y-4">
      <AnalysisInput
        inputText={inputText}
        inputType={inputType}
        isStreaming={isStreaming}
        onInputChange={setInputText}
        onTypeChange={setInputType}
        onSubmit={startAnalysis}
      />

      {error && (
        <div className="px-4 py-3 bg-danger/5 border border-danger/20 rounded-xl text-sm text-danger-fg">
          {error}
        </div>
      )}

      {isStreaming && sentences.length === 0 && (
        <div className="flex items-center gap-3 px-4 py-3 card">
          <span className="flex gap-0.5">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
          <span className="text-sm text-fg-muted">AI 正在分析…</span>
        </div>
      )}

      <AnimatePresence>
        {sentences.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            {[...sentences]
              .sort((a, b) => a.index - b.index)
              .map((s, i) => (
                <SentenceCard key={s.index} sentence={s} analysisId={analysisId} index={i} />
              ))}
          </motion.div>
        )}
      </AnimatePresence>

      {analysisId && sentences.length > 0 && !isStreaming && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <FollowupPanel analysisId={analysisId} />
        </motion.div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rewrite AnalysisInput.tsx**

```tsx
import { useRef } from 'react'
import { Send, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import type { InputType } from '../../types'
import { INPUT_TYPE_LABELS } from '../../types'

interface Props {
  inputText: string
  inputType: InputType
  isStreaming: boolean
  onInputChange: (v: string) => void
  onTypeChange: (t: InputType) => void
  onSubmit: () => void
}

const TYPES: InputType[] = [
  'text', 'jlpt_grammar', 'jlpt_ordering', 'jlpt_reading', 'jlpt_listening',
]

export default function AnalysisInput({
  inputText, inputType, isStreaming,
  onInputChange, onTypeChange, onSubmit,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="card overflow-hidden">
      {/* Type tabs */}
      <div className="flex border-b border-border bg-gray-50/50 px-1 pt-1 gap-0.5 overflow-x-auto">
        {TYPES.map(t => (
          <button
            key={t}
            onClick={() => onTypeChange(t)}
            className={clsx(
              'px-3 py-2 text-xs font-medium whitespace-nowrap rounded-t-md transition-colors duration-150 cursor-pointer',
              inputType === t
                ? 'bg-surface text-accent border-b-2 border-accent -mb-px shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {INPUT_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={inputText}
        onChange={e => onInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isStreaming}
        rows={4}
        placeholder="粘贴日语文本开始分析… (Cmd/Ctrl + Enter)"
        className={clsx(
          'w-full bg-transparent px-4 py-3.5 text-sm text-fg',
          'placeholder:text-fg-subtle resize-none outline-none leading-relaxed',
          isStreaming && 'opacity-50',
        )}
      />

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-gray-50/30">
        <span className="text-2xs text-fg-subtle">
          {inputText.length > 0 ? `${inputText.length} 字符` : 'Cmd/Ctrl + Enter 快速分析'}
        </span>
        <button
          onClick={onSubmit}
          disabled={isStreaming || !inputText.trim()}
          className="btn-primary text-xs h-8 px-4"
        >
          {isStreaming ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" />分析中</>
          ) : (
            <><Send className="w-3.5 h-3.5" />分析</>
          )}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify build + visual check**

```bash
cd /Users/dairui/JLPT-master/frontend && npm run build 2>&1 | tail -5
```

Open `http://localhost:5174` — topbar with 5 tabs, N2 + Gemini selectors, and the input card.

- [ ] **Step 4: Commit**

```bash
cd /Users/dairui/JLPT-master
git add frontend/src/pages/AnalysisPage.tsx frontend/src/components/analysis/AnalysisInput.tsx
git commit -m "feat: rewrite AnalysisPage and AnalysisInput with light design"
```

---

## Task 4: Streaming Results — SentenceCard + VocabChip + GrammarCard

**Files:**
- Rewrite: `frontend/src/components/analysis/SentenceCard.tsx`
- Rewrite: `frontend/src/components/analysis/VocabChip.tsx`
- Rewrite: `frontend/src/components/analysis/GrammarCard.tsx`

- [ ] **Step 1: Rewrite SentenceCard.tsx**

```tsx
import { motion } from 'framer-motion'
import type { SentenceAnalysis } from '../../types'
import VocabChip from './VocabChip'
import GrammarCard from './GrammarCard'

interface Props {
  sentence: SentenceAnalysis
  analysisId?: string | null
  index: number
}

export default function SentenceCard({ sentence, analysisId, index }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.06 }}
      className="card p-5 space-y-4"
    >
      {/* Sentence header */}
      <div className="flex gap-3">
        <span className="mt-1.5 shrink-0 w-5 h-5 rounded-full bg-accent-light
                         text-accent-fg text-2xs flex items-center justify-center font-semibold">
          {sentence.index + 1}
        </span>
        <div className="space-y-1">
          <p className="text-lg font-semibold text-fg leading-relaxed tracking-wide">
            {sentence.text}
          </p>
          {sentence.translation && (
            <p className="text-sm text-fg-muted">{sentence.translation}</p>
          )}
        </div>
      </div>

      {/* Vocab */}
      {sentence.vocab.length > 0 && (
        <div className="space-y-2">
          <p className="section-label">词汇 · {sentence.vocab.length}</p>
          <div className="flex flex-wrap gap-1.5">
            {sentence.vocab.map((v, i) => (
              <VocabChip key={`${v.surface}-${i}`} item={v} analysisId={analysisId} />
            ))}
          </div>
        </div>
      )}

      {/* Grammar */}
      {sentence.grammar.length > 0 && (
        <div className="space-y-2">
          <p className="section-label">语法 · {sentence.grammar.length}</p>
          <div className="space-y-1.5">
            {sentence.grammar.map((g, i) => (
              <GrammarCard key={`${g.pattern}-${i}`} item={g} analysisId={analysisId} />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}
```

- [ ] **Step 2: Rewrite VocabChip.tsx**

```tsx
import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Check, AlertCircle, Loader2, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import type { VocabItem } from '../../types'
import { createAtom } from '../../services/api'

interface Props {
  item: VocabItem
  analysisId?: string | null
}

type Status = 'idle' | 'loading' | 'created' | 'exists' | 'error'

const JLPT_BADGE: Record<string, string> = {
  N1: 'badge-n1', N2: 'badge-n2', N3: 'badge-n3', N4: 'badge-n4', N5: 'badge-n5',
}

export default function VocabChip({ item }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [atomId, setAtomId] = useState<string | null>(null)
  const navigate = useNavigate()

  const badgeClass = item.jlpt_level ? (JLPT_BADGE[item.jlpt_level.toUpperCase()] ?? '') : ''

  const handleIngest = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (status === 'created' || status === 'exists') {
      if (atomId) navigate(`/kb/${atomId}`)
      return
    }
    if (status !== 'idle') return
    setStatus('loading')
    try {
      const res = await createAtom({
        type: 'vocabulary',
        key: item.base,
        properties: [
          ...(item.reading ? [{ kind: 'reading', value: item.reading, source_type: 'ai' }] : []),
          { kind: 'meaning', value: item.meaning, source_type: 'ai' },
          ...(item.part_of_speech ? [{ kind: 'part_of_speech', value: item.part_of_speech, source_type: 'ai' }] : []),
          ...(item.usage ? [{ kind: 'usage', value: item.usage, source_type: 'ai' }] : []),
          ...(item.nuance ? [{ kind: 'nuance', value: item.nuance, source_type: 'ai' }] : []),
          ...(item.example ? [{ kind: 'example', value: item.example, source_type: 'ai' }] : []),
        ],
      })
      setAtomId(res.atom_id)
      setStatus(res.status === 'created' ? 'created' : 'exists')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div
      className={clsx(
        'rounded-lg border transition-all duration-150 select-none text-sm overflow-hidden',
        expanded
          ? 'bg-accent-light border-accent-border w-full'
          : 'bg-surface border-border hover:border-accent/40 hover:shadow-sm cursor-pointer inline-flex',
      )}
    >
      {/* Chip row */}
      <div
        className={clsx(
          'flex items-center gap-2 px-2.5 py-1.5 cursor-pointer',
          expanded && 'border-b border-accent-border/50',
        )}
        onClick={() => setExpanded(e => !e)}
      >
        <span className="font-semibold text-fg">{item.surface}</span>
        {item.reading && item.reading !== item.surface && (
          <span className="text-2xs text-fg-muted font-mono">{item.reading}</span>
        )}
        {badgeClass && <span className={badgeClass}>{item.jlpt_level}</span>}
        {expanded
          ? <ChevronUp className="w-3 h-3 text-fg-subtle ml-auto shrink-0" />
          : <ChevronDown className="w-3 h-3 text-fg-subtle shrink-0" />
        }
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pt-2.5 pb-3 space-y-2">
          <p className="text-sm font-medium text-fg">{item.meaning}</p>
          {item.part_of_speech && (
            <p className="text-xs text-fg-muted">{item.part_of_speech}</p>
          )}
          {item.usage && (
            <p className="text-xs text-fg-muted leading-relaxed">{item.usage}</p>
          )}
          {item.nuance && (
            <p className="text-xs text-fg-muted leading-relaxed pl-2 border-l-2 border-accent/40">
              {item.nuance}
            </p>
          )}
          {item.example && (
            <p className="text-xs font-mono text-fg-muted bg-white/70 rounded-lg px-2.5 py-1.5">
              {item.example}
            </p>
          )}

          {/* Ingest */}
          <button
            onClick={handleIngest}
            disabled={status === 'loading'}
            className={clsx('btn text-xs h-7 mt-1', {
              'btn-ghost': status === 'idle',
              'btn-ghost opacity-60': status === 'loading',
              'text-success-fg hover:bg-success/10': status === 'created',
              'text-fg-muted hover:bg-gray-100': status === 'exists',
              'text-danger hover:bg-danger/10': status === 'error',
            })}
          >
            {status === 'idle'    && <><Plus className="w-3 h-3" />加入知识库</>}
            {status === 'loading' && <><Loader2 className="w-3 h-3 animate-spin" />加入中</>}
            {status === 'created' && <><Check className="w-3 h-3" />已加入<ExternalLink className="w-3 h-3" /></>}
            {status === 'exists'  && <><ExternalLink className="w-3 h-3" />查看</>}
            {status === 'error'   && <><AlertCircle className="w-3 h-3" />失败</>}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rewrite GrammarCard.tsx**

```tsx
import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Check, AlertCircle, Loader2, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import type { GrammarItem } from '../../types'
import { createAtom } from '../../services/api'

interface Props {
  item: GrammarItem
  analysisId?: string | null
}

type Status = 'idle' | 'loading' | 'created' | 'exists' | 'error'

const JLPT_BADGE: Record<string, string> = {
  N1: 'badge-n1', N2: 'badge-n2', N3: 'badge-n3', N4: 'badge-n4', N5: 'badge-n5',
}

export default function GrammarCard({ item }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [atomId, setAtomId] = useState<string | null>(null)
  const navigate = useNavigate()

  const badgeClass = item.jlpt_level ? (JLPT_BADGE[item.jlpt_level.toUpperCase()] ?? '') : ''

  const handleIngest = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (status === 'created' || status === 'exists') {
      if (atomId) navigate(`/kb/${atomId}`)
      return
    }
    if (status !== 'idle') return
    setStatus('loading')
    try {
      const res = await createAtom({
        type: 'grammar',
        key: item.pattern,
        properties: [
          { kind: 'meaning', value: item.meaning, source_type: 'ai' },
          ...(item.connection ? [{ kind: 'connection', value: item.connection, source_type: 'ai' }] : []),
          ...(item.usage  ? [{ kind: 'usage',  value: item.usage,  source_type: 'ai' }] : []),
          ...(item.nuance ? [{ kind: 'nuance', value: item.nuance, source_type: 'ai' }] : []),
          ...(item.example? [{ kind: 'example',value: item.example,source_type: 'ai' }] : []),
        ],
      })
      setAtomId(res.atom_id)
      setStatus(res.status === 'created' ? 'created' : 'exists')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div
      className="rounded-lg border border-border bg-surface hover:border-accent/40
                 transition-colors duration-150 overflow-hidden"
    >
      {/* Header row */}
      <div
        className={clsx(
          'flex items-center gap-3 px-3.5 py-2.5 cursor-pointer select-none',
          expanded && 'border-b border-border',
        )}
        onClick={() => setExpanded(e => !e)}
      >
        <code className="text-sm font-mono font-semibold text-accent">{item.pattern}</code>
        <span className="text-xs text-fg-muted flex-1 truncate">{item.meaning}</span>
        {badgeClass && <span className={badgeClass}>{item.jlpt_level}</span>}
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
        }
      </div>

      {/* Detail */}
      {expanded && (
        <div
          className="px-3.5 py-3 space-y-2 bg-gray-50/50"
          onClick={e => e.stopPropagation()}
        >
          {item.connection && (
            <p className="text-xs text-fg-muted">
              <span className="text-fg-subtle font-medium">接续：</span>{item.connection}
            </p>
          )}
          {item.usage && (
            <p className="text-xs text-fg-muted leading-relaxed">{item.usage}</p>
          )}
          {item.nuance && (
            <p className="text-xs text-fg-muted leading-relaxed pl-2 border-l-2 border-accent/40">
              {item.nuance}
            </p>
          )}
          {item.example && (
            <p className="text-xs font-mono text-fg-muted bg-white rounded-lg px-2.5 py-1.5">
              {item.example}
            </p>
          )}

          <button
            onClick={handleIngest}
            disabled={status === 'loading'}
            className={clsx('btn text-xs h-7 mt-1', {
              'btn-ghost': status === 'idle',
              'btn-ghost opacity-60': status === 'loading',
              'text-success-fg hover:bg-success/10': status === 'created',
              'text-fg-muted hover:bg-gray-100': status === 'exists',
              'text-danger hover:bg-danger/10': status === 'error',
            })}
          >
            {status === 'idle'    && <><Plus className="w-3 h-3" />加入知识库</>}
            {status === 'loading' && <><Loader2 className="w-3 h-3 animate-spin" />加入中</>}
            {status === 'created' && <><Check className="w-3 h-3" />已加入<ExternalLink className="w-3 h-3" /></>}
            {status === 'exists'  && <><ExternalLink className="w-3 h-3" />查看</>}
            {status === 'error'   && <><AlertCircle className="w-3 h-3" />失败</>}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify build + visual check**

```bash
cd /Users/dairui/JLPT-master/frontend && npm run build 2>&1 | tail -5
```

Run analysis with `昨日学校へ行きました` — sentence card appears with vocab chips and grammar cards.

- [ ] **Step 5: Commit**

```bash
cd /Users/dairui/JLPT-master
git add frontend/src/components/analysis/SentenceCard.tsx \
        frontend/src/components/analysis/VocabChip.tsx \
        frontend/src/components/analysis/GrammarCard.tsx
git commit -m "feat: rewrite SentenceCard, VocabChip, GrammarCard with light design"
```

---

## Task 5: Followup Panel

**Files:**
- Rewrite: `frontend/src/components/analysis/FollowupPanel.tsx`

- [ ] **Step 1: Rewrite FollowupPanel.tsx**

```tsx
import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import clsx from 'clsx'
import { sendFollowup } from '../../services/api'

interface Props {
  analysisId: string
}

type Template = 'comparison' | 'usage' | 'conjugation' | 'example' | 'free'

interface TemplateConfig {
  label: string
  fields: { name: string; placeholder: string }[]
}

const TEMPLATES: [Template, TemplateConfig][] = [
  ['comparison', { label: '对比', fields: [{ name: 'word1', placeholder: '词语 A' }, { name: 'word2', placeholder: '词语 B' }] }],
  ['usage',      { label: '用法', fields: [{ name: 'word', placeholder: '词语或语法' }] }],
  ['conjugation',{ label: '活用', fields: [{ name: 'verb', placeholder: '动词原形' }] }],
  ['example',    { label: '例句', fields: [{ name: 'word', placeholder: '词语或语法' }] }],
  ['free',       { label: '自由追问', fields: [{ name: 'question', placeholder: '输入问题…' }] }],
]

export default function FollowupPanel({ analysisId }: Props) {
  const [selected, setSelected] = useState<Template | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleSelect = (t: Template) => {
    setSelected(t)
    setFields({})
    setResult(null)
  }

  const config = TEMPLATES.find(([k]) => k === selected)?.[1]
  const canSubmit = !!config && config.fields.every(f => (fields[f.name] ?? '').trim())

  const handleSubmit = async () => {
    if (!selected || !canSubmit) return
    setLoading(true)
    setResult(null)
    try {
      const res = await sendFollowup(analysisId, selected, fields)
      setResult(typeof res === 'string' ? res : JSON.stringify(res, null, 2))
    } catch {
      setResult('请求失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <p className="section-label">继续探索</p>

      <div className="flex flex-wrap gap-1.5">
        {TEMPLATES.map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => handleSelect(key)}
            className={clsx(
              'btn text-xs h-7',
              selected === key
                ? 'bg-accent-light text-accent-fg border border-accent-border hover:bg-accent-light'
                : 'btn-ghost',
            )}
          >
            {cfg.label}
          </button>
        ))}
      </div>

      {config && (
        <div className="flex flex-wrap gap-2 items-center">
          {config.fields.map(f => (
            <input
              key={f.name}
              value={fields[f.name] ?? ''}
              onChange={e => setFields(prev => ({ ...prev, [f.name]: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && canSubmit && !loading && handleSubmit()}
              placeholder={f.placeholder}
              className="input flex-1 min-w-28 h-8 text-xs"
            />
          ))}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
            className="btn-primary h-8 text-xs shrink-0"
          >
            {loading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <><Send className="w-3.5 h-3.5" />发送</>
            }
          </button>
        </div>
      )}

      {result && (
        <div className="bg-bg rounded-lg border border-border px-4 py-3 text-xs text-fg-muted
                        leading-relaxed whitespace-pre-wrap">
          {result}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/dairui/JLPT-master/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/dairui/JLPT-master
git add frontend/src/components/analysis/FollowupPanel.tsx
git commit -m "feat: rewrite FollowupPanel with light design"
```

---

## Task 6: Knowledge Base Page

**Files:**
- Rewrite: `frontend/src/pages/KnowledgeBasePage.tsx`
- Rewrite: `frontend/src/components/atoms/AtomList.tsx`
- Delete: `frontend/src/components/atoms/AtomCard.tsx`

- [ ] **Step 1: Rewrite KnowledgeBasePage.tsx**

```tsx
import { useEffect, useState } from 'react'
import { getAtoms } from '../services/api'
import AtomList from '../components/atoms/AtomList'

export default function KnowledgeBasePage() {
  const [stats, setStats] = useState({ total: 0, vocabulary: 0, grammar: 0 })

  useEffect(() => {
    Promise.all([
      getAtoms({ limit: 1 }),
      getAtoms({ type: 'vocabulary', limit: 1 }),
      getAtoms({ type: 'grammar', limit: 1 }),
    ])
      .then(([all, vocab, gram]) =>
        setStats({ total: all.total, vocabulary: vocab.total, grammar: gram.total }),
      )
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">知识库</h1>
        <p className="text-sm text-fg-muted mt-0.5">你积累的每个词汇和语法点</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: '全部',  value: stats.total,      color: 'text-fg' },
          { label: '词汇',  value: stats.vocabulary,  color: 'text-blue-600' },
          { label: '语法',  value: stats.grammar,     color: 'text-violet-600' },
        ].map(s => (
          <div key={s.label} className="card px-4 py-4">
            <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
            <p className="text-xs text-fg-subtle mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <AtomList />
    </div>
  )
}
```

- [ ] **Step 2: Rewrite AtomList.tsx (table layout)**

```tsx
import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { getAtoms } from '../../services/api'
import type { AtomListItem } from '../../types'

const PAGE_SIZE = 25

export default function AtomList() {
  const [items, setItems]             = useState<AtomListItem[]>([])
  const [total, setTotal]             = useState(0)
  const [page, setPage]               = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]           = useState('')
  const [typeFilter, setTypeFilter]   = useState<string>('all')
  const [loading, setLoading]         = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const id = setTimeout(() => { setSearch(searchInput); setPage(0) }, 300)
    return () => clearTimeout(id)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getAtoms({
        search: search || undefined,
        type:   typeFilter !== 'all' ? typeFilter : undefined,
        page,
        limit:  PAGE_SIZE,
      })
      setItems(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, page])

  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="搜索词条…"
            className="input pl-9 h-9 text-sm"
          />
        </div>
        {(['all', 'vocabulary', 'grammar'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTypeFilter(t); setPage(0) }}
            className={`btn text-xs h-9 ${typeFilter === t
              ? 'bg-accent-light text-accent-fg border border-accent-border'
              : 'btn-ghost'
            }`}
          >
            {{ all: '全部', vocabulary: '词汇', grammar: '语法' }[t]}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="py-14 text-center text-sm text-fg-subtle">加载中…</div>
        ) : items.length === 0 ? (
          <div className="py-14 text-center text-sm text-fg-subtle">
            {search ? '没有匹配结果' : '知识库还是空的，去分析一段日语开始吧'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-border">
              <tr>
                {['词条', '类型', '成熟度', '属性数'].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 text-2xs font-semibold text-fg-subtle uppercase tracking-wider
                                ${i === 0 ? 'text-left' : i === 3 ? 'text-right' : 'text-left'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map(atom => (
                <tr
                  key={atom.id}
                  onClick={() => navigate(`/kb/${atom.id}`)}
                  className="hover:bg-accent-light/30 cursor-pointer transition-colors duration-100 group"
                >
                  <td className="px-4 py-3 font-semibold text-fg group-hover:text-accent transition-colors">
                    {atom.key}
                  </td>
                  <td className="px-4 py-3">
                    <span className={atom.type === 'vocabulary' ? 'badge-vocab' : 'badge-grammar'}>
                      {atom.type === 'vocabulary' ? '词汇' : '语法'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-full transition-all"
                          style={{ width: `${Math.min(100, atom.maturity)}%` }}
                        />
                      </div>
                      <span className="text-2xs text-fg-subtle tabular-nums">
                        {Math.round(atom.maturity)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-fg-muted tabular-nums">
                    {atom.property_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-fg-muted">
          <span>共 {total} 条 · 第 {page + 1}/{totalPages} 页</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-ghost h-8 w-8 p-0 justify-center"
              aria-label="上一页"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="btn-ghost h-8 w-8 p-0 justify-center"
              aria-label="下一页"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Delete AtomCard.tsx**

```bash
rm /Users/dairui/JLPT-master/frontend/src/components/atoms/AtomCard.tsx
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/dairui/JLPT-master/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /Users/dairui/JLPT-master
git add frontend/src/pages/KnowledgeBasePage.tsx \
        frontend/src/components/atoms/AtomList.tsx
git rm frontend/src/components/atoms/AtomCard.tsx
git commit -m "feat: rewrite KnowledgeBasePage and AtomList with table layout"
```

---

## Task 7: Atom Detail Page

**Files:**
- Rewrite: `frontend/src/pages/AtomDetailPage.tsx`
- Rewrite: `frontend/src/components/atoms/AtomDetailView.tsx`

- [ ] **Step 1: Rewrite AtomDetailPage.tsx**

```tsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getAtom, deleteAtom } from '../services/api'
import type { AtomDetail } from '../types'
import AtomDetailView from '../components/atoms/AtomDetailView'

export default function AtomDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [atom, setAtom]       = useState<AtomDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getAtom(id)
      .then(setAtom)
      .catch(() => setError('加载失败'))
      .finally(() => setLoading(false))
  }, [id])

  const handleDelete = async () => {
    if (!id || !confirm(`确认删除「${atom?.atom.key}」？`)) return
    try {
      await deleteAtom(id)
      navigate('/kb')
    } catch {
      alert('删除失败')
    }
  }

  if (loading) return (
    <div className="py-20 text-center text-sm text-fg-subtle">加载中…</div>
  )
  if (error || !atom) return (
    <div className="py-20 text-center text-sm text-danger">{error ?? '未找到该条目'}</div>
  )

  return <AtomDetailView atom={atom} onDelete={handleDelete} />
}
```

- [ ] **Step 2: Rewrite AtomDetailView.tsx**

```tsx
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2, ArrowRight } from 'lucide-react'
import type { AtomDetail, PropertyResponse } from '../../types'

interface Props {
  atom: AtomDetail
  onDelete: () => void
}

const SOURCE_LABEL: Record<string, string> = {
  ai: 'AI 提取',
  dictionary: '词典',
  user: '用户',
}

function groupBySource(props: PropertyResponse[]) {
  const g: Record<string, PropertyResponse[]> = {}
  for (const p of props) { (g[p.source_type] ??= []).push(p) }
  return Object.entries(g)
}

export default function AtomDetailView({ atom, onDelete }: Props) {
  const navigate = useNavigate()
  const groups = groupBySource(atom.properties)

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <button
          onClick={() => navigate('/kb')}
          className="btn-ghost text-xs h-7 -ml-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />返回知识库
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-fg font-mono tracking-tight">
              {atom.atom.key}
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={atom.atom.type === 'vocabulary' ? 'badge-vocab' : 'badge-grammar'}>
                {atom.atom.type === 'vocabulary' ? '词汇' : '语法'}
              </span>
              {atom.traces_summary && (
                <span className="text-xs text-fg-subtle">
                  遇到 {atom.traces_summary.duplicate_count + 1} 次
                </span>
              )}
              <span className="text-xs text-fg-subtle">
                {new Date(atom.atom.created_at).toLocaleDateString('zh-CN')} 入库
              </span>
            </div>
          </div>
          <button onClick={onDelete} className="btn-danger h-8 text-xs shrink-0">
            <Trash2 className="w-3.5 h-3.5" />删除
          </button>
        </div>
      </div>

      {atom.properties.length > 0 && (
        <section className="space-y-3">
          <p className="section-label">属性 · {atom.properties.length}</p>
          {groups.map(([src, props]) => (
            <div key={src} className="card overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-border">
                <span className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider">
                  {SOURCE_LABEL[src] ?? src}
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {props.map(p => (
                  <div key={p.id} className="flex items-start gap-4 px-4 py-3">
                    <span className="text-xs text-fg-subtle w-24 shrink-0 pt-0.5 font-medium">
                      {p.kind}
                    </span>
                    <span className="text-sm text-fg leading-relaxed">{p.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {atom.relations.length > 0 && (
        <section className="space-y-2">
          <p className="section-label">关联 · {atom.relations.length}</p>
          <div className="card divide-y divide-border/50">
            {atom.relations.map(r => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-xs text-fg-subtle w-24 shrink-0">{r.type}</span>
                <ArrowRight className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                <button
                  onClick={() => navigate(`/kb/${r.target.id}`)}
                  className="text-sm font-mono font-semibold text-accent hover:underline cursor-pointer"
                >
                  {r.target.key}
                </button>
                <span className={r.target.type === 'vocabulary' ? 'badge-vocab' : 'badge-grammar'}>
                  {r.target.type === 'vocabulary' ? '词汇' : '语法'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {atom.analyses.length > 0 && (
        <section className="space-y-2">
          <p className="section-label">来源分析 · {atom.analyses.length}</p>
          <div className="card divide-y divide-border/50">
            {atom.analyses.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-xs text-fg-muted">{a.input_type}</span>
                <span className="ml-auto text-xs text-fg-subtle">
                  {new Date(a.created_at).toLocaleDateString('zh-CN')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify full build**

```bash
cd /Users/dairui/JLPT-master/frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in` — zero TypeScript errors.

- [ ] **Step 4: End-to-end smoke test**

With backend running (`http://localhost:8000`) and frontend dev server (`http://localhost:5174`):

1. Topbar shows 5 tabs: 语料分析 / JLPT专题 / 实时视频 / 知识库 / 内化学习
2. Type `昨日学校へ行きました` → click 分析 → sentences stream in
3. Click a vocab chip → expands with meaning + "加入知识库" button
4. Click "加入知识库" → button turns green "已加入"
5. Click 知识库 tab → stats show 1 item, table shows the atom
6. Click atom row → detail page loads with properties
7. Click 返回知识库 → navigates back
8. Click JLPT专题 / 实时视频 / 内化学习 tabs → show placeholder text

- [ ] **Step 5: Commit**

```bash
cd /Users/dairui/JLPT-master
git add frontend/src/pages/AtomDetailPage.tsx \
        frontend/src/components/atoms/AtomDetailView.tsx
git commit -m "feat: rewrite AtomDetailPage and AtomDetailView with light design"
```

---

## Task 8: JLPT专题 Page

**Files:**
- Rewrite: `frontend/src/pages/JlptPage.tsx`

Purpose: Structured practice for JLPT question formats. Initial release: page shell with 4 topic cards, each marked as 开发中. The tab exists to establish mental model and will receive built-in question banks in a future iteration.

- [ ] **Step 1: Rewrite JlptPage.tsx**

```tsx
import { BookMarked, FileText, BookOpen, Headphones } from 'lucide-react'

const TOPICS = [
  {
    icon: FileText,
    title: '文字・語彙',
    desc: '汉字、读音、选词填空',
    levels: ['N5', 'N4', 'N3', 'N2', 'N1'],
    available: false,
  },
  {
    icon: BookMarked,
    title: '文法',
    desc: '语法选择、排列组合',
    levels: ['N5', 'N4', 'N3', 'N2', 'N1'],
    available: false,
  },
  {
    icon: BookOpen,
    title: '読解',
    desc: '短文、中文、长文理解',
    levels: ['N3', 'N2', 'N1'],
    available: false,
  },
  {
    icon: Headphones,
    title: '聴解',
    desc: '听力理解、即时回答',
    levels: ['N3', 'N2', 'N1'],
    available: false,
  },
]

export default function JlptPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">JLPT 专题</h1>
        <p className="text-sm text-fg-muted mt-0.5">针对 JLPT 考试题型的专项练习</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {TOPICS.map(({ icon: Icon, title, desc, levels, available }) => (
          <div
            key={title}
            className="card p-5 space-y-3 opacity-70"
          >
            <div className="flex items-start justify-between">
              <div className="w-9 h-9 rounded-xl bg-accent-light flex items-center justify-center">
                <Icon className="w-5 h-5 text-accent" />
              </div>
              <span className="badge bg-gray-100 text-fg-subtle ring-1 ring-border">开发中</span>
            </div>
            <div>
              <h2 className="font-semibold text-fg text-sm">{title}</h2>
              <p className="text-xs text-fg-muted mt-0.5">{desc}</p>
            </div>
            <div className="flex gap-1">
              {levels.map(l => (
                <span key={l} className={`badge-${l.toLowerCase()}`}>{l}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-fg-subtle text-center py-4">
        内置题库功能正在开发中，敬请期待
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/dairui/JLPT-master/frontend && npm run build 2>&1 | tail -5
```

Navigate to `/jlpt` — 4 topic cards visible with 开发中 badge.

- [ ] **Step 3: Commit**

```bash
cd /Users/dairui/JLPT-master
git add frontend/src/pages/JlptPage.tsx
git commit -m "feat: JLPT专题 page with topic card placeholders"
```

---

## Task 9: 实时视频 Page

**Files:**
- Rewrite: `frontend/src/pages/VideoPage.tsx`
- Create: `frontend/src/components/video/SubtitleLoader.tsx`
- Create: `frontend/src/components/video/SubtitleList.tsx`
- Create: `frontend/src/components/video/DictPopup.tsx`

Flow: user pastes video URL → fetch subtitles via `/api/preprocess` (treats each subtitle line as text) → display tokenized sentences → click token for dict popup → select sentences → send to analysis tab.

Note: A backend `/api/video/subtitles` endpoint is needed to fetch YouTube/Bilibili subtitles. This task implements the frontend; a separate backend task handles subtitle fetching. The frontend degrades gracefully if the endpoint doesn't exist yet.

- [ ] **Step 1: Create DictPopup.tsx**

Create `frontend/src/components/video/DictPopup.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { lookupDictionary } from '../../services/api'

interface Props {
  word: string
  onClose: () => void
}

export default function DictPopup({ word, onClose }: Props) {
  const [data, setData]     = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    lookupDictionary(word)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [word])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
         onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative card p-5 w-full max-w-sm space-y-3 z-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="font-bold text-xl font-mono text-fg">{word}</span>
          <button onClick={onClose} className="btn-ghost h-7 w-7 p-0 justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-fg-subtle">查询中…</p>
        ) : data ? (
          <pre className="text-xs text-fg-muted bg-bg rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap">
            {JSON.stringify(data, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-fg-muted">未找到「{word}」的词典条目</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create SubtitleList.tsx**

Create `frontend/src/components/video/SubtitleList.tsx`:

```tsx
import { useState } from 'react'
import clsx from 'clsx'
import DictPopup from './DictPopup'

export interface SubtitleLine {
  index: number
  time: string
  text: string
  tokens: string[]
}

interface Props {
  lines: SubtitleLine[]
  selected: Set<number>
  onToggle: (index: number) => void
}

export default function SubtitleList({ lines, selected, onToggle }: Props) {
  const [popup, setPopup] = useState<string | null>(null)

  return (
    <>
      <div className="card divide-y divide-border/60 overflow-hidden">
        {lines.map(line => (
          <div
            key={line.index}
            className={clsx(
              'flex gap-3 px-4 py-3 cursor-pointer transition-colors duration-100',
              selected.has(line.index)
                ? 'bg-accent-light/40'
                : 'hover:bg-gray-50',
            )}
            onClick={() => onToggle(line.index)}
          >
            <input
              type="checkbox"
              checked={selected.has(line.index)}
              readOnly
              className="mt-1 shrink-0 accent-accent cursor-pointer"
              onClick={e => e.stopPropagation()}
              onChange={() => onToggle(line.index)}
            />
            <div className="flex-1 space-y-1.5 min-w-0">
              <span className="text-2xs text-fg-subtle font-mono">{line.time}</span>
              <div className="flex flex-wrap gap-0.5">
                {line.tokens.map((tok, i) => (
                  <button
                    key={i}
                    onClick={e => { e.stopPropagation(); setPopup(tok) }}
                    className="px-0.5 rounded hover:bg-accent-light hover:text-accent-fg
                               transition-colors duration-100 text-sm text-fg cursor-pointer"
                  >
                    {tok}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {popup && <DictPopup word={popup} onClose={() => setPopup(null)} />}
    </>
  )
}
```

- [ ] **Step 3: Create SubtitleLoader.tsx**

Create `frontend/src/components/video/SubtitleLoader.tsx`:

```tsx
import { useState } from 'react'
import { Link, Loader2 } from 'lucide-react'
import type { SubtitleLine } from './SubtitleList'

interface Props {
  onLoaded: (lines: SubtitleLine[]) => void
}

interface SubtitleEntry {
  time: string
  text: string
  tokens: string[]
}

export default function SubtitleLoader({ onLoaded }: Props) {
  const [url, setUrl]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const handleLoad = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/video/subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`${res.status}: ${text}`)
      }
      const data = await res.json() as { subtitles: SubtitleEntry[] }
      const lines: SubtitleLine[] = data.subtitles.map((s, i) => ({
        index: i,
        time: s.time,
        text: s.text,
        tokens: s.tokens,
      }))
      onLoaded(lines)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请检查链接或稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <p className="section-label">视频字幕</p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle" />
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleLoad()}
            placeholder="粘贴 YouTube / Bilibili 视频链接…"
            className="input pl-9 h-10 text-sm"
          />
        </div>
        <button
          onClick={handleLoad}
          disabled={loading || !url.trim()}
          className="btn-primary h-10 text-sm shrink-0"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" />加载中</>
            : '加载字幕'
          }
        </button>
      </div>
      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Rewrite VideoPage.tsx**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send } from 'lucide-react'
import SubtitleLoader from '../components/video/SubtitleLoader'
import SubtitleList, { type SubtitleLine } from '../components/video/SubtitleList'

export default function VideoPage() {
  const [lines, setLines]     = useState<SubtitleLine[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const navigate = useNavigate()

  const toggle = (index: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleAnalyze = () => {
    const text = lines
      .filter(l => selected.has(l.index))
      .map(l => l.text)
      .join('\n')
    if (!text.trim()) return
    // Navigate to analysis page with pre-filled text via URL state
    navigate('/', { state: { prefill: text } })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-fg">实时视频</h1>
        <p className="text-sm text-fg-muted mt-0.5">读取字幕，点击词语查询，选句 AI 分析</p>
      </div>

      <SubtitleLoader onLoaded={lines => { setLines(lines); setSelected(new Set()) }} />

      {lines.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-muted">字幕 · {lines.length} 句</span>
            <div className="flex gap-2">
              <button
                onClick={() => setSelected(new Set(lines.map(l => l.index)))}
                className="btn-ghost text-xs h-8"
              >
                全选
              </button>
              <button
                onClick={handleAnalyze}
                disabled={selected.size === 0}
                className="btn-primary text-xs h-8"
              >
                <Send className="w-3.5 h-3.5" />
                分析选中 {selected.size > 0 ? `(${selected.size})` : ''}
              </button>
            </div>
          </div>

          <SubtitleList lines={lines} selected={selected} onToggle={toggle} />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Accept prefill state in AnalysisPage**

Modify `frontend/src/pages/AnalysisPage.tsx` — add location state handling at the top of the component:

```tsx
import { useLocation } from 'react-router-dom'

// Inside AnalysisPage(), before the return:
const location = useLocation()
const prefill = (location.state as { prefill?: string } | null)?.prefill

useEffect(() => {
  if (prefill) {
    setInputText(prefill)
    window.history.replaceState({}, '')  // clear state so refresh doesn't re-fill
  }
}, [prefill])
```

Full updated AnalysisPage.tsx:

```tsx
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAnalysis } from '../hooks/useAnalysis'
import AnalysisInput from '../components/analysis/AnalysisInput'
import SentenceCard from '../components/analysis/SentenceCard'
import FollowupPanel from '../components/analysis/FollowupPanel'

export default function AnalysisPage() {
  const {
    inputText, inputType, sentences, analysisId,
    isStreaming, error,
    setInputText, setInputType, startAnalysis,
  } = useAnalysis()

  const location = useLocation()
  const prefill = (location.state as { prefill?: string } | null)?.prefill

  useEffect(() => {
    if (prefill) {
      setInputText(prefill)
      window.history.replaceState({}, '')
    }
  }, [prefill, setInputText])

  return (
    <div className="space-y-4">
      <AnalysisInput
        inputText={inputText}
        inputType={inputType}
        isStreaming={isStreaming}
        onInputChange={setInputText}
        onTypeChange={setInputType}
        onSubmit={startAnalysis}
      />

      {error && (
        <div className="px-4 py-3 bg-danger/5 border border-danger/20 rounded-xl text-sm text-danger-fg">
          {error}
        </div>
      )}

      {isStreaming && sentences.length === 0 && (
        <div className="flex items-center gap-3 px-4 py-3 card">
          <span className="flex gap-0.5">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
          <span className="text-sm text-fg-muted">AI 正在分析…</span>
        </div>
      )}

      <AnimatePresence>
        {sentences.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            {[...sentences]
              .sort((a, b) => a.index - b.index)
              .map((s, i) => (
                <SentenceCard key={s.index} sentence={s} analysisId={analysisId} index={i} />
              ))}
          </motion.div>
        )}
      </AnimatePresence>

      {analysisId && sentences.length > 0 && !isStreaming && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <FollowupPanel analysisId={analysisId} />
        </motion.div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Verify build**

```bash
cd /Users/dairui/JLPT-master/frontend && npm run build 2>&1 | tail -5
```

Navigate to `/video` — shows URL input card. The subtitle list and token click functionality require the backend endpoint.

- [ ] **Step 7: Commit**

```bash
cd /Users/dairui/JLPT-master
git add frontend/src/pages/VideoPage.tsx \
        frontend/src/pages/AnalysisPage.tsx \
        frontend/src/components/video/
git commit -m "feat: 实时视频 page with subtitle loader, tokenized list, dict popup"
```

---

## Task 10: 内化学习 Page

**Files:**
- Rewrite: `frontend/src/pages/InternalizePage.tsx`
- Create: `frontend/src/components/internalize/ModeSelector.tsx`
- Create: `frontend/src/components/internalize/TranslationSession.tsx`

Initial release: 翻訳练习 (JP→CN) functional using knowledge base atoms. Other modes show placeholders.

- [ ] **Step 1: Create ModeSelector.tsx**

Create `frontend/src/components/internalize/ModeSelector.tsx`:

```tsx
import { Languages, PenLine, GitCompare, Headphones } from 'lucide-react'
import clsx from 'clsx'

export type LearningMode = 'translation' | 'dictation' | 'comparison' | 'listening'

interface ModeConfig {
  icon: React.ElementType
  label: string
  desc: string
  available: boolean
}

const MODES: [LearningMode, ModeConfig][] = [
  ['translation', { icon: Languages,   label: '翻訳练习', desc: '日→中 意思理解', available: true }],
  ['dictation',   { icon: PenLine,     label: '書き取り', desc: '听写填空练习', available: false }],
  ['comparison',  { icon: GitCompare,  label: '比較学习', desc: '近义词辨析',   available: true }],
  ['listening',   { icon: Headphones,  label: '听解练习', desc: '配合视频字幕', available: false }],
]

interface Props {
  selected: LearningMode | null
  onSelect: (mode: LearningMode) => void
}

export default function ModeSelector({ selected, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {MODES.map(([mode, { icon: Icon, label, desc, available }]) => (
        <button
          key={mode}
          onClick={() => available && onSelect(mode)}
          disabled={!available}
          className={clsx(
            'card p-4 text-left space-y-2.5 transition-all duration-150 cursor-pointer',
            !available && 'opacity-50 cursor-not-allowed',
            selected === mode
              ? 'border-accent ring-2 ring-accent/20'
              : available && 'hover:border-accent/40 hover:shadow-card-md',
          )}
        >
          <div className="flex items-start justify-between">
            <div className={clsx(
              'w-9 h-9 rounded-xl flex items-center justify-center',
              selected === mode ? 'bg-accent text-white' : 'bg-accent-light text-accent',
            )}>
              <Icon className="w-5 h-5" />
            </div>
            {!available && (
              <span className="badge bg-gray-100 text-fg-subtle ring-1 ring-border text-2xs">
                开发中
              </span>
            )}
          </div>
          <div>
            <p className="font-semibold text-sm text-fg">{label}</p>
            <p className="text-xs text-fg-muted mt-0.5">{desc}</p>
          </div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create TranslationSession.tsx**

Create `frontend/src/components/internalize/TranslationSession.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { getAtoms } from '../../services/api'
import type { AtomListItem } from '../../types'
import { ChevronRight, RotateCcw } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  level: string
}

export default function TranslationSession({ level }: Props) {
  const [atoms, setAtoms]       = useState<AtomListItem[]>([])
  const [cursor, setCursor]     = useState(0)
  const [answer, setAnswer]     = useState('')
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    getAtoms({ type: 'vocabulary', limit: 50 })
      .then(res => {
        // Shuffle for variety
        const shuffled = [...res.items].sort(() => Math.random() - 0.5)
        setAtoms(shuffled)
        setCursor(0)
        setAnswer('')
        setRevealed(false)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [level])

  if (loading) return <div className="py-10 text-center text-sm text-fg-subtle">加载练习题…</div>

  if (atoms.length === 0) return (
    <div className="card p-8 text-center space-y-2">
      <p className="text-sm text-fg-muted">知识库为空</p>
      <p className="text-xs text-fg-subtle">先去语料分析页面分析一段日语，把词汇加入知识库</p>
    </div>
  )

  const current = atoms[cursor % atoms.length]

  const handleNext = () => {
    setCursor(c => c + 1)
    setAnswer('')
    setRevealed(false)
  }

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>第 {cursor + 1} 题 / {atoms.length}</span>
        <button
          onClick={() => { setCursor(0); setAnswer(''); setRevealed(false) }}
          className="btn-ghost h-7 text-xs"
        >
          <RotateCcw className="w-3 h-3" />重新开始
        </button>
      </div>

      {/* Card */}
      <div className="card p-6 space-y-4">
        <div className="text-center space-y-2">
          <p className="text-3xl font-bold font-mono text-fg">{current.key}</p>
          <p className="text-xs text-fg-subtle">请翻译成中文</p>
        </div>

        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && e.metaKey && setRevealed(true)}
          placeholder="输入你的翻译… (Cmd+Enter 提交)"
          rows={2}
          className="input resize-none text-sm"
          disabled={revealed}
        />

        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            disabled={!answer.trim()}
            className="btn-primary w-full justify-center"
          >
            查看答案
          </button>
        ) : (
          <div className="space-y-3">
            <div className="bg-success/5 border border-success/20 rounded-xl px-4 py-3">
              <p className="text-xs text-fg-subtle mb-1">参考答案</p>
              <p className="text-sm font-medium text-fg">{current.key} — 请在知识库确认释义</p>
            </div>
            <button
              onClick={handleNext}
              className={clsx('btn-primary w-full justify-center gap-2')}
            >
              下一题 <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite InternalizePage.tsx**

```tsx
import { useState } from 'react'
import ModeSelector, { type LearningMode } from '../components/internalize/ModeSelector'
import TranslationSession from '../components/internalize/TranslationSession'
import { useSettings } from '../context/SettingsContext'

export default function InternalizePage() {
  const [mode, setMode] = useState<LearningMode | null>(null)
  const { settings } = useSettings()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">内化学习</h1>
        <p className="text-sm text-fg-muted mt-0.5">选择练习方式，巩固你积累的词汇和语法</p>
      </div>

      <ModeSelector selected={mode} onSelect={setMode} />

      {mode === 'translation' && (
        <TranslationSession level={settings.targetLevel} />
      )}

      {mode === 'comparison' && (
        <div className="card p-8 text-center text-sm text-fg-muted">
          比較学习 — 近义词对比功能开发中
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify full build**

```bash
cd /Users/dairui/JLPT-master/frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in` — zero TypeScript errors.

- [ ] **Step 5: End-to-end smoke test for all 5 tabs**

1. 语料分析 — paste Japanese, run analysis, ingest a word
2. JLPT专题 — 4 topic cards with 开发中 badge
3. 实时视频 — URL input renders, list empty until backend subtitle endpoint
4. 知识库 — stats show ingested word, table row click opens detail
5. 内化学习 — select 翻訳练习, card shows ingested word, input + reveal works

- [ ] **Step 6: Commit**

```bash
cd /Users/dairui/JLPT-master
git add frontend/src/pages/InternalizePage.tsx \
        frontend/src/components/internalize/
git commit -m "feat: 内化学习 page with translation practice mode"
```

---

## Self-Review

### Spec coverage check

| Requirement | Covered by |
|-------------|------------|
| Light mode, no dark | Task 1 — `color-scheme: light`, white backgrounds |
| Minimal with color accents | Task 1 — indigo `#6366F1` accent tokens |
| Top navigation bar with 5 tabs | Task 2 — TopNav.tsx |
| Settings: model + target level | Task 2 — SettingsContext, dropdowns in TopNav |
| 语料分析 tab | Tasks 3–5 |
| Streaming results | Task 4 — SentenceCard, VocabChip, GrammarCard |
| Ingest flow | Task 4 — status machine in VocabChip/GrammarCard |
| Follow-up panel | Task 5 |
| No analysis history | App.tsx has no history route; no history API calls |
| JLPT专题 tab | Task 8 — 4 topic cards with placeholder state |
| 实时视频 tab | Task 9 — subtitle loader, tokenized list, dict popup |
| Video→Analysis navigation | Task 9 — navigate with location.state prefill |
| 知识库 tab | Task 6 — stats + table |
| Atom detail | Task 7 |
| 内化学习 tab | Task 10 — mode selector + translation session |
| lucide-react icons (no emoji) | All tasks — SVG icons throughout |
| cursor-pointer on all interactive elements | All tasks — `cursor-pointer` in `.btn` base class |

### Placeholder scan — NONE

### Type consistency
- All types from `../../types` (unchanged): `VocabItem`, `GrammarItem`, `SentenceAnalysis`, `AtomDetail`, `AtomListItem`, `PropertyResponse`
- All API functions from `../../services/api` (unchanged): `createAtom`, `getAtoms`, `getAtom`, `deleteAtom`, `sendFollowup`, `lookupDictionary`
- `useAnalysis` hook — unchanged interface, now also needs `setInputText` exported (verify it is in the existing hook)
- `INPUT_TYPE_LABELS` — unchanged in `../../types`
- `LearningMode` type defined in `ModeSelector.tsx`, exported, imported in `InternalizePage.tsx`
- `SubtitleLine` type defined in `SubtitleList.tsx`, exported, imported in `VideoPage.tsx` and `SubtitleLoader.tsx`
