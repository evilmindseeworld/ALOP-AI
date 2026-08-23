# ALOP-AI Frontend Redesign Council Checkpoint

**Checkpoint:** I9–I11 COMPLETE; FINAL REVIEW PACKET READY
**Date:** 2026-08-23
**Repository:** `C:\Users\LENOVO\Documents\AI-Classroom`
**Branch:** `fix/synthesis-degrades-to-council-draft`
**HEAD:** `a8da6fd` (`fix: never degrade to a draft whose text was the model's reasoning`)

## Status

```text
LUNA_STATUS = COMPLETE
OPUS_STATUS = UNAVAILABLE_IN_CURRENT_ENVIRONMENT (no final browser verdict)
PRE_SOL_SYNTHESIS = COMPLETE
SOL_HIGH_CALLS = 2
SOL_CALL_1 = COMPLETE
SOL_CALL_2 = COMPLETE (initial verdict: NEEDS MAJOR CORRECTION)
SOL_STATUS = HIGH_SOURCE_BOUNDARY_FIXED; POST_FIX_SOL_REREVIEW_NOT_RUN
FRONTEND_SOURCE_MODIFIED = YES (I1-I11)
IMPLEMENTATION_PHASE = I9-I11 COMPLETE; FINAL QA COMPLETE
OPUS_IMPLEMENTATION_REVIEW = CHECKPOINT_A_COMPLETE; FINAL_REVIEW_UNAVAILABLE
OPUS_CHECKPOINT_A = COMPLETE
CHECKPOINT_A_FIX_PASS = COMPLETE
OPUS_REVIEW_REQUIRED = FINAL RED-TEAM HANDOFF RECORDED; NO VERDICT CLAIMED
OPUS_CONFIRMATION_A = COMPLETE
OPUS_CONFIRMATION_VERDICT = PASS WITH ONE SMALL FOLLOW-UP
VERDICT = PASS WITH REQUIRED CHANGES (historical review; A1-A9 fix pass complete)
REQUIRED_FIX_COUNT = 9
BLOCKERS = 0 known implementation blockers; final independent review unavailable
HIGH_FINDINGS = 0 known open findings in current Luna pass; final red-team unverified
FINAL_SOL_REVIEW = COMPLETE; one High finding fixed; final QA passed

RELEASE_PHASE = PRODUCTION_TRUTH_ESTABLISHED; RELEASE_PACKAGING_PENDING
LOCAL_HEAD = a8da6fd194c1e371c0e6973fe65abdb60949bf4c
ORIGIN_MAIN_HEAD = 0461c191eb6ce102c1b3cf54cff89185afb44fe8
WORKTREE_STATUS = MIXED_DIRTY; redesign/release files are uncommitted; unrelated evidence artifacts preserved
BRANCH_RELATIONSHIP = HEAD is 3 commits ahead of origin/main; PR #7 is open and unmerged
MIGRATION_STATUS = NO_NEW_REDESIGN_MIGRATION_REQUIRED; production turns.meta jsonb verified; 019/026 are absent from migration ledger but their live schema objects exist
PROD_BACKEND = d8e47a68587af3db199407e995d2e5e3ff9019df; Render deploy dep-da346u2jnfac73bm3k1g is live
PROD_FRONTEND = 0461c191eb6ce102c1b3cf54cff89185afb44fe8; Vercel deploy dpl_zPesoUGpZvN7Kx91SCTu9hfMFmfL is production
DEPLOYMENT_STATUS = NOT_PERFORMED
PRODUCTION_SMOKE = PUBLIC_PAGE_200; HEALTH_200; ALLOWED_ORIGIN_200; EVIL_ORIGIN_403; authenticated/council/provenance smoke pending candidate deployment
ROLLBACK_STATUS = PREPARED_BY_EXISTING_MAIN_REVISION; no release mutation made
```

The completed Opus Checkpoint A review remains recorded in `docs/OPUS_CHECKPOINT_A_REVIEW.md`; the completed independent critique is `docs/OPUS_INDEPENDENT_UX_CRITIQUE.md`. Sol High Call #1 issued `docs/ALOP_FRONTEND_VISION_SOL.md` and `docs/ALOP_FRONTEND_DESIGN_CONSTITUTION.md`. The paragraph below is the historical Checkpoint A record. The authoritative current execution record is at the end of this file and records I5–I11, current verification, the unavailable final Opus boundary, and the final Sol packet.

## Implementation execution map

The requested `docs/ALOP_FRONTEND_EXECUTION_OPUS.md` is not present at that exact path in the current worktree. The pasted implementation handoff, Sol vision, design constitution, current forensic audits, and existing source are the active execution inputs. This missing-file condition remains an open risk and must be resolved before any phase beyond Checkpoint A is accepted.

### I0 — baseline and safety

- Preserve the current branch and all unrelated untracked audit/design files; do not reset, overwrite, deploy, or modify backend/auth/publishing code.
- Record the current tests/build/browser geometry before changing source. Existing baselines remain the comparison point until fresh I0 captures are made.
- Confirm the implementation surface is frontend-only for I1-I4, using the existing SSE contract rather than inventing a demo protocol.

### I1 — current mobile and accessibility gates

- Remove `maximum-scale=1` from `frontend/index.html` while retaining width, initial scale, and safe-area behavior.
- Fix the measured 390px starter/composer occlusion by changing layout/scroll geometry, not hiding starter content.
- Reduce measured CLS causes only where a current capture identifies them; reserve space for late layout contributors and avoid broad visual restyling.
- Verify keyboard focus, visible focus rings, touch target reachability, 390px interaction, and reduced-motion behavior.

### I2 — structured live stage semantics

- Preserve `frame.key` and `frame.text` in frontend stream state.
- Represent `context`, `council`, and `synthesis` as explicit stage semantics with backward compatibility for text-only/older frames.
- Keep stage transitions truthful to the existing backend events; no fake seats, votes, model activity, or chain-of-thought.

### I3 — real council process experience

- Use the real stage frames and bounded activity already emitted by the backend.
- Verify context, council seat progress, and synthesis/reconciliation render as an ordered process rather than one replaceable status line.
- Keep the surface compact, accessible, and quiet enough that it remains a reading aid rather than spectacle.

### I4 — reconciliation to first token

- Ensure the first answer token does not erase the meaning of the council process.
- Resolve process state into the answer surface with an honest transition; preserve enough completed-stage context for the user to understand what happened.
- Test no-synthesis, one-seat, fallback, abort, timeout, refusal, and partial paths for truthful non-seal behavior. Stop here for Opus browser review.

### Deferred after Opus Review Checkpoint A

- **Backend contract/API:** only if I2-I4 prove the current SSE contract cannot carry the necessary safe semantics. No backend change is planned in I1-I4.
- **Persistence/schema:** I5-I7 durable safe process memory, migrations, tenant/RLS/privacy rules, and backward-compatible hydration. Do not persist stages in this pass.
- **Sources/evidence:** I8 structured sources and evidence receipt, only after the backend/frontend metadata boundary is defined.
- **Completion/material/mobile identity/landing/polish:** I9-I11, including seal conditions, accent hierarchy, mobile-native identity, labelled landing exemplar, and final motion/performance polish.

### I1-I4 anticipated source surface and verification

- Likely source files: `frontend/index.html`, `frontend/src/hooks/useChats.js`, `frontend/src/components/Skeletons.jsx`, `frontend/src/components/MessageList.jsx` only if the existing message/stage seam requires it, and the existing `frontend/src/styles/chat.css`, `chat-controls.css`, or `utilities.css` layout rules.
- Required checks: focused streaming/stage tests, responsive/zoom/accessibility/CSS tests, full frontend test suite, production build, 390px and desktop browser captures, keyboard/focus/touch checks, and reduced-motion capture.
- Checkpoint A must record exact files changed, test/build results, browser screenshots, fresh performance observations, accessibility status, Opus status, open risks, and the next action. The next action after the checkpoint is Opus review, not I5 implementation.

## Evidence baseline preserved

- Frontend deterministic baseline: 57 files / 705 tests passed.
- Focused accessibility/contrast/CSS/reduced-motion baseline: 5 files / 107 tests passed.
- Frontend build passed.
- Backend baseline: 2,112 passed, 2 existing `lib/stream-open-order.test.js` source-anchor failures; not represented as repository-wide green.
- Signed-out local Lighthouse: Accessibility 94, Best Practices 73, SEO 100 on desktop and mobile.
- Trace baseline: desktop 1440/1× Fast 4G LCP 1.199s, CLS 0.04; mobile 412/4× Fast 4G LCP 1.643s, CLS about 0.21.
- Mobile geometry: 390×844 has about 531px visible empty/transcript height versus about 600px starter content and roughly 61px recoverable scroll; the fourth starter is initially occluded by the fixed composer.
- Accessibility constraint before I1: `frontend/index.html:5` contained `maximum-scale=1`; I1 removed it while retaining `viewport-fit=cover`.
- No Clerk, Oxalpha, auth, publishing, scheduling, deployment, backend, persistence, or source-surface change was made in this implementation pass.

## Verified Opus findings

1. **Structured council-stage data already exists.** `backend/server.js:1592` emits `{type:'stage', key, text}`. Current keys are `context`, `council`, and `synthesis`. Verified call sites: `:4739-4742` (`Reading your conversation`), `:5720-5728` (`Asking N seats` and live `N of M answered` counts), and `:6217-6218` (`Reconciling the answers` or `Writing the reply`). These are real events on the ordinary text/council paths, not a decorative demo contract. Search, Wikipedia, fallback, image, and one-seat paths can differ; the packet records those route limits.

2. **The frontend ignores `frame.key` and retains only the latest text.** `frontend/src/hooks/useChats.js:1084`, resume handling around `:1168-1178`, and main handling around `:1450-1455` assign `stage = frame.text`; there is no frontend read of `frame.key`. `AnswerSkeleton` renders one `answer-stage` paragraph (`Skeletons.jsx:63-84`), styled as `text-xs`/`text-subtle` (`styles/chat.css:565-570`).

3. **The stage disappears at first token.** `useChats.js:1367-1387` paints content/activity without stage when the first chunk arrives; the final message around `:1501-1514` also has no stage. The council sequence is therefore neither visible as a sequence nor retained beside the answer.

4. **Council/tool activity is not persisted in the chat message.** `MessageList.jsx:296-300` documents the loss. `backend/lib/chat-update.js:81-109` whitelists role/content/timestamp/id/bounded image fields/`hasImage`; stage, activity, source arrays, and process summaries are stripped. Reloading the chat UI produces the plain answer transcript.

5. **A backend durable record exists, but it is not a user-facing provenance surface.** `backend/lib/turn-ledger.js:63-143` stores owned turn state, bounded question, partial/final answer, event id, and strict operational metadata; `:155-165` supports owned resume. This must not be confused with safe chat process memory or exposed wholesale.

6. **There is no dedicated frontend source/citation surface.** `MessageList.jsx:23-72` customizes Markdown code rendering only; ordinary links are default Markdown. No source card, citation rail, footnote, or structured reference component is wired into chat.

7. **Backend evidence infrastructure exists internally.** Source rules/citation suffixes/evidence ledgers are present at `backend/server.js:1142`, `backend/lib/council-tools.js:156-164` and `:426-430`, `server.js:851-857`, `:2214-2317`, and `:5102-5147`. Tool-event `sources` are explicitly stripped before SSE delivery at `server.js:5849-5853`.

8. **Accent hierarchy supports the inversion reading.** New Chat is a filled gradient/glow control (`styles/sidebar.css:252-291`); Upgrade is pink-accented (`styles/panels.css:282-300`); Send has gradient/shadow/stop state (`styles/composer.css:575-622`). Reconciliation is `text-xs`/subtle and tool activity is muted (`styles/chat.css:262-328`, `:565-570`). This supports a qualitative hierarchy finding, not a claim of a measured numeric accent budget.

9. **Mobile loses several desktop identity carriers together.** Below 640px the chat rosette and lattice are hidden (`styles/decoration.css:185-202`); the model badge is hidden below `sm` (`App.jsx:579-584`); `.earring-wrap` is hidden below 1180px (`decoration.css:436-437`). The empty-state keystone/base remains and shrinks (`App.jsx:714-716`, `decoration.css:185-187`). Identity is reduced, not literally erased; mobile-native identity is an open design question.

10. **The central “missing consequence” diagnosis is supported by Luna.** Luna independently identified visible life as cause/effect, ordered reconciliation legibility first, and found ambient motion stronger than reconciliation motion. Opus adds the verified data-loss and persistence mechanism. The combined diagnosis explains static-feeling processing, weak answer payoff, council identity fading at first token, and reload amnesia.

## Opus claims corrected or narrowed

- **“No sources exist” is too broad.** No dedicated/durable frontend source surface exists; backend source URLs, citation rules, evidence ledgers, and internal verification metadata do exist. The packet does not claim structured sources are currently available to the client.
- **“Stage state is accidental” is too broad.** The latest-only status-line behavior is explicit in frontend comments and implementation. The accidental/misaligned outcome is that a deliberate transient treatment deletes the product’s most differentiated act.
- **“Reload leaves only a plain transcript” needs scope.** This is correct for the chat message UI and `/api/chats` message schema. Internal `turns`/telemetry/audit records can retain operational information, but they are not hydrated as chat provenance and are not safe to expose wholesale.
- **“Crescents are the main identity that survives at 390px” is not current chat-source truth.** `decoration.css:436-437` hides the chat earrings below 1180px. The surviving carriers are the wordmark/favicon, typography/materials, empty-state mark/keystone, composer treatment, and seed actions. Older branch references in the critique are also not current source components.
- **Stale screenshot observations are freshness warnings, not current implementation truth.** The current source/fixture and a new capture must govern implementation; historical 1440/390/768 gallery images must be refreshed.

## Luna/Opus decision synthesis

The major framing difference is resolved as follows: Luna correctly described an observability/demo gap; Opus correctly identified that ordinary council-stage signals already arrive and are discarded. Sol must decide whether to expose the live contract, author a separately labelled landing example, or support both. The packet must not tell Sol to invent a council demo as the first remedy.

Strong agreements: the problem is not a lack of decoration; current material identity is valuable; reconciliation is the meaningful state change; ambient motion needs a budget; mobile occlusion, zoom, and CLS are real gates; no fake seats/table/votes/chain-of-thought; answer asymmetry, typography, seal vocabulary, honest failures, centered empty state, and seed behavior should be protected. Opus added first-order gaps Luna did not rank separately: `frame.key` loss, process amnesia, and sources/evidence surface.

Sol resolved the remaining disagreements: truthful live runtime state is the primary “alive” foundation; a clearly labelled deterministic landing exemplar may support comprehension but must not pretend to be live; safe process memory survives as a separate versioned turn/provenance record; disagreement is bounded, expandable transparency rather than raw debate; mobile identity is content-led and process/convergence-centered rather than a compressed desktop; accent belongs primarily to active intelligence, convergence, completion, and trust; the seal marks a completed synthesis path, not correctness; and sources are a persistent, progressively disclosed trust receipt.

## Sol High Call #1 decisions

1. **Council truth and surface:** expose the real runtime stage contract in live chat as the primary alive experience. The landing may use a safe, reviewed, deterministic exemplar labelled as an example/illustration, never as a live private council or fabricated seat theatre.
2. **Durable process memory:** retain a minimum safe process record in a dedicated, versioned, tenant-owned turn/provenance concept referenced by the message. Store actual phases, counts, evidence/tool use, reliable conflict/partial status, completion state, sources, and bounded timing; never chain-of-thought or raw deliberation.
3. **Disagreement:** show only a truthful user-relevant consequence as a compact summary/conflict indicator with expansion. Do not expose raw debate or convert disagreement into unsupported confidence.
4. **Product priority:** support both landing comprehension and live provenance, but prioritize live council truth and durable post-answer memory because the data already exists and returning-user trust is deeper than a static claim.
5. **Mobile identity:** use a mobile-native, content-led expression. The council act/convergence/completion mark is the load-bearing identity carrier, supported by material, typography, asymmetry, and negative space; do not restore every desktop ornament.
6. **Accent economy:** prioritize active intelligence, convergence/completion, and evidence trust; keep Send clear but subordinate; lower New Chat, Upgrade, navigation, and admin below the product’s defining work.
7. **Seal:** use the seal only for a terminal completed answer with actual synthesis completed. A partial council may retain a seal only with a discoverable partial qualifier; one-seat writing, fallback without synthesis, abort, timeout, refusal, and unresolved failure do not receive the reconciliation seal.
8. **Sources:** make structured sources the receipt of evidence work: discoverable by default when used, progressively disclosed for detail, persistent and touch/keyboard accessible, with inline attachment only where it improves claim trust. Never invent source metadata from implication.

## Issued artifacts

- `docs/ALOP_FRONTEND_VISION_SOL.md` — North Star, emotional arc, product/landing/chat/answer/source/mobile architecture.
- `docs/ALOP_FRONTEND_DESIGN_CONSTITUTION.md` — 35-section operating law and implementation heuristics for Luna and Opus.

## Sol packet word count

`docs/SOL_FRONTEND_INPUT_PACKET.md` contains **3,692 whitespace-delimited words** (within the required 2,000–4,000 range). It includes evidence references, the Luna/Opus comparison matrix, keep/enhance/rework/prohibit boundaries, constraints, uncertainties, and exactly eight questions.

## Exact eight questions reserved for Sol

1. **Council truth and surface:** Should the redesign expose the real `context`/`council`/seat-count/`synthesis` runtime state rather than author a decorative demo, and if both are needed what belongs in labelled landing versus live chat?
2. **Durable process memory:** Should safe phases, seat counts, tool/evidence use, conflict, completion, partial failure, and bounded timing survive reload without chain-of-thought, and should that be message metadata or an owned turn/provenance record?
3. **Disagreement:** Should disagreement/conflict be hidden, summarized, expandable, or surfaced as a bounded evidence/conflict signal?
4. **Product priority:** Which comes first—pre-sign-in demonstration or post-answer durable provenance—and should the architecture support both?
5. **Mobile identity:** Should 390px preserve a desktop motif or use a mobile-native content/process/selected-ornament carrier while also meeting occlusion, zoom, and CLS gates?
6. **Accent economy:** What is the hierarchy among primary action, council/synthesis, completion, sources, navigation, New Chat, Upgrade, and admin?
7. **Seal/completion:** Is a seal appropriate, and under exactly what truthful completion condition, including abort/fallback/partial/reduced-motion behavior?
8. **Sources:** What structured source role best balances trust, reading flow, mobile space, persistence, sensitivity, and the current backend/frontend metadata boundary?

## Checkpoint A — I1-I4 implementation evidence

**Status:** I4 is complete. This is an implementation handoff to Opus, not authorization for I5. `SOL_HIGH_CALLS = 1`; no second Sol call was made.

### Scope and exact source surface

Changed only frontend/dev/test material:

- `frontend/index.html` — removed the mobile zoom lock while retaining width, initial scale, and safe-area viewport behavior.
- `frontend/src/styles/chat.css` — made the empty state contribute its full content height and added the compact council process receipt styles.
- `frontend/src/styles/utilities.css` — preserved the transcript bottom reserve at `var(--fade-bottom)` through the 1100px and 768px responsive overrides.
- `frontend/src/hooks/useChats.js` — preserved keyed stage frames in a transient stream wrapper, grouped repeated keys for display, and kept process state separate from the persisted final message.
- `frontend/src/components/Skeletons.jsx` — added `CouncilProcess`; retained the current stage as an accessible status when the visible stage line is replaced by the receipt.
- `frontend/src/components/MessageList.jsx` — renders the receipt before tool activity/content and keeps it mounted across the first-token handoff.
- `frontend/src/gallery.jsx` — adds a deterministic live-component streaming fixture using the real process receipt.
- `frontend/src/__tests__/useChats.test.jsx` and `frontend/src/__tests__/MessageList.test.jsx` — keyed-stage, first-token, completion, no-synthesis, and assistive-technology coverage.
- `frontend/src/test/fixtures/appMarkup.js`, `frontend/src/__tests__/cssSnapshot.test.js`, and `frontend/src/__tests__/__snapshots__/cascade.baseline.txt` — fixture guard and deliberately regenerated cascade baseline for the intended visual changes.

No backend file, SSE producer, API contract, persistence schema, auth, sources pipeline, deployment configuration, or frontend source-surface implementation was changed.

### I1 — mobile, zoom, reachability, and motion

- `frontend/index.html:5` no longer contains `maximum-scale=1`.
- The actual live empty-state component at 390×844 renders all four starter cards. Measured `.scroll-wrapper`: `scrollHeight = 789`, `clientHeight = 555`, maximum scroll `234`; at maximum scroll the fourth card is fully inside the scroll viewport. Page horizontal overflow is `0`.
- Header/Upgrade controls measure 40×40 at 390px; the primary Send/Stop control measures 44×44. The existing 40px secondary-target decision is retained and is visible to Opus; no broad target-size restyle was smuggled into I1.
- Keyboard evidence: a starter card receives the global visible ring (`2px` primary outline, `2px` offset); Tab moves from the first starter card to the second. The new process receipt uses a named `section`/ordered list, while the skeleton retains a live `role=status` label.
- Reduced-motion browser evidence: `prefers-reduced-motion: reduce` is active; the logo settles to identity transform with a one-iteration `0.00001s` animation, starter transforms settle to none after their existing delay, and page overflow remains `0`. The reduced-motion suite passes.

### I2 — truthful stage semantics

`frontend/src/hooks/useChats.js:14-21` reads `{ key, text }` without rewriting either value. The send path at `:1102-1133` retains an ordered raw `frames` receipt and one latest row per key in `stages`; repeated `council` frames update the visible count while the raw sequence remains available to the live wrapper. `context`, `council`, and `synthesis` are the existing backend keys documented above; text-only/older frames remain renderable with a null key. The resume path (`:1225-1232`) and ordinary path (`:1503-1508`) both use the same recorder.

### I3/I4 — process receipt and first-token handoff

`CouncilProcess` presents only the received stage facts: `Context — Reading your conversation`, `Council — 3 of 3 answered`, and `Synthesis — Reconciling the answers`. The receipt is compact, one row per stage, and intentionally contains no fake seats, votes, model theatre, hidden reasoning, confidence claim, or correctness seal. `AnswerSkeleton` hides the duplicate visible stage paragraph when the receipt exists but keeps `msg.stage` in its status label for assistive technology.

On the first answer token the process wrapper changes to `phase: "answering"`; the ordered receipt remains above the arriving answer and says `Answer in progress`. A completed path with no synthesis says `Answer complete without a synthesis stage` and does not render a seal. Failed, stopped, one-seat, fallback, refusal, timeout, and partial behavior remain bounded by the existing final-message paths; no completion seal was introduced.

### Persistence boundary deliberately preserved

`process` is attached only to the transient stream draft. `finalMessage` continues to contain the existing assistant message fields and tool activity, not `process`, `frames`, or stage rows. Therefore reload still produces the current plain transcript, and no message-schema/API migration, privacy policy, storage-cost decision, or backwards-compatibility claim is being made in I1-I4. Durable safe process memory remains deferred to the post-Opus phase; hidden chain-of-thought is not a candidate for persistence.

### Browser evidence

Playwright checks used the dev server and the actual React `MessageList`, `InputBar`, and `ChatSidebar` in `gallery.html`; the signed-in Clerk route was not available in this environment. Captures:

- `C:\Users\LENOVO\Documents\Codex\2026-08-23\investigate-the-failed-keep-the-api-5\work\frontend-i4-gallery-1440.png`
- `C:\Users\LENOVO\Documents\Codex\2026-08-23\investigate-the-failed-keep-the-api-5\work\frontend-i4-gallery-390.png`
- `C:\Users\LENOVO\Documents\Codex\2026-08-23\investigate-the-failed-keep-the-api-5\work\frontend-i4-empty-390.png`

At 1440px the receipt is a quiet 456px-wide process block above the tool trail and answer. At 390px it is 296px wide, remains above the answer, and has no horizontal overflow. The browser also observed a controlled signed-out/dev CLS run with no layout-shift entries; this does not replace Lighthouse and does not resolve the existing mobile CLS attribution uncertainty (`about 0.21` in the historical signed-out baseline).

### Verification record

- Focused implementation/accessibility/CSS/reduced-motion run: **9 files, 172 tests passed**.
- Full frontend suite with one worker to remove the documented lazy-chunk scheduling flake: **57 files, 709 tests passed**.
- The default parallel suite otherwise passed 56/57 files and 708/709 tests twice; `MagneticButton.test.jsx` failed only at the documented fallback-to-lazy node-swap timing assertion. Its isolated run passed **4/4**. No MagneticButton source was changed.
- Production build: passed; 3,894 modules transformed, CSS `102.60 kB` (`18.71 kB` gzip), `MessageList` chunk `9.58 kB` (`3.71 kB` gzip).
- `git diff --check`: passed.
- Backend baseline remains unchanged: 2,112 passed with the two existing `lib/stream-open-order.test.js` source-anchor failures; backend was out of scope.

### Open risks for Opus Review Checkpoint A

- The named `docs/ALOP_FRONTEND_EXECUTION_OPUS.md` is still absent at that exact path; the pasted execution handoff and current Sol/audit/source evidence were used instead.
- Process state is intentionally transient. Reload amnesia, safe durable metadata schema/API design, tenant/privacy rules, and storage/backwards compatibility remain unresolved.
- Structured sources/evidence remain backend-internal and are not exposed by this pass; the new receipt does not imply citations.
- Backend route variations can emit different stage sequences; this pass preserves what arrives and does not claim every route emits all three keys.
- The historical mobile CLS score remains attribution-uncertain; manual assistive-technology output and authenticated production browser behavior remain unproven.
- Opus must review the process density, mobile identity loss, truthful transition semantics, failure states, and whether the live contract is sufficient before I5.

## Opus Review Checkpoint A — outcome

**Status:** COMPLETE. Full review: `docs/OPUS_CHECKPOINT_A_REVIEW.md`.

```text
OPUS_CHECKPOINT_A = COMPLETE
VERDICT = PASS WITH REQUIRED CHANGES
REQUIRED_FIX_COUNT = 9
BLOCKERS = 3
HIGH_FINDINGS = 6
SAFE_TO_BEGIN_I5 = NO (until A1, A2, A3 are closed)
SOL_HIGH_CALLS = 1
```

### Thesis result

The missing-consequence thesis is **half-proven**. The council's real work now persists through and
past the first token, and the answer is visibly attributed to a process for the first time. The
implementation delivered consequence as a **state**; it has not yet delivered consequence as an
**event**. Every state change in the sequence — context arriving, a seat answering, synthesis
beginning, the first token landing — renders identically as an un-animated grey row insert.

### Blockers (must close before I5 scope begins)

- **A1 — Completion marks assert completion the data does not carry.** Measured: on `stopped` and
  `failed`, every stage row renders `is-complete` with an emerald tick, including the stage that was in
  flight when the turn died. Violates Constitution §28.
- **A2 — Stage announcements regressed to an unreliable mechanism.** Measured: the only live region has
  empty `textContent` and carries the stage in a mutating `aria-label`; `.council-process` has no
  `role`/`aria-live`. Pre-I3 the stage was announced as live-region text content. Evidence class is
  mechanism + source, not a screen-reader capture; closing it requires a real capture or a change of
  mechanism. Constitution §31.
- **A3 — The answer's position is not reserved.** Measured across one turn: 68 → 92 → 116 → **141px**,
  73px of unreserved growth in three hard reflows, the last landing on the first token. Violates
  Constitution §32 and §8; also requires a fresh mobile CLS capture rather than an inherited one.

### High findings

- **A4** — Reconciliation has no perceptual expression; `animation-name: none`, one row appended. The
  prior `.answer-stage` crossfade was removed and not replaced, so this boundary has less expression
  than before I3.
- **A5** — The `Answer in progress` / `Answer complete` tail restates what is visible and costs the
  25px push at first token; completed rows keep present-continuous copy.
- **A6** — Emerald tick column under an uppercase `COUNCIL PROCESS` label reads as a CI pipeline; this
  is the load-bearing mobile identity carrier per §29.
- **A7** — Receipt + ToolTrail form two unrelated stacked grey lists (~8 rows / ~230px before the
  answer) that can contradict each other. §34 risk.
- **A8** — Sending the next question deletes the previous answer's receipt with no reload. Distinct
  from the deferred reload-persistence question.
- **A9** — Stage text is ellipsis-truncated at 390px (measured 280px of 366px required), inconsistent
  with `.tool-trail-text`'s deliberate wrap.

### Confirmed working

Truthfulness discipline held on the happy path — no fake seats, models, disagreement, confidence,
sources or seal. `Asking N seats` / `N of M answered` is comprehensible and unfakeable. The receipt
shares the answer's column and reading measure, expressing cause → result through layout. The
`no-synthesis` copy is the correct register. Answer-as-page survives. I1 gates hold at 390px: zero
horizontal overflow in every state, zoom restored, block fits and wraps at the container level.
Contrast measured 5.6:1 (passes AA). Reduced motion trivially satisfied. Keyboard/focus clean.
Stillness good — all ambient animation correctly scoped and terminating.

### Review method note

The Chrome extension channel was unavailable; the review ran through Playwright against the dev server
using the real components. A temporary probe page was created to drive the real `Message` component
through a scripted stage timeline, because a static fixture cannot evaluate a transition. **Both probe
files were deleted after use; no existing frontend source file was modified by this review.** The
untracked `.playwright-mcp/` capture directory is new — remove or ignore at Luna's discretion.

**Historical next action at review time:** Luna closes A1, A2 and A3, then A4-A9. That action is
superseded by the fix-pass record below; Opus confirmation remains required before I5. Do not call
Sol again from this checkpoint; `SOL_HIGH_CALLS` remains 1.

## Checkpoint A fix pass — Luna implementation outcome

**Status:** COMPLETE for the bounded frontend implementation; **Opus confirmation is still required**.
This pass changed only the already-authorized frontend surface. No backend route, SSE producer,
message schema, persistence API, source/citation surface, auth flow, or deployment was changed.

```text
CHECKPOINT_A_FIX_PASS = COMPLETE
A1 = COMPLETE
A2 = COMPLETE (mechanism and test verified; live screen-reader capture unavailable)
A3 = COMPLETE (desktop/mobile temporal probe verified)
A4 = COMPLETE (truthful synthesis emphasis plus reduced-motion-safe event cue)
A5 = COMPLETE
A6 = COMPLETE
A7 = COMPLETE
A8 = COMPLETE (current-tab/session receipt only; reload persistence remains deferred)
A9 = COMPLETE
VERIFIED_OPUS_FINDINGS = A1-A9
REJECTED_OPUS_CLAIMS = NONE
UNVERIFIED_CLAIMS = authenticated production behavior, live AT output, route-universal stage sequence
OPUS_REVIEW_REQUIRED = NO (complete)
OPUS_CONFIRMATION_A = COMPLETE
OPUS_CONFIRMATION_VERDICT = PASS WITH ONE SMALL FOLLOW-UP
SAFE_TO_BEGIN_I5 = YES
SOL_HIGH_CALLS = 1
```

### A1-A9 evidence map

| Finding | Fix-pass result and evidence |
|---|---|
| A1 — false completion marks | `derivedStageState` in `frontend/src/components/Skeletons.jsx:85-106` now treats explicit terminal state and the terminal phase as interrupted/failed; `processTransition` at `:118-132` checks stopped/failed before pending tools. The parameterized stopped/failed assertions in `frontend/src/__tests__/MessageList.test.jsx:574-610` prove the terminal row is not `is-complete`, while only the prior completed context row is. |
| A2 — live-region silence | `CouncilProcess` at `frontend/src/components/Skeletons.jsx:169-239` uses a named `role="status"` region whose accessible text is in the DOM, with `aria-live="polite"`, `aria-atomic="true"`, and a matching label. The loading and handoff cases are covered at `frontend/src/__tests__/MessageList.test.jsx:261-264` and `:482-544`. This verifies the browser mechanism, not a hardware/AT capture. |
| A3 — answer hard reflows | `.council-process` reserves `124px` at `frontend/src/styles/chat.css:548-559` and `164px` below 600px at `:736-740`; the synthetic pending process begins at `frontend/src/components/MessageList.jsx:37-44`. In the real React temporal probe, answer top stayed `275.23px` at 1440px and `330.42px` at 390px across send, context, council, synthesis, and first token; answer-top range was `0px`. Measured CLS was `0.000142` desktop and `0` mobile. |
| A4 — no reconciliation consequence | `council-process.is-converging` at `frontend/src/components/Skeletons.jsx:199-205` and `councilConverge` at `frontend/src/styles/chat.css:614-650` give the truthful synthesis row a restrained opacity-only event cue. No transform, scale, sound, seal, or correctness implication is introduced. The global reduced-motion rule remains authoritative. |
| A5 — redundant transition tail | `processTransition` at `Skeletons.jsx:118-132` returns no normal success tail once synthesis is present; no-synthesis, partial, pending-evidence, stopped, and failed messages remain explicit. `MessageList.jsx:626-629` suppresses the generic “Answer in progress/complete” region when the process receipt owns the announcement. |
| A6 — CI-pipeline visual language | The receipt heading is sentence case at `Skeletons.jsx:108-115`; completed marks are quiet diamonds rather than emerald ticks, and terminal states use interrupted/failed marks. The process remains a reading aid, not a dashboard or model-seat theatre. |
| A7 — duplicate process/tool lists | `Message.jsx` selects one `CouncilProcess` at `frontend/src/components/MessageList.jsx:373-412`; `ProcessEvidence` is a closed, bounded disclosure at `Skeletons.jsx:133-157`. The test at `MessageList.test.jsx:613-639` proves `.tool-trail` is absent while the single process evidence disclosure remains. |
| A8 — current-session receipt deletion | `sessionProcesses` and `rememberSessionProcess` live at `frontend/src/hooks/useChats.js:82-168`; `renderedMessages` reattaches the safe process receipt after a later send. Completion/stop/failure paths record it at `:1410`, `:1680`, `:1714`, and `:1767`. The test at `useChats.test.jsx:1122-1149` proves the prior receipt survives the next send and every PUT payload remains free of `process`. Reload persistence is intentionally unchanged. |
| A9 — mobile ellipsis | `.council-stage-text` at `frontend/src/styles/chat.css:633-638` uses normal wrapping and `overflow-wrap:anywhere`; it has no ellipsis or nowrap. The 390px long-copy probe measured a `271.52px` text box, `64.75px` rendered height, equal `scrollHeight/clientHeight`, and document width exactly `390px`. The CSS contract is also asserted at `frontend/src/__tests__/answerSkeletonLayout.test.js:22-31`. |

### Verified findings, corrected interpretations, and remaining uncertainty

All nine Opus findings were valid findings against the pre-fix implementation and are now addressed
within this pass. The old measurements in the review — for example `68 → 92 → 116 → 141px`, the
25px tail push, the ellipsis width, and the two-list height — are historical evidence of the defect,
not current measurements after the fix. No Opus finding was discarded as false.

Two boundaries need to stay explicit. First, A8 is a current-tab process receipt, not durable process
memory: the final persisted assistant message remains plain transcript plus the existing safe fields,
so reload amnesia and the future schema/API/privacy/storage decision are still deferred. Second, the
fix pass does not prove that every backend route emits context, council, and synthesis, nor that a
screen reader has spoken the live text in a real authenticated session. The frontend continues to
preserve and render whatever keyed or legacy text-only frames actually arrive.

The execution handoff named `docs/ALOP_FRONTEND_EXECUTION_OPUS.md` remains absent at that exact path.
The pasted handoff, Sol constitution/vision, current forensic documents, Opus review, source, tests,
and browser evidence were used. This is an input-hygiene risk, not a reason to invent a second
implementation scope.

### Final verification record

- Focused post-A4 gate: **7 files, 118 tests passed**.
- Final full serial frontend suite: **57 files, 715 tests passed**.
- Final production build: **passed**, 3,894 modules transformed; CSS `104.20 kB` (`18.99 kB` gzip);
  `MessageList` chunk `9.78 kB` (`3.80 kB` gzip).
- `git diff --check`: passed; only existing LF/CRLF normalization warnings were reported.
- Browser probe used the real `MessageList`/`Message`/`CouncilProcess` path at 1440×900 and 390×844.
  Captures: `C:\Users\LENOVO\Documents\Codex\2026-08-23\investigate-the-failed-keep-the-api-5\work\frontend-opus-a3-1440.png`
  and `C:\Users\LENOVO\Documents\Codex\2026-08-23\investigate-the-failed-keep-the-api-5\work\frontend-opus-a3-390.png`.
- The temporary probe HTML/JS files were deleted after measurement. No I5 work has started. Do not
  call Sol again from this checkpoint; wait for the short Opus confirmation pass.


## Opus confirmation pass — outcome

```text
OPUS_CONFIRMATION_A = COMPLETE
OPUS_CONFIRMATION_VERDICT = PASS WITH ONE SMALL FOLLOW-UP
SAFE_TO_BEGIN_I5 = YES
SOL_HIGH_CALLS = 1
A1 = CLOSED
A2 = CLOSED (mechanism only; no screen-reader capture claimed)
A3 = CLOSED (re-verified at 390px: answer top 114.2px constant across all nine states)
A4 = CLOSED (convergence cue confirmed present at 390px)
A5 = CLOSED
A6 = CLOSED
A7 = CONSOLIDATION CLOSED; CLIPPING OPEN (HIGH, non-blocking)
A8 = CLOSED (sessionProcesses map + renderedMessages reattachment + passing test)
A9 = CLOSED (0px horizontal overflow in every case at 390px; long copy wraps, no ellipsis)
```

The full pass is `# Checkpoint A Confirmation Pass` in `docs/OPUS_CHECKPOINT_A_REVIEW.md`. The pass was
interrupted once and recovered from disk rather than restarted; no frontend source was modified, and the
temporary probe files were deleted after use.

**Open follow-up (HIGH, does not block I5).** `.council-process` is `height: 124px; overflow: hidden`
(`frontend/src/styles/chat.css:548-559`) with no release in terminal states. At 1440px this hides both
evidence rows when the disclosure is opened (44px clipped) and hides the transition line under verbose
stage copy (24.4px clipped); the partial and failed cases keep it by a 2.4px margin. 390px is clean at
164px. Fix: release the fixed height once the phase is `complete`, `stopped` or `failed`, and keep the
evidence disclosure outside the clipped box while working. This sharpens constraint 23.1 — the pre-answer
stack has no vertical budget left for I5's additions.
## Checkpoint B — current Luna execution record

**Date:** 2026-08-23
**CURRENT_PHASE:** I9_I10_I11_COMPLETE; FINAL_QA_COMPLETE; HANDOFF_READY
**BRANCH:** `fix/synthesis-degrades-to-council-draft`
**OPUS_STATUS:** UNAVAILABLE_IN_CURRENT_ENVIRONMENT; EXACT_HANDOFF_RECORDED
**SOL_HIGH_CALLS:** 2
**PRE_SOL_SYNTHESIS:** COMPLETE
**I5:** COMPLETE
**I6:** COMPLETE
**I7:** COMPLETE
**I8:** COMPLETE
**I9:** COMPLETE
**I10:** COMPLETE
**I11:** COMPLETE
**MIGRATION_CREATED:** NO
**MIGRATION_APPLIED:** NOT VERIFIED; no production migration run
**PRODUCTION_DEPLOY:** NOT PERFORMED

### Verified implementation evidence

- Backend stage truth remains route-dependent and keyed: `context`, `council`, and `synthesis` are emitted through `emitStage` / `sendStage` on the applicable production paths. The frontend preserves `frame.key`, accumulates bounded keyed rows, and does not invent absent phases.
- A7F fixed the desktop terminal/disclosure clipping without moving the live answer baseline. Live process height is 124px desktop / 164px below 600px; terminal states are content-driven.
- I5 separates request termination, answer production, council completion, synthesis, partial participation, failure, user abort, timeout/deadline, and seal eligibility. The seal is a process-completion receipt, never a correctness claim.
- I6 stores bounded safe provenance under existing tenant-scoped `turns.meta`; no chain-of-thought, hidden prompt, provider body, or raw model scratchpad is persisted. Old messages without provenance remain valid.
- I7 exposes structured safe source metadata through progressive disclosure. I11 removes an exact duplicate model-authored Markdown `Sources` block only when every URL matches the structured receipt; unmatched or prose-bearing Markdown source sections remain visible.
- I8 rebalances accent/material hierarchy so active intelligence and synthesis outrank New Chat/Upgrade while preserving Sakura Obsidian, Bamboo Day, lattice, earrings, rosette, keystone, skyline, and editorial answer composition.

### Current verification

- Frontend: **58 files / 734 tests passed**.
- Backend: **2,120 tests passed / 0 failed**.
- Build: **passed**, 3,896 modules transformed; CSS 109.02 kB / 19.75 kB gzip; latest `MessageList` chunk **13.65 kB / 5.39 kB gzip** after the defensive host validator.
- Static focused gate after final I8 fixes: **45 tests passed** (security headers, z-index hygiene/order, cascade snapshot).
- Automated a11y/contrast/reduced-motion suites remain green: 6 / 75 / 5 tests. Live screen-reader and authenticated production behavior remain unverified.
- Browser gallery captures: `checkpoint-b-1440-process.png`, `checkpoint-b-1440-sources.png`, `checkpoint-b-1440-populated.png`, `checkpoint-b-768-populated.png`, `checkpoint-b-430-populated.png`, `checkpoint-b-390-process.png`, `checkpoint-b-390-sources.png`, `checkpoint-b-390-populated.png`, `checkpoint-i9-390-empty-final.png`, `checkpoint-i10-1440-exemplar-final.png`, `checkpoint-i10-390-exemplar-final.png`, `checkpoint-i11-1440-source-receipt.png`, and `checkpoint-i11-390-source-receipt.png`.
- Browser geometry: body width equals viewport at 390, 768, and 1440; live process measures 306×164 at 390 and 456×124 at 1440; composer is 316×151 at 390 and 860×147 at 1440.
- Prior controlled temporal probe measured answer-top range 0px across send/context/council/synthesis/first-token and CLS 0.000142 desktop / 0 mobile. Final browser geometry still shows body width equal to the viewport at 390, 430, 768, and 1440; the 390px live process is 306×164 and the 1440px process is 456×124. A release-grade authenticated production Lighthouse trace remains unverified.

### Verified Opus findings for Checkpoint B

No independent Opus Checkpoint B review was run. The current tool environment does not expose Claude Opus 5 Medium or an equivalent direct invocation, so no Opus verdict is claimed. The exact brief and inputs are in `docs/LUNA_CHECKPOINT_B_PACKET.md`.

### Rejected or narrowed claims

- **Rejected as current-source fact:** “the frontend ignores `frame.key`.” Current `readStageFrame` / `recordStage` preserve it on this branch.
- **Narrowed:** “the full context→council→synthesis sequence is always emitted.” It is route-dependent; fast, cache, arithmetic, greeting, wiki/memory, image, and other paths can differ.
- **Narrowed:** “there is no source metadata anywhere.” Backend evidence/search and turn metadata exist; the former gap was the lack of a dedicated user-facing structured receipt, now implemented.
- **Unverified:** production migration application, authenticated Clerk flow, real screen-reader speech, route-universal browser behavior, final Lighthouse/performance result, and independent Opus judgement.

### Remaining uncertainty and next action

I9 translated identity into the actual 390px surface rather than restoring desktop-only ornaments: the header mark remains, all four starters fit in a 2×2 composition above the composer, and no horizontal overflow was measured. I10 added a deterministic, explicitly labelled landing exemplar (`Reviewed example · not a live turn`) after the real roster; it does not claim live runtime activity. I11 added conservative duplicate-source suppression and retained mismatched/prose-bearing Markdown sources. Sol High Call #2 then identified one High source-host trust defect; Luna fixed it in both sanitizers and the final full gates passed. The remaining boundaries are external: no independent final Opus browser verdict is available, live screen-reader speech and authenticated production behavior remain unverified, and no production migration or deployment was run. The exact final Opus brief is recorded in `docs/LUNA_FINAL_OPUS_HANDOFF.md`.

## Final I9–I11 execution record

**Date:** 2026-08-23
**Implementation status:** COMPLETE
**Opus status:** UNAVAILABLE_IN_CURRENT_ENVIRONMENT; no final verdict claimed
**Sol status:** `SOL_HIGH_CALLS = 2`; Call #2 completed with one High finding, then Luna applied the smallest correction
**Production status:** no deployment; no production migration applied

### I9 — mobile-native identity and responsive closure

- `frontend/src/styles/utilities.css` translates the four starter cards to a compact 2×2 grid below 480px, keeping the invitation above the fixed composer without restoring desktop ornament or introducing a new identity motif.
- `frontend/src/gallery.jsx` now includes the existing `/favicon.png` header mark so the reviewed gallery matches the actual application shell.
- At 390px, the final gallery capture shows the mark, warm material, ALOP wordmark, empty-state keystone, process-ready composition, four visible starter cards, and composer with body/document width exactly 390px. This is a mobile translation of ALOP, not a shrunken desktop frame.

### I10 — truthful landing exemplar

- `frontend/src/components/CouncilExemplar.jsx` provides a fixed Postgres/MongoDB example with question → Gather → Reconcile → one reply structure.
- `frontend/src/SignInPage.jsx` and `frontend/src/gallery.jsx` place it after the real seven-seat roster and before any authenticated turn; the label explicitly says `Reviewed example · not a live turn` and the footnote says the user’s question is handled by the live council after sign-in.
- The exemplar has no live region, no fake seat animation, no model-status claim, and no hidden request. Desktop and 390px captures show the intended editorial-to-vertical translation without horizontal overflow.

### I11 — evidence-surface and polish closure

- `frontend/src/components/MessageList.jsx` exposes `ProvenanceReceipt` as progressive disclosure and strips only an exact trailing Markdown source block whose safe URLs are already represented by structured provenance. Unmatched URLs and source sections containing prose remain visible; raw message content remains the copy source.
- The final 1440px capture shows one `Sources · 2` receipt rather than competing bibliographies. The final 390px capture shows both safe links readable when expanded, with no overflow.
- Completion/seal semantics, partial/failure/no-synthesis states, reduced-motion behavior, z-index/CSP hygiene, and CSS cascade guards remain covered by the existing automated suites.

### Final evidence ledger

| Area | Current evidence | Boundary |
|---|---|---|
| Process truth | Keyed `context`, `council`, and `synthesis` rows are preserved and rendered when emitted; process is retained after answer in the current message/session path. | Route sequence is conditional; no claim that every request emits every phase. |
| Completion | `processSemantics.js` allows the quiet seal only after an answer-producing, synthesis-complete path with no disqualifying failure; partial council is qualified. | The mark is process completion, not correctness or unanimity. |
| Provenance | Bounded safe metadata is serialized under tenant-scoped `turns.meta`; no hidden reasoning, prompts, provider bodies, or raw scratchpad. | Production migration/application and authenticated reload readback remain unverified. |
| Sources | Backend safe source metadata reaches the structured receipt; URL safety, dedupe, cap, disclosure, and duplicate suppression are tested. | The live backend/search contract still needs production-shaped authenticated verification. |
| Mobile | 390/430/768/1440 geometry has no horizontal overflow; final 390 empty-state and source-receipt captures are current. | Real-device/AT capture is not available. |
| Motion/performance | Reduced-motion tests pass; temporal probe answer-top range is 0px and CLS was 0.000142 desktop / 0 mobile. Fresh local signed-out traces measured desktop LCP 826ms / CLS 0.04 and mobile LCP 750ms / CLS 0.21. | The mobile shift cluster is dominated by the dev/auth shell and late font load; authenticated production Lighthouse and long-session performance are not release evidence. |
| Accessibility | Automated a11y 6, contrast 75, reduced-motion 5, plus component keyboard/link/disclosure tests pass. | Live screen-reader speech was not captured. |

### Final review handoff state

The implementation received Sol High Call #2. Sol found no blockers and one High trust-boundary defect: both source sanitizers accepted any HTTP(S) hostname, including private/special-use hosts. Luna fixed this in `backend/lib/turn-provenance-meta.js` and `frontend/src/components/MessageList.jsx`, added targeted host-rejection tests, and reran the full frontend/backend/build gates successfully. Sol’s initial verdict remains `NEEDS_MAJOR_CORRECTION`; no post-fix Sol re-review was spent. `docs/LUNA_FINAL_OPUS_HANDOFF.md` contains the exact independent Opus review handoff and must be read as a handoff, not as an Opus verdict. Authenticated production, live AT, and production performance boundaries remain unverified.

## Sol High Call #2 outcome and final correction

**Initial Sol verdict:** `NEEDS_MAJOR_CORRECTION`; blockers: none; one High finding.
**High finding:** the backend and frontend source URL sanitizers accepted any HTTP(S) hostname. Private/special-use destinations such as loopback, RFC1918, link-local, localhost, ULA, and mapped loopback could therefore enter durable provenance or appear as trusted receipt links if upstream metadata did not flag them first.

**Correction applied:** both sanitizers now reject private/special-use IPv4 ranges, IPv4-mapped/compatible special-use IPv6, IPv6 loopback/unspecified/link-local/ULA/multicast/documentation ranges, localhost and special-use local hostname suffixes, while retaining ordinary public HTTP(S) sources. The backend remains the authoritative boundary; the frontend repeats the check defensively for old or hand-authored transcript data.

**Post-fix evidence:** backend provenance tests **4/4**; focused frontend MessageList tests **43/43**; full frontend **58 files / 734 tests**; full backend **2,120 tests / 0 failed**; production build passed with **3,896 modules**. No source metadata, prompt, provider body, or hidden reasoning is exposed by this correction. No migration or deployment was performed.

### Final browser QA after the Sol correction

- Actual signed-out `/` at 1440px and 390px retains the labelled exemplar, correct accessibility tree, and body/document width equal to the viewport; the mobile page measured `scrollWidth = 390` with no horizontal overflow.
- Local Chrome traces after the correction: desktop LCP **826ms**, CLS **0.04**; mobile LCP **750ms**, CLS **0.21**. The mobile CLS cluster begins after the development auth shell/font load; it is recorded as an environment-bound attention item, not a production pass claim.
- Local browser console noise is limited to development conditions: Clerk development-key warning, Agentation development root re-mount warning, and the absent local `localhost:3000/health` service. No redesign runtime exception was observed in the component gallery evidence.
- No live screen-reader speech, authenticated production reload/provenance readback, real-device zoom/reflow, production deployment, or migration application was claimed.
