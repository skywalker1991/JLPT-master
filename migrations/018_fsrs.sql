-- Review scheduling moves from five fixed Leitner boxes to FSRS: each card
-- keeps its own stability (days until recall drops to the target) and
-- difficulty, and the next review follows from them.

ALTER TABLE atom_srs_states ADD COLUMN IF NOT EXISTS stability     REAL;
ALTER TABLE atom_srs_states ADD COLUMN IF NOT EXISTS difficulty    REAL;
ALTER TABLE atom_srs_states ADD COLUMN IF NOT EXISTS state         SMALLINT NOT NULL DEFAULT 2;
ALTER TABLE atom_srs_states ADD COLUMN IF NOT EXISTS last_review   TIMESTAMPTZ;
ALTER TABLE atom_srs_states ADD COLUMN IF NOT EXISTS reps          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE atom_srs_states ADD COLUMN IF NOT EXISTS lapses        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE atom_srs_states ADD COLUMN IF NOT EXISTS introduced_at TIMESTAMPTZ;

-- Cards reviewed under the old boxes: a rough FSRS state from the box they
-- reached, due when they were already due.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'atom_srs_states' AND column_name = 'box_level') THEN
        UPDATE atom_srs_states SET
            stability = CASE box_level WHEN 0 THEN 0.5 WHEN 1 THEN 1 WHEN 2 THEN 2
                                       WHEN 3 THEN 5 WHEN 4 THEN 10 ELSE 20 END,
            difficulty = 5,
            reps = box_level,
            last_review = updated_at,
            introduced_at = updated_at
        WHERE stability IS NULL;
        ALTER TABLE atom_srs_states DROP COLUMN box_level;
    END IF;
END $$;

-- How much new material a day, and how sure to be of remembering.
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_cards_per_day SMALLINT NOT NULL DEFAULT 10;
ALTER TABLE users ADD COLUMN IF NOT EXISTS desired_retention REAL NOT NULL DEFAULT 0.9;
