-- A sitting is several files, and the middle layer's output is worth keeping.
--
-- exam_drafts held one filename and one blob of markdown, so a sitting that
-- arrives as 試題 + 解析 + 答案表 either went in incomplete or was assembled by
-- hand. Each file now has a row, with the text pulled out of it and the role
-- it was classified as.
--
-- Keeping the text is what makes the extractor replaceable: improving it means
-- re-running over these rows, not asking for the PDFs again. `canonical` holds
-- the result in the shape everything downstream reads, and `report` holds what
-- validation and answer-merging had to say about it.

CREATE TABLE IF NOT EXISTS exam_draft_sources (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 draft_id UUID NOT NULL REFERENCES exam_drafts(id) ON DELETE CASCADE,
 filename TEXT NOT NULL,
 role VARCHAR(20) NOT NULL DEFAULT 'unknown',
 page_count INTEGER NOT NULL DEFAULT 0,
 text_pages INTEGER NOT NULL DEFAULT 0,
 text_raw TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_exam_draft_sources_draft_id ON exam_draft_sources(draft_id);

ALTER TABLE exam_drafts ADD COLUMN IF NOT EXISTS canonical JSONB;
ALTER TABLE exam_drafts ADD COLUMN IF NOT EXISTS report JSONB;
