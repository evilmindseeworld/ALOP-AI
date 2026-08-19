'use strict';

const { validate, FINAL_ANSWER_META, TURN_RELIABILITY_META } = require('./schemas');

/**
 * The server's own record of a turn: what was asked, how much of the answer has
 * been written, and whether it finished.
 *
 * THREE THINGS IT REPLACES.
 *
 *   1. `req.body.history` as the source of truth for what was said earlier.
 *      lib/history.js sanitises that hard, but sanitised client input is still
 *      client input: the model was told the conversation went however the caller
 *      said it went. The real transcript is already in `chats.messages`;
 *      `canonicalHistory` reads it.
 *   2. An answer that existed only in one HTTP response. A phone changing
 *      network mid-answer got nothing, and the tokens were paid for anyway.
 *      Checkpoints put the partial answer somewhere a reconnect can find it.
 *   3. Admission that was atomic but not idempotent. `claim` returns false for
 *      the second caller with the same turn id, and `settle` transitions once.
 *
 * EVERY WRITE HERE IS BEST-EFFORT AND NONE OF THEM CAN FAIL A TURN. This is a
 * recorder attached to the path that answers a user; a Postgres blip must
 * degrade the recovery story, not the product. Failures are reported through
 * `onError` and counted, so a ledger that has quietly stopped recording is not
 * also quiet about it.
 */

/** How much of a partial answer is worth keeping. Longer than any real answer. */
const MAX_ANSWER_CHARS = 200_000;

/** Turns read back as canonical history. The client used to send 8. */
const DEFAULT_HISTORY_TURNS = 10;

const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function createTurnLedger({
  supabase,
  onError = (msg) => console.error(msg),
  now = Date.now,
  historyTurns = DEFAULT_HISTORY_TURNS,
} = {}) {
  if (!supabase) throw new TypeError('createTurnLedger needs a supabase client');

  let failures = 0;
  const guard = async (what, work, fallback) => {
    try {
      return await work();
    } catch (error) {
      failures += 1;
      onError(`[TURNS] ${what} failed: ${error && error.message ? error.message : String(error)}`);
      return fallback;
    }
  };

  return {
    failures: () => failures,

    /**
     * Open the row for a turn. Idempotent: a second call with the same turn id
     * inserts nothing and is not an error.
     */
    async begin({ turnId, operationId, userId, chatId = null, question = '', category = null }) {
      if (!turnId || !userId) return false;
      return guard('begin', async () => {
        const { error } = await supabase.from('turns').upsert({
          id: turnId,
          operation_id: String(operationId || ''),
          user_id: userId,
          chat_id: chatId || null,
          state: 'running',
          category,
          /* Clipped to what the model was actually sent. Storing more than the
           * turn used would make this a second, longer-lived copy of user input
           * than the one the turn ran on. */
          question: clip(question, 8_000),
        }, { onConflict: 'id', ignoreDuplicates: true });
        if (error) throw error;
        return true;
      }, false);
    },

    /**
     * Record how much of the answer has been written.
     *
     * The SQL refuses a checkpoint that would SHORTEN the answer, because these
     * are written from a streaming loop and settle out of order under load. A
     * late early checkpoint would otherwise truncate an answer the user watched
     * arrive in full.
     */
    async checkpoint({ turnId, answer, lastEventId = 0 }) {
      if (!turnId || typeof answer !== 'string') return false;
      return guard('checkpoint', async () => {
        const { error } = await supabase.rpc('checkpoint_turn', {
          p_turn_id: turnId,
          p_answer: clip(answer, MAX_ANSWER_CHARS),
          p_last_event_id: Math.max(0, Math.floor(Number(lastEventId) || 0)),
        });
        if (error) throw error;
        return true;
      }, false);
    },

    /**
     * Close the row.
     *
     * @param {'complete'|'failed'|'aborted'} state
     * @param {object|null} meta  held to one of the two `turns.meta` contracts
     *        -- the final-answer record, or the reliability record the route's
     *        `finally` builds from the closing telemetry snapshot. An
     *        off-contract meta is dropped rather than stored, because a ledger
     *        row whose shape nobody checked is a ledger row nobody can query.
     *
     *        THIS REPLACES `meta`, it does not merge into it. That is safe
     *        because nothing else writes the column: `begin` leaves it at its
     *        `'{}'` default, `checkpoint_turn` (migrations/019) does not touch
     *        it, and this is the only `finish`. If a second writer ever appears,
     *        this is the line that has to become a merge.
     */
    async finish({ turnId, state = 'complete', answer = null, lastEventId = null, meta = null }) {
      if (!turnId) return false;
      const patch = {
        state,
        answer_complete: state === 'complete',
        updated_at: new Date(now()).toISOString(),
      };
      if (typeof answer === 'string') patch.answer = clip(answer, MAX_ANSWER_CHARS);
      if (Number.isFinite(lastEventId)) patch.last_event_id = Math.max(0, Math.floor(lastEventId));
      if (meta) {
        /* Two shapes, tried in turn, and both STRICT: `validate` refuses an
         * unknown key rather than carrying it into a row. Whichever matches
         * wins; a bag matching neither is reported and dropped. */
        const checked = [FINAL_ANSWER_META, TURN_RELIABILITY_META]
          .map((schema) => validate(schema, meta))
          .reduce((best, result) => (best.ok ? best : result));
        if (checked.ok) patch.meta = checked.value;
        else onError(`[TURNS] meta rejected for ${turnId}: ${checked.errors.join('; ')}`);
      }
      return guard('finish', async () => {
        const { error } = await supabase.from('turns').update(patch).eq('id', turnId);
        if (error) throw error;
        return true;
      }, false);
    },

    /**
     * What a reconnecting client needs: the newest turn for this operation that
     * belongs to this user.
     *
     * OWNERSHIP IS PART OF THE QUERY, not a check afterwards. An operation id is
     * a correlation handle minted in a browser, so it is guessable by
     * construction; without `user_id` in the WHERE clause this endpoint would
     * hand one user's answer to another on a guessed UUID.
     */
    async findForResume({ operationId, userId }) {
      if (!operationId || !userId) return null;
      return guard('findForResume', async () => {
        const { data, error } = await supabase
          .from('turns')
          .select('id,state,answer,answer_complete,last_event_id,question,category,meta,created_at')
          .eq('user_id', userId)
          .eq('operation_id', String(operationId))
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return data || null;
      }, null);
    },

    /**
     * THE CANONICAL TRANSCRIPT, read from the server's own store.
     *
     * `chats.messages` is what the server persisted after each turn, so it is
     * the record of what actually happened rather than the record the caller
     * says happened. Returned in the same `{role, content}` shape
     * `sanitizeHistory` produces, so the caller can substitute it without
     * changing anything downstream.
     *
     * NULL, NOT AN EMPTY ARRAY, when there is nothing to read — no chat id, no
     * row, or a failed read. An empty array is a claim ("this conversation has
     * no history") and would silently strip context from every turn during a
     * Postgres blip; null lets the caller fall back to the client's copy, which
     * is what it used before this existed.
     */
    async canonicalHistory({ chatId, userId, limit = historyTurns }) {
      if (!chatId || !userId) return null;
      return guard('canonicalHistory', async () => {
        const { data, error } = await supabase
          .from('chats')
          .select('messages')
          .eq('id', chatId)
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw error;
        const messages = Array.isArray(data?.messages) ? data.messages : null;
        if (!messages) return null;
        return messages
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-Math.max(2, limit * 2))
          .map((m) => ({ role: m.role, content: m.content }));
      }, null);
    },
  };
}

module.exports = { createTurnLedger, MAX_ANSWER_CHARS, DEFAULT_HISTORY_TURNS };
