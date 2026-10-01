-- Accounts, and whose data is whose.
--
-- Until now there was one person and one of everything. The exam bank stays
-- shared; what a person collects — atoms (and through them properties,
-- relations, occurrences, reviews), analyses, attempts — now belongs to a
-- user.
--
-- The tables are created here as well as by create_all, because on a fresh
-- database this file runs from docker-entrypoint-initdb.d before the backend
-- has started, and the foreign keys below need users to exist.

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY,
    email         VARCHAR(320) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  VARCHAR(100),
    role          VARCHAR(20) NOT NULL DEFAULT 'user',
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ,
    CONSTRAINT ck_users_role CHECK (role IN ('user', 'admin'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash   VARCHAR(64) PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS ix_user_sessions_user_id ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS ix_user_sessions_expires_at ON user_sessions (expires_at);

ALTER TABLE atoms ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE exam_item_reports ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_atoms_user_id ON atoms (user_id);
CREATE INDEX IF NOT EXISTS ix_analyses_user_id ON analyses (user_id);
CREATE INDEX IF NOT EXISTS ix_exam_attempts_user_id ON exam_attempts (user_id);

-- An atom is unique within one person's dictionary, not across everyone's.
-- 001 named it atoms_type_key_key; create_all named it uq_atoms_type_key.
ALTER TABLE atoms DROP CONSTRAINT IF EXISTS atoms_type_key_key;
ALTER TABLE atoms DROP CONSTRAINT IF EXISTS uq_atoms_type_key;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_atoms_user_type_key') THEN
        ALTER TABLE atoms ADD CONSTRAINT uq_atoms_user_type_key UNIQUE (user_id, type, key);
    END IF;
END $$;

-- Everything made before accounts existed was made by the first admin. The
-- backend creates that account at start-up from ADMIN_EMAIL/ADMIN_PASSWORD,
-- which is before this runs on a deploy; with no admin yet these update
-- nothing, and the backend repeats the hand-over the next time it starts.
UPDATE atoms SET user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
    WHERE user_id IS NULL;
UPDATE analyses SET user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
    WHERE user_id IS NULL;
UPDATE exam_attempts SET user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
    WHERE user_id IS NULL;
