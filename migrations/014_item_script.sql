-- Where a listening question's dialogue and answer were read.
--
-- A listening question can come from two files: the question paper prints
-- 問題1's options, the 解析 booklet prints what is said and the answer. Kept
-- apart from source_file/source_page, which name where the question itself
-- was read — for 問題3 and 4, which the paper prints nothing of but
-- 「1番 2番…」, that is the booklet too.
ALTER TABLE exam_items ADD COLUMN IF NOT EXISTS script_file TEXT;
ALTER TABLE exam_items ADD COLUMN IF NOT EXISTS script_page INTEGER;
