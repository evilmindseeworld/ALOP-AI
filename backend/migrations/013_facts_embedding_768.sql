-- 013: give user_facts.embedding a width somebody chose, and a way to read it.
--
-- The column arrived as vector(1536) with the ad-hoc schema that predates this
-- directory. 1536 is OpenAI's width and there is no OpenAI key on this project;
-- MEMORY-AND-CACHE-PLAN.md Phase 2 says in as many words not to assume the
-- existing dimension is a decision anyone made. It was not. GOOGLE_API_KEY is
-- set and already pays for vision, so text-embedding-004 at 768 is the
-- provider, and the column moves to it.
--
-- Safe to run as a plain ALTER because user_facts is EMPTY: confirmed
-- `select count(*)` = 0 against production before writing this. There is no
-- rewrite and no cast of existing vectors, because there are none. IF THIS IS
-- EVER RUN AGAINST A POPULATED TABLE IT WILL FAIL, and that is the correct
-- behaviour — 1536 numbers cannot be truncated to 768 and still mean anything.
-- Re-embedding every row is the migration in that case, not this file.
--
-- NO VECTOR INDEX. Deliberate. ivfflat and hnsw earn their build cost and their
-- recall loss at thousands of rows; this table holds at most a few hundred per
-- user and every query filters by user_id first, which user_facts_user_recent
-- already serves. An exact scan of one user's facts is faster than an index
-- probe here. Add hnsw when a single user's fact count reaches four figures,
-- and read pg_indexes first — twice in this project an index has been proposed
-- from the repository alone that already existed under another name.

ALTER TABLE public.user_facts
  ALTER COLUMN embedding TYPE public.vector(768);

-- Semantic recall. supabase-js cannot express `ORDER BY embedding <=> $1`
-- through PostgREST's query builder, so the ordering lives here.
--
-- SECURITY INVOKER, which is the default and is stated anyway because the
-- alternative is what would go wrong: SECURITY DEFINER would let any caller
-- pass any uuid and read that user's facts. As an invoker function it is
-- covered by whatever RLS applies to the caller — user_facts has RLS enabled
-- and zero policies, so anon and authenticated see nothing through it, and the
-- server's service-role connection sees rows because service role bypasses RLS
-- by design. That bypass is exactly why p_user_id is not optional: the filter
-- in the query IS the tenant boundary for this connection. See AGENTS.md.
--
-- `set search_path = ''` per Supabase's linter, which is why every name below
-- is schema-qualified, including the vector type — the extension lives in
-- public, not extensions, on this project.
CREATE OR REPLACE FUNCTION public.match_user_facts(
  p_user_id uuid,
  p_query public.vector(768),
  p_limit int DEFAULT 20
)
RETURNS TABLE (fact text, similarity double precision)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT f.fact,
         -- Cosine distance, reported as similarity because that is the
         -- direction a reader expects it to run in.
         1 - (f.embedding OPERATOR(public.<=>) p_query) AS similarity
  FROM public.user_facts f
  WHERE f.user_id = p_user_id
    AND f.embedding IS NOT NULL
  ORDER BY f.embedding OPERATOR(public.<=>) p_query
  -- Clamped, because the limit reaches here from application code and an
  -- unbounded one would read a whole table into a prompt.
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 200);
$$;

COMMENT ON FUNCTION public.match_user_facts(uuid, public.vector, int) IS
  'Phase 2 semantic recall: one user''s facts ordered by cosine distance to a query embedding. Callers must pass the server-resolved user id; the filter is the tenant boundary for the service-role connection.';
