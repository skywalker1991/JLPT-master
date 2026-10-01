-- Practice by question type, across papers: each answer on its own, not
-- part of an attempt at a paper. Counted with attempt answers for the
-- per-type accuracy on the JLPT home.
CREATE TABLE IF NOT EXISTS practice_answers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     UUID NOT NULL REFERENCES exam_items(id) ON DELETE CASCADE,
    user_answer VARCHAR(10) NOT NULL,
    is_correct  BOOLEAN NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_practice_answers_user ON practice_answers (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_practice_answers_item ON practice_answers (item_id);

-- A mock exam: timed stages (言語知識・読解, then 聴解), questions flagged
-- 不确定. Kept with the attempt as {"mock": true, "stage": ..., "stage_started_at": ..., "flags": [...]}.
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS meta JSONB;
