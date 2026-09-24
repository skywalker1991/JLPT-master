-- What a sitting set out to cover.
--
-- N1 runs 170 minutes and almost nobody sits it in one go, so a run is
-- usually a 問題 or two on a commute. Until now the range was inferred from
-- the answers given, which cannot tell "chose 問題5 and answered nothing"
-- from "chose nothing" — and cannot say what is left to do on a paper.
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS scope JSONB;
