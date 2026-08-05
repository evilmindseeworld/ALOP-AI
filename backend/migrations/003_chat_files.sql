-- 003_chat_files.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 003_chat_files.sql
--
-- Storage for non-image uploads, so the council's read_file tool has something
-- to read.
--
-- WHY POSTGRES AND NOT A BUCKET OR A DISK.
--
-- The design's rule is that a model passes an OPAQUE ID and never a path,
-- because a model-issued path is attacker-controlled the moment anyone can get
-- text into a prompt, and there is no allowlist of directories that makes
-- read_file("../../.env") safe to even attempt.
--
-- A table makes that structural rather than something the code has to remember:
-- the lookup is `WHERE id = $1 AND user_id = $2 AND chat_id = $3`, there is no
-- path to traverse because there is no path, and ownership is a predicate
-- rather than a convention. A bucket would reintroduce a key namespace to get
-- wrong, and Render's disk is ephemeral anyway.
--
-- Content is capped at 512KB on the way in (lib/file-intake.js), so this stays
-- comfortably inside what a TEXT column and a row-per-file want to hold.

CREATE TABLE IF NOT EXISTS chat_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  content     TEXT NOT NULL,
  truncated   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Both cascades are deliberate. A file belongs to a conversation: deleting the
-- chat deletes what was attached to it, and deleting the user takes both. The
-- alternative is orphaned rows holding user content indefinitely, which is a
-- data-retention problem rather than a tidiness one.

-- The lookup read_file performs, in the order it filters.
CREATE INDEX IF NOT EXISTS chat_files_scope ON chat_files (chat_id, user_id, created_at DESC);

-- Same posture as every other table in 002: RLS on, FORCE so it applies to the
-- owner too, default deny, and one owner policy for the browser-side client
-- that does not exist yet but will. The backend uses the service role and
-- bypasses all of it — app-level scoping in server.js is still the control that
-- matters today. See 002 for the full argument.
ALTER TABLE chat_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_files FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_files_owner ON chat_files;
CREATE POLICY chat_files_owner ON chat_files
  FOR ALL USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());
