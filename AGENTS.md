# ALOP-AI — working notes

Read by Codex automatically. Claude Code reads it via `CLAUDE.md`, which points
here. One file, so the two of us cannot drift apart on the facts.

Only things that are **not** derivable from the code or `git log` belong here.
If it can be discovered by reading a file, do not write it down — write down the
things that cost someone an hour to find out.

## Layout

- `backend/` — Node/Express, `server.js` plus `lib/`. Supabase for data, Clerk
  for auth, Stripe for billing, a council of models behind the OpenRouter
  gateway.
- `frontend/` — React + Vite.
- Tests: `cd backend && npm test` (node:test, `lib/**/*.test.js`) and
  `cd frontend && npm test -- --run` (vitest). Run both before claiming done.

## Traps

**`server.js` cannot be `require`d in a test.** It calls `process.exit(1)` at
import time when env vars are missing, so anything defined in it is untestable
by construction. That is why logic keeps getting moved to `lib/`, and why a few
tests read `server.js` as *text* and assert on its source. If you add one of
those, assert on proximity rather than exact escaped strings — otherwise it
fails the next time someone reflows the line.

**RLS is on, and it does nothing for your queries.** Policies are enabled on all
9 tables, but the server connects with `SUPABASE_SERVICE_ROLE_KEY`, which
bypasses RLS by design. RLS protects you from *other* clients hitting Supabase
directly. Every ownership check has to live in the query itself
(`.eq('user_id', user.id)`). A cross-tenant write already got through once
exactly this way — the policies were on, and irrelevant. `tenant-scope.test.js`
enforces it; keep it passing.

**The agent loop has two clocks, and mixing them up is the bug it already
had.** `totalToolMs` (25s) is time spent *inside* `registry.execute` only;
`totalWallMs` (75s) is what bounds the request. They were one clock measured
from the top of the loop, which counted the council's own deliberation as tool
spend — a single round of seven seats under the 30s whip could exhaust the
"tool budget" before the first search returned, and the turn truncated saying
it had run out of time to research on a turn where it had barely researched.
If you add a ceiling here, be explicit about which clock it is on.

**Anything that waits on the whole council needs a whip and a quorum.** Both
exist in `runCouncilWithWhip`, and both had to be added again to the tools path
after it replaced that call — `roundMs` caps a round, `quorum` releases the
last one. The quorum release is inert on research rounds on purpose: releasing
there drops the members that asked for a tool, which turns the feature off
exactly when part of the council wanted it. Copying the whip without the quorum,
or the quorum without the last-round guard, reintroduces one of the two.

**Third-party text must be labelled.** `UNTRUSTED_PREAMBLE` lives in
`lib/council-tools.js` and is prepended at every boundary where content we did
not write enters a prompt: search context, tool results, Wikipedia, attached
file names, image descriptions. If you add a new source of fetched or uploaded
content, label it, and never place it at system position.

The line drawn: `convSummary` and `feedbackGuidance` stay at system position on
purpose. They derive from one user's own turns under their own `user_id`, so the
only session either can inject is that user's own — and they already own the
user turn. Do not "fix" these; the comment above them says the same thing.

**Browser security headers live in `frontend/vercel.json`, not `helmet`.** The
backend's `helmet` config covers `alop-ai.onrender.com` and has never applied to
the pages a browser loads — `alop-ai.com` is static on Vercel. A scan found it
serving only HSTS. The CSP is the one header here that can take the product
down, and its failure mode is silent: miss an origin and sign-in dies with
nothing but a console message.

Two things that are easy to get wrong and were:

- **`clerk.alop-ai.com` is not in the frontend source.** Clerk derives its host
  from the publishable key at runtime and loads `clerk.browser.js` from it, so
  grepping for hardcoded URLs will not find it. Same for
  `challenges.cloudflare.com` — that is the Turnstile widget behind
  `bot_protection.captcha_enabled`, it only renders during sign-up, so omitting
  it looks fine until a real user registers.
- **Do not copy a scanner's Permissions-Policy advice.** It says disable camera,
  microphone and geolocation. This app ships `useCamera`,
  `useSpeechRecognition` and the overlay's `getDisplayMedia`; two of those three
  would have been switched off. Only `geolocation` is genuinely unused.

Test a CSP against a build made with PRODUCTION config. The ordinary local build
points at the development Clerk instance and `localhost:3000`, so it produces
violations that do not exist in production and hides the ones that do.
`securityHeaders.test.js` asserts every external origin in the frontend source
appears in the CSP.

**Migrations go through the Supabase MCP `apply_migration`.** It wraps
statements in a transaction, so `CREATE INDEX CONCURRENTLY` fails there. Keep
`CONCURRENTLY` in the migration file (right for a rebuild under load), drop it
at apply time, and record the difference in the file — see `007`.

**`migrations/` is NOT what production's schema looks like, and reasoning from
it will produce confident wrong answers.** `004`, `005` and `006` have never
been applied, and the live database carries indexes no file in that directory
creates — they came from an ad-hoc schema predating these files. The two are
not going to converge on their own. `006` creates `audit_logs_created_at`,
which does not exist in production; production had `audit_logs_recent` and
`idx_audit_logs_created_at`, identical to each other, and neither is named in
any migration. Read `pg_indexes` through the Supabase MCP before believing
anything about the schema, and write new migrations to be idempotent against
BOTH states — `008` creates the index it is about to deduplicate for exactly
this reason, which reads as redundant until you know a fresh database would
otherwise end up with no index at all.

**`user_facts.embedding` is `vector(768)` and every row in it must come from
the same model.** `013` narrowed it from the `vector(1536)` the ad-hoc schema
shipped, which matched OpenAI on a project with no OpenAI key. The provider is
Google `text-embedding-004` through `GOOGLE_API_KEY`, named once in
`lib/embeddings.js`. Changing that constant without re-embedding every stored
row leaves two incomparable geometries in one column, and `<=>` will rank
across them without erroring — the failure is bad memory, not a stack trace.
`013`'s ALTER is a plain one and will fail loudly against a populated table,
which is correct: 1536 numbers do not truncate to 768.

Two consequences worth knowing before touching that path. **Semantic recall
reaches the table through `supabase.rpc('match_user_facts', ...)`, which the
`.from('user_facts')` sweep in `tenant-scope.test.js` cannot see** — the RPC
has its own contract in that file, and `p_user_id` is the whole tenant boundary
because the service-role connection bypasses RLS. And **the recency read still
runs on every turn alongside the semantic one, on purpose**: a fact written
while the key was unset has a null embedding and is invisible to the RPC
forever, so semantic-only retrieval would drop it silently rather than rank it
low.

**The Supabase performance advisor is worth running and not worth obeying.**
It flagged two "unindexed foreign keys" on 2026-08-07; both were wrong to act
on. `chat_files.user_id` is already covered by `chat_files_scope
(chat_id, user_id, created_at DESC)` and every query supplies both keys, and
`user_facts` has zero references anywhere in the code. Its "unused index"
findings mean "no traffic yet", not "dead". The `duplicate_index` finding was
the only real one.

**A read-then-cache is a security hole wherever the cached thing gates
access.** `checkSuspended` caches the `users` row. The invalidation on suspend
is not sufficient by itself: a request that has already read the row and is
awaiting the reply can write that row into the cache *after* the clear lands,
where it outlives the suspension for a full TTL. `lib/ttl-cache.js` exposes a
generation counter and `setIfCurrent` for this; read the generation before the
select, not after. Any future cache in front of a permission check needs the
same treatment — the TTL is not the bound on staleness, the race is.

**Clerk's verifier does not check `azp` unless you ask it to.**
`clerkMiddleware()` with no options validates the signature and expiry
and ignores the origin the token was minted for. `authorizedParties` is set
from `originPolicy.exact` so it cannot drift from the CORS list. The
consequence to remember before debugging a mystery 401: an origin allowed only
by `ALLOWED_ORIGIN_SUFFIXES` passes CORS and fails auth, because `azp` is an
exact string. Preview deploys that need to sign in must be named in
`ALLOWED_ORIGINS`. The boot log prints which mode it is in.

**`req.auth` is written by our own middleware, not by Clerk.** `@clerk/express`
v2 removed direct property access to `req.auth`; `getAuth(req)` is the only
supported accessor there. About forty call sites in `server.js` read
`req.auth.userId`, so `requireAuth` assigns the resolved object back onto the
request once and they all keep working. Deleting that assignment as redundant
breaks every one of them, silently, with `undefined` rather than a throw.

**`clerkMiddleware()` is mounted only when `CLERK_PUBLISHABLE_KEY` is set, on
purpose.** It throws "Publishable key is missing" without one, and mounted
globally that turns a single missing variable into a 500 on every route
including `/health` — a misconfigured deploy then looks like a dead one to
whatever polls it. The guard keeps the failure where `clerk-sdk-node` had it:
authenticated routes 500, everything else keeps serving. Both states are
covered by boot smoke tests; if you remove the guard, check `/health` without
the key before believing it is fine.

**The sidebar is cached in `localStorage`, and that is user data in shared
storage.** `frontend/src/lib/chatCache.js` persists the chat list so a reload
paints instantly instead of showing the app skeleton. Four rules keep it from
becoming a leak, all of them enforced in `chatCache.test.js`: messages are never
written (the stored fields are an *allowlist*, not a delete-list, so a new
column on the server cannot start being persisted by accident); entries are
keyed by Clerk user id and read back only for the same id; the cache is cleared
whenever the app renders with no user, which is the only hook that catches a
sign-out through Clerk's own `UserButton`; and anything older than seven days is
ignored. If you add a field to the sidebar, add it to `pick` deliberately and
ask whether it should be on disk at all.

Two consequences worth knowing before debugging it. Restored rows carry
`fromCache: true`, and `loadChats` uses that to tell a chat deleted on another
device (drop it) from one this tab just created that the list response predates
(keep it) — without the flag, deleted conversations resurrect on every reload.
And the write is driven by a *signature* of the cached fields, not by `chats`
itself: `chats` gets a new identity on every painted frame of a streaming
answer, so an effect on it would write to `localStorage` sixty times a second.

**The ornament set is the one the owner wants, and it has been reverted to
twice.** Two hanging crescents in the gutters, an asanoha lattice across the
chat surface, the keystone above the composer, the seal, the composer skyline,
a centred hero, and starters as a 2x2 card grid.

**The torii and EVERY branch are gone (2026-08-11) and must not be redrawn.**
This paragraph used to list "four sakura corner sprigs and a faint torii" as
part of the specification, and said so for a while after both had been deleted
— which is how a stale spec gets restored by someone reading it as current.
The torii went first, replaced by `CouncilRosette`; the branches went on the
owner's instruction, "leave the earrings, just delete the branches", taking all
four corner sprigs, the `Leaf` helper, the `Corner` component, `SakuraFrame`
itself and the sign-in bough and petals. The charge against both was the same:
they said "Japanese" without saying anything about THIS product. What is left
is the half that carries meaning. See `handoff.md`.

Five redesigns were tried and all five were rejected: a single wooden bough, the
same bough moved to the bottom right, an ensō drawn as seven arcs, a split
layout with the council roster on it, and a day/night sky with a crescent and a
sun. Some of them were defensible on paper. Several were argued for by the
design skills this repo is worked on with, which name centred heroes and grids
of equal cards as anti-patterns. It does not matter. This is a personal product
with one owner and his taste is the specification. Do not "fix" the centred hero
or the card grid on the strength of a general design rule; if a redesign is
wanted it will be asked for, and it will be asked for in terms of this ornament
family rather than in place of it.

What DID survive from those attempts is worth keeping and lives elsewhere in
this file: the reduced-motion exception list, the skeleton work, the chat cache,
and the council runner extraction.

**THE ANSWER CACHE IS SHARED ACROSS USERS, AND ONE LINE IN `server.js` IS THE
WHOLE REASON THAT IS SAFE.** `lib/answer-cache.js` stores finished answers and
replays them to anybody who asks the same question — that is the feature, and it
is what keeps repeated questions off the 50-requests-per-day account allowance.
It is safe only because `const personalised = …` in the council route refuses to
build a cache key when the turn read conversation history, the chat summary,
stored user facts, learned feedback guidance, or an attached image or file. No
key means no read and no write. If a new source of one person's data is ever
injected into a prompt on that route, **it must be added to that gate**, and the
list in `answer-cache.test.js` is what will notice if it is not. The failure
mode if it is missed has no error, no log line and no visible symptom: one
user's answer, built from their own memory, served verbatim to a stranger. It
would look exactly like the cache working.

Two consequences worth knowing. `streamModel` now RETURNS the assembled answer,
and it throws on an incomplete stream *before* returning — so a truncated answer
cannot be cached and served for six hours; that ordering is asserted. And the
write for the synthesis branch sits below the abort check on purpose, because a
cancelled turn holds a half-written answer.

**A Wikipedia lookup that cannot recognise its own miss will answer the wrong
question.** Asked to "write an biography about mohamed fateh the sultan of
ottoman empire" the product replied "I couldn't find this on Wikipedia." and
stopped — the council, which knows who Mehmed the Conqueror is, was never asked.
Two causes: the RAW MESSAGE was the search query, so "write an biography about"
was searched as though it were a subject (measured: Wikipedia returned Rumi,
Khatri and a list of assassination survivors); and a miss was TERMINAL. The
second is the load-bearing one — Wikipedia returns something for almost any
input, so "did it find anything" was never the question. `lib/wiki-relevance.js`
now strips the instruction and requires the article title to share a content
word with the question, and returning `''` falls through to the council. Note
the CJK clause: those scripts have no word boundaries to split on, so without a
substring test the gate would reject every article for every Japanese or Chinese
question and switch the whole path off for them.

**The arithmetic module has a SECOND LANE as of 2026-08-13, and the `=` / `≈`
distinction is what makes it safe.** Rationals stay exact; sin, cos, tan, ln,
exp and roots that do not come out whole are doubles and ALWAYS render with `≈`.
A rational is promoted to a float when it meets one and never the reverse, so
one transcendental anywhere marks the whole answer approximate. The rule this
replaced — "anything irrational falls through" — was right while the grammar was
four operators wide and wrong for a calculator; two entries were removed from
`arithmetic.test.js`'s falls-through list and the removal is documented in place.
Roots are tried EXACTLY first (`bigRoot`, Newton on BigInts, then verified by
raising back) so `√16 = 4` rather than `≈ 4` — without that, `≈` would appear on
exact answers often enough to stop meaning anything.

**The council runner lives in `lib/council-run.js`.** It moved out of
`server.js` so it could be tested at all, and it is the most intricate
concurrency in the product: seats race in parallel and it resolves on the first
of quorum, all-settled, or the whip timer. It also takes an optional `onSeat`
reporter, best-effort by construction and wrapped so a dead client socket cannot
lose an answer a model call was already paid for. Nothing renders those events
yet, and the reporter is the seam if a live council view is ever wanted.

**A COMMA IN A CSS COMMENT DIRECTLY ABOVE AN `@media` BREAKS
`cssHygiene.test.js`, and the failure names an innocent rule.** Its parser only
skips a comment when the scanner is standing exactly on `/*`; a comment sitting
between two rules is instead swept into the next rule's *prelude*, and the
prelude is then split on commas. So a comment containing a comma becomes several
"selectors", and when the rule it precedes is `@media`, the `@media` is no longer
the start of the prelude — the at-rule is never recognised, `depth` never
increments, and **every rule inside that media block is counted as top-level**.
The reported failure was `.earring-left x2, .earring-right x2` on a commit that
touched neither. Cost 20 minutes. If the duplicate budget rises after an edit
that added no duplicate selector, look at the COMMENTS you added, not the rules —
and dump the top-level list before and after rather than reasoning about it.

**`cssHygiene.test.js` counted keyframe steps as selectors.** `from`, `to` and
percentage steps leaked out of `@keyframes` blocks and were counted as top-level
rules, so the duplicate budget was partly measuring how many animations the app
has. Fixed by shape; the budget came down from 10 to 9 as a result. If that test
blocks you, check whether it is counting something real before you edit CSS to
satisfy it.

**The `@clerk/clerk-sdk-node` migration is DONE.** `@clerk/express` is what is
installed, and `npm audit --omit=dev` on the backend reports **0
vulnerabilities** — verified 2026-08-11.

This paragraph used to say the opposite, at length: that the old SDK was pinned
at its final 5.1.6, that its `js-cookie@3.0.5` chain carried an unpatched
advisory, and that "until that migration happens" the backend would keep
reporting three highs. It said that after the migration had merged. Anyone
reading it as current state would have believed this backend had three live
high-severity advisories, and either re-planned finished work or panicked about
nothing. Do not restore it.

**`callModel` RETURNS A STRING BY DEFAULT, AND THAT STRING USED TO BE THE ONLY
THING THERE WAS.** `lib/openrouter.js` collapsed the provider message through a
helper that took `content`, else `reasoning`, else the `reasoning_details`
parts, else `''` — so three things were deleted at that boundary with no error
and no log line. The load-bearing one: a message with `content: null` and a
populated `tool_calls` array became `''`. `fromNative` in `lib/tool-protocol.js`
could always read that array and could never be reached, because the array was
gone one function earlier; the seat was then scored `empty` and dropped from the
round. It looks exactly like a model that declined to answer.

`{ structured: true }` as the ninth argument returns the whole reply instead —
see `lib/model-reply.js`. It is MESSAGE-SHAPED on purpose (`role`, `content`,
`tool_calls` where an OpenAI-compatible message carries them) so
`parseToolRequests` reads it with no change. Two consequences worth knowing.
The fallback from content to `reasoning` is KEPT, because removing it blanks
every seat on a model that writes its answer there — but it is now labelled
`textSource`, so a caller that must not cache or show internal reasoning can
test rather than guess. And the tools path in `server.js` tests
`reply.content.trim()` rather than `String(raw)`: stringifying the reply object
gives `"[object Object]"`, which is always truthy and would mark every seat
unusable.

The default string contract is unchanged for the other eleven call sites. Do not
"simplify" by making structured the default without walking all of them.

**ONE SEAT NOW SENDS A `tools` ARRAY, and it is the only one.**
`COUNCIL_TOOL_SEAT_MODEL` (default `openai/gpt-5.6-luna`) is a member that gets
real tool schemas, emits real `tool_calls`, and receives real `role: "tool"`
results against the ids it asked with. `lib/native-tool-seat.js` owns it. Every
other seat still speaks the fenced-text protocol, and that stays the floor: it
is the only thing that works on a model with no tool template, which is most of
this roster.

This paragraph used to say native mode could not be wired at all, because the
loop broadcasts one deduped result set to EVERY seat while a native round trip
must answer one seat's `tool_call_id`. That tension is real and the resolution
is the shape of the module: **the seat keeps its own message list across rounds
while still drawing its results from the loop's shared transcript**, matched by
CANONICAL KEY. The loop still executes each unique call exactly once — the
dedupe saving survives — and only the spelling differs per seat.

Four things about it that are not derivable from reading the code:

- **The seat is NOT in the `COUNCIL` array**, deliberately. Every id in that
  array is `:free` and eligible for temperature-band narrowing; this one is
  metered and is added by policy (`withToolSeat`). Putting it in the array makes
  it a substitute for a free seat on turns that never asked for it.
- **`free: true` on a seat means "included in the free PLAN", not "costs
  nothing".** `rosterForPlan` has always read it the first way and it has never
  mattered, because everything was $0. This seat is where the two readings come
  apart, and reading it the second way puts a metered model on an unbounded free
  tier. It is Pro-only unless `COUNCIL_TOOL_SEAT_FREE_PLAN=1`.
- **An assistant message with N `tool_calls` MUST be followed by N `role:
  "tool"` messages** or the provider rejects the next request. The loop can
  decline to execute a call (a ceiling, a budget, a whip), so "the result
  exists" is not safe: every pending id is answered, and an unexecuted one is
  told so in words. Dropping it surfaces as the seat failing rather than as the
  ceiling that caused it.
- **`tool_choice: "none"` is how the final round is ENFORCED.** The text path
  can only ask a model not to call a tool. Measured against the live gateway on
  2026-08-14: the same prompt that had been emitting calls returned prose and
  `finish_reason: "stop"`.

**IT COSTS MONEY, AND IT IS THE FIRST SEAT ON THIS COUNCIL THAT DOES.** A
ChatGPT/Codex subscription covers `gpt-5.6-luna` through THAT account; this is
OpenRouter, which is a different account and a different bill — $0.10/M prompt,
$0.60/M completion, reasoning tokens billed as completion, and this seat runs at
high effort. `lib/spend.js` prices it separately (`toolSeatTenths`) and
`reservationCents` takes a `toolSeatCount` so the reservation still bounds
`priceTurn`, which is that function's whole load-bearing property.

A live four-round research turn measured **$0.00077 in total** (209, 593, 1435
and 1959 tokens across the four calls). The price constant is 8 tenths per call
— ~40x the measured typical and ~1.5x a reasoned worst case with real fetched
pages in the prompt. It was 12 first, which was ~60x, and that is not free
either: `priceTurn` charges it per seat record PER ROUND, off a real user's
daily allowance.

**ADOPTION IS COUNTED, because it cannot be inferred.** A native seat that
quietly degrades to writing fenced blocks produces identical answers, identical
timings and identical costs. `source` on every parsed call (`native` / `fence`,
plus `seeded` for a server-issued search) is the only difference, and it rides
through the dedupe as a `sources` ARRAY — one canonical call can be proposed by
a native seat and a fenced one at once, and keeping only the first would report
adoption as whichever seat replied first. It is deliberately NOT part of
`callKey`: two members asking the same thing by different protocols is still one
execution. The `[TOOLS] call sources:` line is where it lands.

**STREAM USAGE ACCOUNTING IS ON, AND IT WAS OFF FOR A REASON WORTH KEEPING.**
`usage: {include: true}` is an OpenRouter extension, not an OpenAI field
(OpenAI spells it `stream_options.include_usage`), and it rides in the body of
the request that writes every answer. It shipped OFF behind
`STREAM_USAGE_ACCOUNTING` because there was no OpenRouter key on the
development machine, and an unverified body field on that path fails as a
product-wide outage rather than as missing telemetry. It was probed against the
live gateway on 2026-08-14 — HTTP 200, content streamed normally, a usage frame
carrying prompt, completion, total and cost — and is now on by default, with
`=0` as the off switch. Note the frame that carries usage ALSO carries
`finish_reason`; the terminator is still `[DONE]` and the completion latch is
what stops a second one being written.

**`engines.node` IS `>=26.0.0` AS OF 2026-08-14, and Render reads it.** It said
`>=18.0.0` while CI tested only 26 and the Dockerfile pinned 22 — three
declarations, no two agreeing. `lib/deployment-config.test.js` now enforces that
the floor is not BELOW the tested major and that the Dockerfile matches every CI
pin. If a Render build fails to find the runtime, that is this line: Render keeps
the previous deployment alive when a new one fails, so lower the floor, ci.yml
and the Dockerfile together rather than one of them.

**EVERY 5xx BODY IS NOW A SAFE TYPED ENVELOPE, and the thrown message never
reaches a client in production.** `lib/error-envelope.js`. Twenty-two routes
ended in `res.status(500).json({ error: err.message })`, and the express handler
masked that only when `NODE_ENV === 'production'` — so a deploy with the
variable unset returned Supabase prose, unreachable hostnames and Postgres
constraint names. `sendError(res, err)` replaces all of them. The wire shape is
ADDITIVE: `error` is still a plain string at the same key, with `code` (branch on
this, not the prose), `operationId`, and `detail` only outside production.

4xx prose IS still returned, deliberately — a 4xx reason describes the caller's
own request. The stream path was the same leak and was easier to miss: a failed
turn renders `type: 'error'` into the chat, so a gateway message was being shown
to the user as part of the answer.

**`req.operationId` IS THE SAME VALUE `req.requestId` ALWAYS WAS, and the
difference is that it now goes somewhere.** It was minted per request and read by
nothing — no response, no log line, no audit row — so the one thing an id is for
was impossible. It is echoed as the `X-Operation-Id` header, in every error
body, as the first SSE frame (`type: 'meta'`), and in the 5xx log line.

The CLIENT mints it (`frontend/src/lib/operationId.js`) and the server validates
it as a UUID before echoing it anywhere — an unvalidated id that reaches a log
line is a log injection. Client-minted is what makes a retry correlate with the
attempt it replaced; a server-minted id changes on every request, which cannot
answer the only question a failed turn raises. The frontend shows the first eight
characters on the failure message, and that message is persisted, so it is still
there when the user comes back to report it.

**THE REQUEST BUDGET STILL FAILS OPEN, BUT NO LONGER WITHOUT A BOUND.**
`lib/request-budget.js`. The argument for failing open is right and is kept:
failing closed turns a partial dependency failure into a total outage. What was
wrong is that "open" meant UNLIMITED — a Supabase outage of any length admitted
every turn from every user with no counter, so the account's whole daily
allowance could be spent inside it, invisibly, because the only number anyone can
look at lives in the store that is down.

There is now a local degraded allowance (5% of the day, floor of one) that
admits through a blip and refuses past it, resets with the UTC day, clears the
moment a reservation succeeds, and is refunded at settlement so a cheap turn does
not cost its worst case. It is PER PROCESS: two instances in degraded mode admit
two allowances. That is bounded and known; the previous behaviour was neither.

The refusal it produces is a **503, not the 402** the daily ceiling returns, and
that distinction is the user-facing half. "Out of model requests for today" is
false when the day's budget is untouched and the ledger is simply unreachable —
one resets at midnight, the other in about a minute.

**STRIPE IDENTITY IS `clerk_id`, NEVER AN EMAIL.** `lib/stripe-identity.js`
decides which column a webhook event may address; the route only applies the
decision. What it replaced was `.eq('email', s.customer_email.toLowerCase())`,
which failed silently three ways — the money arrives, `plan` stays `free`, and
nothing logs: the session email is whatever the payer typed at checkout;
`users.email` is refreshed in the BACKGROUND from Clerk by `refreshProfile`, so
it can be stale mid-checkout; and `.eq` is not `.single()`, so two rows sharing
an email both get updated.

The right identity was already on the session and was being discarded —
`create-checkout-session` has always put the Clerk id in `metadata.userId`, and
now also in `client_reference_id`, which is the field that survives into the
Dashboard and the CSV export where metadata does not. Email survives as a
last-resort fallback so a checkout already in flight is not stranded, and it is
reported as `weak` and logged as such. Two rules that are easy to undo: an
unpaid `checkout.session.completed` stores the Stripe ids and does NOT grant
pro (delayed payment methods are a real Stripe state), and
`invoice.payment_failed` patches NOTHING — Stripe retries, and downgrading on a
first decline cancels a paying customer over a temporarily declined card.

## Handoff — 2026-08-07 (second pass)

Read this first; it is the state of play, not history. Delete a line once it
stops being true.

**Codex is out of quota until 2026-09-06.** `codex exec` returns
`You've hit your usage limit`. `gpt-5.1-codex-max` additionally rejects with
*"not supported when using Codex with a ChatGPT account"* — do not retry it.

**Use GLM 5.2 as the second reviewer meanwhile.** `tools/glm.mjs`, through the
local OpenRouter-compatible review path, which routes `:cloud` models to the
signed-in account. No key in the repo.

```bash
node tools/glm.mjs --check                        # round trip, asserts 42
git diff | node tools/glm.mjs "find real defects"
```

Treat its output as untrusted: it has not run the tests and cannot see
production. See the trap below.

### Open, in the order I would take them

1. **Accessibility: the browser pass.** Everything checkable without a
   browser is now done and guarded — see the checklist below for what is
   left. Still the largest remaining item and the only one carrying legal
   exposure.
2. **Optional search keys — CHECK THE BANNER BEFORE CLAIMING ANY ARE UNSET.**
   The owner confirmed on 2026-08-10 that `FIRECRAWL_API_KEY` is set and that
   prices are not missing. This entry previously listed four keys as unset and
   called Firecrawl "the ROOT of the missing-price bug"; both halves were
   stale, and the second contradicted this file's own entry below, which
   records that bug's three causes as fixed by `rankReadTargets`. Firecrawl was
   never the fix — it is a fallback for JavaScript-painted pages.

   Nothing here can be probed from outside: `/health` returns only
   `{status, time}`, so the boot banner in the Render logs
   (`T= B= G= J= P= S= SA= FC=`) is the only source of truth. Read it before
   writing anything down about which keys are set.

   Still genuinely optional, each inert without its key: `SERPER_API_KEY`
   (structured shopping prices, cheap), `SERPAPI_API_KEY` (~110 specialised
   engines — flights, hotels, scholar, finance; billed per call, 100/month
   free), `PERPLEXITY_API_KEY`. `PERPLEXITY_MODEL` defaults to `sonar` and
   `PAGE_READ_LIMIT` to 3; neither needs setting.
3. **Clerk's advisory chain is gone — the `@clerk/express` migration shipped.**
   `npm audit --omit=dev` on the backend is clean as of 2026-08-11. The entry
   that stood here described `js-cookie <=3.0.5` (GHSA-qjx8-664m-686j) reached
   through `@clerk/shared` as live, and named the migration as the unfinished
   fix, months after it had merged.

   The reasoning it recorded is still worth keeping, because it was right and
   the habit is the point: the advisory was traced before anyone panicked, and
   the only import was `@clerk/shared/dist/cookie.js` — browser-side code this
   Node backend never executed, so it was never reachable here. Trace first,
   then act. That is the durable part; the package versions were not.

### Accessibility: what still needs a real browser

Everything checkable without one is done and guarded: `a11y.test.jsx` (axe on
the real components), `contrast.test.js` (every text/surface pair, both
themes, 4.5:1 even for "decorative" text), `reflow.test.js` (no min-width or
fixed width above 320px), and the palette's focus trap. None of that proves
the list below. Work through it in a browser at 320px and at desktop, in both
themes.

- [x] **Contrast as RENDERED, not as declared.** DONE 2026-08-08, by hiding
      every string, screenshotting the live page and sampling the pixels
      underneath. 43 of 44 pass. The one failure was Clerk's primary button —
      white on the pink gradient, 1.86:1 — now `--text-on-fill` on a gradient
      ending at `--primary-strong`. Guarded by `contrast.test.js`. ORIGINAL: The tokens pass in isolation.
      What is unverified is text over `--gradient-warm`, over the sakura
      decoration, and the `.signin-orb` bleed — a gradient has no single
      background colour and no static check can pick one. DevTools' contrast
      readout on the sign-in headline, tagline and council rows.
- [~] **Focus visible on every interactive element.** SIGN-IN PAGE DONE
      2026-08-09, and it found a real one: Clerk's `cardBox` is
      `overflow: hidden` and the email input is full-bleed to it, so the 3px
      box-shadow ring was sliced flat on both sides. Fixed by
      `cardBox: { ...RESET, overflow: "visible" }`, guarded by
      `clerkFocusRing.test.js`. Note that axe passed the whole time — it checks
      that a focus style EXISTS, not that it survives its ancestors' geometry.
      STILL OPEN: the signed-in shell (header, sidebar, composer, panels),
      which needs a session.
- [x] **Tab order matches reading order** on the sign-in page. DONE 2026-08-09
      by real keyboard walk: identifier → Continue → Sign up → Terms → Privacy,
      tops 348/394/446/555/555, no positive `tabindex` anywhere. A first
      automated pass reported three mismatches and all three were the harness's
      fault — the selector had swept in `password-field` and `Show password`,
      both `tabindex="-1"` and correctly outside the tab sequence. Check
      `tabindex` before believing a tab-order failure.
      STILL OPEN: the signed-in shell, especially the composer, where the
      buttons are visually reordered on mobile.
- [ ] **Keyboard-only run of the core flow.** STILL OPEN — behind sign-in,
      so it needs a real session. Send a message, rename a chat,
      delete a chat, open and close each panel. Anything reachable only by
      pointer is a failure.
- [x] **320px reflow, in a real window.** DONE 2026-08-08: `scrollWidth` equals
      the 320px viewport, no clipped text, and every element past the right
      edge is a decorative orb or sakura path carrying no text. ORIGINAL: The static guard cannot see a long
      unbreakable string, a code block, or a flex row that refuses to wrap.
      NOTE: `body { overflow: hidden }` means anything that does overflow is
      CLIPPED AND UNREACHABLE rather than scrollable — the worst failure mode
      for 1.4.10, so look for cut-off content, not for a scrollbar.
- [x] **200% browser zoom** DONE 2026-08-08 at a 640px-wide viewport: zero
      text nodes outside a reachable container. ORIGINAL: — a separate criterion (1.4.4) that the 320px pass
      does not cover.
- [ ] **A screen reader on the transcript.** STILL OPEN — needs NVDA or
      VoiceOver and a signed-in session; no automation substitutes for it. NVDA or VoiceOver. Streaming
      answers are the risk: does new text get announced, and is it announced
      once rather than re-reading the whole message on every token?
- [x] **`prefers-reduced-motion`.** DONE 2026-08-08, and the suspicion in the
      original note was correct — neither `animate()` call honoured it, because
      anime.js writes inline styles and a media query cannot reach those. Both
      guarded, `reducedMotion.test.js`. ORIGINAL: Nine blocks honour it; confirm the anime.js
      animations in App.jsx do too, since those are driven from JS and a media
      query in CSS does not reach them.
- [ ] **Clerk's own sign-in form.** Third-party markup inside our page, and
      our accessibility obligation regardless of who wrote it.

### Closed since the last handoff

- **`012_rls_recursion.sql` is fully applied**, grants included. Verified
  2026-08-09: both helpers are `prosecdef = true`, and all five policies match
  the migration text.

  **Do not verify a grant with `has_function_privilege` alone.** Postgres grants
  EXECUTE to PUBLIC by default on every new function, so that check returns true
  whether or not the `grant` statement ever ran — it would have said "applied"
  here even if nothing had been. Read `pg_proc.proacl` instead: a NULL acl is
  the default, and the grant is proven only by seeing the roles listed
  explicitly with PUBLIC absent (`anon=X/postgres | authenticated=X/postgres`).

- **The infinite loading screen after sign-in is fixed.**
  `force_organization_selection` was turned off in the Clerk dashboard, which
  was the cure; the code side had already landed. Keep the trap, because it
  cost days and nothing threw: Clerk's two hooks disagree about "signed in",
  and its own shipped source is explicit —

  ```
  useAuth:  isSignedIn = session.status !== "pending" && !!session   FALSE
  useUser:  isSignedIn = a user object exists, no session check      TRUE
  ```

  The gate used `useUser` and the app used `useAuth`, so the shell rendered for
  a session that could never authorise a request. `isReady` stayed false, the
  `loadChats` effect never fired, and `setIsInitialLoading(false)` lives in
  that function's `finally` — so the skeleton stayed up forever. Sentry had
  nothing and the console had nothing. If a loading state ever hangs again,
  check which hook decided it. The gate now consults both hooks,
  `SessionPending` explains a pending session, and a 60s watchdog replaces the
  skeleton with an error rather than spinning.

  THE `/__clerk` 404 IS REAL, IT IS CLERK-JS DOING IT TO ITSELF, AND IT ONLY
  HAPPENS ON `*.vercel.app`. Nothing in this repo configures a proxy. clerk-js
  6.26.0 synthesises one, in `get proxyUrl()`:

  ```js
  // e8 = [".vercel.app"]
  if (!domain && instanceType === "production" &&
      e8.some(s => window.location.hostname?.endsWith(s)))
    return `${window.location.origin}/__clerk`;
  ```

  A production publishable key on a hostname ending `.vercel.app`, with no
  `domain` option, makes clerk-js route every API call through
  `${origin}/__clerk` — a path nothing serves, so `/v1/environment` and
  `/v1/client` 404. It then falls back to `clerk.alop-ai.com` and sign-in
  works, which is why this never surfaced.

  Measured 2026-08-09, clean headless Chromium, both hosts:

  | Host | `Clerk.proxyUrl` | `/v1/environment` |
  |---|---|---|
  | `alop-ai-omega.vercel.app` | `https://alop-ai-omega.vercel.app/__clerk` | 404, then fallback |
  | `alop-ai.com` | `""` | 200, direct |

  SO THERE IS NOTHING TO FIX FOR REAL USERS. `alop-ai.com` never takes this
  path. The cost falls only on the `*.vercel.app` URL, which is preview and QA
  traffic. Do NOT add a `/__clerk` rewrite to chase it: proxying needs the
  Clerk secret key at the edge and is already in this repo's history as a
  revert. If a preview URL ever needs a clean network log, the lever is the
  `domain` prop on `ClerkProvider` — setting it skips the branch above — but
  `domain` is satellite-domain machinery, so do not reach for it casually.

  Two corrections this entry has now survived, both from confident wrong
  reasoning about the same three requests:

  - "A stale cache or an extension made that request." Wrong, but built on two
    true facts: the source really contains no `/__clerk`, and direct calls
    really do return 200 (that is the fallback).
  - "`proxyUrl` is injected from a Vercel environment variable." Also wrong —
    invented to explain the first fact. The only Vercel variables set are
    `VITE_SENTRY_DSN`, `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_BASE`.

  The lesson both times: absence from the source is not evidence of absence,
  and "it must come from config" is a guess wearing a mechanism's clothes. The
  answer was in the library's own compiled source. Read the dependency.

- **A CSS mask resolves against the PADDING box, and that made a fade look like
  a bug twice.** The transcript's bottom edge had a 28px fade to dissolve the
  line where it meets the composer. It still looked guillotined, because the
  bottom padding was 16px — so two thirds of the fade dissolved empty padding
  and only ~12px reached text. `--fade-bottom` is now BOTH the fade length and
  the padding, in one token, because the geometry requires `padding >= fade`
  and two separate numbers will drift. If you shorten one, shorten both.

- **Decoration needs somewhere to be that is not behind the words.** The
  hemp-leaf lattice was `.empty-state::after`, so it vanished the moment a
  conversation started and the composer sat on an undecorated band. Moving it
  to `.chat-main::after` fixed that — and introduced a mobile regression I then
  had to fix: the mask clears the middle of the surface, which works while
  there are GUTTERS. At 320px the transcript is 87% of the chat surface, so the
  pattern landed under the prose. It is `display: none` below 640px. A
  percentage mask cannot be tuned out of that; the column and the surface have
  converged.

  Note also that `.chat-content` had to be lifted to `--z-empty-content`. A
  positioned `::after` paints in a later phase than static in-flow content
  however small its z-index, so without it the pattern renders ON TOP of the
  transcript. The empty state already carried the identical fix.

- **Check what the SIGNED-OUT page actually downloads, not what the bundle
  report says.** Measured in a browser against a production build: 621.7 KB, of
  which 230 KB is Clerk's own chunks (not ours to cut) and 142 KB was fonts.
  Two findings that no bundle analyser would have surfaced, because both are
  runtime behaviour:

  1. **JetBrains Mono, 30.7 KB, was loading to render eleven glyphs** — the
     council temperatures `0.2`–`0.8` on the sign-in page. A webfont downloads
     when a glyph needs it, so a single small element on the public page pulled
     the whole file. `--font-mono-system` exists for exactly this: mono voice,
     no download. Its nine other consumers are behind auth and keep the real
     font.
  2. **`logo-mark.png` is 512×512 and 28 KB, and was rendered at 34px, 22px,
     and in the initial skeleton.** `favicon.png` is the same mark at 144px and
     5.5 KB and is already fetched for the tab icon, so on those three it now
     costs nothing. The empty state keeps the big file — it renders at 76px.

  Total after: 573.6 KB. Re-measure the same way rather than trusting a diff.

- **`copyStyle.test.js` enforces the house copy rules.** Em dashes are out of
  interface copy by request. It reads JSX TEXT NODES only — comments and string
  literals are exempt, because prose about code is not interface copy and a
  string is as often a regex as a sentence. It found three em dashes and a
  stray ellipsis character on its first run that a manual pass had missed.
  If it fails, rewrite the sentence; do not widen the exemptions.


- **The RLS layer had never worked. Every policy recursed.** Found by running
  the policies rather than reading them — `set local role authenticated`, set
  `request.jwt.claims` to a real user, `select count(*) from chats`:

  ```
  ERROR: 54001 stack depth limit exceeded
  CONTEXT: SQL function "current_app_user_id" during startup   (x ~400)
  ```

  The cycle, in place since migration 002: policy `chats_owner` calls
  `current_app_user_id()`, which does `SELECT id FROM users`, which triggers
  policy `users_self_read`, which calls `current_app_user_id()`. Same for
  `chat_files` and `usage`.

  It was invisible because the backend holds the **service-role key, which
  bypasses RLS**, and the frontend has no Supabase client at all — there is no
  `createClient` anywhere in `frontend/src`. Nothing has ever taken the path
  that recurses. So this was a latent bug and not an incident, and the whole
  point of fixing it now is that the day somebody adds a direct-from-browser
  path is the worst possible day to find out the guard rail throws instead of
  denying.

  Fix in `012_rls_recursion.sql`: an RLS helper that reads a table protected by
  a policy that calls that helper **must be SECURITY DEFINER**, or it cannot
  terminate. `current_app_user_id()` and the new `current_app_is_admin()` are
  both DEFINER with a pinned `search_path`. Safe because they take no
  arguments and derive everything from a claim the caller already proved.

  **Two traps here, both of which bit during this work:**
  1. A policy expression is evaluated AS THE CALLING ROLE, so it DOES consult
     `EXECUTE` privilege on functions it calls. Revoking EXECUTE from
     `authenticated` "because policies don't check grants" turned every policy
     from denying correctly into `42501 permission denied for function`. The
     grants are required. Do not revoke them again.
  2. Testing this needs `set local role` plus a forged `request.jwt.claims`.
     Reading the SQL will not show you either failure.

  **STILL OPEN:** the two `grant execute` statements at the end of 012 have NOT
  been applied — the tool that runs DDL here refused GRANT. Until they run,
  RLS denies with an error rather than a clean false. No production impact
  (nothing uses that path), but 012 is not finished. Run them from the Supabase
  SQL editor.

- **SerpApi's ~110 "APIs" are one endpoint, and they are ONE council tool.**
  The dashboard lists Google Flights API, Yelp Reviews API, YouTube Transcript
  API and about a hundred more. They are `serpapi.com/search` with a different
  `engine=`. So `lib/serpapi.js` is a table, and `search_specialized` is a
  single registry entry taking an `engine` argument.

  **Do not "improve" this into one tool per engine.** Every tool's name and
  description is injected into every seat's prompt on every turn: at ~10 words
  each, 110 tools is roughly 1,500 tokens per seat per turn — seven seats, every
  conversation — to describe flight search to somebody asking about a monitor.
  `tool-registry.test.js` asserts it stays one tool.

  Two guards that are not decoration. The engine list is an **allowlist**,
  because an invented `engine=google_cars` is a 400 that SerpApi still BILLS —
  the request reached them. And the extra-parameter list is an allowlist too,
  so a model-written argument cannot override `api_key`. Both are tested.

  SerpApi bills per search on a 100/month free tier, which is a couple of
  talkative conversations. The agent loop's 8-call ceiling is what bounds it and
  is load-bearing here in a way it never was for the free providers.

  Overlap is deliberate: Serper stays the cheap default for shopping in the
  search fan-out, SerpApi covers the engines Serper has no equivalent for.
  Paying both vendors for Google Shopping would be the easy mistake.

- **Jina cannot see a price that JavaScript paints in, and that was the root.**
  It fetches a document and converts it. Every large retailer ships an empty
  product shell and fills it from an XHR, so the conversion is navigation and
  nothing else — ranking URLs better only picks a page whose price is still
  invisible. `FIRECRAWL_API_KEY` adds a real browser as a **fallback**, never
  the default: it is slower and metered where Jina is neither, and most pages
  are server-rendered.

  The gate is `hasReadableSignal` in page-extract.js, and its second test is
  conditional for a reason worth keeping. Short output always means failure. A
  MISSING PRICE only means failure when a price was the point of the read — a
  news article legitimately has none, and testing for one there would call every
  successful read a failure and send every page in the app to Firecrawl. That is
  how a free-tier allowance disappears in an afternoon. It lives in
  page-extract.js rather than server.js purely so it can be tested; server.js
  cannot be required in a test.

- **Prices are a data problem, not a reading problem.** Asked for monitors
  under 2,500 AED, the app named five monitors, gave no price for any of them,
  and told the user to go and check the shops. Nothing had thrown. Three causes,
  all now fixed:

  1. **One page was read, and it was the wrong one.** The deep read was
     `sources[0]`, and on a shopping question the top web result is a CATEGORY
     listing — `carrefouruae.com/.../c/NF4070600`, `amazon.ae/b?node=...`, a
     PCMag roundup. Those pages hold no price in their markup at all; it is
     painted in by JavaScript after load. `rankReadTargets` (page-extract.js)
     now scores URLs and reads `PAGE_READ_LIMIT` (3) of them, product-shaped
     first. The reads share ONE `settleByDeadline`, so three cost the wall
     clock of the slowest, not the sum — a loop that awaited each in turn would
     triple the latency of the deep read with nothing to show it.
     A long hyphenated slug scores 1 and an explicit `/dp/`-style path scores
     3, deliberately: the PCMag roundup has a slug, and when they scored equal
     the roundup won the tie and got read instead of the Amazon product page.
  2. **No provider returned a price as data.** All five web providers return
     links and prose. Google Shopping holds the price as a field, and
     `lib/shopping.js` reads it through Serper. Gated by `isShoppingQuery` —
     Serper bills per query and "who won the election" needs no price check —
     and the gate requires a product word AND a money word, because either
     alone matches "the price of freedom" and "the monitor lizard".
  3. **The search cache was not keyed by country.** It is now. Shopping results
     are region-scoped, so without the country in the key whoever asked first
     decides what everyone else is told a thing costs — and the answer looks
     entirely normal while doing it.

  Two rules in there that are not obvious and should not be "tidied":
  **prices are never parsed into numbers** (picking a currency wrongly turns
  1,899 dirhams into 1,899 dollars silently, and the council can read a
  currency but cannot recover a discarded one), and **the prompt block states
  its own coverage limits** (Google Shopping is thin outside the US and EU; a
  model handed a short list with no caveat describes it as the market).
  `enough` in the fan-out also refuses to resolve while a shopping lookup is
  outstanding — on a price question the eight links are precisely the part
  that already failed the user.

- **Cross-chat memory ships.** `user_facts` was a table in production with a
  `vector(1536)` column and zero references anywhere in the repo; it is now
  written, read, injected at system position and deletable from Settings.
  **Facts are extracted from the USER'S message only, never the assistant's** —
  an answer carries text fetched from the open web, and a fact drawn from that
  would be replayed at system position in every later conversation forever.
  That rule is the design, not a detail; `lib/user-facts.js` explains it and
  `tenant-scope.test.js` asserts the call obeys it.
  There is still **no embedding provider in this codebase** — no call to any
  embeddings endpoint exists — so the `vector(1536)` dimension is inherited,
  not chosen. Semantic recall is Phase 2 and starts with picking a provider.
  See `docs/MEMORY-AND-CACHE-PLAN.md`.

- `VITE_SENTRY_DSN` is set in Vercel and confirmed present in the deployed
  bundle. Front-end crashes now produce a screen AND an event.
- `ErrorBoundary` ships. Nothing may render above it — `--z-crash: 400`.
- Custom `404.html` ships. Note what actually reaches it: the rewrite sends
  extensionless paths to the SPA, so only missing assets land there. `/api/*`
  and `/v1/*` are left on Vercel's plain 404 DELIBERATELY — an API path
  returning branded HTML is worse than one returning nothing.
- **Four surfaces stopped lying on failure.** The pattern, if you add a
  fifth: state the error, say the data is unaffected, offer the retry, and do
  NOT clear the list you already have. Named `<thing>Error` / `retry<Thing>`
  every time — `chatsError`, `messageLoadError`, `pricesError`,
  `chatFilesError`. Each was showing the SUCCESS-with-no-data state on a
  caught error, which is indistinguishable from the data being gone.
  - The chat list rendered "No chats yet".
  - Upgrade was a DEAD BUTTON: the panel was gated on `Boolean(prices)`, so a
    failed prices call meant clicking it did nothing at all.
  - `fetchPlan` swallowed its error, so a paying customer could be shown the
    free tier and asked to buy what they already had.
  - `loadChatFiles` set `[]` on failure, so attachments appeared deleted.
  - One nuance worth keeping: a 503 from `/api/billing/prices` means no
    Stripe price IDs are configured. That is permanent, so it gets NO retry
    button. Only transport failures get one.
- **Palette focus trap.** It declared `aria-modal` and enforced nothing.
- **`reflow.test.js`, `contrast.test.js`** cover what can be checked without a
  browser. The manual checklist above is what is left.

### Deliberately NOT built, and why

Message queues, load balancers, read replicas, a search index, a circuit
breaker. The database holds **2 users and 5 usage rows**. Each of these adds a
component that fails independently for no measurable gain at this size. The
model-call path already has `settleByDeadline` and per-call timeouts, which is
the useful part of a breaker. Revisit on evidence, not on principle.

### Two findings worth not re-deriving

**The scanner's "wildcard CORS on all endpoints" was false, twice over.**
`/v1/client` and `/v1/environment` are Clerk's Frontend API at
`clerk.alop-ai.com`. `/api/*` on `alop-ai.com` was the Vercel static host
answering every extensionless path with `index.html` — fixed in the rewrite so
those paths 404. The real API is `alop-ai.onrender.com` and has always been an
exact-origin allowlist; `lib/origin-guard.js` has the proof and the reasoning.

**`test/fixtures/appMarkup.js` is NOT a source of truth about accessibility.**
It is hand-transcribed markup for the CSS cascade snapshot, where only classes
and structure matter, so its ARIA attributes lag the components badly. An axe
run over it reported 44 violations; the real components had 2. If you assert
anything about labels or roles, render the component.

## Working as a duo

Claude and Codex review each other's work rather than splitting it. The pattern
that works: one writes, the other attacks the diff *before* it is committed,
and findings get verified against the source rather than taken on trust. Both
have been wrong; both have caught the other. Commits carry both trailers.

Codex runs from Claude's side with:

```bash
codex exec --skip-git-repo-check -c model_reasoning_effort=high "<prompt>" 2>/dev/null
```

`2>/dev/null` matters — Codex logs MCP connection failures to stderr and they
drown the answer. Do not pass `-m`; the configured model is correct.

## House style

Terse. Drop articles, filler, pleasantries, hedging. Fragments fine. Technical
terms exact, code and error strings verbatim.

Pattern: `[thing] [action] [reason]. [next step].`
Not: "Sure! I'd be happy to help you with that."

Write normally — full sentences — for: code, commit messages, PRs, security
warnings, and irreversible-action confirmations.

**`MagneticButton`'s lazy-chunk test is timing-sensitive.** It flaked once
under parallel load and passed on re-run. If it fails alone, re-run before
investigating.

**The CSS guards will stop you, and they are right every time.** Adding a
stylesheet means four edits, not one: the `@import` in `App.css` (before
`utilities`, which stays last), the order list in `cssImportOrder.test.js`,
the table in `docs/FRONTEND.md` §2, and a z-index TOKEN — never a bare
number. Add the new component's markup to `test/fixtures/appMarkup.js` or the
file reads as dead CSS later, then regenerate the cascade baseline with
`UPDATE_CASCADE_BASELINE=1`. Regenerating is correct ONLY when you changed
what renders on purpose; it is not a way to make a red test green.

**Two more traps, learned the expensive way.**

*Never propose an index from the repository alone.* Twice now — 006's
`audit_logs_created_at` when `audit_logs_recent` already existed, and 009's
`usage_user_recent` when `usage_user_id_date_key(user_id, date)` already
covered it. `IF NOT EXISTS` protects the NAME, not the semantics. Read
`pg_indexes` first, and force the planner to show you (`begin; set local
enable_seqscan=off; explain ...; rollback;`) because these tables are too
small for it to choose an index on its own.

*Windows + Node stdin.* `process.exit()` while stdin is closing, or consuming
`process.stdin` as an async iterable, both trip
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in libuv and return
127 from a run that succeeded. Use `process.exitCode` and `readFileSync(0)`.
`tools/glm.mjs` has both, commented.

## Google model ids expire, per account

**Never pin a dated Gemini id, and never trust ListModels.** Measured
2026-08-16 with the owner's key: `gemini-2.5-pro`, `gemini-2.5-flash` and
`gemini-2.0-flash` all answered `generateContent` with 404, two of them "no
longer available to NEW USERS" — the retirement is account-relative, so the
same list can work on an older key and refuse every image on a newer one.
ListModels still advertises `gemini-2.5-flash` while `generateContent` refuses
it, so only a real call to the endpoint you will use proves an id.

`lib/vision.js` therefore leads both ladders with an alias
(`gemini-pro-latest`, `gemini-flash-latest`) — Google repoints aliases instead
of retiring them. `lib/image-gen.js` has no alias available and holds dated ids
that need re-probing whenever generation starts failing. **A 429 is not a
retirement**: it means the id is alive and the quota is spent, and falling
through on it would quietly downgrade the model.

## The migrations and the database disagreed in both directions

Found 2026-08-16 by listing `pg_proc` and `information_schema`, after `023` —
whose checker reads the migration FILES — could not see any of it. **A checker
over the files verifies what the files say, not what the database is.**

- **`019_turn_ledger.sql` HAS NEVER BEEN APPLIED.** `turns`,
  `turn_reservations`, `claim_turn_reservation`, `settle_turn_reservation` and
  `checkpoint_turn` are absent from production while `lib/turn-ledger.js` and
  `lib/reservation-ledger.js` call them on every turn. Both fail open, so
  resume-after-drop and idempotent admission are OFF in production and the
  suite is green anyway. Apply it before trusting anything about turn resume.
- **The original tables were created by hand.** `users`, `chats`, `usage`,
  `audit_logs`, `user_facts` and `or_request_budget` predate `migrations/`.
  `000_base_schema_lineage.sql` and `025` now transcribe them, so a rebuild has
  a `users` table for 019's foreign keys to point at. Both are transcripts of
  production, not redesigns, and **neither has been proven by an actual
  rebuild** — applying them where everything exists is a no-op.

Two checks exist now and both were watched failing. `scripts/check-drift.mjs`
asks production (needs `SUPABASE_ACCESS_TOKEN`) and reports MISSING and
UNTRACKED separately. `lib/rpc-lineage.test.js` runs in the suite with no
token: every `rpc('…')` and `.from('…')` in the code must be created by some
migration file.

## A claim you never release is not idempotency

`stripe_events` was claimed before the work and never touched again, and the
webhook read "a row exists" as "it was applied". The sequence costs a customer
their subscription: the `users` update throws, the route answers 500 so Stripe
will retry, the retry hits the primary key, and the handler reports a duplicate
and answers 200. Paid, still on `free`, and every line the retry logs reads
healthy.

`lib/stripe-event-ledger.js` gives the row a state and only `done` skips.
**The `failed` check must stay ABOVE the in-flight window check** — Stripe's
first retry can arrive inside that window, so testing the clock first reads a
known failure as a live attempt and skips it, which is the original bug wearing
a new status.

The general shape, and it is not only Stripe's: **any at-least-once delivery
whose dedupe key is claimed before the work must settle that claim on BOTH
paths.** Existence is not completion.

`026_stripe_event_state.sql` is written and **NOT APPLIED**. Until it is, the
ledger reads the missing column as "no state" and falls back to exactly the old
behaviour, which is deliberate and tested — see the 019 entry above for why
that fallback is written explicitly rather than assumed.

## The instance count is measured now, not remembered

`RATE_LIMIT_STORE=postgres` shares the rate-limit counters; unset, every limit
is per-process and multiplies by the instance count. The whole design rested on
a comment saying "set it before scaling", and scaling on Render is a dropdown.

`lib/instance-census.js` heartbeats one row a minute into `rate_limits` (no
migration — 004's shape already fits) and counts the live ones. More than one
instance while the shared store is off is a named log line carrying the
multiplier, plus `instances` and `limitsMultiplied` on `/health`.

**It warns rather than refusing to boot**, and that is not timidity: a rolling
deploy runs two instances by design, so exiting on a second one would fail every
deploy of a correctly configured service. Do not "harden" this into a fatal.

## A wired module and a tested module are different claims

Three guards now read `server.js` as text because their subject is a call site,
not a function: `lib/upload-wiring.test.js` (an extractor with no caller),
`lib/census-wiring.test.js` (a census started inside the branch it exists to
watch), `lib/error-envelope-wiring.test.js` (the ~30 leaking `res.status(500)
.json({ error: err.message })` sites the envelope replaced, and nothing stopping
the thirty-first).

When you add one, mutate the source and watch it fail. The census guard passed
against a one-line `if (USE_PG_RATE_LIMIT) startInstanceCensus(...)` on its
first version, because it only scanned braced blocks — a guard that misses the
shortest form of the bug is decoration.

## A Clerk 401 explains itself in a header, not in the body

Measured 2026-08-18, two passes into an evaluation run that could not start.

The server's 401 body is `{"error":"Authentication required","code":
"unauthenticated"}` and that is all it will ever say. Clerk writes the actual
reason onto the response:

    x-clerk-auth-status:  signed-out
    x-clerk-auth-reason:  token-invalid-authorized-parties
    x-clerk-auth-message: Invalid JWT Authorized party claim (azp) undefined.
                          Expected "https://alop-ai.com,…"

Read those three before theorising. The fact they carried here: **a token minted
through the Clerk BACKEND API has no `azp` claim**, and `server.js` mounts
`clerkMiddleware` with `authorizedParties` from the CORS origin list, so no
back-minted token can ever authenticate against this server. `azp` is written by
the FRONTEND API from the `Origin` of the request that asks for the token. A
script that needs a real session therefore has to sign in the way a browser
does — sign-in token from the Backend API, redeemed at the Frontend API with an
`Origin` header — which is what `backend/scripts/run-evals.mjs` now does and is
the working example to copy.

Related: `sessions.createSession` is refused on a PRODUCTION instance (400
`request_invalid_for_environment`). It is a development-only call.

## `/health` says which commit is running, and it has been a day behind

`GET https://alop-ai.onrender.com/health` needs no authentication and answers
`{"status","time","commit","instances","limitsMultiplied","rateLimitStore"}`.

**Check `commit` against `git log` before trusting any measurement taken against
production.** On 2026-08-18 it was 15 commits and 22 hours behind `main` —
Render was not auto-deploying — and the first live evaluation run therefore
graded a build that predated half the features the ledger describes. The run's
numbers are real; they are just not numbers for `HEAD`.

The same endpoint settles two things that were previously recorded as
unverifiable from here: `rateLimitStore` and `instances`.

## The answer cache sits above the router, so a routing change is invisible to it

Measured 2026-08-18 by running the evaluation dataset twice.

The cache lookup in `server.js` happens BEFORE `routeByRule` and before the
model router — deliberately, because a hit costs zero OpenRouter requests out of
the fifty this account gets in a day. The consequence: **a question already in
the answer cache never reaches the routing decision.** Ship a change to which
questions get a web search and every cached question keeps the answer it already
had, for the row's whole ninety-day life, with nothing marking it stale.

`lib/cache-identity.js` is the mechanism that prevents this and its header
already says "editing a prompt IS the invalidation". Anything that decides HOW
an answer is produced belongs in `cacheFingerprint`'s material. Routing did not,
until `ROUTING_POLICY` in `lib/router.js`. `lib/router.test.js` fails if a regex
`routeByRule` branches on is missing from `ROUTING_RULES`.

**Before claiming a behaviour change works in production, ask whether the path
you changed is below a cache.**

## An eval score that improves is not evidence — read the latencies

Same two runs. The first scored 15/22, the second 17/22 after a fix, and the
second measured nothing at all: every case was a cache hit replaying the first
run's answers. What gave it away was not a verdict but a set of numbers that
should not have moved — `arith-order` 31,753ms to 3,414ms, `reason-bayes`
43,510ms to 2,966ms, p50 11,182ms to 3,586ms, with no optimisation between them.

The sharpest signal was a case that got WORSE: `search-weather` passed on run
one having genuinely called `web_search`, and failed on run two returning the
same cited text with no tool call, because a cache hit emits no `tool_start`
frame. `toolSuccessRate` went 1.0 to `null` for the same reason.

**When a run gets faster and better at once, check that it did the work.** The
per-case observations in `eval-runs/*.json` carry latency, frame count and the
answer text; the pass/fail summary does not.
