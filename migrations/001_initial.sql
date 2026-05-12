-- JLPT Master — 初始化数据库
-- 此文件由 Docker 在首次启动时自动执行

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 核心模型（原子 + 属性 + 关系）
-- =============================================================================

CREATE TABLE atoms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(20) NOT NULL,
  key         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT atoms_type_check CHECK (type IN ('vocabulary', 'grammar')),
  UNIQUE(type, key)
);

CREATE INDEX idx_atoms_type ON atoms(type);
CREATE INDEX idx_atoms_key  ON atoms(key);

-- --------------------------------------------------------------------------

CREATE TABLE atom_properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  kind        VARCHAR(50) NOT NULL,
  value       TEXT NOT NULL,
  source_type VARCHAR(20) NOT NULL,   -- 'dictionary' | 'ai' | 'user'
  source_ref  UUID,                   -- 关联到 analyses.id（可空）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT properties_source_check CHECK (source_type IN ('dictionary', 'ai', 'user'))
);

CREATE INDEX idx_properties_atom ON atom_properties(atom_id);
CREATE INDEX idx_properties_kind ON atom_properties(atom_id, kind);
CREATE INDEX idx_properties_source_ref ON atom_properties(source_ref) WHERE source_ref IS NOT NULL;

-- --------------------------------------------------------------------------

CREATE TABLE atom_relations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  to_id       UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL,
  note        JSONB,
  source_type VARCHAR(20) NOT NULL,   -- 'ai' | 'user'
  source_ref  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(from_id, to_id, type),
  CHECK (from_id != to_id),
  CONSTRAINT relations_source_check CHECK (source_type IN ('ai', 'user')),
  CONSTRAINT relations_type_check CHECK (type IN ('synonym', 'formal_casual', 'derivative', 'contrast', 'nuance'))
);

CREATE INDEX idx_relations_from ON atom_relations(from_id);
CREATE INDEX idx_relations_to   ON atom_relations(to_id);

-- =============================================================================
-- 应用层
-- =============================================================================

CREATE TABLE atom_tags (
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  tag         VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (atom_id, tag)
);

CREATE INDEX idx_tags_tag ON atom_tags(tag);

-- --------------------------------------------------------------------------

CREATE TABLE traces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  action      VARCHAR(30) NOT NULL,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_traces_atom    ON traces(atom_id);
CREATE INDEX idx_traces_action  ON traces(action);
CREATE INDEX idx_traces_created ON traces(created_at DESC);

-- --------------------------------------------------------------------------

CREATE TABLE analyses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  input_type    VARCHAR(20) NOT NULL,
  input_content TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'in_progress',
  session_data  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT analyses_status_check CHECK (status IN ('in_progress', 'completed')),
  CONSTRAINT analyses_type_check CHECK (
    input_type IN ('text', 'image', 'jlpt_grammar', 'jlpt_reading', 'jlpt_ordering', 'jlpt_listening')
  )
);

CREATE INDEX idx_analyses_status  ON analyses(status);
CREATE INDEX idx_analyses_created ON analyses(created_at DESC);

-- --------------------------------------------------------------------------

CREATE TABLE analysis_atoms (
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  atom_id     UUID NOT NULL REFERENCES atoms(id) ON DELETE CASCADE,
  PRIMARY KEY (analysis_id, atom_id)
);

CREATE INDEX idx_analysis_atoms_atom     ON analysis_atoms(atom_id);
CREATE INDEX idx_analysis_atoms_analysis ON analysis_atoms(analysis_id);
