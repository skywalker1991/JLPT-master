CREATE TABLE problem_analyses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id  UUID NOT NULL UNIQUE REFERENCES exam_problems(id) ON DELETE CASCADE,
  session_data JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_problem_analyses_problem_id ON problem_analyses(problem_id);
