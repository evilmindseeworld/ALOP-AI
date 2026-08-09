# ALOP-AI — working notes

Read by Codex automatically. Claude Code reads it via `CLAUDE.md`, which points
here. One file, so the two of us cannot drift apart on the facts.

Only things that are **not** derivable from the code or `git log` belong here.
If it can be discovered by reading a file, do not write it down — write down the
things that cost someone an hour to find out.

## Layout

- `backend/` — Node/Express, `server.js` plus `lib/`. Supabase for data, Clerk
  for auth, Stripe for billing, a council of models behind an Ollama-compatible
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
`ClerkExpressRequireAuth()` with no options validates the signature and expiry
and ignores the origin the token was minted for. `authorizedParties` is set
from `originPolicy.exact` so it cannot drift from the CORS list. The
consequence to remember before debugging a mystery 401: an origin allowed only
by `ALLOWED_ORIGIN_SUFFIXES` passes CORS and fails auth, because `azp` is an
exact string. Preview deploys that need to sign in must be named in
`ALLOWED_ORIGINS`. The boot log prints which mode it is in.

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
twice.** Two hanging crescents in the gutters, four sakura corner sprigs and a
faint torii behind the empty state, an asanoha lattice across the chat surface,
a centred hero, and starters as a 2x2 card grid.

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

**The council runner lives in `lib/council-run.js`.** It moved out of
`server.js` so it could be tested at all, and it is the most intricate
concurrency in the product: seats race in parallel and it resolves on the first
of quorum, all-settled, or the whip timer. It also takes an optional `onSeat`
reporter, best-effort by construction and wrapped so a dead client socket cannot
lose an answer a model call was already paid for. Nothing renders those events
yet, and the reporter is the seam if a live council view is ever wanted.

**`cssHygiene.test.js` counted keyframe steps as selectors.** `from`, `to` and
percentage steps leaked out of `@keyframes` blocks and were counted as top-level
rules, so the duplicate budget was partly measuring how many animations the app
has. Fixed by shape; the budget came down from 10 to 9 as a result. If that test
blocks you, check whether it is counting something real before you edit CSS to
satisfy it.

**`@clerk/clerk-sdk-node` is deprecated at its final version, 5.1.6.** It pulls
`@clerk/shared@2.22.1`, which pulls `js-cookie@3.0.5`, which has an unpatched
prototype-hijack advisory. No `npm audit fix` clears it — the only non-breaking
suggestion is a downgrade to v4. The successor is `@clerk/express`. Until that
migration happens, `npm audit` on the backend will keep reporting three highs
and they are all this one chain.

## Handoff — 2026-08-07 (second pass)

Read this first; it is the state of play, not history. Delete a line once it
stops being true.

**Codex is out of quota until 2026-09-06.** `codex exec` returns
`You've hit your usage limit`. `gpt-5.1-codex-max` additionally rejects with
*"not supported when using Codex with a ChatGPT account"* — do not retry it.

**Use GLM 5.2 as the second reviewer meanwhile.** `tools/glm.mjs`, through the
local Ollama daemon, which routes `:cloud` models to the signed-in account. No
key in the repo.

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
2. **Four search keys are unset in Render.** All four providers ship inert
   without them; the boot banner reads `P=` `S=` `SA=` `FC=` and says which.
   In the order they are worth setting:
   `FIRECRAWL_API_KEY` (fixes the ROOT of the missing-price bug — Jina cannot
   see a JavaScript-rendered price at all), `SERPER_API_KEY` (structured
   shopping prices, cheap), `SERPAPI_API_KEY` (the ~110 specialised engines —
   flights, hotels, scholar, finance; billed per call, 100/month free), and
   `PERPLEXITY_API_KEY` if it is still missing. `PERPLEXITY_MODEL` defaults to
   `sonar` and `PAGE_READ_LIMIT` to 3; neither needs setting.
3. **`@clerk/clerk-sdk-node` is deprecated and carries a high-severity
   advisory.** `npm audit` reports `js-cookie <=3.0.5` (GHSA-qjx8-664m-686j,
   cookie-attribute injection) reached through `@clerk/shared`. Traced before
   panicking: the only import is `@clerk/shared/dist/cookie.js`, browser-side
   code that this Node backend never executes, so it is **not reachable here**.
   The real fix is migrating to `@clerk/express`, which is an auth-path change
   worth its own session and a live Clerk to test against — not something to
   slip into an unrelated commit. `npm audit fix --force` would downgrade to
   `@clerk/clerk-sdk-node@4` and break the app.

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
- [ ] **Focus visible on every interactive element.** `:focus-visible` rings
      are declared; confirm none is clipped by an `overflow: hidden` ancestor,
      which is how a ring silently disappears.
- [ ] **Tab order matches reading order** through: header, sidebar, chat rows,
      composer, panels. Especially the composer, where the buttons are
      visually reordered on mobile.
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
