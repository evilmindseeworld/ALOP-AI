-- The index the chat list has always needed.
--
-- /api/chats runs exactly one shape of query, on every single app load:
--
--     select ... from chats where user_id = $1 order by updated_at desc
--
-- and there was no index on chats at all. Postgres answers that with a
-- sequential scan of every row in the table followed by a sort. It is
-- imperceptible at ten rows and it is the whole response time at ten thousand,
-- which is the point at which nobody is looking for a missing index because the
-- app "used to be fine".
--
-- The column ORDER matters and is not arbitrary. `user_id` first because it is
-- the equality predicate, `updated_at DESC` second because it is the sort — a
-- composite in that order lets Postgres seek straight to one user's rows and
-- read them already sorted, so the sort disappears from the plan entirely. The
-- reverse order would index the sort and still scan for the user.
--
-- CONCURRENTLY so this does not take a write lock on a live table. It cannot
-- run inside a transaction block, which is why this file contains this
-- statement and nothing else.

CREATE INDEX CONCURRENTLY IF NOT EXISTS chats_user_recent
  ON chats (user_id, updated_at DESC);
