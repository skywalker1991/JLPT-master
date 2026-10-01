-- Sign-up by invitation, and which invitation each account came in on.

CREATE TABLE IF NOT EXISTS invite_codes (
    code        VARCHAR(32) PRIMARY KEY,
    note        TEXT,
    max_uses    INTEGER NOT NULL DEFAULT 1,
    used_count  INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_invite_codes_uses CHECK (used_count <= max_uses)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code VARCHAR(32);
