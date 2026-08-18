-- 029_workspace_files.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 029_workspace_files.sql
-- or through the Supabase MCP apply_migration.
--
-- A DOCUMENT ATTACHED ONCE, SEARCHABLE FROM EVERY CONVERSATION.
--
-- Every file is bound to one chat, so the same syllabus, price list or handbook
-- has to be uploaded again in every conversation that needs it — and each copy
-- counts against MAX_FILES_PER_CHAT, gets extracted again, and is stored again.
-- The person doing that is not attaching a file to a conversation. They are
-- telling the app what their material IS.
--
-- WHAT A WORKSPACE FILE IS, EXACTLY: a `chat_files` row with `chat_id IS NULL`.
-- Not a second table, not a second store, not a second retrieval path. It is
-- the same row, read by the same `read_file` and `search_files`, ranked by the
-- same lexical and vector sides. Everything already built keeps working because
-- there is nothing new for it to know about.
--
-- WHY NULL IS THE RIGHT SPELLING, AND NOT A `scope` COLUMN. A foreign key does
-- not constrain a NULL, so `chat_id IS NULL` removes the row from the
-- `ON DELETE CASCADE` in 003 by construction. That is the property this feature
-- needs and the one a `scope = 'workspace'` column would NOT have: with a
-- non-null chat_id still sitting beside it, deleting the conversation a file
-- happened to be uploaded into would delete the workspace document too, and the
-- flag would be a comment rather than a mechanism.
--
-- WHAT DOES NOT MOVE: the object in the bucket. Its key is
-- `{user_id}/{chat_id}/{file_id}` from the moment of upload (028), and
-- `storage_path` is the only thing that addresses it. Rewriting the key on
-- promotion would mean a copy, a delete, and a window where a download 404s for
-- a file that exists. The key is an address, not a description.

ALTER TABLE chat_files ALTER COLUMN chat_id DROP NOT NULL;

COMMENT ON COLUMN chat_files.chat_id IS
  'The conversation this file is attached to. NULL means a WORKSPACE file: it belongs to the user, is visible from every one of their chats, and is deliberately outside the ON DELETE CASCADE from chats. See 029.';

-- The read `search_files` performs for a workspace file, in the order it
-- filters. The chat-scoped index from 003 cannot serve this: its leading column
-- is chat_id, and this query has no chat_id to give it.
CREATE INDEX IF NOT EXISTS chat_files_workspace
  ON chat_files (user_id, created_at DESC) WHERE chat_id IS NULL;

-- RLS is unchanged and does not need to change: `chat_files_owner` from 012 is
-- `user_id = current_app_user_id()`, which was never about the chat. A
-- workspace row is owned exactly as strongly as a chat row.
--
-- The 028 delete trigger is unchanged too, and still correct: a workspace row
-- deleted by the user still records its object for the sweeper, and it can no
-- longer be deleted by a chat cascade at all, which is the point.
