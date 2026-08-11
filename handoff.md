# Handoff — 2026-08-11

State of play at `49dd9bc`, pushed to `origin/main`. Read `AGENTS.md` first;
this file is what changed and what is still open, not a description of the
project.

617 frontend tests, 576 backend, working tree clean. Render auto-deploys from
`main` and is slow — well over five minutes — so the four commits below are
live or shortly will be.

**A previous handoff went stale in the worst way**: it still described the
Clerk migration as "deliberately NOT attempted" three weeks after it had merged,
so anyone reading it as current state would have re-planned finished work.
Dated section headings and commit SHAs exist to stop that. If you change
something this file describes, change this file in the same commit.

---

## The one thing to read before touching the frontend

**The empty-state ornament set is the specification, and it has now been
reverted to twice.** Two hanging crescents in the gutters, four sakura corner
sprigs, the asanoha lattice across the chat surface, a centred hero, and the
starters as a 2x2 card grid. The torii is gone — `CouncilRosette` replaced it,
and the logo mark now sits inside the rosette's centre hole.

Five redesigns were tried and all five rejected: one wooden bough replacing the
four sprigs; that bough moved to the bottom right; an ensō drawn as seven
overlapping arcs; a split layout with the council roster as the right column; a
day/night sky with a crescent and stars against a sun.

Several were argued for by the design skills this repo is worked on with, which
name centred heroes and grids of equal cards as anti-patterns. That did not
settle it and should not next time. This is a personal product with one owner
and his taste is the specification. **Do not "fix" the centred hero or the card
grid on the strength of a general design rule.** If a redesign is wanted it will
be asked for, and it will be asked for in terms of this ornament family rather
than in place of it.

The revert was done by restoring the design-owned files from `c513df7` rather
than by reverting five commits, because non-design work had landed in the same
files. If you ever need to do it again, that is the shape of it: check
`git log <base>..HEAD -- <file>` per file before restoring anything wholesale.

---

## This session (2026-08-11), later

**The double rule** on the composer and the sidebar. Asked for with two
botanical-poster references, and taken as an addition WITHIN the ornament
family rather than as a direction to replace it — the branch, the seal and the
alpha ladder are untouched, and the empty state was not opened.

The references never draw a single edge: an outer rule at the trim and a second
hairline a few millimetres inside it. Three pseudo-elements, no new markup, so
`appMarkup.js` did not need a fixture:

- `.input-wrapper::after` — inner rule, inset 4px inside the card's 12px
  padding, `--ornament-ink` at the faint step, one step up on focus-within.
- `.sidebar::after` — the second line 3px inside `border-right`. Kept in the
  collapsed rail, so toggling never changes the KIND of edge.
- `.chat-group-label::after` — the rule that runs off the caption to the trim,
  faded rather than stopped square because the label is sticky and passes over
  rows underneath it.

Rendering changed on purpose; the cascade baseline was regenerated. 620
frontend tests pass.

---

## This session (2026-08-11)

**Semantic memory, Phase 2** (`c19508e`). `user_facts.embedding` is
`vector(768)` and facts are retrieved by meaning, not only by recency. Migration
`013` is APPLIED to production. Provider is Google `text-embedding-004`, named
once in `lib/embeddings.js`.

Four things about it that are decisions, not accidents:

- *A malformed vector reads as no vector.* Wrong width, NaN, Infinity — all
  null, all stored as a fact without semantic recall. The alternative is a row
  `<=>` ranks against forever without ever erroring.
- *Both reads run on every turn.* A fact written while the key was unset has a
  null embedding and is invisible to `match_user_facts` permanently, so
  semantic-only retrieval would silently DROP those facts rather than rank them
  low. Nearest first, newest filling the remaining slots.
- *The read-path embed is behind a 600ms deadline.* Past it the turn goes out
  with recency-ranked memory, which is what it had before. Nothing on the write
  path has a deadline — it runs after the user has been answered.
- *Semantic dedupe on write was deliberately not built.* Recall and dedupe fail
  in opposite directions: a wrong ranking costs one turn, a wrong merge destroys
  a statement the user made.

Verified against production: probes ranked 1.0000 / 0.9939 / 0.0000 in the right
order, a second user's id returned nothing, probes deleted, no new advisor
findings. **NOT verified: the live HTTP call to `text-embedding-004`.**
`GOOGLE_API_KEY` is set in Render and not in the local `.env`, so every
provider-dependent path was exercised through its failure branch only. The first
real turn on the deployed backend is the check — `[EMBED]` in the logs means it
is failing.

**The transcript looked dead while waiting** (`bfa7fe8`). Reported as "no
loading animation, no SSE, no animations". **Streaming was never broken.** SSE,
the 16ms backlog-proportional reveal and the answer-shaped skeleton are all
intact and reachable — an agent traced the whole path to confirm it before
anything was changed. What was wrong: `send` sets status to `loading`
immediately, but the placeholder carrying `typing: true` — the thing that
renders `AnswerSkeleton` — was inserted only after `createChat`,
`ensureMessagesLoaded` and the awaited message PUT. The question painted and
then sat alone for one round trip on a warm chat, or a whole cold start on a new
one. The skeleton now renders off `status`. Image generation got its first
in-transcript feedback of any kind from the same change; that path sets the same
status and inserts no placeholder at all.

**The council now says what it is doing** (`e7a408d`). Seats are polled with
`stream: false`, so no answer token can exist until the last seat settles —
that is most of the turn and all of it was silent. The backend opens the stream
before the council runs and reports real work: `Asking 7 seats`, then `N of 7
answered`, then `Reconciling the answers`. `runCouncil` had always accepted an
`onSeat` reporter and nothing in production ever passed one, so the information
existed and went nowhere.

**Every stage is a real event, and it must stay that way.** There is no rotating
list of plausible-sounding activities. The first time it claims to be searching
on a turn that ran no search, nothing else this product reports about its own
work is worth believing. Counts only, never model names — the roster is one
screenshot away from being public.

Two things had to move with the early stream open, and both would have been
silent damage:

- `msToFirstByte` was stamped at `openStream`, which is now seconds before any
  word. Left alone, that commit would have looked like a large latency win while
  the user waited exactly as long. It is stamped on the first chunk now, and the
  old measurement continues as `msToFirstProgress`.
- The client cleared the `typing` placeholder when headers arrived. That would
  have swapped the skeleton for an empty bubble at the moment the long wait
  BEGINS — the feature meant to fill the wait would have emptied it. It clears
  on the first chunk now, and the 16ms painter no longer paints an empty string,
  which is what used to win that race on every turn.

**The collapsed rail is closed and reports work** (`f9c8f7a`). It used to end
wherever the chat glyphs ran out, which is a list stopping rather than a column
closing. It gets the keystone at its foot, and lights while the council works —
the earrings either side of the transcript already do exactly that, so this
joins an existing signal instead of inventing a second one. Opacity and colour
only, no movement: the earrings swing because they hang from a chain; a fleuron
on the floor of a column that moved would read as a loose element. `Keystone` is
exported and takes a `className` now. Verified in a browser, not inferred from
the markup.

**Live prices were being lost for most products** (`49dd9bc`). Asked for the
best air fryers in the UAE under 700 AED, the app quoted a price range invented
by an SEO listicle. `isShoppingQuery("air fryer price")` returned **false**, so
Google Shopping — which holds real merchant prices as a field — was never
called and the council had only content farms to reason from.

The gate required a money signal AND a product noun from a hand-written list.
That list has monitors, laptops and mattresses. It does not have air fryers, and
**it cannot be completed** — there is no version covering kayaks, cat litter and
whatever is sold next year, and every gap fails silently behind an answer that
looks entirely normal. Unmistakable buying language now stands alone; the weak
signals (`best`, `recommend`) still need a noun. `"the price of freedom"` now
buys one wasted lookup, and the test that asserted otherwise records why that is
the better side to be wrong on.

**This only reaches users if `SERPER_API_KEY` is set in Render.** Without it the
provider stays absent and answers degrade exactly as before.

---

## What shipped earlier and stayed

**Clerk migration** (`7ff4c32`, merged 2026-08-09). `@clerk/clerk-sdk-node` →
`@clerk/express@2.1.52`, zero advisories. The `req.auth` call sites were kept
working by a shim rather than rewritten; both that and the conditional
`clerkMiddleware()` mount are traps written up in `AGENTS.md`. Read those before
touching auth wiring.

**Streaming cadence** (`de5dca8`, `5e7d87e`). Answers reveal against a 16ms
clock at a rate proportional to the backlog, not once per network read. The
second commit is the important one: the reveal had been gated on
`prefers-reduced-motion`, which disabled it on exactly the machines that set the
preference, including the owner's. That is the origin of the rule now applied
across the app — reduced motion is about MOVEMENT, and content arriving is not
movement.

**Skeletons, not spinners** (`93b9efa`). The three-dot typing indicator is an
answer-shaped skeleton at the prose column's width. Pending tool rows breathe
instead of spinning. Deleting a chat is optimistic and puts the chat back with a
toast if the server refuses.

**Voice out** (`c513df7`). Every assistant answer has a Listen button, markdown
stripped before speaking. `/api/speech` proxies Fish Audio and answers 501 when
`FISH_AUDIO_API_KEY` is unset, at which point the client falls through to the
browser's own voice. Defaults to `s2.1-pro-free`; Fish Audio selects the model
in a HEADER and defaults to the paid one, so omitting it is a silent bill and a
test pins that.

**Sidebar cache** (`e52b11d`). `frontend/src/lib/chatCache.js` persists the chat
list to localStorage so a reload paints instantly. Four security rules, all
tested: messages are never written, entries are keyed by Clerk user id and read
back only for the same id, the cache clears whenever the app renders with no
user, and anything older than seven days is ignored.

**Upgrade panel** (`28a5efe`), **reduced-motion exceptions** (`3f74ff6`),
**council runner extraction** (`9e2e05a`), **`cssHygiene` counter fix**
(`9e2e05a`), **corner fix** (`5f17c03`), **button press and hover** (`da727cc`),
**sign-in focus ring and tab order** (`1ae0402`, `f7a3811`), **empty-state seal**
(`0adbd36`), **composer sprigs and pointer** (`dfa654f`).

---

## Open, and needing the owner

- **Is `COUNCIL_TOOLS=1` set in Render?** If it is off, the entire tool-calling
  path is dark in production — specialised engines, live shopping, the tool
  trail — which would be a second and larger cause of weak answers than the
  shopping gate that was just fixed. Cannot be checked from this side.
- **Is `SERPER_API_KEY` set in Render?** `49dd9bc` does nothing without it.
- **`FISH_AUDIO_API_KEY` in Render.** Voice works without it using the browser
  voice; the key upgrades it with no UI change.
- **Rotate the Perplexity API key.** It was printed into a transcript earlier in
  this project's history.
- **Two commands the sandbox classifier blocked during the Agent Reach install.**
  Both are the owner's to run in a terminal:
  ```
  ~/.local/bin/agent-reach.exe install --env=auto
  mcporter config add exa https://mcp.exa.ai/mcp --scope home
  ```
  The second is the one that matters — free semantic web search, no key, and
  the highest-value channel still dark. `mcporter` is already installed. It was
  blocked because it wires a remote MCP endpoint into the home config, which is
  a reasonable thing to gate rather than route around.

## Open, and not blocked

- **Phase 2's evaluation is still owed.** It was built before Phase 1 had
  produced data — `user_facts` was empty the day it shipped — so it was built to
  cost nothing when wrong rather than to be justified by measurement. Once real
  facts accumulate, the question is whether the nearest-first half ever surfaces
  something recency missed.
- **No vector index on `user_facts`, deliberately.** ivfflat and hnsw earn their
  cost at thousands of rows; every query filters by `user_id` first and that
  index exists. Revisit when one user's fact count reaches four figures, and
  read `pg_indexes` first — twice in this project an index has been proposed
  from the repository alone that already existed under another name.
- **Mumbai migration** is prepared and not executed. `backend/Dockerfile`,
  `fly.toml` with `primary_region = "bom"`, `scripts/verify-migration.sh` and
  `docs/MUMBAI-MIGRATION.md` all exist. Fly wants payment to deploy; Cloud Run
  `asia-south1` is the free alternative.
- **The council is only late-streaming.** Seats are polled non-streaming, so the
  first token cannot arrive until the last seat settles. The stage line now
  covers that wait rather than removing it. Streaming the seats themselves is
  the real fix and is a much larger change.

## Deliberately not done

- **Semantic dedupe of facts on write.** See the Phase 2 note above.
- **More API keys / more tools.** The public-apis list was surveyed. Almost
  nothing there is worth wiring: search, Firecrawl and Perplexity already cover
  the general case, and each extra tool costs roughly 1,500 tokens per seat per
  turn. Same lesson that cut SerpApi's ~110 engines down to one
  `search_specialized` tool.
- **A sweep of the top 100 Claude Code repos.** Refused by the owner, in his
  words: "One idea each from 100 repos into a codebase this opinionated is slop
  injection." A named topic with five repos is the shape that was acceptable.
- **A live council view.** The `onSeat` seam now feeds a one-line status rather
  than a council table. The owner has said a council table on the main chat
  screen is not wanted; do not build one unprompted.
- **Tooltips.** Already exist in the composer.

---

## Environment notes

- `jq` is not installed. Use `node -e` for JSON work.
- **Agent Reach is installed on this machine** (2026-08-11) and is a research
  tool for whoever is working on this repo, not a dependency of the app —
  nothing in `backend/` or `frontend/` imports it. Live web page reads via
  `curl https://r.jina.ai/<URL>`, YouTube subtitles via `yt-dlp`, RSS, V2EX,
  Bilibili search — all keyless and verified working. `agent-reach doctor`
  reports every channel. Full notes, including the two commands still to be run
  by hand, are in `~/CLAUDE.md`.
- **`~/.claude/awesome-claude-design`** is a prose reference of DESIGN.md
  prompts by aesthetic family. Read it when a named direction is asked for.
  **Do not apply a family to this app on your own initiative** — see the
  ornament warning at the top of this file.
- The frontend dev server for screenshots: `npx vite --port 5199 --strictPort`,
  then drive it with the Playwright MCP. `gallery.html` renders every component
  state without needing auth, which is the fastest way to look at the empty
  state, both themes, and the loading states. **Check whether it is already
  running before starting it** — a second one fails on the port.
- `UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js`
  after any deliberate CSS change, and say in the commit message that rendering
  changed on purpose. New markup also has to be added to
  `src/test/fixtures/appMarkup.js` or the CSS reads as dead later.
- Screenshots written by the Playwright MCP land in the user's HOME directory,
  not the repo. Delete them when finished.
- Backend `.env` does NOT carry `GOOGLE_API_KEY`, `SERPER_API_KEY` or the search
  provider keys — those live only in Render. Anything depending on them can be
  tested here through its failure branch only, and a commit message should say
  so rather than implying end-to-end verification.
- DDL goes through the Supabase MCP `apply_migration`, which wraps statements in
  a transaction, so `CONCURRENTLY` cannot be used through it. See `AGENTS.md`.
