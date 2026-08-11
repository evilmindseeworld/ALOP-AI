# Handoff — 2026-08-11

State of play at frontend commit `f110515` on local `main`; Claude owns the
push. Read `AGENTS.md` first;
this file is what changed and what is still open, not a description of the
project.

634 frontend tests and the production build are green. Backend work was owned
concurrently and was not touched or counted in this frontend pass. Render
auto-deploys from `main` and is slow — well over five minutes — so nothing in
`f110515` is live until Claude pushes it and that deploy finishes.

**A previous handoff went stale in the worst way**: it still described the
Clerk migration as "deliberately NOT attempted" three weeks after it had merged,
so anyone reading it as current state would have re-planned finished work.
Dated section headings and commit SHAs exist to stop that. If you change
something this file describes, change this file in the same commit.

---

## The one thing to read before touching the frontend

**The empty-state ornament set is the specification, and it has now been
reverted to twice.** Two hanging crescents in the gutters, the asanoha lattice
across the chat surface, a centred hero, and the starters as a 2x2 card grid.
The torii is gone — `CouncilRosette` replaced it, and the logo mark now sits
inside the rosette's centre hole.

**EVERY BRANCH CAME OFF ON 2026-08-11**, on the owner's instruction: "leave the
earrings, just delete the branches." The top pair went first as a declutter and
the rest followed in the same breath — all four corner sprigs and their four
hand-authored variants, the `Leaf` helper, the `Corner` component,
`SakuraFrame` itself, and the bough and falling petals that were only ever on
sign-in. `SakuraBough.jsx` is deleted. `SakuraBaseCorners` is the keystone
alone. The dead CSS went with the markup rather than being left to rot.

What remains is the family's harder half, and it is the half that was carrying
it: the crescents, the keystone, the seal, the composer skyline and the lattice.
The branch was the part that said "Japanese" without saying anything about THIS
product — the same charge that retired the torii. **Do not redraw it.** If a
screen needs more, it needs it from the marks that mean something here.

Everything else in this section still stands in full. The cut was inside the
family, not a licence to edit it.

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

## How the three of us split the work (2026-08-11)

Recorded because it was got wrong twice in one session, and because the wrong
version leaves a precedent that looks like practice by the next reading.

- **Claude and sol plan, design and code.** Sol is the senior peer on
  substantive work and is not to be spent on petty jobs.
- **Luna executes**: pushing, committing, bug-hunting, the smaller tasks, and
  reviewing. It may pitch in on bigger work, but that is the exception. Luna
  has push authority — do not sit on a green branch waiting to push it yourself.
- **Bug-hunting and reviewing belong to everyone.** That list is who OWNS a
  beat, never who is allowed on it. The deepest finds this session came from the
  design pair, not the executor: sol found two synchronous-throw crash paths, a
  money leak in the dedupe, and five hover rules Claude had missed; Claude found
  a duplicate-render race in a peer's split. Never answer "that is luna's job"
  about a bug or a review.
- Review cannot come from the author, so when luna wrote the code, sol reviews
  it. That is the three-eyes rule breaking a tie, not sol changing seats.

**THE MISALLOCATION, so the precedent does not survive this file.** The
AbortSignal propagation and turn-telemetry work was given to LUNA, and it should
not have been: threading cancellation through five layers and designing a
telemetry system is architectural work, which belongs to sol and Claude. It was
assigned before the split above was set, and it was allowed to finish because it
was healthy and nearly done — killing it would have burned real work to make a
point. **From the next dispatch forward, architectural work goes to sol and
Claude.** If you are reading this and about to hand luna a cross-layer refactor
because "that is what happened last time": that is the precedent this paragraph
exists to kill.

The full protocol — invocation, the ~23k dispatch floor, file partitioning —
lives in `~/CLAUDE.md` rule 15 and the `codex-duo-protocol` memory file.

---

## This session (2026-08-11), latest — response times, measured at last

The owner's report was "AI response times are quite slow". Both peers profiled
rather than guessed, and the answer is not what the phrasing suggests.

**IT IS THE TAIL, NOT THE MEDIAN. p50 first answer 1.71s. p90 71.42s.** The
wall ceiling is 75s, so the slow turns are turns running to the ceiling and
stopping there. Anyone optimising the typical turn is optimising the wrong
thing. Supporting numbers: warm Supabase reads ~200ms and the batch is already
concurrent, so the database is not it; a live Render cold start measured
22.55s, which is an infrastructure floor no prompt change touches.

**The real gap is telemetry, and it is the next thing to fix.** Per-seat model
duration and synthesis duration are not recorded separately anywhere. The
numbers that would settle where the tail actually goes DO NOT EXIST. Luna
refused to invent them, which is why this section is short.

Note for the owner, not a re-litigation: the decision to keep the
post-truncation fallback council is part of why the p90 is what it is — a
blown 75s ceiling then buys another 30s whip. The decision stands and is
recorded under "Deliberately not done". It now has a measurement attached to
it that it did not have when it was made.

Shipped on the backend: the final council round no longer carries the tool
catalogue (~596 input tokens per seat, ~4.2k across seven, on the round the
user is actually waiting through — it is answer-only and cannot request a tool
anyway), and vision now starts before the independent context reads instead of
after them.

Shipped on the frontend: **animejs was on the critical path while the chunk
config claimed it was not.** A static import in App.jsx pinned it, and because
framer-motion was grouped with it, lazily importing framer-motion's only
consumer loaded it eagerly too. Initial JS is ~20.12 kB gzip lighter. The
message entrance effect keyed on the messages ARRAY, so a 700ms animation
restarted on every reveal tick.

**And the live region was announcing a lie**: an idle transcript that had never
streamed anything announced "Answer complete" on arrival, so a screen reader
user opening an old chat was told an answer had just finished. It now
announces lifecycle transitions only, and only after something was actually
responding.

**The O(message count) reveal reconcile is fixed in `f110515`, and the size of
the win was measured before keeping it.** The arriving answer now lives outside
the persisted `chats` tree, and settled rows sit behind a memo boundary while
the draft advances. The completed draft remains mounted through the
plain-text-to-Markdown swap, while export, feedback and the PUT continue to use
the full persisted transcript. Against 200 settled messages and the earlier
replay shape — 57 network frames, 109 reveal commits, 13.4 characters per
commit — median React update work across five runs fell 45.88ms → 7.27ms
(84.1%), and median replay wall time fell 68.60ms → 14.68ms (78.6%). The commit
count is unchanged on purpose: the draft still needs every paint; the 200 old
rows do not.

The null transcript Suspense fallback is also fixed in `f110515`. A slow
MessageList chunk now paints the existing `MessageSkeleton` or
`AnswerSkeleton`; there is no new decoration and no CSS change. The regression
tests were run against actual temporary reverts: history mapping rose from 1
to 20 calls, the persisted tree lost identity, and the null boundary lost its
skeleton. All three tests passed again after restoration.

Still deliberately left: the 224ms reveal tail, which smooths bursty output
and is a cadence decision, not a bug.

**A real NVDA or VoiceOver run is still owed.** Unit semantics and axe pass,
which is not the same thing, and the peer declined to call screen-reader
behaviour cleared without running one. Windows Narrator is present on this
machine, but this automation environment cannot capture or inspect what it
speaks, so launching it would not produce evidence of what a user heard. Do not
mark it done from the test count or the browser accessibility tree.

**Seat streaming is written up as a staged plan and is NOT started.** Stage
one is worth shipping for progress telemetry and perceived waiting, but it is
not by itself a final-answer TTFB win, because synthesis still waits for
complete seat answers. Do not let anyone sell it as one. The plan runs:
provider stream parser → progressive disclosure through explicit `seat_delta`
events that must never be merged into `chunk` or persisted as the answer →
`AbortSignal` → streaming tool rounds last, because tool results have to
re-enter still-running conversations without corrupting round ordering.

Rejected on the way, and worth not re-proposing: lowering quorum to one (trades
synthesis quality for a misleading first-token metric), sending the first
seat's prose as the final answer, speculative synthesis before quorum, and
provider prompt-caching without any cache-hit telemetry to show it works.

---

## This session (2026-08-11), earlier — sign-in rebuilt, branches cut

**Sign-in was the screen nobody had improved.** Three things were wrong with it
and all three are fixed.

*It was vibe-coded where it showed.* Two blurred gradient orbs drifted behind
the form on 18s and 22s loops — the single most reproduced background on the
web, the one that arrives with the framework. Gone, along with the branch above
them. The replacement is the app's own ground: the asanoha lattice, copied in
geometry from `.chat-main::after` so that signing in is the same room as the
app rather than an entrance hall decorated in a different style.

*Nothing moved on it.* The owner's question was fair — "the earrings swing, but
when I log in nothing's swinging" — because the crescents were mounted in
`.chat-main`, behind the sign-in wall, so the one piece of motion in this app
was invisible until after you had already committed to it. They now hang on the
first screen, on the resting 7s arc rather than the active one: the wide quick
swing means the council is working, and nothing is working yet. Hidden below
900px where the grid collapses and there is no margin to hang them in.

*The seal now closes the council ladder.* A hanko is pressed at the END of a
document, as the stroke that commits to what is above it, which is what "One
reply, reconciled." does to the seven rows above it. The drawing is already the
argument — two strokes converging to a point — and it is the only mark on the
page at full opacity. It lands at 980ms, exactly where `councilResolve`
finishes, oversized and over-rotated, and lifts to -4deg because a seal set
perfectly square reads as a printed logo.

**The page's ARGUMENT was not touched.** The council ladder, the temperatures,
the headline, the tagline and both legal paragraphs are exactly as they were.
This was a change of surface. Do not read it as the copy being in play.

**And it no longer waits on Clerk to render.** `if (!isLoaded) return null` was
holding the entire screen blank until a third-party bundle had downloaded,
parsed and initialised — seconds of nothing on a cold cache, on the one page
every new user sees. Only the card waits now, in a slot that reserves the
form's height so nothing reflows when Clerk arrives. The outage screen is
deliberately unchanged: once the ten seconds are up the message is the only
thing that matters.

Two notes for whoever is next here:

- **`prefers-reduced-motion` is handled globally**, in `utilities.css`, by
  collapsing every duration to 0.01ms. Any entrance animation on this page must
  therefore use `forwards`, or it is stranded at `opacity: 0` for those users.
  The seal is written that way and says so.
- **Sign-in renders OUTSIDE `.app-root`**, so `.app-root.light` never applies
  and the screen is always the dark theme. That is pre-existing, not new, and
  it is why the light theme was not part of this work.

---

## This session (2026-08-11), earlier — the loop's ceilings, reviewed by two peers

Five defects in the agent loop's time and money ceilings. All five have a test
that was verified failing on revert by actually reverting and running, not by
assertion. 598 backend tests pass.

**Found by review, in `agent-loop.js`:**

- The wall gate was `wallLeft() <= 0`, so a round could start with a few
  milliseconds left: every member asked, every model call paid for, every one
  dropped at a whip that had already expired. Now floored at `MIN_ROUND_MS`
  (250), clamped against `cfg.roundMs` so a caller with a deliberately tiny
  round is not floored out of existence. Stopping leaves up to 250ms of the
  ceiling unspent, which is the point.
- The late-member truncation blamed `cfg.roundMs` for a whip the wall had
  clamped, sending whoever read the log at the wrong knob. It now names the whip
  that actually fired.
- **The fix for the first one introduced the same bug one level down.** The
  round deadline was computed at the gate and reused verbatim as the helper's
  `deadlineMs` — but `active.map(...)` invokes `askMember` for every member
  eagerly, before the helper's timer starts, so that duration was granted twice
  and a 300ms wall could accept a reply at ~380ms. Entry-construction time is
  now subtracted. A ceiling measured from the wrong instant is the exact defect
  the first fix addressed; watch for it whenever a budget is computed at one
  point and spent at another.
- `perCall` was `Math.max(250, Math.min(perCallMs, budgetLeft(), wallLeft()))`.
  The floor sat OUTSIDE the clamp, so a 100ms budget handed the registry a 250ms
  timeout — the overrun the clamp exists to prevent, reintroduced by the floor
  meant to keep calls worth making. The 250 is now a stop, not a floor.

**In `deadline.js`:** a throwing `enough` predicate rejected the promise
returned by `.then()`, which nobody holds — the process-level unhandled
rejection that whole file's header exists to prevent, arriving by the one path
the fallbacks did not cover. Wrapped in `enoughNow()`; a predicate that cannot
answer has not said "enough", so the deadline still governs. Not reachable from
either live caller today, so it is a contract hole rather than a live bug.

**In `tool-dedupe.js` / `tool-registry.js` — a money leak.** Dedupe keyed on the
arguments as the model wrote them, but `validateArgs` strips anything the schema
does not name before running the call. Two members proposing the same search,
one carrying a `nonce`, were two unique calls at dedupe and one identical
request at execution — billed twice, in money and in the 25s budget. The
registry now exposes `normalize(call)`, the canonical form `execute` will run,
and `dedupeCalls` takes it as an optional third argument. A call it cannot
normalise keys on its raw form, so an invalid call still reaches `execute` once
and comes back as the error the model needs to see. A registry without a
`normalize` (every test double) dedupes on raw args exactly as before.

**Two synchronous-throw paths**, same shape, both fixed: `server.js`'s periodic
audit sweep and `search-cache.js`'s sweep both invoked `supabase.rpc()` before
attaching a handler, so a synchronous client throw became an unhandled
rejection. The cache one could also turn a successful paid search into a failed
tool result.

**How this session was run.** Two Codex peers worked alongside, as peers rather
than as subagents: `gpt-5.6-sol` at medium effort on security, `gpt-5.6-luna` at
max effort adversarially attacking the diff. Luna found the reused-deadline
defect; sol found both synchronous-throw paths, the `perCall` floor and the
dedupe leak. Two things made it work and are worth repeating:

- **File ownership was partitioned up front** — luna owned `agent-loop.js` and
  `deadline.js`, sol owned the rest and reported patches for luna's files rather
  than editing them. Both ran concurrently with no collision.
- **`gpt-5.6` is not a valid model id on a ChatGPT account.** The ids are
  `gpt-5.6-sol`, `gpt-5.6-luna`, `gpt-5.6-terra`. The first launch died on a 400
  with the model name in it; the work was fine.

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

**The prompt bar's ornament is a town at dawn now, not a branch.** The owner's
words for the old one: it read as sitting behind the bar and looked bad, and he
was right about the cause. It hung ABOVE the card's top edge with half of it
over the transcript, so it had to be faint enough to read text through, and at
that alpha it was a smudge. An ornament that overlaps live text has no good
opacity — the rule for this surface is now **on the bar, or not on the bar,
nothing hangs off it**.

What is there: a skyline silhouette standing on the inner rule at the FOOT of
the card, with a vermilion sun rising behind the roofline. The card carries
24px of bottom padding to give the horizon a strip it owns. The drawing is
1040 units wide — wider than the card ever gets — because a 262px town centred
in an 850px bar reads as a sticker, and a horizon has to run off both ends. The
`bar` sprig variant is deleted. The hanko is unchanged.

This was asked for with two botanical-poster references and is an addition
within the ornament family, not a replacement of it. The empty state was not
opened. If it is ever reverted, the files are `SakuraFrame.jsx`
(`ComposerSkyline`) and the `.composer-skyline` block in `composer.css`.

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
- **Nothing is cancelled, only abandoned.** `settleByDeadline` ignores
  stragglers rather than cancelling them, and quorum release does the same: five
  final-round model calls keep running toward the server's 30s timeout after the
  room has been released, and a timed-out tool keeps executing its provider (a
  20ms tool timeout was measured still running at 103ms). The fix is an
  `AbortSignal` threaded through `settleByDeadline`, `askMember`, `callModel`,
  the registry executors and the provider fetches, then cancelled on deadline or
  quorum release. Queued deliberately for a session of its own — it touches
  every layer and is not a patch.
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
- **Bounding the post-truncation fallback council.** When the agent loop
  exhausts its 75s ceiling without producing an answer, `server.js` starts a
  further full council run with its own 30s whip — seven more paid model calls,
  outside the ceiling that was just declared blown. This was raised as a
  resource-exhaustion finding and is **the owner's decision, made 2026-08-11:
  leave it.** If the ceiling blows, spend the calls to recover; a truncated
  answer is worse than a late one. Do not "fix" this by capping it to a single
  model or by putting one request-wide deadline across both paths. It is a
  product choice, not an oversight.

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
