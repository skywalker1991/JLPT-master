-- Where each atom was actually met.
--
-- analysis_atoms was a bare (analysis_id, atom_id) junction and was never
-- written to — not one of the five createAtom call sites passed an
-- analysis_id, so every atom in the knowledge base had lost its origin.
-- Replaced by a record of the encounter itself: the sentence, the form the
-- word took in it, and what it meant there.
--
-- Safe to drop: analysis_atoms holds 0 rows.

DROP TABLE IF EXISTS analysis_atoms;

CREATE TABLE IF NOT EXISTS atom_occurrences (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 atom_id UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
 -- SET NULL, not CASCADE: the sentence is the memory anchor and should
 -- outlive housekeeping on the analysis history.
 analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
 sentence_index SMALLINT,
 surface VARCHAR(100), -- the form in the text, e.g. 尊ばれた
 surface_meaning TEXT, -- what it meant there, e.g. 受到尊重
 sentence_text TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_atom_occurrences_atom_id ON atom_occurrences(atom_id);

-- One record per (word, sentence, form). Re-analysing the same text, or
-- tapping the same word twice, must not pile up duplicates. md5() because
-- sentence_text can exceed the btree key limit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_atom_occurrences
 ON atom_occurrences(atom_id, md5(sentence_text), coalesce(surface, ''));
