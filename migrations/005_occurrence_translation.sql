-- The sentence a word was met in is the memory anchor; without its
-- translation the anchor is only half useful when reviewing. The analysis
-- already produces one per sentence — it was simply never carried through to
-- the occurrence.

ALTER TABLE atom_occurrences ADD COLUMN IF NOT EXISTS sentence_translation TEXT;
