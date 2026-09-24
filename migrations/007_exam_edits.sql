-- Fixing a question after it has been imported.
--
-- Confirming a draft was a one-way door: nothing edits an imported paper, so
-- 2015年07月 第39题 — whose ★ was dropped, leaving it unscorable — can only be
-- repaired by deleting the whole paper and losing the six attempts recorded
-- against it. With dozens of papers coming, that trade gets worse every time.
--
-- Two things make editing safe rather than merely possible:
--
-- Revisions, because an attempt was answered against the wording as it
-- stood. Change a question and past scores quietly mean something else;
-- the history is what makes that visible instead of silent.
--
-- Reports, because the moment a defect is actually noticed is while
-- answering, not while reviewing an import. A flag raised there costs
-- nothing and survives until someone deals with it.

CREATE TABLE IF NOT EXISTS exam_item_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id UUID NOT NULL REFERENCES exam_items(id) ON DELETE CASCADE,
 field VARCHAR(30) NOT NULL,
 old_value TEXT,
 new_value TEXT,
 -- 'ingest' wrote it during import, 'user' edited it afterwards.
 source VARCHAR(10) NOT NULL DEFAULT 'user',
 note TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_exam_item_revisions_item_id ON exam_item_revisions(item_id);
CREATE INDEX IF NOT EXISTS ix_exam_item_revisions_created_at ON exam_item_revisions(created_at);


CREATE TABLE IF NOT EXISTS exam_item_reports (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id UUID NOT NULL REFERENCES exam_items(id) ON DELETE CASCADE,
 -- Which attempt it was noticed during, if any. SET NULL so clearing
 -- attempt history does not discard the defect it turned up.
 attempt_id UUID REFERENCES exam_attempts(id) ON DELETE SET NULL,
 kind VARCHAR(20) NOT NULL,
 note TEXT,
 status VARCHAR(10) NOT NULL DEFAULT 'open',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_exam_item_reports_status ON exam_item_reports(status);
CREATE INDEX IF NOT EXISTS ix_exam_item_reports_item_id ON exam_item_reports(item_id);
