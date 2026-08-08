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

## Phase 2 — semantic retrieval, only if Phase 1's recall is too blunt

"Newest N" fails once a user has a few hundred facts, because the relevant one
is not the recent one. That is when the `embedding` column earns its place.

Blocker to resolve first: **there is no embedding provider in this codebase.**
No call to any embeddings endpoint exists. The column is `vector(1536)`, which
matches OpenAI's dimensions, not Google's `text-embedding-004` (768) and not
Jina v3 (1024 default). `JINA_API_KEY` and `GOOGLE_API_KEY` are both set. So
this phase starts by picking a provider and either matching 1536 or altering the
column — do not assume the existing dimension is a decision anyone made.

Then: embed on write, `ORDER BY embedding <=> query_embedding LIMIT k` on read,
an ivfflat or hnsw index once the row count justifies one. Confirm `pgvector` is
actually enabled with `list_extensions` before writing any of it.

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

Do not start Phase 2 or 3 because they are more interesting.
