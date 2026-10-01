-- Follow-up questions about an exam question. One person's own thread: the
-- question's explanation is shared by everyone, the questions asked are not.
CREATE TABLE IF NOT EXISTS item_asks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     UUID NOT NULL REFERENCES exam_items(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    targets     JSONB,
    result      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_item_asks_user_item ON item_asks (user_id, item_id, created_at);
