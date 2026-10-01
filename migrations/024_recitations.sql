-- 背诵: passages to say by heart, one at a time, in a queue. The sentences
-- are copied in so the passage stays even if its analysis is deleted.
CREATE TABLE IF NOT EXISTS recitations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
    sentences   JSONB NOT NULL,          -- [{"text", "translation", "index"}]
    status      VARCHAR(10) NOT NULL DEFAULT 'queued',  -- queued | done
    position    INTEGER NOT NULL DEFAULT 0,             -- order in the queue
    progress    INTEGER NOT NULL DEFAULT 0,             -- sentences said so far this time
    times_done  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    done_at     TIMESTAMPTZ,
    CONSTRAINT ck_recitations_status CHECK (status IN ('queued', 'done'))
);
CREATE INDEX IF NOT EXISTS ix_recitations_user ON recitations (user_id, status, position);
