-- ── AI First Look v2 — review engine memory ─────────────────────────────────
-- 1. Semantic memory: pgvector embeddings on agent_memory + similarity RPC,
--    so each review retrieves the most RELEVANT past lessons/corrections
--    instead of a global top-N dump.
-- 2. Structured memory: meta JSONB (sector, stage, mistake_type, rule) and a
--    'gold_memo' kind for few-shot examples of the founder-note voice.
-- Educational only: the engine never makes investment decisions or capital
-- commitments at any point.

-- 1 ── Semantic memory ───────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.agent_memory
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

ALTER TABLE public.agent_memory
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Allow gold memos (few-shot note voice) alongside existing kinds.
ALTER TABLE public.agent_memory DROP CONSTRAINT IF EXISTS agent_memory_kind_check;
ALTER TABLE public.agent_memory ADD CONSTRAINT agent_memory_kind_check
  CHECK (kind IN ('lesson', 'thesis_nuance', 'red_flag_pattern', 'sector_note', 'correction', 'gold_memo'));

-- HNSW: good at any table size, no re-training as rows grow.
CREATE INDEX IF NOT EXISTS agent_memory_embedding_idx
  ON public.agent_memory
  USING hnsw (embedding extensions.vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_agent_memory(
  query_embedding extensions.vector(1536),
  match_count INT DEFAULT 6
) RETURNS TABLE (
  id UUID,
  kind TEXT,
  content TEXT,
  weight NUMERIC,
  meta JSONB,
  similarity FLOAT
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT
    m.id,
    m.kind,
    m.content,
    m.weight,
    m.meta,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM public.agent_memory m
  WHERE m.is_active = true
    AND m.embedding IS NOT NULL
  ORDER BY m.embedding <=> query_embedding, m.weight DESC
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_agent_memory FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_agent_memory TO service_role;

COMMENT ON FUNCTION public.match_agent_memory IS
  'Semantic retrieval of agent memory (lessons/corrections/gold memos) for AI First Look reviews. Service role only.';
