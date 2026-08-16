-- 000: write the ORIGINAL schema back into the lineage.
--
-- NUMBERED 000, not 026, and the number is the point: 019 and 022 declare
-- foreign keys into `users`, so on an empty database this file has to run
-- FIRST or those migrations fail. It was written last and belongs at the
-- front. Applying it to production out of order is harmless — every statement
-- is a no-op there.
--
-- WHAT THIS IS, and what it is not. `users`, `chats`, `usage`, `audit_logs`
-- and `user_facts` are the tables this product was built on. They were created
-- by hand in the Supabase dashboard before `migrations/` existed, so every
-- migration from 001 onward has been ALTERing tables that no file creates. A
-- database rebuilt from this directory had no `users` table, which means every
-- foreign key in 019 and 022 pointed at nothing and the very first request
-- failed. `scripts/check-drift.mjs` had to carry them as a hardcoded
-- exemption for exactly that reason.
--
-- This is a TRANSCRIPT of production as it stood on 2026-08-16, taken from
-- `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_class` and
-- `pg_policies` — not a redesign. Applying it to production is a no-op;
-- applying it to an empty database is meant to produce the same schema.
--
-- **THIS FILE HAS NOT BEEN PROVEN BY A REBUILD.** It has been applied to
-- production, where every object already exists and every statement therefore
-- did nothing — which proves the SQL parses and nothing more. The claim that
-- an empty database ends up matching production is reasoned from the
-- catalogues it was generated from. Proving it needs a scratch Postgres with
-- pgvector, `migrations/*.sql` applied in order, and its catalogues diffed
-- against production. Until someone does that, treat this as the best
-- available record rather than a verified one.
--
-- TWO DIVERGENCES ARE REPRODUCED RATHER THAN FIXED, because a lineage repair
-- that quietly changes production is the opposite of what this is for:
--
--   1. `user_facts` has RLS ENABLED but not FORCED, where its four siblings
--      are forced. Forcing it is a behaviour change on the memory path and
--      belongs in its own migration with its own evidence.
--   2. `audit_logs` carries two identical indexes, `audit_logs_recent` and
--      `idx_audit_logs_created_at` — the drift AGENTS.md already records.
--      Only the ones production actually has are written here.
--
-- `fact_tsv` is a plain column with no trigger and no generated expression in
-- production. Whatever maintains it is application code, not the schema.
--
-- Idempotent throughout. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

/* ---------------------------------------------------------------------------
 * USERS — the root of every foreign key in this schema.
 * ------------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The identity Clerk owns. UNIQUE is the whole account boundary: two rows
  -- with one clerk_id is two balances for one person.
  clerk_id               TEXT NOT NULL UNIQUE,
  email                  TEXT,
  name                   TEXT,
  avatar_url             TEXT,
  is_admin               BOOLEAN DEFAULT FALSE,
  plan                   TEXT DEFAULT 'free',
  created_at             TIMESTAMPTZ DEFAULT now(),
  suspended              BOOLEAN DEFAULT FALSE,
  last_seen              TIMESTAMPTZ,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  conversation_summary   TEXT DEFAULT ''::text
);

CREATE INDEX IF NOT EXISTS users_email ON users USING btree (email);
CREATE INDEX IF NOT EXISTS users_stripe_customer ON users USING btree (stripe_customer_id);
CREATE INDEX IF NOT EXISTS users_stripe_subscription ON users USING btree (stripe_subscription_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY users_self_read ON users FOR SELECT
    USING ((id = (SELECT current_app_user_id())) OR (SELECT current_app_is_admin()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY users_self_update ON users FOR UPDATE
    USING (id = (SELECT current_app_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ---------------------------------------------------------------------------
 * CHATS — the transcript. `messages` is the server's own copy, and 019's
 * reason for existing is that the turn path read the client's instead.
 * ------------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS chats (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES users(id) ON DELETE CASCADE,
  title                TEXT DEFAULT 'New Chat'::text,
  messages             JSONB DEFAULT '[]'::jsonb,
  pinned               BOOLEAN DEFAULT FALSE,
  favorite             BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now(),
  conversation_summary TEXT
);

CREATE INDEX IF NOT EXISTS chats_user_recent ON chats USING btree (user_id, updated_at DESC);

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY chats_owner ON chats FOR ALL
    USING ((user_id = (SELECT current_app_user_id())) OR (SELECT current_app_is_admin()))
    WITH CHECK ((user_id = (SELECT current_app_user_id())) OR (SELECT current_app_is_admin()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ---------------------------------------------------------------------------
 * USAGE — the free-tier counter. The UNIQUE (user_id, date) is what makes
 * increment_usage's ON CONFLICT an upsert rather than a duplicate row.
 * ------------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS usage (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  date           DATE DEFAULT CURRENT_DATE,
  messages_count INTEGER DEFAULT 0,
  images_count   INTEGER DEFAULT 0,
  UNIQUE (user_id, date)
);

ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY usage_owner_read ON usage FOR SELECT
    USING (user_id = (SELECT current_app_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ---------------------------------------------------------------------------
 * AUDIT_LOGS — `user_id` is SET NULL rather than CASCADE on purpose: deleting
 * an account must not delete the record that something was done.
 * ------------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  metadata   JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_action ON audit_logs USING btree (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_recent ON audit_logs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs USING btree (user_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY audit_owner_read ON audit_logs FOR SELECT
    USING (user_id = current_app_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ---------------------------------------------------------------------------
 * USER_FACTS — memory. `vector(768)` is load-bearing: see AGENTS.md on why
 * every row in that column must come from one embedding model.
 * ------------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS user_facts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
  fact               TEXT NOT NULL,
  category           TEXT DEFAULT 'general'::text,
  embedding          VECTOR(768),
  created_at         TIMESTAMPTZ DEFAULT now(),
  kind               TEXT NOT NULL DEFAULT 'semantic'::text,
  chat_id            UUID,
  source_turn_id     TEXT,
  confidence         REAL,
  expires_at         TIMESTAMPTZ,
  superseded_by      UUID,
  conflict_state     TEXT,
  updated_at         TIMESTAMPTZ,
  embedding_model    TEXT,
  embedding_dim      INTEGER,
  embedding_status   TEXT,
  embedding_attempts INTEGER NOT NULL DEFAULT 0,
  embedded_at        TIMESTAMPTZ,
  fact_tsv           TSVECTOR,
  CONSTRAINT user_facts_kind_check
    CHECK (kind = ANY (ARRAY['semantic'::text, 'preference'::text, 'procedure'::text, 'episodic'::text])),
  -- An episodic fact is scoped to a chat and a non-episodic one is not. The
  -- equality states both halves at once.
  CONSTRAINT user_facts_episodic_scope_check
    CHECK ((kind = 'episodic'::text) = (chat_id IS NOT NULL)),
  CONSTRAINT user_facts_conflict_check
    CHECK ((conflict_state IS NULL) OR (conflict_state = ANY (ARRAY['none'::text, 'disputed'::text, 'superseded'::text]))),
  CONSTRAINT user_facts_embedding_status_check
    CHECK ((embedding_status IS NULL) OR (embedding_status = ANY (ARRAY['ok'::text, 'pending'::text, 'failed'::text, 'stale'::text])))
);

CREATE INDEX IF NOT EXISTS user_facts_user_recent ON user_facts USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_facts_user_kind_live
  ON user_facts USING btree (user_id, kind, created_at DESC) WHERE (superseded_by IS NULL);
CREATE INDEX IF NOT EXISTS user_facts_embedding_backlog
  ON user_facts USING btree (user_id, embedding_attempts)
  WHERE (embedding_status = ANY (ARRAY['pending'::text, 'stale'::text, 'failed'::text]));
CREATE INDEX IF NOT EXISTS user_facts_fact_tsv ON user_facts USING gin (fact_tsv);

-- ENABLE without FORCE, reproducing production. See the header.
ALTER TABLE user_facts ENABLE ROW LEVEL SECURITY;

/* ---------------------------------------------------------------------------
 * INCREMENT_USAGE — the last project function that no migration created.
 * Transcribed from pg_get_functiondef.
 * ------------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id  uuid,
  p_date     date,
  p_messages integer DEFAULT 0,
  p_images   integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO usage (user_id, date, messages_count, images_count)
  VALUES (p_user_id, p_date, p_messages, p_images)
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    messages_count = usage.messages_count + p_messages,
    images_count = usage.images_count + p_images;
END;
$function$;
