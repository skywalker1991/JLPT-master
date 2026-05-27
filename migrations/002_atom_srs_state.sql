CREATE TABLE atom_srs_states (
    atom_id     UUID PRIMARY KEY REFERENCES atoms(id) ON DELETE CASCADE,
    box_level   SMALLINT NOT NULL DEFAULT 0
                    CHECK (box_level BETWEEN 0 AND 5),
    next_review TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_atom_srs_states_next_review ON atom_srs_states(next_review);
