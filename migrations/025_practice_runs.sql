-- One pass through one paper's questions of one kind (文字・語彙 / 文法 /
-- 読解 / 聴解). Its answers point at it, so each pass is kept as a record of
-- its own; one left halfway can be picked up again. Answers are judged only
-- once the pass is handed in (submitted_at); until then they can change.
CREATE TABLE IF NOT EXISTS practice_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    paper_id    UUID NOT NULL REFERENCES exam_papers(id) ON DELETE CASCADE,
    kind        VARCHAR(20) NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_practice_runs_user_paper ON practice_runs (user_id, paper_id, started_at);

ALTER TABLE practice_answers ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES practice_runs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ix_practice_answers_run ON practice_answers (run_id);
ALTER TABLE practice_runs ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
