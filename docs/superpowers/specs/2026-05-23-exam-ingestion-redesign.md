# Exam Ingestion & DB Redesign

**Date**: 2026-05-23  
**Status**: Approved for implementation

---

## Problem

The current exam data pipeline is a two-step offline process (PDF → Markdown → JSON → seed script) with no human review. This causes three classes of errors that compound:

1. **OCR errors**: Gemini misreads characters, special formats (★ position, furigana, tables)
2. **Type misclassification**: Question type is inferred from content; AI makes mistakes
3. **Answer mismatches**: Answer parsing is fragile and sometimes produces no answers

Current DB schema is also under-granular: `ExamSection → ExamQuestion` collapses the real 4-level structure of JLPT exams, losing the 問題N grouping and making type-per-problem impossible to enforce.

---

## Solution Overview

1. **Redesign DB** to 4-layer structure matching real exam hierarchy
2. **Add admin ingestion UI** with AI-assisted draft + human review + confirm flow
3. **Support media**: images (reading), transcript text (listening, no audio)

---

## Database Schema

### Layer hierarchy

```
ExamPaper
  └── ExamSection          (4 fixed sections)
        └── ExamProblem    (問題N — NEW layer)
              └── ExamItem (individual questions, renamed from ExamQuestion)
```

Plus: `ExamMedia` for image attachments, `ExamDraft` for in-progress ingestion.

---

### ExamPaper (unchanged)
```sql
id UUID PK
title       TEXT NOT NULL
level       TEXT NOT NULL  -- N1..N5
source      TEXT           -- "2015年07月"
created_at  TIMESTAMPTZ DEFAULT now()
```

---

### ExamSection (unchanged)
```sql
id UUID PK
paper_id    UUID REFERENCES ExamPaper
seq         INT NOT NULL
name        TEXT NOT NULL
-- 言語知識（文字・語彙）/ 言語知識（文法）/ 読解 / 聴解
```

---

### ExamProblem (NEW)
```sql
id UUID PK
section_id  UUID REFERENCES ExamSection
seq         INT NOT NULL   -- ordering within section
name        TEXT NOT NULL  -- "問題1", "問題2", …
type        TEXT NOT NULL  -- AI-suggested, human-editable; see type list below
instruction TEXT           -- 指示語 original text from exam
passage     TEXT           -- long text (reading_comp / passage_fill)
transcript  TEXT           -- listening transcript (replaces audio)
```

**Problem types** (determined by content, not by 問題 number):
`kanji_reading`, `kanji_writing`, `word_formation`, `vocab_fill`, `synonym`,
`usage`, `grammar_fill`, `sentence_order`, `passage_fill`, `reading_comp`, `listening`

**Multiple passages under one 問題N**: create multiple ExamProblems with the same `name`
(e.g., three ExamProblems all named "問題13", each with its own passage and items).
The UI groups them visually by `name`.

---

### ExamItem (renamed from ExamQuestion)
```sql
id UUID PK
problem_id      UUID REFERENCES ExamProblem
seq             INT NOT NULL        -- ordering within problem
num             INT                 -- original question number in exam (全卷通编)
stem            TEXT                -- question stem; retains [_1_][_2★_] markup for sentence_order
options         JSONB NOT NULL      -- {"1":"…","2":"…","3":"…","4":"…"} or {} for audio-only
correct_answer  TEXT                -- merged from ExamAnswerKey (1/2/3/4)
meta            JSONB               -- {target, star_position, …}
```

`ExamAnswerKey` table is **removed** — `correct_answer` lives on ExamItem.

---

### ExamMedia (NEW)
```sql
id UUID PK
entity_type  TEXT NOT NULL   -- "problem" | "item"
entity_id    UUID NOT NULL   -- ExamProblem.id or ExamItem.id
media_type   TEXT NOT NULL   -- "image" (only type for now)
url          TEXT NOT NULL   -- served path, e.g. /media/exams/uuid.png
caption      TEXT
seq          INT DEFAULT 0
created_at   TIMESTAMPTZ DEFAULT now()
```

---

### ExamDraft (NEW — temporary ingestion state)
```sql
id UUID PK
filename     TEXT           -- original uploaded filename
markdown_raw TEXT           -- output of pdf_to_md (left pane source of truth)
draft_json   JSONB          -- editable structured draft (right pane state)
paper_id     UUID REFERENCES ExamPaper  -- set after confirm
status       TEXT DEFAULT 'pending'     -- pending | confirmed
created_at   TIMESTAMPTZ DEFAULT now()
updated_at   TIMESTAMPTZ DEFAULT now()
```

---

### AttemptAnswer (unchanged)
Points to ExamItem.id (was ExamQuestion.id). No logic change needed.

---

## Admin Ingestion UI

### Route
`/admin/ingest` — single page, accessible from TopNav "管理" tab.

---

### Flow

```
① Upload PDF
      ↓  (background: pdf_to_md → convert_exam → create ExamDraft)
② Review & Edit   [left: markdown raw | right: editable form]
      ↓  (user edits type, instruction, passage, items, uploads images)
③ Confirm → seeds ExamPaper/Section/Problem/Item to DB
      ↓
  Done — appears in exam list
```

Re-ingestion: "重新识别" re-runs AI and overwrites `draft_json` (markdown_raw preserved).
Re-editing: confirmed papers can be re-opened into a new draft for corrections.

---

### Layout (right pane detail)

```
[试卷信息]  title ___  level [N1▼]  source ___

Section: 言語知識（文字・語彙）
  └─ 問題1  [type: kanji_reading ▼]  [编辑] [删除]
       指示語: ___________
       Q1  __運賃__  1.うんちん 2.うんどう  答:2  [编辑]
       Q2  ...
       [+ 添加题目]
  └─ 問題2  [type: kanji_writing ▼]
       ...
  [+ 添加問題]

Section: 読解
  └─ 問題13  [type: reading_comp ▼]
       passage: [文章A text box]  [+ 上传图片]
       Q45  ...  Q46  ...
  └─ 問題13  [type: reading_comp ▼]   ← same name, different passage
       passage: [文章B text box]
       Q47  ...
```

**Type selector**: dropdown showing all 11 types — most important editable field, shown prominently on each Problem row. Type determines how the question renders during exam and which AI analysis prompt is used.

**Image upload**: appears on ExamProblem (for passage images) and optionally on ExamItem (for option images in listening). Stored via `/admin/media/upload`, served as static files.

**Listening problems**: show `transcript` textarea instead of passage; no image upload.

---

### Bottom action bar
- `[重新识别]` — re-run AI, overwrite draft_json
- `[保存草稿]` — persist draft_json to ExamDraft, no DB side effects
- `[确认入库]` — validate completeness, commit to ExamPaper tree, mark draft confirmed

---

## API Endpoints (new/changed)

### Ingestion (new, prefix `/admin`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/drafts` | Upload PDF, start AI parsing, return draft_id |
| GET | `/admin/drafts/{draft_id}` | Fetch draft (markdown_raw + draft_json) |
| PUT | `/admin/drafts/{draft_id}` | Save edited draft_json |
| POST | `/admin/drafts/{draft_id}/reparse` | Re-run AI on existing markdown_raw |
| POST | `/admin/drafts/{draft_id}/confirm` | Commit draft → ExamPaper tree |
| POST | `/admin/media/upload` | Upload image, return url |

### Exam data (updated)
Existing exam endpoints adapted to new schema:
- `GET /exams/{paper_id}` — returns Sections → Problems → Items hierarchy
- `GET /questions/{question_id}/analysis` — `question_id` now refers to ExamItem.id
- All attempt/answer endpoints unchanged (still reference ExamItem.id)

---

## Migration

1. Add new tables: `ExamProblem`, `ExamMedia`, `ExamDraft`
2. Migration script: for each existing `ExamSection`, create one `ExamProblem` per unique `(type, passage_group)` group of its questions, then re-parent questions as ExamItems
3. Copy `ExamAnswerKey.correct_answer` → `ExamItem.correct_answer`, drop `ExamAnswerKey`
4. Frontend: update type references from `ExamQuestion` → `ExamItem`; update API response shapes

---

## Out of Scope

- Audio file support (transcript text is sufficient for now)
- Multi-user permissions / concurrent editing
- Version history / diff view for drafts
- Listening question image options (marked as `[画像1]` placeholder, no image upload for now)
