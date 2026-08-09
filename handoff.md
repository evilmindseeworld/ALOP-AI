# Handoff — 2026-08-09

State of play at `5f17c03`. Read `AGENTS.md` first; this file is what changed in
this session and what is still open, not a description of the project.

Everything below is pushed. 602 frontend tests, 565 backend, build clean,
working tree clean.

---

## The one thing to read before touching the frontend

**The empty-state ornament set is the specification, and it has now been
reverted to twice.** Two hanging crescents in the gutters, four sakura corner
sprigs and a faint torii behind the empty state, the asanoha lattice across the
chat surface, a centred hero, and the starters as a 2x2 card grid.

Five redesigns were tried this session and all five were rejected:

1. one wooden bough replacing the four sprigs
2. that bough moved to the bottom right
3. an ensō drawn as seven overlapping arcs
4. a split layout with the council roster as the right column
5. a day/night sky, crescent and stars against a sun

Several of those were argued for by the design skills this repo is worked on
with, which name centred heroes and grids of equal cards as anti-patterns. That
did not settle it and should not next time. This is a personal product with one
owner and his taste is the specification. **Do not "fix" the centred hero or the
card grid on the strength of a general design rule.** If a redesign is wanted it
will be asked for, and it will be asked for in terms of this ornament family
rather than in place of it.

The revert was done by restoring the design-owned files from `c513df7` rather
than by reverting the five commits, because non-design work landed in the same
files in between. `App.jsx`, `MessageList.jsx` and `utilities.css` were
reconciled by hand for that reason. If you ever need to do this again, that is
the shape of it: check `git log c513df7..HEAD -- <file>` per file to see whether
a file is design-only before restoring it wholesale.

---

## What shipped and stayed

**Streaming cadence** (`de5dca8`, `5e7d87e`). Answers reveal against a 16ms
clock at a rate proportional to the backlog, not once per network read. The
second commit is the important one: the reveal had been gated on
`prefers-reduced-motion`, which disabled it on exactly the machines that set the
preference, including the owner's. That is the origin of the rule now applied
across the app — reduced motion is about MOVEMENT, and content arriving is not
movement.

**Skeletons, not spinners** (`93b9efa`). The three-dot typing indicator is an
answer-shaped skeleton at the prose column's width. The rotating icon on pending
tool rows breathes instead of spinning. Deleting a chat is optimistic and puts
the chat back with a toast if the server refuses. New chat no longer posts at
all: every send path already creates the row when there is something to put in
it.

**Voice out** (`c513df7`). Every assistant answer has a Listen button. Markdown
is stripped before speaking. `/api/speech` proxies Fish Audio and answers 501
when `FISH_AUDIO_API_KEY` is unset, at which point the client falls through to
the browser's own voice. Defaults to `s2.1-pro-free`; Fish Audio selects the
model in a HEADER and defaults to the paid one, so omitting it is a silent bill
and there is a test pinning that.

**Sidebar cache** (`e52b11d`). `frontend/src/lib/chatCache.js` persists the chat
list to localStorage so a reload paints instantly. Four security rules, all
tested: messages are never written, entries are keyed by Clerk user id and read
back only for the same id, the cache clears whenever the app renders with no
user, and anything older than seven days is ignored. See `AGENTS.md` for the two
merge consequences (`fromCache`, and the signature-driven write).

**Upgrade panel** (`28a5efe`). It used to replace the whole panel with "Loading
plans" while waiting for two price strings, even though the plan comparison is
compiled into the component. It renders for real now with the figures
placeholdered and the checkout buttons disabled until the price is known.

**Reduced-motion exceptions** (`3f74ff6`). The global rule collapsed every
animation, which turned skeletons into static grey boxes and stopped the
streaming caret. Five loading signals are now reduced rather than removed via a
`reducedPulse` opacity-only keyframe. Verified in a browser with the preference
forced on, not inferred from the stylesheet.

**Council runner extraction** (`9e2e05a`, survived the revert).
`backend/lib/council-run.js` with 11 tests. It could not have any before:
`server.js` exits at import time on a missing env var, so the most intricate
concurrency in the product was untested. It also takes an optional `onSeat`
reporter, best-effort by construction and wrapped so a dead client socket cannot
lose an answer a model call was already paid for. **Nothing renders those events
yet** — that reporter is the seam if a live council view is ever wanted, and the
owner has said the council table on the main chat screen is not wanted, so do
not build one unprompted.

**`cssHygiene.test.js` counter fix** (`9e2e05a`, survived the revert). `from`,
`to` and percentage steps were leaking out of `@keyframes` blocks and counting
as top-level selectors, so the duplicate budget was partly measuring how many
animations the app has. Budget came down 10 to 9. If that test blocks you, check
whether it is counting something real before editing CSS to satisfy it.

**Corner fix** (`5f17c03`). The bottom sprigs sat 78px above the panel edge
while the top pair sat 47px below its top. Not an inset problem: all four were
correctly in the corners of the box they were positioned against, and the box
was the wrong one, because the scroll wrapper's padding is asymmetric by design.
The frame is extended downward by exactly the difference. Measured 48/48 after.

---

## Open, and needing the owner

- **`FISH_AUDIO_API_KEY` in Render.** Voice works without it using the browser
  voice; the key upgrades it with no UI change.
- **Two `grant execute` statements in `backend/migrations/012_rls_recursion.sql`
  are unapplied.** Classifier-blocked from this side. They must be run in the
  Supabase SQL editor. RLS helper functions are otherwise reachable.
- **Rotate the Perplexity API key.** It was printed into a transcript earlier in
  this project's history.
- **Google Search Console indexing request** for the favicon/front-page listing.

## Open, and not blocked

- **`@clerk/clerk-sdk-node` is deprecated at 5.1.6** and carries three high
  advisories through `js-cookie`. The successor is `@clerk/express`. Deliberately
  NOT attempted this session: `req.auth` has 23 call sites and changed from a
  property to a function between majors, and there is no way to verify auth
  end-to-end here without a live Clerk instance. Real exposure is low — the
  advisory is a prototype hijack in a cookie parser on a backend that
  authenticates with bearer tokens. Worth doing with the owner present.
- **Mumbai migration** is prepared and not executed. `backend/Dockerfile`,
  `fly.toml` with `primary_region = "bom"`, `scripts/verify-migration.sh` and
  `docs/MUMBAI-MIGRATION.md` all exist. Fly wants payment to deploy; Cloud Run
  `asia-south1` is the free alternative.

## Deliberately not done

- **More API keys / more tools.** The public-apis list was surveyed. Almost
  nothing there is worth wiring: search, Firecrawl and Perplexity already cover
  the general case, and each extra tool costs roughly 1,500 tokens per seat per
  turn. That is the same lesson that cut SerpApi's ~110 engines down to one
  `search_specialized` tool.
- **Tooltips.** Already exist in the composer. Nothing to build.
- **A live council view.** See the runner note above.

---

## Environment notes

- `jq` is not installed. Use `node -e` for JSON work.
- The frontend dev server for screenshots: `npx vite --port 5199 --strictPort`,
  then drive it with the Playwright MCP. `gallery.html` renders every component
  state without needing auth, which is the fastest way to look at the empty
  state, both themes, and the loading states.
- `UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js`
  after any deliberate CSS change, and say in the commit message that rendering
  changed on purpose.
- Screenshots written by the Playwright MCP land in the user's home directory,
  not the repo. Delete them when finished.
