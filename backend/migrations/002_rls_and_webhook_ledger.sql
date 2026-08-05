-- 002_rls_and_webhook_ledger.sql
--
-- Additive and re-runnable: nothing is dropped, no existing row is rewritten.
-- Apply with `node scripts/run-migration.mjs 002_rls_and_webhook_ledger.sql`,
-- which verifies its own work.
--
-- Three things:
--   1. Row Level Security on every table that holds user data.
--   2. A ledger so a replayed Stripe webhook cannot be applied twice.
--   3. audit_logs survives the deletion of the user it describes.

-- ===========================================================================
-- 1. Row Level Security
-- ===========================================================================
--
-- READ THIS BEFORE ASSUMING THIS SECURES THE API.
--
-- The backend connects with the SERVICE ROLE key, and the service role BYPASSES
-- RLS entirely. Every policy below is invisible to server.js. Ownership on the
-- API path is enforced by requireOwnership() and by the .eq('user_id', …) on
-- each query, and that is still the control that matters for the running app.
--
-- So what is this for? Three real cases, in descending order of likelihood:
--
--   * The anon/publishable key is public by design — it ships in the frontend
--     bundle. Today nothing uses it against PostgREST. The day something does
--     (a realtime subscription, a direct-from-browser read, a Supabase client
--     added for one feature), RLS is the difference between "that endpoint is
--     scoped to the caller" and "every chat in the database is readable by
--     anyone who opens devtools". Turning it on before that day is the whole
--     point; turning it on after is an incident.
--   * A table left RLS-disabled is reported by Supabase's own advisors as an
--     error, and a permanent known-bad line in that report is how a real one
--     gets ignored.
--   * FORCE ROW LEVEL SECURITY below applies policies even to the table owner,
--     so a future migration or a psql session as the owner cannot quietly read
--     across users either.
--
-- What it is NOT: protection against a leaked service-role key. That key is
-- god. Rotate it if it leaks; RLS will not save you.

ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats          ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage          ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     ENABLE ROW LEVEL SECURITY;

ALTER TABLE users          FORCE ROW LEVEL SECURITY;
ALTER TABLE chats          FORCE ROW LEVEL SECURITY;
ALTER TABLE usage          FORCE ROW LEVEL SECURITY;
ALTER TABLE feedback_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     FORCE ROW LEVEL SECURITY;

-- Default deny. With RLS enabled and no policy, every non-service-role query
-- returns zero rows — which is the correct posture, and the policies below open
-- exactly the paths a browser-side client would legitimately need.

-- The app authenticates with Clerk, not Supabase Auth, so auth.uid() is null
-- here. A Clerk JWT carries the Clerk user id in `sub`, and users.clerk_id is
-- what it matches. This helper is the single place that mapping is written.
CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS UUID
  LANGUAGE sql STABLE
  -- SECURITY INVOKER (the default) is deliberate: a DEFINER function reading
  -- users would itself bypass the RLS being defined on users.
  AS $$
    SELECT id FROM users
    WHERE clerk_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')
    LIMIT 1
  $$;

DROP POLICY IF EXISTS users_self_read   ON users;
DROP POLICY IF EXISTS users_self_update ON users;
CREATE POLICY users_self_read ON users
  FOR SELECT USING (id = current_app_user_id());
-- No self-INSERT and no self-DELETE: accounts are created by ensureUser() and
-- removed by an admin, both service-role paths. A user may edit their own row
-- but not the columns that decide what they are allowed to do.
CREATE POLICY users_self_update ON users
  FOR UPDATE USING (id = current_app_user_id())
  WITH CHECK (
    id = current_app_user_id()
    AND plan      = (SELECT plan      FROM users u WHERE u.id = users.id)
    AND is_admin  = (SELECT is_admin  FROM users u WHERE u.id = users.id)
    AND suspended = (SELECT suspended FROM users u WHERE u.id = users.id)
  );

DROP POLICY IF EXISTS chats_owner ON chats;
CREATE POLICY chats_owner ON chats
  FOR ALL USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());

DROP POLICY IF EXISTS feedback_owner ON feedback_notes;
CREATE POLICY feedback_owner ON feedback_notes
  FOR ALL USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());

-- Usage and audit_logs are read-only to their subject. Nobody edits their own
-- meter, and nobody edits their own audit trail — a writable audit log is not
-- an audit log.
DROP POLICY IF EXISTS usage_owner_read ON usage;
CREATE POLICY usage_owner_read ON usage
  FOR SELECT USING (user_id = current_app_user_id());

DROP POLICY IF EXISTS audit_owner_read ON audit_logs;
CREATE POLICY audit_owner_read ON audit_logs
  FOR SELECT USING (user_id = current_app_user_id());

-- ===========================================================================
-- 2. Stripe webhook ledger
-- ===========================================================================
--
-- Stripe delivers at-least-once: it retries on any non-2xx, and can repeat a
-- delivery that already succeeded. The handler claims an event id here before
-- acting, and a duplicate-key violation means it has run before.
--
-- The current handlers all set a field to a fixed value and so are replay-safe
-- by accident. This makes it a property of the endpoint instead, before someone
-- adds a handler that grants credits.

CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,      -- Stripe's evt_… id
  type         TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stripe's own retry window is days, not months. Anything older than that can
-- never arrive again, so the ledger does not need to grow without bound:
--   DELETE FROM stripe_events WHERE processed_at < now() - interval '30 days';

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events FORCE ROW LEVEL SECURITY;
-- No policy at all: this table is service-role only. Default deny is the spec.

-- ===========================================================================
-- 3. audit_logs outlives its subject
-- ===========================================================================
--
-- If audit_logs.user_id CASCADEs, deleting a user deletes the record of the
-- deletion, and the one event most worth auditing is the one that erases its
-- own evidence. SET NULL keeps the row; the metadata JSON keeps the target id
-- and email.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'user_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'audit_logs' AND constraint_name = 'audit_logs_user_id_fkey'
  ) THEN
    ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_user_id_fkey;
  END IF;

  ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
END $$;

CREATE INDEX IF NOT EXISTS audit_logs_recent ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action ON audit_logs (action, created_at DESC);
