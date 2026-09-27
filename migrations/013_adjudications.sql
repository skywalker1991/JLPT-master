-- What a person decided about a question, kept apart from the paper.
--
-- A human judgement is not part of an import; it is a layer over every
-- import of that sitting. Held on the paper it is indistinguishable from a
-- machine-filled value and any re-import silently discards it — which nearly
-- happened to three decisions made by hand: 2015年07月 第23題, 2017年07月
-- 第37題 and 2013年12月 第38題, all three cases where the 解析 booklet was
-- wrong and the answer table right.
--
-- Keyed by the sitting and where the question sits in it, not by paper id,
-- so it survives the paper being deleted and built again.
CREATE TABLE IF NOT EXISTS exam_adjudications (
    id           UUID PRIMARY KEY,
    level        TEXT NOT NULL,
    sitting      TEXT NOT NULL,          -- 2015年07月
    section      TEXT NOT NULL,          -- 聴解
    problem_name TEXT NOT NULL,          -- 問題6
    num          INTEGER,                -- the question's own number
    field        TEXT NOT NULL,          -- correct_answer | answer_order | stem | …
    value        TEXT,                   -- NULL means "deliberately blank"
    reason       TEXT,                   -- why, in the decider's words
    decided_by   TEXT NOT NULL DEFAULT 'user',
    decided_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (level, sitting, section, problem_name, num, field)
);
CREATE INDEX IF NOT EXISTS ix_exam_adjudications_sitting
    ON exam_adjudications (level, sitting);
