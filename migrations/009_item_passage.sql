-- 読解問題8 prints four unrelated passages under one heading, 問題9 three, and
-- 問題11 an A and a B. Held only on the problem, answering 第46题 means being
-- shown all four texts at once. A 問題 with a single passage keeps it where it
-- is; this is for the ones that do not.
ALTER TABLE exam_items ADD COLUMN IF NOT EXISTS passage TEXT;
