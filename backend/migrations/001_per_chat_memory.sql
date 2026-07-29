-- 001_per_chat_memory.sql
--
-- Run this in the Supabase SQL editor before deploying the matching backend.
-- Both statements are additive and safe to re-run; nothing is dropped and no
-- existing data is rewritten.
--
-- Why:
--   * conversation_summary lived on `users`, so a single summary was shared by
--     every chat a user had. Context from one conversation leaked into
--     unrelated ones, which is the "the AI is confused about what we discussed"
--     symptom.
--   * Thumbs up/down notes were concatenated onto that same field, so coaching
--     notes and conversation facts competed for the same 2000 characters and
--     progressively corrupted each other.

-- Per-chat memory.
ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS conversation_summary TEXT;

-- Feedback notes get their own home, one row per rating.
CREATE TABLE IF NOT EXISTS feedback_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('up', 'down')),
  note        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_notes_user_recent
  ON feedback_notes (user_id, created_at DESC);

-- The old per-user column is intentionally left in place. Drop it only after
-- confirming the new path works in production:
--   ALTER TABLE users DROP COLUMN conversation_summary;
