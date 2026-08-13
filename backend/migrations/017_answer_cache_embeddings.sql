-- 017: semantic answer-cache matching.
-- Global/service-role only, like answer_cache itself. All answer-changing
-- dimensions are filtered inside the function before cosine ranking.

-- This project already places pgvector in public (013 records that live fact).
-- No version is pinned: Supabase deprecated extension version pinning.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

ALTER TABLE public.answer_cache
  ADD COLUMN IF NOT EXISTS embedding public.vector(768);

CREATE OR REPLACE FUNCTION public.match_answer_cache(
  p_query_embedding public.vector(768),
  p_lang TEXT,
  p_country TEXT,
  p_plan TEXT,
  p_detailed BOOLEAN,
  p_branch TEXT,
  p_threshold REAL DEFAULT 0.95
)
RETURNS TABLE (
  key TEXT,
  answer TEXT,
  stored_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  similarity DOUBLE PRECISION
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT ac.key, ac.answer, ac.stored_at, ac.expires_at,
         1 - (ac.embedding OPERATOR(public.<=>) p_query_embedding) AS similarity
  FROM public.answer_cache AS ac
  WHERE ac.embedding IS NOT NULL
    AND ac.expires_at > NOW()
    AND ac.lang IS NOT DISTINCT FROM p_lang
    AND ac.country IS NOT DISTINCT FROM p_country
    AND ac.plan IS NOT DISTINCT FROM p_plan
    AND ac.detailed IS NOT DISTINCT FROM p_detailed
    AND ac.branch IS NOT DISTINCT FROM p_branch
    AND 1 - (ac.embedding OPERATOR(public.<=>) p_query_embedding) >= p_threshold
  ORDER BY ac.embedding OPERATOR(public.<=>) p_query_embedding
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.match_answer_cache(public.vector, TEXT, TEXT, TEXT, BOOLEAN, TEXT, REAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_answer_cache(public.vector, TEXT, TEXT, TEXT, BOOLEAN, TEXT, REAL) TO service_role;

ALTER TABLE public.answer_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_cache FORCE ROW LEVEL SECURITY;
