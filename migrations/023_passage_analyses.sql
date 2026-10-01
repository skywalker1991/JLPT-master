-- A text from the exam bank — a 読解 passage, a 聴解 script, an ordered
-- 整序 sentence — analysed the way 語料分析 analyses a pasted passage, so
-- the review page can read it with the same reader. Exam text is the same
-- for everyone, so each is analysed once, keyed by the text itself.
CREATE TABLE IF NOT EXISTS passage_analyses (
    text_hash    CHAR(32) PRIMARY KEY,
    text         TEXT NOT NULL,
    sentences    JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
