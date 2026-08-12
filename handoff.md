# Handoff — 2026-08-12

State of play at backend commit `2306cf8` on `main`, pushed — local and
`origin/main` are level, nothing is being sat on. Read `AGENTS.md` first;
this file is what changed and what is still open, not a description of the
project.

624 backend tests are green at `2306cf8`; the 634 frontend tests and the
production build were green at `f110515` and have not been re-run since, as
that pass touched backend only. Render auto-deploys from `main` and is slow —
well over five minutes — so `2306cf8` is live only once that deploy finishes.

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
lives in `~/CLAUDE.md` under "Peers" and the `codex-duo-protocol` memory file.
Named rather than numbered on purpose: the rules were renumbered the same day
this line was written, and a number is the part that goes stale silently.

**How it was arrived at**, kept here rather than in the rule, because a rule
that carries its own history stops being readable as an instruction.

The split was got wrong three times in one day. First Claude delegated only
REVIEW while keeping every piece of execution, which took the owner saying it
twice — the second time as "you are fucking peers… you have friends, workers
amongst you." That was not a refusal to delegate: two peers ran all session and
found four real defects. It was handing them the errand and keeping the work.
Reviewing a diff is the errand; building the thing is the work.

Then the effort levels were set backwards. Sol was made the cheap default
worker at `low`, which inverts the allocation above — sol is the senior peer
and should be dispatched rarely, for something substantial. Before that, the
rule claimed sol needed `medium` for reviews because review is an unbounded
search. **That was a prior asserted as a measurement.** Sol has never been run
at `low` on a review here; the owner asked for the evidence and there was none.
If it matters again, test it rather than asserting it.

Third was the AbortSignal misallocation recorded above.

What has worked, every time it was tried: partitioning by file before dispatch
(zero collisions across four concurrent runs), and telling peers plainly they
may disagree and do it their way. Luna found a real defect in one of Claude's
fixes that way; sol found two synchronous-throw crash paths, a money leak in
the dedupe, and five hover rules Claude had missed after Claude claimed to have
found them all.

---

## SEAT HEALTH IS UNKNOWN, AND THE ALARMING NUMBER WAS MEASURED ON THE WRONG
## ROSTER (2026-08-11)

**Retracted before it could be acted on.** This section briefly read "THE
COUNCIL IS DELIVERING ONE SEAT OUT OF SIX" and named it the top priority. That
claim does not survive its own evidence, and the retraction is left visible
because the mistake is more instructive than the correction.

**What was measured.** A local telemetry run reported 5 of 6 seats timing out
on every turn, naming `qwen3.6`, `gemma4`, `qwen3-coder`, `gemma2` and
`mistral-nemo`, with only `glm-5.2` answering.

**Why it does not mean what it looked like.** Four of those five ARE NOT IN THE
COUNCIL. The roster in `server.js` is `glm-5.2`, `kimi-k2.7-code`, `qwen3.5`,
`gemma4`, `deepseek-v4-pro`, `nemotron-3-ultra`, `minimax-m3`. This machine's
Ollama serves exactly one of them — `gemma4` — plus `glm-5.2:cloud` under a
different tag. It has none of `kimi-k2.7-code`, `qwen3.5`, `deepseek-v4-pro`,
`nemotron-3-ultra` or `minimax-m3`. The models that "timed out" are local
odds and ends that happen to be installed here.

So the run measured a substitute roster on hardware that cannot serve the real
one. It is not evidence about production seat health in either direction — the
council may be perfectly healthy in production, or badly broken, and this says
nothing either way.

**Why the production probe could not settle it either.** This runner has no
`OLLAMA_HOST` and no `OLLAMA_API_KEY`; `backend/.env` does not carry them. The
gateway cannot be reached from here at all, so no measurement made on this
machine can speak for production.

**What IS established, and is worth keeping:**

- The request shape is not the problem. `{ model, messages, stream, options:
  { temperature, num_predict } }` was accepted by every model that responded —
  no 400s on options, roles or structure. That kills the malformed-request
  hypothesis for good.
- Locally, three models produce no token within 35–60s and `gemma4` cold-starts
  at 33.4s against a 30s whip. On hardware like this, a cold seat cannot make
  the whip. Whether the production gateway behaves this way is unknown.
- A model the gateway does not serve and a model that is merely slow look
  IDENTICAL from inside the whip and need opposite fixes. That distinction is
  the thing any real probe has to establish first.

**The one action that would settle it**, and it needs the owner: an
authenticated probe of the real `OLLAMA_HOST` using the seven roster names and
the exact payload above, measuring TTFT per seat over several runs. Until that
exists, do not remove seats, do not raise the whip, and do not repeat the
"one seat in six" number — it measured something else.

---

## This session (2026-08-12) — cancellation landed, then reviewed for state

`2306cf8`, backend. The `AbortSignal` work that this file had queued "for a
session of its own" is done: the signal is threaded through
`settleByDeadline`, `askMember`, `callModel`, the registry executors and the
provider fetches, and cancelled on deadline and on quorum release. Stragglers
are now cancelled, not merely ignored.

The part worth remembering is the review brief, because a weaker one would have
passed this. Sol was asked to trace **what the state IS at each layer while an
abort propagates**, not whether the abort fires — and the named failure turned
out to be reachable: a seat released by quorum could still land its answer and
reach synthesis. `settleByDeadline` now marks the round resolved BEFORE
aborting the layers below it, closed for all four orderings (quorum-first,
abort-first, late-fulfilment, late-rejection). Three more came out of the same
pass: a provider body closing without Ollama's `done: true` frame was persisted
as a complete answer rather than an error, `signal || settleSignal` in the
search cache dropped the local deadline whenever a parent signal existed, and
quorum-during-a-round reported `stopReason: null` where the preflight path
reported `"quorum"`.

624 tests green. Each fix was reverted individually and its regression test
watched to fail before being restored.

---

## This session (2026-08-12) — an attacker's read of the app, and three fixes

The owner asked for the app looked at "like a hacker would think". Sol did the
review under an authorised, bounded brief — read-only against production, no
fuzzing, no payloads. Full document in `docs/attack-surface-sol.md`, and it is
worth reading whole: it ranks by what an attacker GAINS, and it says plainly
what it could not check.

Its executive judgement, which reframes the whole surface: **the valuable attack
here is not shell access, it is getting one council seat to turn private prompt
context into an outbound URL.** The tool set is read-only, capped, and has no
write or execution primitive, so an injected page cannot alter Supabase or take
a tenant. It can still cost confidentiality, an answer nobody asked for, and
paid calls.

Three findings fixed today. Each was verified in the source before being
believed, and each fix was reverted and watched to fail.

**Every rate limit in the file was an IP limit wearing a user limit's clothes.**
`rateLimitKey` prefers `u:<userId>` and falls back to IP, and its own comment
said the quiet part — "Only routes that run their auth middleware before the
limiter will have it." None did: `clerkMiddleware` was mounted about a hundred
lines BELOW the limiters, so `req.auth` never existed at limiter time. One valid
account rotating source addresses collected a fresh 30-per-minute council
allowance per address, and a council turn is seven paid model calls plus search
plus a possible fallback whip. The mount moved above the limiters; nothing else
changed, because `rateLimitKey` had been written for this and was waiting.
`middleware-order.test.js` pins it, because **no unit test can see this** — the
function passes either way when handed a `req` with `auth` set, and the defect
is the order of two `app.use` calls.

Still missing, and NOT smuggled in: a per-user SPEND ceiling. There is only a
request rate. A user inside 30/minute can still run the bill up; they just
cannot multiply themselves across addresses. Sol's proposal is an atomic
reservation against a daily budget before the first provider call, refunded on
completion. That is a product decision about money and it is the owner's.

**`/api/feedback` called a paid model with no suspension check.** Every other
paid route carries `checkSuspended`; this one had `requireAuth` alone while
invoking `FAST_MODEL` on every rating. A suspended account with a live Clerk
session kept spending — suspension was not the kill switch it is documented to
be. The test asserts the whole paid set rather than the one route, because the
next paid route added is the one at risk.

**`redirect: 'follow'` let the HTTP client outrun `url-guard`.** The link
checker vetted the URL a model produced and then followed redirects
unsupervised. An attacker publishes on a public host, gets it into a search
result, and answers `302 Location: http://169.254.169.254/…`. The check said yes
to the public host and the fetch went to cloud metadata — **every address the
guard refuses was reachable in one hop through a host it allows**, which made
the address list advisory. Now `manual`, with `assertSafeUrl` on every hop,
resolved against the previous URL, capped at four. Tested against a real
loopback redirect rather than a stubbed fetch, because the bug was in what the
client did on our behalf and a stub would only have tested the stub's opinion.

### Still open from that review

- **The DNS-rebinding half of the URL guard.** Each hop is validated by NAME
  and then fetched by NAME, so a name answering public for the check and private
  for the connection still wins. `assertSafeUrl` already returns
  `{ address, family }` for exactly this and every caller throws it away.
  Closing it means connecting to the vetted address while preserving Host and
  SNI — a custom dispatcher, not a flag.
- **Indirect prompt injection**, ranked highest by Sol and still the queued
  research question. Its concrete shape: a page instructs a seat to encode
  conversation context into `https://attacker/collect?d=…` and call `read_url`;
  one seat of seven complying is enough, and the fetch itself is the
  exfiltration. Sol's proposed fix is structural rather than persuasive — mint
  an opaque ID per search result and let `read_url` accept only IDs, so a model
  that has consumed untrusted text cannot author a host, path or query at all.
  That is worth more than any wording of `UNTRUSTED_PREAMBLE` and it is the
  first thing to try when this is picked up.
- **Google API credentials travel in query strings.** Not a repo leak, but
  query credentials survive in outbound proxy and tracing logs where an
  Authorization header would not.
- **Several handlers return raw `err.message`**, including provider and Supabase
  failures. Sol declined to inflate it into a finding on a public-source app and
  suggested stable public codes with the original kept in Sentry.
- Sol could not verify: live RLS (service-role traffic bypasses it, so no
  source review can prove the policies work for `authenticated`), any
  signed-in route, `COUNCIL_TOOLS` state, or the Perplexity key rotation. It
  found no history evidence of that key, which is not the same as it being safe.

**What is well defended, worth knowing so effort goes elsewhere:** the URL
parser handles decimal, octal, hex and IPv4-mapped IPv6 encodings correctly —
the flaw was always callers discarding its result, never the parser. The tool
loop's blast radius is genuinely bounded: read-only tools, four rounds, twelve
unique calls, per-call and wall clocks, output clamps, untrusted text kept out
of system position, opaque file IDs bound to `(user, chat)`. Route enumeration
found no missing `requireAuth` across 30 routes; `/health` and the
signature-verified Stripe webhook are the only public ones, by design.

---

## This session (2026-08-12) — the CSP finding was aimed at the wrong CSP

Chased `'unsafe-inline'` in `server.js`'s helmet block, on the assumption it was
governing the app's scripts. **It never was**, and the correction is more useful
than the original finding.

**The document CSP is set by `frontend/vercel.json`, on the Vercel response, and
it is already clean.** Measured on live `alop-ai.com`:

```
script-src 'self' https://clerk.alop-ai.com https://challenges.cloudflare.com
```

No `'unsafe-inline'`, no nonce. Loaded production in a browser with a
`securitypolicyviolation` listener attached: Clerk initialised, the app
rendered, **zero violations**. The page ships exactly one inline block — an
`application/ld+json` data block, which is not executable and which `script-src`
does not govern. **Clerk needs neither the inline permission nor a nonce here**,
because it arrives as an external script from an allowlisted origin. Nothing to
fix on the frontend.

**The backend CSP was still worth tightening, for a different reason.** It
travels on JSON and SSE; `server.js` has zero HTML routes, zero `<script>`
tags, no `express.static`, no `sendFile`. So `script-src 'self' 'unsafe-inline'
https://*.clerk.com` was permission for a route that does not exist — dead until
someone adds one, and Express's own error handler already returns HTML. Now
`'none'`.

**And the real find, which nothing was looking for:
`xFrameOptions: 'DENY'` was silently ignored.** Helmet 8 does not accept the
string form, does not warn, and falls through to its own SAMEORIGIN default.
Reproduced locally against helmet 8.3.0:

```
default (no option)                X-Frame-Options = SAMEORIGIN
xFrameOptions: 'DENY'   (ours)     X-Frame-Options = SAMEORIGIN
xFrameOptions: {action:'deny'}     X-Frame-Options = DENY
```

and confirmed on the deployed backend, which was serving `SAMEORIGIN` while the
source read as `DENY`. Impact is small — `frame-ancestors 'none'` in the same
CSP covers every browser that matters, deliberately redundant — but **a line
that states an intent it does not carry out is worse than a missing line,
because it stops anyone looking again.** No grep could have caught it: the
source was not wrong about its intent, it was wrong about the library.

The options moved to `backend/lib/security-headers.js` so
`security-headers.test.js` can mount them on a real express app and read the
headers off a real response. It pins the helmet behaviour itself — if helmet
ever starts honouring the string, that assertion fails and says so. Both fixes
watched to fail. 635 backend tests pass.

**Queued, not done: measuring whether `UNTRUSTED_PREAMBLE` actually works.** The
owner's framing, and it is right: that is a research question, not a fix. It is
the most serious item on `docs/cyber-skills-shortlist.md` and the hardest to act
on — seven models are handed arbitrary fetched web text behind a preamble that
asks them to distrust it, and nobody has measured whether they do.

---

## This session (2026-08-12) — mist, hookify disarmed, sign-in measured

**The cloud bars were the wrong MATERIAL, not the wrong weight.** The owner:
"the bars reading as highlighter means they crossed from one material into
another. Kasumi is grey mist." He asked for half a step back on the alpha, and
the experiment says no point on that ladder works — measured over the composer
card in the light theme, the bars sat at +0.062 chroma; a half step left +0.045,
a full step left +0.030 and returned them to the invisible state that started
this. Both ends of the ladder are wrong in opposite directions because the
ladder is not the axis the fault lives on. `--ornament-mist` is a new per-theme
token: same lightness gap to within a rounding error (dark 0.166 against 0.159,
light 0.186 against 0.187), about a twentieth of the chroma. Verified live.

It is per theme and it is NOT the silhouette, though the light value matches it.
Mist is defined against the card; silhouette is defined against the light. In
the dark theme `--ornament-silhouette` is `#0a0a0a` and mist drawn in it
vanishes outright — a lightness gap of 0.014. Tried, looked at, rejected.

**hookify is installed and three of Luna's four rules had to be disarmed or
loosened before they could stay.** The install and its firing evidence are real
and good — see `docs/hookify-setup.md`. But:

- `block-outside-declared-boundary` shipped `enabled: true` with the boundary of
  the dispatch that wrote it: `.claude/**` plus one docs file. Left armed, it
  denies every write to `frontend/` and `backend/`. The next session would have
  opened to a repo where no source file could be edited, by a rule whose purpose
  is to prevent surprises. Now `enabled: false` with a placeholder pattern and
  arming instructions.
- The two stop gates were bare `not_contains` on the transcript, so a session
  that answered a question could not stop until it had run a test suite for code
  it never touched. Now conditional on the transcript mentioning a source file
  in that half.
- They also demanded one exact spelling, `cd backend && npm test`. The command
  actually used in that same session was `npm test` with the cwd already at
  `backend/`, which is correct and would have been blocked. **The rule passed its
  own false-positive check because it was tested against the string it had
  itself written** — the check tested the author's memory, not the rule.

**The hook rules are NOT in the repository.** `.gitignore:13` ignores `.claude/`
wholesale, so all four `hookify.*.local.md` files — Luna's originals and the
corrections above — exist only on this machine and will not survive a fresh
clone or reach anyone else. `docs/hookify-setup.md` is committed and describes
them, which is the worst of both: a committed document describing local-only
configuration reads as shared setup. If they should be shared, `.gitignore`
needs an exception (`!.claude/hookify.*.local.md`) — the owner's call, since
`.claude/` also holds `settings.local.json`.

**Sign-in, measured rather than redesigned.** Four defects found on the live
page, all fixed:

- **Two `<h1>`s and no `<h2>`** — the thesis title and Clerk's "Sign in to
  ALOP-AI". Clerk's `header` is now `display: none` (confirmed removed from the
  accessibility tree, not merely invisible) and `SignInPage.jsx` supplies its own
  `<h2>`, which also lets the heading differ between sign-in and sign-up.
- **The Pro tags sat 158–167px from the name they qualify**, `margin-left: auto`
  pushing them to the far edge of the ladder — a fourth column of stranded
  words. Now 12px, on the same baseline.
- **The temperature outranked the seat name.** In `--primary` at 0.85 it
  measured 8.36:1 against the page while the attribution sat at 5.62:1, so the
  first thing the eye met on every row was an internal sampling parameter. The
  column stays as texture, one step back instead of one step in front.
- The Clerk card is NOT unthemed — `lib/clerkAppearance.js` is thorough. An
  early read that it was "stock" was wrong.

Checked and NOT changed: the page is already vertically centred (the 112px below
the content is matched by 110px above it), and every small-text contrast on it
passes AA — the legal and plan text at 5.62:1. Both were suspected and both are
fine.

**Sol's critique landed and found the thing that mattered.** Full document in
`docs/signin-critique-sol.md`. Its verdict on the premise is worth keeping: the
1440/1024 steady state is NOT "really bad" — it is authored and coherent with
the app; the complaint becomes true at the information order, the collapsed
layout, and the states around Clerk.

**`/sign-up` had no route to Terms or Privacy, and a test enforced it.** The
component withheld our legal links there on the belief that Clerk renders its
own required consent checkbox with links to both documents. False in this
configuration — measured by Sol and then independently here: zero Terms/Privacy
links in the card, zero checkboxes, no occurrence of either word in its rendered
text. The flow where consent is actually taken was the only one with no route to
either document; sign-in, where the account already exists, had both. A test
asserted exactly that, so the suite agreed with the comment and neither looked
at the page. Fixed in both flows, test inverted and watched to fail.

The rule that came out of it: **our obligations must not be conditioned on what
a third-party component is believed to render.** Its markup changes on their
release schedule, silently, and the failure is invisible from inside this repo.

**The loading slot now says which state it is in** — a 700ms grace period, then
"Preparing secure sign-in…" with `role="status"`. Before, a blank 342px well sat
there with nothing to separate "on its way" from "failed" until the ten-second
down-state. Two timers, because those are different questions.

### Open from Sol's critique, not done

- **The narrow-viewport information order is backwards.** At 768 and 320 the
  auth card renders above the product headline, so the first consequential
  choice precedes the first product sentence — and DOM order is still thesis
  then card, so sighted and screen-reader users get opposite sequences. Sol's
  fix is a `grid-template-areas` split of the thesis into `signin-intro` (title
  + tagline, before the card) and `signin-proof` (ladder + seal, after it). Real,
  and a bigger change than the commit that carried the legal fix should have
  taken on.
- **Sign-in cannot render Bamboo Day at all.** With `prefers-color-scheme:
  light`, `.signin-root` still resolves `--bg: #0a0a0a` — it has no
  `.app-root.light` ancestor — and Clerk is pinned to `baseTheme: "dark"` with
  hex variables. Every screenshot of this page, including today's, is one theme.
  Describe it as Sakura Night-only until the saved `alop-dark-mode` choice is
  threaded through the signed-out gate.
- **`gallery.html` has no sign-in, sign-up, loading or down frames**, which is
  why these defects survived: every visual check ran against a fixture that does
  not contain the page.
- **Sol's surprise, not built**: a seven-bar seat meter above "3 models free.
  All 7 on Pro." in `--ornament-mist`, free seats at mid and Pro-only at faint.
  Cheap, and it explicitly uses mist rather than pink "because brand pink at the
  same visibility would read as highlighter" — the lesson from the composer
  travelling on its own.
- The council ladder announces each row starting with an unexplained decimal.
  Sol proposes a visually hidden scale description; the numbers are already
  demoted visually but a screen reader still meets them first.

---

## This session (2026-08-12) — the weather, and a green suite over a broken build

The owner asked for the sun at middle-left with clouds, for the design to be
more visible, and for the background lines, which go thin and hard to see in
both themes. He also said "surprise me", and asked that the three of us make the
idea together. Sol and Luna each wrote an independent proposal without seeing
the other's; both are committed as `docs/design-proposal-sol.md` and
`docs/design-proposal-luna.md`, and the implementation is a synthesis, not
either one.

**Where they agreed, that is the finding.** Both independently moved
`.composer-clouds` from `--ornament-a-faint` to `--ornament-a-mid`, having each
found the bars present in every screenshot and needing to be hunted for. Done.

**Where they disagreed, one of them was measuring the wrong machine, and it is
worth knowing why.** Sol measured `devicePixelRatio = 1.25` and Windows
`AppliedDPI = 120`, diagnosed subpixel smearing, and A/B'd it: doubling the
lattice mixes to 16%/12% at 1px made the smear darker and left it a smear, while
holding the mixes and widening the band to 1.6px made it crisp. Luna measured
DPR 1, concluded the fault was alpha, and proposed new per-theme lattice tokens.
Luna's DPR came from a Playwright browser at the default `deviceScaleFactor` of
1 — **the instrument reported its own configuration, not the machine.** I
measured 1.25 twice independently before choosing. The width fix shipped; the
alpha is untouched, which also keeps the banding tuning in that rule intact.

`--lattice-line` is on `:root`, not on `.chat-main::after`, because the asanoha
is drawn twice — the transcript and `.signin-lattice` — and two copies of one
pattern get one definition of how thick its line is.

**A unit inside an SVG transform is a user unit, not a CSS pixel**, and Sol's
proposal was written as if in pixels. Measured in Chrome at this viewBox,
`translateX(74px)` on the weather group moves the disc 60.3 CSS px. The
behaviour was right and the stated magnitudes were not; the comments now say so
at both sites, because this is exactly the kind of number the next person
"corrects".

Shipped: sun and clouds in one `.composer-weather` group under a bounded
`clamp` shift — measured at 28% across the visible strip at a 1068px window,
against 16% before, and unchanged at 380px where the composition already worked.
Seven cloud bars, one per council seat, four approaching and three answering,
which is Sol's surprise and the only thing here nobody asked for. Verified in
the browser rather than asserted: 7 bars, nearest 6.3px clear of the disc,
`--lattice-line` resolving to exactly 2.000 device pixels, cloud opacity 0.26.

### The part that matters more than the design

**The full frontend suite passed, 636 green, while App.css was returning 500 and
the app mounted to an empty body.** An unterminated comment in decoration.css
made PostCSS refuse the file. The cascade snapshot did not notice, and it could
not: `readStylesheet` inlines the @imports as text and hands the result to
jsdom's CSSOM, which is specified to DROP rules it cannot parse rather than
raise. The broken file arrived as slightly fewer rules, the baseline was
regenerated from that, and the diff came out clean — with two comment fragments
sitting in the baseline as selectors.

`src/__tests__/cssParses.test.js` is the missing half: it parses every
stylesheet with PostCSS itself and fails on the error the dev server would have
raised. It was watched to fail by reintroducing that exact comment. The baseline
has been regenerated from correct CSS.

The general shape, and the reason this is in the handoff rather than just in a
commit: **a test that reads CSS as text cannot tell you the CSS compiles.** The
suite was green over a build that 500s.

Not taken: Luna's per-theme lattice alpha tokens (the diagnosis under them is
the DPR-1 artefact) and Luna's `.input-wrapper::before` kasumi rail (Sol's seven
bars cost two rects and say something about the product; a second decorated edge
beside the seal was the riskier of the two, and Luna itself said to delete it if
it competed).

Open, for the owner's eye rather than a fix: at `--ornament-a-mid` in the light
theme the cloud bars are saturated enough to read a little like highlighter
rather than kasumi. Both peers wanted the step up and it is what "more visible"
asked for. Say the word and they go back half a step.

---

## This session (2026-08-12) — the p90 stops lying about abandoned turns

The owner's ruling on the item the last commit left him: *"A p90 that hides
aborted turns is a lying metric."* Fixed, and the fix is in two halves because
writing the row is only half of not lying.

**`server.js` writes the row from the `finally`, fire-and-forget.** Every abort
path returned before the audit write — the `if (turnSignal.aborted) return`
guards and the catch alike — so a turn the user gave up on left no trace. It is
NOT awaited: the client is already gone, so there is nobody left to wait for the
round trip, and `.catch(() => {})` is there because an unhandled rejection in a
`finally` ends the process under Node's default policy. Only
`turnSignal.aborted` reaches it, so a 400 from `validatePrompt` still writes
nothing.

**It keeps the `council` action rather than taking a new `council.aborted`.**
The admin console selects `.in("action", ["council.tools", "council"])` and then
filters on `metadata.telemetry === "council_turn"`. A new action name would have
written rows no report reads — the same invisibility with extra steps.

**`admin-commands.js` counts them and keeps them out of the percentiles**, and
this is the half worth remembering. An abandoned turn's `turnMs` is a CENSORED
observation: the turn was still running, so the number is a lower bound on a
duration nobody measured. Folding those in would have made every percentile
improve as more users gave up — the original bug, inverted, and harder to spot
because the graph moves the way you want. They are reported as
`abandonedTurns` and `abandonedAfterMsMedian`, and an abandonment rate over one
in five now outranks every other verdict the report can print. Their seat and
tool records are dropped too: seats that had not answered yet are absent rather
than slow, which biases a seat percentile toward whichever seats are fast.

Also collapsed to one flag: `telemetryWritten` guarded only `auditTelemetry`
while the memory, greeting, no_results, search and wiki branches called
`auditLog` directly, so it read false on the paths that had already written.
Harmless until the `finally` started writing too — then a client vanishing
between a branch's `await` and its `return` meant two rows for one turn.
Everything routes through `auditBranch` or `auditTelemetry` now, and a contract
test asserts no `auditLog(user.id, 'council'` survives in the route.

**Still not audited: a non-aborted 500.** Real gap, separate one, not fixed
here.

631 backend tests pass (624 + 7). Each of the three fixes was reverted
individually and its tests watched to fail — percentiles including abandoned
rows, the `finally` firing for a 400, one branch bypassing the flag — then
restored.

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
- ~~**Nothing is cancelled, only abandoned.**~~ **Done** — the `AbortSignal` is
  threaded through `settleByDeadline`, `askMember`, `callModel`, the registry
  executors and the provider fetches, and cancelled on deadline and on quorum
  release. Sol's review of it landed four further fixes in `2306cf8`; see the
  2026-08-12 section above. What remains of this item is one owner decision,
  listed under "Open, and needing the owner": aborted turns write no telemetry
  row at all.
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
- **The cascade snapshot cannot see a stylesheet that does not compile**, so
  `UPDATE_CASCADE_BASELINE=1` on a broken file bakes the breakage into the
  baseline. `src/__tests__/cssParses.test.js` covers that now. If a CSS change
  looks green but the page is blank, load `/src/App.css` from the dev server and
  read the 500 body — it names the file, line and column.
- **A `px` inside a `transform` on an SVG child is an SVG user unit**, not a CSS
  pixel. Measured: `translateX(74px)` on `.composer-weather` moves the disc 60.3
  CSS px at this drawing's scale.
- **A headless browser's `devicePixelRatio` is its own configuration.**
  Playwright defaults to `deviceScaleFactor: 1`, and this machine is at 1.25.
  One peer's whole diagnosis rested on reading 1 there. For anything
  resolution-dependent, read the value in the user's own Chrome.
- **The two halves use different test runners.** Backend is `node:test` —
  `npm test` from `backend/`. Frontend is vitest. Running `npx vitest` in
  `backend/` reports all 44 files as "No test suite found in file", which reads
  as a broken suite and is only the wrong runner.
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
