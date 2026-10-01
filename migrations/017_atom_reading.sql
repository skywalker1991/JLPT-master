-- A word is its dictionary form *and* its reading: 市場 いちば and 市場 しじょう
-- are two words, 分かる and わかる one word written two ways.

ALTER TABLE atoms ADD COLUMN IF NOT EXISTS reading TEXT;

UPDATE atoms a SET reading = p.value
FROM (
    SELECT DISTINCT ON (atom_id) atom_id, value
    FROM atom_properties WHERE kind = 'reading'
    ORDER BY atom_id, created_at
) p
WHERE p.atom_id = a.id AND a.type = 'vocabulary' AND a.reading IS NULL;

ALTER TABLE atoms DROP CONSTRAINT IF EXISTS uq_atoms_user_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_atoms_user_type_key_reading
    ON atoms (user_id, type, key, COALESCE(reading, ''));

-- Generic, shareable parts of a word / grammar card generated on demand:
-- example sentences, other spellings, how a pattern attaches, usage rules.
-- The same for everyone, so made once per (type, key, reading).
CREATE TABLE IF NOT EXISTS card_details (
    type        VARCHAR(20) NOT NULL,
    key         TEXT NOT NULL,
    reading     TEXT NOT NULL DEFAULT '',
    detail      JSONB NOT NULL,
    model       VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (type, key, reading)
);
