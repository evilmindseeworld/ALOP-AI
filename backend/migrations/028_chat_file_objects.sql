-- 028_chat_file_objects.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 028_chat_file_objects.sql
-- or through the Supabase MCP apply_migration.
--
-- THE GAP THIS CLOSES. A user uploads a PDF; `lib/file-intake.js` extracts its
-- text, stores that in `chat_files.content`, and DISCARDS the original bytes.
-- The council can answer questions about the document forever and the person
-- who uploaded it can never get their own file back. That is the whole reason
-- for a bucket here, and it is worth being precise that it is the ONLY reason:
-- retrieval, citations and every path a model touches keep reading Postgres.
--
-- WHY THIS DOES NOT REOPEN WHAT 003 CLOSED.
--
-- 003 rejected a bucket, and the argument was security, not convenience:
--
--   > A bucket would reintroduce a key namespace to get wrong ... there is no
--   > path to traverse because there is no path, and ownership is a predicate
--   > rather than a convention.
--
-- That argument is still correct, so the key namespace is removed as a thing
-- anyone can influence:
--
--   THE KEY IS DERIVED, NEVER SUPPLIED. It is exactly
--   `{user_id}/{chat_id}/{file_id}` — three UUIDs the SERVER already resolved
--   while answering an authenticated request. No client string, no model
--   string, and specifically NOT the filename, ever enters it. A filename is
--   attacker-controlled; `../../` in a filename is the classic way a key
--   namespace becomes a path, and the only reliable defence is that the name
--   is not part of the address at all. See `lib/storage-keys.js`, which
--   refuses to build a key from anything that is not a v4 UUID.
--
--   OWNERSHIP IS STILL A PREDICATE. Nothing is served by key. A download
--   resolves the ROW first — `WHERE id = $1 AND user_id = $2 AND chat_id = $3`,
--   the same predicate as before — and only then mints a short-lived signed
--   URL for the object that row points at. The bucket is private; there is no
--   URL to guess and none that outlives the minute it was issued in.
--
--   THE ID A MODEL SEES IS UNCHANGED. `read_file` and `search_files` still take
--   the opaque `chat_files.id` and still read `content` out of Postgres. No
--   tool gains a key, a path, or a network fetch.

ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS storage_path TEXT;

COMMENT ON COLUMN chat_files.storage_path IS
  'Key of the original upload in the private chat-files bucket, always {user_id}/{chat_id}/{id}. NULL means the original was not retained (upload predates 028, or the object write failed) and download is unavailable for this row. See lib/storage-keys.js.';

-- NULLABLE, AND THAT IS A FEATURE. A row whose text extracted fine but whose
-- object write failed is still a working row: the council can read it, and the
-- download endpoint answers 404 with a reason instead of the request failing.
-- Storing the original is an ENHANCEMENT to an upload that already succeeded,
-- so it is never allowed to fail the upload.

-- The bucket. Private, size-capped to the same 8MB ceiling `file-intake.js`
-- enforces, so a bug on the way in cannot store something the door refuses.
-- `on conflict do nothing` keeps this re-runnable.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-files', 'chat-files', false, 8388608)
ON CONFLICT (id) DO NOTHING;

-- Same posture as 003: the backend uses the service role and bypasses all of
-- this, so app-level scoping is still the control that matters today. These
-- policies are defence in depth and the answer for the browser-side client that
-- does not exist yet. The first path segment IS the owner, which is only safe
-- because the key is derived rather than supplied.
DROP POLICY IF EXISTS chat_files_objects_owner ON storage.objects;
CREATE POLICY chat_files_objects_owner ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'chat-files'
    AND (storage.foldername(name))[1] = current_app_user_id()::text
  )
  WITH CHECK (
    bucket_id = 'chat-files'
    AND (storage.foldername(name))[1] = current_app_user_id()::text
  );

-- ORPHANS ARE THE PART A BUCKET GETS WRONG.
--
-- `chat_files` cascades from both `users` and `chats` (see 003), and a cascade
-- runs in the DATABASE — no application code executes, so nothing deletes the
-- object. Deleting a conversation would leave its user's documents in the
-- bucket indefinitely, which is the data-retention problem 003 named when it
-- chose the cascades, reappearing one layer down.
--
-- So the row's disappearance records the object that outlived it, and a sweeper
-- deletes it. A queue rather than an immediate call because a trigger cannot
-- make a network request, and should not try.
CREATE TABLE IF NOT EXISTS deleted_file_objects (
  id            BIGSERIAL PRIMARY KEY,
  storage_path  TEXT NOT NULL,
  deleted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  swept_at      TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT
);

COMMENT ON TABLE deleted_file_objects IS
  'Objects whose chat_files row is gone. Written by a trigger because cascades run in the database with no application code in the path. Drained by the storage_sweep job. swept_at IS NULL means the object may still exist in the bucket.';

-- Only rows the sweeper still owes work on. A swept row stays for the audit
-- trail but stops being scanned.
CREATE INDEX IF NOT EXISTS deleted_file_objects_pending
  ON deleted_file_objects (deleted_at) WHERE swept_at IS NULL;

CREATE OR REPLACE FUNCTION record_deleted_file_object()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- A row that never had an object has nothing to sweep.
  IF OLD.storage_path IS NOT NULL THEN
    INSERT INTO deleted_file_objects (storage_path) VALUES (OLD.storage_path);
  END IF;
  RETURN OLD;
END;
$$;

-- `search_path` is pinned for the same reason 023 pinned every other function's:
-- a SECURITY DEFINER function that resolves an unqualified name through the
-- caller's search_path can be made to call something else entirely.

DROP TRIGGER IF EXISTS chat_files_record_deleted_object ON chat_files;
CREATE TRIGGER chat_files_record_deleted_object
  AFTER DELETE ON chat_files
  FOR EACH ROW
  EXECUTE FUNCTION record_deleted_file_object();

ALTER TABLE deleted_file_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE deleted_file_objects FORCE ROW LEVEL SECURITY;
-- No policy, therefore default deny for everyone but the service role. There is
-- no user-facing read of this table; it is a work list for the sweeper, and it
-- holds one user's storage keys, which name another user's nothing but should
-- still not be readable by a browser client.
