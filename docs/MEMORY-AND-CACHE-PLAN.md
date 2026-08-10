# Making answers fast without crawling the web

Status: proposal, nothing here is built yet. Written 2026-08-08.

## The idea this replaces

The original framing was: the app is slow because it pulls information at the
moment it needs it, so it should instead crawl the web continuously and store
everything ahead of time, even with no users.

The instinct — precompute instead of fetch — is right. The target is wrong, and
it is worth being precise about why before spending a month on it.

**Where the time actually goes.** An answer costs one search fan-out (already
deadlined at 3500ms, already cached) plus a council fan-out of up to seven model
calls. The model calls dominate, and no amount of stored web pages removes them.
A pre-crawled corpus would speed up the part that is already the cheap part.

**What a crawl would cost.** Storage grows without bound, every page needs
refreshing or it silently answers with stale facts, and the crawl must obey
robots.txt and rate limits per host. Against 2 users and 5 usage rows, that is a
second product with its own failure modes and no measurable gain. This is the
same reasoning that already keeps message queues and read replicas out of this
codebase — see AGENTS.md, "Deliberately NOT built".

**What is worth keeping from the idea.** Two of its three parts are already
half-built and unfinished:

1. Remembering what a specific user has told us, permanently, across chats.
2. Not re-fetching an answer the system has already produced.

Both are per-user or per-query precomputation. Both pay off at two users. Both
have tables in production already.

## What exists today

`search_cache` — live and working. `lib/search-cache.js`, two tiers (in-process
Map, then Postgres), 15 minute TTL, never throws, reads on a 400ms leash, writes
never awaited. This is already the "don't fetch it twice" half.

`user_facts` — a table in production with columns `id, user_id, fact, category,
embedding vector(1536), created_at`, and **zero references anywhere in the
repository**, including migrations. It came from the ad-hoc schema that predates
`migrations/`. Nothing writes it, nothing reads it, and the performance advisor
flags it as unindexed because it has never been used.

Per-chat memory already ships (`chats.conversation_summary`, `feedback_notes`),
so the missing piece is specifically **cross-chat** memory.

## Phase 1 — wire `user_facts`, no embeddings

Ship the durable part before the clever part.

- Extraction: after a turn settles, ask one cheap seat to return zero or more
  short standalone facts about the user, or nothing. Runs off the response path
  — the user has already been answered — same as the title generation.
- Storage: insert into `user_facts` with `user_id` set from the server's own
  session, never from the request body.
- Retrieval: newest N facts for that user, injected at system position.
- Deduplication: exact-text match against that user's existing facts before
  insert. Crude, and enough at this size.

Rules this must not break:

- Every query carries `.eq('user_id', user.id)`. RLS is on and does nothing for
  the service-role connection — see AGENTS.md. `tenant-scope.test.js` must cover
  the new queries.
- A user's own facts derive from that user's own turns, so system position is
  correct here for the same reason `convSummary` is. Facts extracted from a
  fetched page or an uploaded file are NOT the same thing and would need
  `UNTRUSTED_PREAMBLE`.
- Needs a user-visible list with delete, and deletion on account deletion. Data
  about a person that they cannot see or remove is a compliance problem, not a
  feature.
- Index: `(user_id, created_at DESC)`. Read `pg_indexes` before writing the
  migration — twice now an index has been proposed from the repo alone that
  already existed under a different name.

Verifiable success criterion: tell it something in chat A, start chat B, and it
knows. Nothing in Phase 1 requires the embedding column.

## Phase 2 — semantic retrieval — SHIPPED 2026-08-11

"Newest N" fails once a user has a few hundred facts, because the relevant one
is not the recent one. That is what the `embedding` column is now for.

The blocker was **no embedding provider in this codebase**, and a column of
`vector(1536)` — OpenAI's width, on a project with no OpenAI key. Resolved by
picking Google `text-embedding-004` (768) against the `GOOGLE_API_KEY` that
already pays for vision, and narrowing the column to match. pgvector confirmed
enabled first (0.8.2, in `public`, so the type is `public.vector`).

What shipped:

- `013_facts_embedding_768.sql` — the ALTER, plus `match_user_facts(uuid,
  vector(768), int)`. A plain ALTER was safe only because the table was empty;
  the file says so and says what to do instead if it ever is not.
- `lib/embeddings.js` — request body, response parse, width check. A vector of
  the wrong width or holding a non-finite number reads as *no* vector, never as
  a usable one, because `<=>` will rank against nonsense without complaining.
- Write path embeds each new fact off the response path. A null embedding is a
  fact stored without semantic recall, not a fact lost.
- Read path embeds the current turn behind a 600ms `settleByDeadline`, then
  merges nearest-first with newest-first and deduplicates.

**Both reads run, and that is deliberate.** Any row written while the key was
unset has a null embedding and is invisible to `match_user_facts` forever, so
semantic-only retrieval would silently drop those facts rather than degrade
them. Nearest first, newest filling the remaining slots.

**No vector index.** ivfflat and hnsw earn their cost at thousands of rows;
every query filters by `user_id` first and that index already exists. Revisit
when one user's fact count reaches four figures.

Left undone on purpose: **semantic dedupe on write.** Recall and dedupe fail in
opposite directions — a wrong ranking costs one turn, a wrong merge destroys a
statement the user made. `factKey` stays exact-match.

## Phase 3 — warm the search cache, do not crawl

The bounded version of "have it before it is asked for": take the queries this
system has actually seen, and refresh the popular ones just before their TTL
expires so the next asker gets an L2 hit instead of a fan-out.

- Source of truth is `search_cache.query_text` — real traffic, not a guess about
  what people might ask.
- Bounded by construction: refreshes only queries already asked, capped per run.
- The existing keep-warm cron is the place to hang it. Note the trap already
  recorded in memory: GitHub drops scheduled ticks and a `concurrency` group
  with `cancel-in-progress` cancels merely-queued runs.
- Facts with a long shelf life could take a longer TTL than 15 minutes, keyed by
  query shape. Worth measuring before building a classifier for it.

At 2 users this phase is premature. It is written down because it is the honest
version of the original idea, and because it becomes correct on evidence — a
cache hit rate worth reading.

## Order and reasoning

Phase 1 is the whole user-visible win: "it remembers me." Phase 2 is an
optimisation of Phase 1 that cannot be evaluated until Phase 1 has data. Phase 3
is a latency optimisation of a path that is already cached and already fast
relative to the council fan-out.

Do not start Phase 3 because it is more interesting.

Phase 2 was built before Phase 1 had produced data — `user_facts` was still
empty the day it shipped — so it was built to cost nothing when it is wrong
rather than to be justified by measurement: the recency read still runs, the
deadline is 600ms, and every failure lands back on Phase 1's behaviour. The
evaluation is still owed. Once real facts accumulate, the question to answer is
whether the nearest-first half ever surfaces something recency missed.
