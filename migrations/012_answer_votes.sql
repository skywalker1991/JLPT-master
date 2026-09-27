-- What each source said about this answer, keyed by the file it came from.
--
-- The evidence behind the answer, so that how far to trust it can be read
-- off rather than guessed at. Keyed by file because two statements
-- corroborate each other only if they come from different ones: the front
-- table and the per-item 正解 lines are usually printed in the same booklet,
-- and counting them as two witnesses is how a paper came to be reported as
-- having three sources when it had one.
ALTER TABLE exam_items ADD COLUMN IF NOT EXISTS answer_votes JSONB;
