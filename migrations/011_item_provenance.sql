-- Where a question was read from: which file, and which page of it.
--
-- A reviewer settling a disputed answer has to see the page it came from,
-- and a forty-page booklet with no page number is a page to go hunting for.
-- The file itself is not copied into the bank: ingest is offline tooling run
-- where the material already is, and one copy of it is the truth.
ALTER TABLE exam_items ADD COLUMN IF NOT EXISTS source_file TEXT;
ALTER TABLE exam_items ADD COLUMN IF NOT EXISTS source_page INTEGER;
