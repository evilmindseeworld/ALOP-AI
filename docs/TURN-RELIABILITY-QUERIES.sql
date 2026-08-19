-- Read-only analytics over `turns.meta -> 'reliability'`.
--
-- SCOPE, AND IT IS NOT "ALL TRAFFIC". Every row here is a turn that reached
-- `turnLedger.begin`. A request refused before that -- a bad prompt, a blown
-- ceiling, an auth failure -- has no `turns` row at all and is deliberately
-- outside this surface. A rate computed here is a rate over BEGUN TURNS.
--
-- ALWAYS FILTER ON schemaVersion. The namespace is versioned so that a field
-- whose meaning changes gets a new version rather than silently poisoning a
-- historical average; a query that does not filter is a query that will one day
-- mix two definitions of the same column.
--
-- ALWAYS CHECK jsonb_typeof BEFORE jsonb_array_elements. `reliability.seats` is
-- guaranteed to be an array by lib/turn-reliability-meta.js -- that guarantee is
-- the whole reason this surface exists, since `audit_logs.metadata.seats` is a
-- number in some rows and an array in others. The check stays anyway: it costs
-- nothing, and `jsonb_array_elements` on a scalar raises and takes the whole
-- query with it rather than skipping the row.
--
-- NEVER READ A PERCENTAGE WITHOUT ITS n. Every query below returns one.
-- Suggested floor for acting on a rate: n >= 50.
--
-- These are read-only SELECTs. Adjust the `created_at` window per query.

-- Reusable shape:
--   FROM turns t, LATERAL (SELECT t.meta -> 'reliability' AS r) x
--   WHERE (x.r ->> 'schemaVersion')::int = 1


-- 1. 429 RATE BY MODEL, over provider attempts.
--    `byStatus` is turn-level, so this attributes a turn's 429s to the model
--    that answered synthesis. For per-seat attribution use query 6's shape.
SELECT
  COALESCE(r -> 'synthesis' ->> 'model', '(no synthesis)') AS model,
  COUNT(*)                                                  AS n_turns,
  SUM(COALESCE((r -> 'providerAttempts' -> 'byStatus' ->> '429')::int, 0)) AS n_429,
  SUM(COALESCE((r -> 'providerAttempts' ->> 'total')::int, 0))             AS n_attempts,
  ROUND(
    100.0 * SUM(COALESCE((r -> 'providerAttempts' -> 'byStatus' ->> '429')::int, 0))
    / NULLIF(SUM(COALESCE((r -> 'providerAttempts' ->> 'total')::int, 0)), 0)
  , 2) AS pct_429
FROM turns t
CROSS JOIN LATERAL (SELECT t.meta -> 'reliability' AS r) x
WHERE (x.r ->> 'schemaVersion')::int = 1
  AND t.created_at >= now() - interval '7 days'
GROUP BY 1
HAVING COUNT(*) >= 50
ORDER BY pct_429 DESC NULLS LAST;


-- 2. 404 RATE BY MODEL -- a model no provider serves any more. Same shape as
--    (1); a 404 wants the roster edited, where a 429 wants pacing.
SELECT
  COALESCE(r -> 'synthesis' ->> 'model', '(no synthesis)') AS model,
  COUNT(*)                                                  AS n_turns,
  SUM(COALESCE((r -> 'providerAttempts' -> 'byStatus' ->> '404')::int, 0)) AS n_404,
  SUM(COALESCE((r -> 'providerAttempts' ->> 'total')::int, 0))             AS n_attempts,
  ROUND(
    100.0 * SUM(COALESCE((r -> 'providerAttempts' -> 'byStatus' ->> '404')::int, 0))
    / NULLIF(SUM(COALESCE((r -> 'providerAttempts' ->> 'total')::int, 0)), 0)
  , 2) AS pct_404
FROM turns t
CROSS JOIN LATERAL (SELECT t.meta -> 'reliability' AS r) x
WHERE (x.r ->> 'schemaVersion')::int = 1
  AND t.created_at >= now() - interval '7 days'
GROUP BY 1
HAVING COUNT(*) >= 50
ORDER BY pct_404 DESC NULLS LAST;


-- 3. RETRY COUNT BY MODEL. `retries` counts physical requests that were not the
--    first attempt -- the difference between a seat and a request, which is what
--    an account-wide daily cap actually charges against.
SELECT
  COALESCE(r -> 'synthesis' ->> 'model', '(no synthesis)') AS model,
  COUNT(*)                                                 AS n_turns,
  SUM(COALESCE((r -> 'providerAttempts' ->> 'retries')::int, 0)) AS n_retries,
  ROUND(AVG(COALESCE((r -> 'providerAttempts' ->> 'retries')::int, 0)), 3) AS retries_per_turn
FROM turns t
CROSS JOIN LATERAL (SELECT t.meta -> 'reliability' AS r) x
WHERE (x.r ->> 'schemaVersion')::int = 1
  AND t.created_at >= now() - interval '7 days'
GROUP BY 1
HAVING COUNT(*) >= 50
ORDER BY n_retries DESC;


-- 4. RETRY-SUCCESS RATE BY MODEL: of the turns that retried at all, how many
--    ended with more successful attempts than failed ones. A retry that buys
--    nothing is latency and money for no answer.
SELECT
  COALESCE(r -> 'synthesis' ->> 'model', '(no synthesis)') AS model,
  COUNT(*) AS n_turns_with_retry,
  COUNT(*) FILTER (
    WHERE COALESCE((r -> 'providerAttempts' ->> 'ok')::int, 0) > 0
  ) AS n_retry_then_ok,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE COALESCE((r -> 'providerAttempts' ->> 'ok')::int, 0) > 0)
    / NULLIF(COUNT(*), 0)
  , 2) AS pct_retry_succeeded
FROM turns t
CROSS JOIN LATERAL (SELECT t.meta -> 'reliability' AS r) x
WHERE (x.r ->> 'schemaVersion')::int = 1
  AND COALESCE((x.r -> 'providerAttempts' ->> 'retries')::int, 0) > 0
  AND t.created_at >= now() - interval '7 days'
GROUP BY 1
HAVING COUNT(*) >= 50
ORDER BY pct_retry_succeeded ASC;


-- 5. USABLE-SEAT RATE BY MODEL. `usable` is true only for outcome 'answered';
--    a seat cut by the quorum, timed out, empty, skipped or failed was paid for
--    and not used.
SELECT
  seat ->> 'model' AS model,
  COUNT(*)         AS n_seats,
  COUNT(*) FILTER (WHERE (seat ->> 'usable')::boolean) AS n_usable,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (seat ->> 'usable')::boolean) / NULLIF(COUNT(*), 0), 2) AS pct_usable
FROM turns t
CROSS JOIN LATERAL (SELECT t.meta -> 'reliability' AS r) x
CROSS JOIN LATERAL jsonb_array_elements(x.r -> 'seats') AS seat
WHERE (x.r ->> 'schemaVersion')::int = 1
  AND jsonb_typeof(x.r -> 'seats') = 'array'   -- defensive; the writer guarantees it
  AND t.created_at >= now() - interval '7 days'
GROUP BY 1
HAVING COUNT(*) >= 50
ORDER BY pct_usable ASC;


-- 6. p50 SEAT LATENCY BY MODEL. p95 alongside, because a median that looks fine
--    with a long tail is the shape that produces a slow turn.
SELECT
  seat ->> 'model' AS model,
  COUNT(*)         AS n_seats,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY (seat ->> 'durationMs')::numeric) AS p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (seat ->> 'durationMs')::numeric) AS p95_ms
FROM turns t
CROSS JOIN LATERAL (SELECT t.meta -> 'reliability' AS r) x
CROSS JOIN LATERAL jsonb_array_elements(x.r -> 'seats') AS seat
WHERE (x.r ->> 'schemaVersion')::int = 1
  AND jsonb_typeof(x.r -> 'seats') = 'array'
  AND t.created_at >= now() - interval '7 days'
GROUP BY 1
HAVING COUNT(*) >= 50
ORDER BY p50_ms DESC;


-- 7. QUORUM-CUT FREQUENCY BY MODEL: how often a seat's answer arrived after the
--    council had already released. Persistently high means the seat is paying
--    for itself and contributing nothing.
SELECT
  seat ->> 'model' AS model,
  COUNT(*)         AS n_seats,
  COUNT(*) FILTER (WHERE seat ->> 'outcome' = 'quorum') AS n_quorum_cut,
  ROUND(100.0 * COUNT(*) FILTER (WHERE seat ->> 'outcome' = 'quorum') / NULLIF(COUNT(*), 0), 2) AS pct_quorum_cut
FROM turns t
CROSS JOIN LATERAL (SELECT t.meta -> 'reliability' AS r) x
CROSS JOIN LATERAL jsonb_array_elements(x.r -> 'seats') AS seat
WHERE (x.r ->> 'schemaVersion')::int = 1
  AND jsonb_typeof(x.r -> 'seats') = 'array'
  AND t.created_at >= now() - interval '7 days'
GROUP BY 1
HAVING COUNT(*) >= 50
ORDER BY pct_quorum_cut DESC;


-- 8. SYNTHESIS p50 TIME-TO-FIRST-TOKEN BY MODEL. NULL TTFT rows are excluded by
--    the IS NOT NULL, and that is deliberate: a stream that emitted no content
--    has no first token, and counting it as 0 would drag the percentile toward
--    a number nobody experienced. `n_no_ttft` reports how many were dropped.
SELECT
  r -> 'synthesis' ->> 'model' AS model,
  COUNT(*) FILTER (WHERE r -> 'synthesis' ->> 'msToFirstToken' IS NOT NULL) AS n,
  COUNT(*) FILTER (WHERE r -> 'synthesis' ->> 'msToFirstToken' IS NULL)     AS n_no_ttft,
  PERCENTILE_CONT(0.50) WITHIN GROUP (
    ORDER BY (r -> 'synthesis' ->> 'msToFirstToken')::numeric
  ) FILTER (WHERE r -> 'synthesis' ->> 'msToFirstToken' IS NOT NULL) AS p50_ttft_ms
FROM turns t
CROSS JOIN LATERAL (SELECT t.meta -> 'reliability' AS r) x
WHERE (x.r ->> 'schemaVersion')::int = 1
  AND jsonb_typeof(x.r -> 'synthesis') = 'object'
  AND t.created_at >= now() - interval '7 days'
GROUP BY 1
HAVING COUNT(*) FILTER (WHERE x.r -> 'synthesis' ->> 'msToFirstToken' IS NOT NULL) >= 50
ORDER BY p50_ttft_ms DESC;


-- 9. SYNTHESIS p50 TOTAL STREAM LATENCY BY MODEL. `streamTotalMs` is open + body
--    and is derived from its own two halves in the recorder, so the three can
--    never disagree. Open and body are broken out because they want opposite
--    fixes: a long open is a queued provider, a long body is a slow one.
SELECT
  r -> 'synthesis' ->> 'model' AS model,
  COUNT(*) AS n,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY (r -> 'synthesis' ->> 'streamTotalMs')::numeric) AS p50_total_ms,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY (r -> 'synthesis' ->> 'streamOpenMs')::numeric)  AS p50_open_ms,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY (r -> 'synthesis' ->> 'streamBodyMs')::numeric)  AS p50_body_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY (r -> 'synthesis' ->> 'streamTotalMs')::numeric) AS p95_total_ms
FROM turns t
CROSS JOIN LATERAL (SELECT t.meta -> 'reliability' AS r) x
WHERE (x.r ->> 'schemaVersion')::int = 1
  AND jsonb_typeof(x.r -> 'synthesis') = 'object'
  AND x.r -> 'synthesis' ->> 'streamTotalMs' IS NOT NULL
  AND t.created_at >= now() - interval '7 days'
GROUP BY 1
HAVING COUNT(*) >= 50
ORDER BY p50_total_ms DESC;


-- 10. SYNTHESIS ABORT RATE BY MODEL AND REASON. The split is the point:
--     'turn_deadline' means the budget is now binding and the model is too slow
--     for it; 'client'/'client_disconnected' means the user left and nothing is
--     wrong. One number for both hides the first behind the second.
SELECT
  r -> 'synthesis' ->> 'model'                             AS model,
  COALESCE(r -> 'synthesis' ->> 'abortReason', '(none)')   AS abort_reason,
  COUNT(*)                                                 AS n,
  SUM(COUNT(*)) OVER (PARTITION BY r -> 'synthesis' ->> 'model') AS n_model_total,
  ROUND(
    100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY r -> 'synthesis' ->> 'model'), 0)
  , 2) AS pct_of_model
FROM turns t
CROSS JOIN LATERAL (SELECT t.meta -> 'reliability' AS r) x
WHERE (x.r ->> 'schemaVersion')::int = 1
  AND jsonb_typeof(x.r -> 'synthesis') = 'object'
  AND t.created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY model, n DESC;
