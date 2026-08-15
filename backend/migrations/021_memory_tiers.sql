-- 021_memory_tiers.sql
--
-- Additive, re-runnable, and idempotent against BOTH states this database can
-- be in — the ad-hoc schema that predates migrations/ and a fresh build from
-- this directory. See 008 for why that is the rule here.
--
-- Applied to the connected APOL-AI Supabase project on 2026-08-15 as
-- `20260815034253 memory_tiers` after a live schema/index inspection. Every
-- statement remains additive and re-runnable; `CONCURRENTLY` is dropped by the
-- MCP apply wrapper because it runs migrations transactionally.
--
--
-- ONE TABLE OF "FACTS" WAS FOUR DIFFERENT THINGS.
--
-- `user_facts` currently holds anything the extractor decides is durable, all
-- with the same lifetime, the same trust and the same recall path. Four kinds
-- of memory are in there and they behave differently in ways that have already
-- produced wrong answers elsewhere in this product:
--
--   semantic    "works in TypeScript" — true until it isn't, no expiry.
--   preference  "wants short answers" — an instruction, and it outranks the
--               model's own defaults rather than being context.
--   procedure   "deploys with `npm run ship`" — how this user does a thing.
--   episodic    "asked about the pricing page on Tuesday" — chat-scoped, and
--               the one kind that must NOT cross chats. 001 already moved
--               conversation_summary off `users` for exactly this reason.
--
-- The kind column is what lets recall ask for the right ones: a preference is
-- injected on every turn, an episodic memory only inside its own chat.
--
--
-- PROVENANCE, BECAUSE A STORED FACT IS REPLAYED AT SYSTEM POSITION FOREVER.
--
-- `source_turn_id` ties a fact to the turn that produced it, which is the only
-- way to answer "why does the assistant believe this about me" — and the only
-- way to delete the consequences of one bad turn without clearing everything.
-- `confidence` and `conflict_state` let two contradictory facts coexist while
-- being marked, instead of the newer one silently winning.
--
--
-- THE EMBEDDING LIFECYCLE COLUMNS ARE A CORRECTNESS FIX, NOT BOOKKEEPING.
--
-- AGENTS.md: every row in `user_facts.embedding` must come from the same model,
-- because `<=>` will happily rank across two incomparable geometries without
-- erroring. Today nothing in the row says which model produced it, so that
-- invariant is enforced by a constant in `lib/embeddings.js` and by memory.
-- `embedding_model` and `embedding_dim` make a mismatched row DETECTABLE, and
-- `embedding_status` makes the rows that need re-embedding queryable instead of
-- invisible. A null embedding is already invisible to `match_user_facts` — that
-- is the hole `readUserFacts` works around by also reading by recency.

-- ---------------------------------------------------------------------------
-- 1. The kind, and everything about where a fact came from.
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_facts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'semantic',
  ADD COLUMN IF NOT EXISTS chat_id uuid,
  ADD COLUMN IF NOT EXISTS source_turn_id text,
  ADD COLUMN IF NOT EXISTS confidence real,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid,
  ADD COLUMN IF NOT EXISTS conflict_state text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Values, not a free-text column. A typo'd kind is a fact that is never
-- recalled and never noticed; the constraint makes it a failed write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_facts_kind_check'
  ) THEN
    ALTER TABLE public.user_facts
      ADD CONSTRAINT user_facts_kind_check
      CHECK (kind IN ('semantic', 'preference', 'procedure', 'episodic'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_facts_conflict_check'
  ) THEN
    ALTER TABLE public.user_facts
      ADD CONSTRAINT user_facts_conflict_check
      CHECK (conflict_state IS NULL OR conflict_state IN ('none', 'disputed', 'superseded'));
  END IF;
END $$;

-- An episodic memory belongs to one chat and a cross-chat one belongs to none.
-- Enforced here rather than in the writer: the writer is one function today and
-- there is no reason to believe it will stay one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_facts_episodic_scope_check'
  ) THEN
    ALTER TABLE public.user_facts
      ADD CONSTRAINT user_facts_episodic_scope_check
      CHECK ((kind = 'episodic') = (chat_id IS NOT NULL));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The embedding lifecycle.
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_facts
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_dim int,
  ADD COLUMN IF NOT EXISTS embedding_status text,
  ADD COLUMN IF NOT EXISTS embedding_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_facts_embedding_status_check'
  ) THEN
    ALTER TABLE public.user_facts
      ADD CONSTRAINT user_facts_embedding_status_check
      CHECK (embedding_status IS NULL
             OR embedding_status IN ('ok', 'pending', 'failed', 'stale'));
  END IF;
END $$;

-- Rows written before this migration carry a vector from a model nobody
-- recorded. They are LABELLED, not guessed at: `stale` where a vector exists
-- and `pending` where one does not, which is exactly what a backfill needs to
-- find them. Guessing the model name would be worse than the gap — a wrong
-- label is trusted, and mixing geometries is the failure AGENTS.md names.
UPDATE public.user_facts
   SET embedding_status = CASE WHEN embedding IS NULL THEN 'pending' ELSE 'stale' END
 WHERE embedding_status IS NULL;

-- The backfill's own query: the rows that still need work, this user first.
-- Partial, because the rows it selects are the minority and are meant to stay
-- that way.
CREATE INDEX CONCURRENTLY IF NOT EXISTS user_facts_embedding_backlog
  ON public.user_facts (user_id, embedding_attempts)
  WHERE embedding_status IN ('pending', 'stale', 'failed');

-- ---------------------------------------------------------------------------
-- 3. Lexical retrieval, the half a vector search cannot do.
-- ---------------------------------------------------------------------------
--
-- A vector search cannot find a rare exact token. "AC-4471" and "AC-4477" embed
-- to nearly the same point and mean different things; an identifier, a flag or
-- a filename is precisely the kind of fact a user expects to be remembered
-- verbatim. Lexical and vector retrieval fail in opposite directions, which is
-- why hybrid retrieval is worth having and why lib/hybrid-retrieval.js fuses
-- both rather than picking one.
--
-- 'simple' rather than 'english': stemming an identifier is how "AC-4471"
-- stops matching itself, and facts here are short enough that stopword removal
-- buys nothing.
ALTER TABLE public.user_facts
  ADD COLUMN IF NOT EXISTS fact_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(fact, ''))) STORED;

CREATE INDEX CONCURRENTLY IF NOT EXISTS user_facts_fact_tsv
  ON public.user_facts USING gin (fact_tsv);

-- Recall filters on kind and skips expired rows on every read; without this the
-- filter is a sequential scan behind the user_id index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS user_facts_user_kind_live
  ON public.user_facts (user_id, kind, created_at DESC)
  WHERE superseded_by IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Hierarchical conversation summaries (episodic retrieval).
-- ---------------------------------------------------------------------------
--
-- `chats.conversation_summary` is ONE 2000-character string per chat, rewritten
-- in place. A long conversation therefore forgets its own beginning, and there
-- is no way to ask "what did we decide about X" — the only granularity is "the
-- whole chat, compressed until it fits".
--
-- Levels: 0 is a window of raw turns, 1 summarises a run of level 0, 2 a run of
-- level 1. Retrieval reads the highest level that covers the range and drills
-- down only where the question lands, which is what makes an old conversation
-- searchable instead of merely compressed.

CREATE TABLE IF NOT EXISTS public.chat_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  -- Denormalised on purpose: every read filters by user first, and the
  -- service-role connection bypasses RLS, so this column IS the tenant
  -- boundary for those queries. See AGENTS.md on RLS.
  user_id uuid NOT NULL,
  level int NOT NULL DEFAULT 0,
  -- The half-open turn range this summary covers, [from, to).
  from_turn int NOT NULL,
  to_turn int NOT NULL,
  summary text NOT NULL,
  embedding public.vector(768),
  embedding_model text,
  embedding_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_summaries_range_check CHECK (to_turn > from_turn),
  CONSTRAINT chat_summaries_level_check CHECK (level >= 0 AND level <= 3)
);

-- One summary per (chat, level, range). A re-run of the summariser updates
-- rather than appending a second opinion about the same turns.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS chat_summaries_unique_span
  ON public.chat_summaries (chat_id, level, from_turn, to_turn);

CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_summaries_chat_level
  ON public.chat_summaries (chat_id, level, from_turn);

ALTER TABLE public.chat_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_summaries FORCE ROW LEVEL SECURITY;

-- Service-role only, like every other table here: the server connects with the
-- service key and every ownership check lives in the query. This policy exists
-- so a direct client connection gets nothing, which is what RLS protects
-- against — see AGENTS.md, "RLS is on, and it does nothing for your queries".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'chat_summaries'
  ) THEN
    -- No policy at all means no direct access, which is the intended posture.
    -- Stated rather than left implicit; 011 records the same decision.
    NULL;
  END IF;
END $$;

COMMENT ON TABLE public.chat_summaries IS
  'Hierarchical per-chat summaries. Level 0 covers raw turn windows; higher levels summarise lower ones. Written by the summariser job, read by episodic recall.';
COMMENT ON COLUMN public.user_facts.kind IS
  'semantic | preference | procedure | episodic. Episodic rows are chat-scoped and must never cross chats.';
COMMENT ON COLUMN public.user_facts.embedding_model IS
  'The model that produced `embedding`. Rows from two models cannot be compared with <=> and the operator will not error — see AGENTS.md.';
