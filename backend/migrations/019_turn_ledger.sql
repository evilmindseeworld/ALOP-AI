-- 019_turn_ledger.sql
--
-- Additive and re-runnable. Apply with
--   node scripts/run-migration.mjs 019_turn_ledger.sql
--
-- THE SERVER'S OWN RECORD OF A TURN, and the reservation ledger that makes
-- admission idempotent.
--
-- WHY. Three things were true at once and only became a problem together:
--
--   1. A turn's history came from `req.body.history`. lib/history.js sanitises
--      it hard — roles, sizes, types — but sanitised client input is still
--      client input: what the model is told happened earlier in a conversation
--      was whatever the caller said happened. The server already stores the
--      real transcript in `chats.messages`; it simply never read it.
--   2. A dropped connection lost the answer. Everything about a turn lived in
--      one HTTP response and in memory. A phone changing network mid-answer got
--      nothing, and the tokens were still paid for.
--   3. Admission was atomic but not idempotent. `reserve_user_spend` cannot be
--      applied twice safely, and nothing recorded that a given turn had already
--      reserved — so a retry inside one turn, or a settlement running twice from
--      two paths, moved a real user's balance by an amount nobody intended.
--
-- WHAT IS STORED, AND WHAT IS NOT. The question and the answer are user data
-- and are stored under the same rules `chats` already lives by: owned by a
-- user, RLS forced, deleted with the user. Nothing here stores prompts,
-- provider payloads, seat drafts or search results — the partial ANSWER only,
-- because that is the thing a reconnecting client needs and the thing that was
-- being thrown away.

/* ---------------------------------------------------------------------------
 * THE TURN LEDGER
 * ------------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS turns (
  -- The server's handle for ONE execution. lib/turn-context.js mints it.
  id             UUID PRIMARY KEY,

  -- The CLIENT's handle, from `X-Operation-Id`. Deliberately NOT unique: a user
  -- who retries a failed send produces a second turn under the same operation,
  -- and collapsing those would make "charged once for two executions"
  -- indistinguishable from "charged twice for one".
  operation_id   TEXT NOT NULL,

  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id        UUID REFERENCES chats(id) ON DELETE CASCADE,

  -- running -> complete | failed | aborted. A row is never deleted on failure;
  -- a failed turn that spent money is exactly the row worth keeping.
  state          TEXT NOT NULL DEFAULT 'running',
  category       TEXT,

  -- The user's message, so a resumed stream can be shown what it is answering
  -- without the client having to re-send it.
  question       TEXT NOT NULL DEFAULT '',

  -- The answer SO FAR. Appended at checkpoints while the answer streams, so a
  -- connection that dies mid-sentence leaves something to recover.
  answer         TEXT NOT NULL DEFAULT '',
  answer_complete BOOLEAN NOT NULL DEFAULT FALSE,

  -- Monotonic counter of answer chunks written. An SSE client that reconnects
  -- sends its last id and is served the tail rather than the whole answer.
  last_event_id  INTEGER NOT NULL DEFAULT 0,

  -- Non-user metadata: model, textSource, citations, evidence ids. Held to
  -- lib/schemas.js FINAL_ANSWER_META on write.
  meta           JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The resume lookup: "the newest turn for this operation, belonging to this
-- user". user_id is in the index rather than only in the WHERE clause because
-- the ownership check is not optional and must not be a second round trip.
CREATE INDEX IF NOT EXISTS turns_operation_idx
  ON turns (user_id, operation_id, created_at DESC);

-- The history read: "the last N complete turns of this chat".
CREATE INDEX IF NOT EXISTS turns_chat_idx
  ON turns (chat_id, created_at DESC)
  WHERE chat_id IS NOT NULL;

ALTER TABLE turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE turns FORCE ROW LEVEL SECURITY;
-- Service-role only, exactly like user_spend and stripe_events: the backend is
-- the only writer and the only reader, and it always filters by user_id itself.
-- Default deny is the specification, so there is deliberately no policy here.

/* ---------------------------------------------------------------------------
 * THE RESERVATION LEDGER
 * ------------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS turn_reservations (
  turn_id           UUID PRIMARY KEY,
  operation_id      TEXT NOT NULL,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reserved_cents    INTEGER NOT NULL DEFAULT 0,
  reserved_requests INTEGER NOT NULL DEFAULT 0,
  settled_cents     INTEGER,
  settled_requests  INTEGER,
  -- reserved -> settled. One transition, enforced by the WHERE clause in
  -- settle_turn_reservation, which is what makes a double settlement a no-op
  -- rather than a double refund.
  state             TEXT NOT NULL DEFAULT 'reserved',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at        TIMESTAMPTZ
);

ALTER TABLE turn_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE turn_reservations FORCE ROW LEVEL SECURITY;

/*
 * RESERVE ONCE PER TURN, WHATEVER HAPPENS.
 *
 * Returns `claimed = TRUE` for the caller that actually took the reservation
 * and `FALSE` for any later caller with the same turn id. Only a claiming
 * caller may go on to move the money; a non-claiming one has already been
 * charged and must not be charged again.
 *
 * SET search_path = '' and fully-qualified names, because a SECURITY DEFINER-
 * adjacent function that resolves `turn_reservations` through a caller-supplied
 * search_path can be pointed at a different table. Every function in this file
 * is hardened the same way; 020 does the same for the ones that predate the
 * rule.
 */
CREATE OR REPLACE FUNCTION claim_turn_reservation(
  p_turn_id      UUID,
  p_operation_id TEXT,
  p_user_id      UUID,
  p_cents        INTEGER,
  p_requests     INTEGER
)
RETURNS TABLE (claimed BOOLEAN, state TEXT)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rows  INTEGER := 0;
  v_state TEXT;
BEGIN
  INSERT INTO public.turn_reservations (turn_id, operation_id, user_id, reserved_cents, reserved_requests)
  VALUES (p_turn_id, p_operation_id, p_user_id, GREATEST(p_cents, 0), GREATEST(p_requests, 0))
  ON CONFLICT (turn_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  SELECT r.state INTO v_state FROM public.turn_reservations r WHERE r.turn_id = p_turn_id;
  RETURN QUERY SELECT v_rows > 0, COALESCE(v_state, 'unknown');
END;
$$;

/*
 * SETTLE ONCE PER TURN.
 *
 * The `AND state = 'reserved'` is the whole mechanism: the second call updates
 * no rows and reports `settled = FALSE`, so the caller knows not to apply the
 * refund to `user_spend` a second time. Two paths in server.js can reach a
 * settlement — the request-ceiling refusal and the route's `finally` — and a
 * turn refused by the second ceiling settles early and then falls through the
 * same `finally`.
 */
CREATE OR REPLACE FUNCTION settle_turn_reservation(
  p_turn_id  UUID,
  p_cents    INTEGER,
  p_requests INTEGER
)
RETURNS TABLE (settled BOOLEAN, prior_cents INTEGER, prior_requests INTEGER)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_reserved_cents    INTEGER;
  v_reserved_requests INTEGER;
  v_rows              INTEGER;
BEGIN
  UPDATE public.turn_reservations
     SET state = 'settled',
         settled_cents = GREATEST(p_cents, 0),
         settled_requests = GREATEST(p_requests, 0),
         settled_at = now()
   WHERE turn_id = p_turn_id
     AND state = 'reserved'
  RETURNING reserved_cents, reserved_requests
       INTO v_reserved_cents, v_reserved_requests;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN QUERY SELECT v_rows > 0, COALESCE(v_reserved_cents, 0), COALESCE(v_reserved_requests, 0);
END;
$$;

/*
 * A CHECKPOINT MAY ONLY EVER GROW THE ANSWER.
 *
 * Checkpoints are written from a streaming loop and settle out of order under
 * load. Without the length guard a late-arriving early checkpoint truncates an
 * answer that had already been written further, and the user's recovered
 * answer would be shorter than the one they watched arrive.
 */
CREATE OR REPLACE FUNCTION checkpoint_turn(
  p_turn_id       UUID,
  p_answer        TEXT,
  p_last_event_id INTEGER
)
RETURNS VOID
LANGUAGE sql
SET search_path = ''
AS $$
  UPDATE public.turns
     SET answer = p_answer,
         last_event_id = GREATEST(last_event_id, COALESCE(p_last_event_id, 0)),
         updated_at = now()
   WHERE id = p_turn_id
     AND state = 'running'
     AND length(p_answer) >= length(answer);
$$;

-- Housekeeping. A turn row is worth keeping while anyone might resume it or ask
-- what a bill was made of; beyond that it is a copy of data `chats` already
-- holds:
--   DELETE FROM turns WHERE created_at < now() - interval '30 days';
--   DELETE FROM turn_reservations WHERE created_at < now() - interval '30 days';
