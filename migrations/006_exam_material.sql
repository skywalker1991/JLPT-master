-- Room for the material the source PDFs actually carry.
--
-- A JLPT sitting comes as 試題 + 解析 + 答案表, and between them they hold
-- more than the schema could hold:
--
--   並べ替え answers are a full ordering (36→3412), but correct_answer is
--   CHAR(1) — so review could say "the answer is 3" and never show the
--   sentence in its correct order, which is the whole point of the question.
--
--   The 解析 carries a Chinese translation of every 読解 passage, and the
--   official per-item explanation. question_analyses currently holds an
--   AI-written one; without knowing which is which, you cannot tell an
--   authoritative explanation from a generated one.
--
--   Listening audio is per 番, i.e. per item, but exam_media could only hang
--   off a problem. Bytes live in the row because the app runs in a container
--   where a written file does not survive a restart, and a synthesised clip
--   is tens of KB.

ALTER TABLE exam_items     ADD COLUMN answer_order VARCHAR(8);
ALTER TABLE exam_problems  ADD COLUMN passage_translation TEXT;

ALTER TABLE question_analyses ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'ai';
-- Everything stored so far was generated on demand.
UPDATE question_analyses SET source = 'ai';

ALTER TABLE exam_media ADD COLUMN item_id UUID REFERENCES exam_items(id) ON DELETE CASCADE;
ALTER TABLE exam_media ADD COLUMN data BYTEA;
ALTER TABLE exam_media ALTER COLUMN url DROP NOT NULL;
ALTER TABLE exam_media ALTER COLUMN problem_id DROP NOT NULL;
ALTER TABLE exam_media ADD CONSTRAINT ck_exam_media_owner
    CHECK (problem_id IS NOT NULL OR item_id IS NOT NULL);
ALTER TABLE exam_media ADD CONSTRAINT ck_exam_media_payload
    CHECK (url IS NOT NULL OR data IS NOT NULL);

CREATE INDEX ix_exam_media_item_id ON exam_media(item_id);
