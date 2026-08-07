# ALOP-AI — Session Handoff

**Written:** 2026-08-06
**Repo:** `C:\Users\LENOVO\Documents\AI-Classroom` — `evilmindseeworld/ALOP-AI`
(**PUBLIC** — never commit a secret, and treat anything already in history as
compromised)
**Branch:** `main`.

> **STALE HEADER, corrected 2026-08-07.** This block used to read "HEAD
> `e31d6ad`, committed locally and NOT pushed". Both are wrong now: everything
> described below was pushed, and `main` has since moved on through the prompt
> injection fixes, the router extraction and `0583cde`. `git log` is the
> authority on what is where; this file is a record of one session's reasoning
> and its head facts age out within a day. The blocked-on-the-owner list further
> down has also drifted — `gh auth login` is done, and item 4's migrations are
> partly applied. Check before acting on any line of it.

**Verified against the live site, not assumed:** the Clerk key swap has NOT
taken. `alop-ai.com`'s bundle still ships `pk_test_…`, which decodes to
`relaxing-impala-5.clerk.accounts.dev`; `window.Clerk.frontendApi` confirms it
at runtime and the sign-in page renders a **"Development mode"** badge. The
production instance itself is fine — `clerk.alop-ai.com` returns 200 — so this
is the Vercel variable or the redeploy, exactly the trap below.

**Owner:** Mohamed Fateh Douba, Style Tower 2603, Sharjah, UAE.
Now named as data controller in both legal documents — public information on
the site, not a secret, but also the answer to "what goes in the [FILL IN]",
which cost a round trip last time.

**Verified this session, not assumed:**

| | |
|---|---|
| Frontend tests | **417 passing**, 31 files |
| Backend tests | **389 passing** (was 337) |
| Server boot | starts, `/health` 200, roster still 7 pro / 3 free |
| Live site | **`https://alop-ai.com`** → 200, valid cert |
| `www` | 307 → apex. Apex is canonical |
| Clerk production | **certs issued** — `clerk.alop-ai.com` 200, `tls_verify=0` |
| CORS on the new domain | 204 for `alop-ai.com`, **403** for attacker origins |
| Third-party font CDNs | **zero requests**, checked in a browser |

---

## Unpushed, and one of them matters more than the Clerk swap

Four commits sit on `main` locally. **`git push`, then let Render and Vercel
redeploy.** Two are security fixes and neither is live.

**`aa6f59f` — one account could overwrite another account's conversation
memory.** `updateChatSummary` read and wrote the `chats` table addressed by row
id alone:

```js
supabase.from('chats').select('conversation_summary').eq('id', chatId)
supabase.from('chats').update({ conversation_summary: … }).eq('id', chatId)
```

`chatId` comes from the request body of `/api/council`. `readChatSummary`, three
lines below, filtered on `user_id` all along — so the read path was scoped and
the write path was not. Any signed-in account could pass any chat's id and have
that conversation's summary replaced with a summary of its own exchange. The
victim's per-chat memory then shapes every later answer in that chat, and
nothing surfaces it: no error, no audit row, and the victim's own reads keep
working.

**RLS does not cover this and never would.** The server holds
`SUPABASE_SERVICE_ROLE_KEY`, which bypasses row-level security by design, so
migration 002's policies are not consulted for this client at all. Every
ownership check has to be in the query. `tenant-scope.test.js` now asserts that
for every `chats` and `chat_files` query.

**`3433557` — a client could put a system message in the model's context.**
`/api/overlay` spread client-supplied objects straight into the message array
with no check on role, content type or size, and `/api/council` listed `system`
among the roles a caller could send. A caller-supplied system message lands
*after* the server's own, which is how you override one — putting "use ONLY the
provided data" and "introduce no fact that appears in none of the responses"
inside the request body. Those rules are the groundedness claim. Also closed:
history had no *total* size cap, so one request could carry 2,000,000 characters
to seven models; the real frontend sends at most 8 × 4,000.

The other two are smaller. `818286c` fixes a router that answered German
questions in French; `f90a4c1` deletes a 50 MB body limit granted to two routes
that do not exist.

---

## The one thing to do first *after* pushing

**The Clerk key swap is half-done and the app is still on development keys.**

The certificates exist. The keys have not been switched. Until they are, the
app is capped at 100 users and the sign-in page reads "Development mode".

```
Render →  CLERK_SECRET_KEY = sk_live_…              (do this FIRST)
Vercel →  VITE_CLERK_PUBLISHABLE_KEY = pk_live_…    then REDEPLOY
```

Order matters. If the frontend goes live on `pk_live_` while the backend still
validates against `sk_test_`, every request fails auth for the gap between the
two.

**The redeploy is not optional.** Vite bakes env vars into the bundle at build
time. Changing the variable without redeploying leaves the old `pk_test_` in
the shipped JS and looks like the change silently failed.

Confirm the bundle actually carries the live key:

```bash
js=$(curl -s https://alop-ai.com | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -s "https://alop-ai.com$js" | grep -oE 'pk_(test|live)_[A-Za-z0-9]{6}' | head -1
```

**The three existing accounts do not migrate.** Production is a separate user
store. Everyone re-registers. That is why this was done before launch.

---

## Blocked on the owner — this is the critical path

None of it is engineering. Every item needs a login.

1. **ICANN contact verification.** Namecheap's domain row shows an **ALERT /
   VERIFY CONTACTS** badge. Miss the 15-day window and `alop-ai.com` stops
   resolving, which makes everything else here irrelevant. Highest priority and
   it is not close.

2. **The Clerk key swap** above.

3. **Stripe price IDs.** `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY` must
   point at **AED 30/month** and **AED 280/year**. If they do not,
   `/api/billing/prices` returns 503 and the upgrade path hides itself — a
   product nobody can pay for. **The Terms now state both prices publicly**, so
   Stripe has to match the page.

4. **Migrations** `004_rate_limits.sql`, `005_search_cache.sql`,
   `006_audit_retention.sql`.

   ```bash
   node scripts/run-migration.mjs 006_audit_retention.sql
   ```

   006 is the one with teeth. **The published privacy policy says IP addresses
   are deleted after 90 days. Until that migration runs, they are not.** A
   retention period the database does not honour is a false public statement,
   not a missing feature.

5. **`privacy@alop-ai.com` forwarder.** Namecheap → Advanced DNS → Mail
   Settings → ADD FORWARDER. Free. Both legal documents route rights requests
   there and it currently goes nowhere.

6. `TERMINAL_ADMINS` + `TERMINAL_SECRET` — admin console is disabled until both
   are set, and the boot log says so.
7. `GOOGLE_API_KEY` — unset means attaching an image returns a clear 503.
8. `ALLOWED_ORIGIN_SUFFIXES=-evilmindseeworlds-projects.vercel.app` — without
   it, Vercel *preview* deploys cannot call the API. Production is unaffected.
9. `gh auth login` — `gh pr create` still fails.
10. Decide `alop-desktop`'s repo. It has none, and Smart App Control blocks the
    Rust build here, so the F9 overlay fix is unverified.

---

## What this session did

### There was no way to sign up

`ClerkProvider` had `signUpUrl="/"`, `/` renders the sign-in page, and that page
rendered `<SignIn>` unconditionally — so Clerk's own "Sign up" link led back to
the sign-in form. Clicked on the live site to confirm. Email registration was
unreachable; only the Google button could make an account, because OAuth signs
up and signs in through one flow, **which is why this survived: the path the
owner uses works.** It is a launch blocker specifically because a production
Clerk instance is a separate user store, so everyone re-registers — through a
loop. Fixed, plus the `vercel.json` that was missing entirely (every deep link
404'd, so `/sign-up` would have died on refresh).

### Clerk is no longer styled through its internal DOM

21 CSS rules named `.cl-*` classes, and Clerk warned about it on every page
load: those selectors break when it ships a component update. On the one screen
every new user sees. Now `appearance.elements`.

The useful measurement: the 52 `!important` declarations were not sloppiness.
Clerk styles its button at specificity 0,3,0 and our selectors sat at 0,2,0, so
they lost the cascade outright. Through the API most become unnecessary — but
**three properties still need pinning**, because `box-shadow` and `border` are
set at Clerk's variant level. The first attempt claimed zero and was wrong;
diffing computed styles against a pre-change baseline caught the button silently
losing its inset highlights. Every property and rect now matches that baseline
exactly.

### The later half — four commits, all unpushed

**One root cause produced nine of the bugs: asking overlapping sets in order
and taking the first hit.** `detectLanguage` checked French before German and
Spanish, and French shares `ü` with one and `é` with the other — so "Grüße aus
München" and "El café está más frío" were both reported as French, and the
council was told to answer in it. The same mistake checked Chinese before
Japanese, and Japanese is written with Han characters as well as kana, so nearly
every real Japanese sentence was reported as Chinese. Now every alphabet is
counted and the highest total wins, which makes a shared character decide
nothing — correct, because it carries no information.

**None of that produced an error.** The council still ran, still streamed, and
still returned a fluent answer. There is nothing to grep for. That is the
argument for the move: the four router decisions now live in `lib/router.js`
where a test can call them with a sentence and look at what comes back.

**The security findings are in the section at the top.** Both were found the
same way — reading what a route does with input the client controls, rather
than what it looks like it does.

**Two guards were written to catch classes rather than incidents**, because in
both cases the sibling was already correct and only one caller was wrong:
`tenant-scope.test.js` (every `chats` / `chat_files` query names an owner) and
`route-config.test.js` (every limiter and every 50 MB exemption names a route
that exists). Both are mutation-tested, and both carry a guard on the guard —
the failure mode of a source contract is passing on zero matches.

`council-roster.test.js` closes the drift the frontend file already admitted to
in a comment: the sign-in page duplicates the roster deliberately, and the
comment said "it is wrong until someone updates it". The roster is that page's
entire argument, so it is the one claim on it that must not be false.

**A false positive is worth recording.** The first version of
`tenant-scope.test.js` read one line per statement and reported the file-upload
insert as unscoped. The insert carries `user_id` — on the next line. The code
was right and the check was wrong. A contract that cries wolf is one the next
person loosens, so it now reads to the semicolon.

### The earlier half

**The domain went live.** `alop-ai.com`, apex canonical, `www` redirecting.
Clerk production instance created, all five of its CNAMEs added at Namecheap.

**Clerk sat at 0/5 for over an hour and the records were never wrong.** Worth
recording because it looks exactly like a misconfiguration. The zone's SOA
negative-cache TTL is **3601 seconds**. Clerk queried `clerk.alop-ai.com` when
the instance was created, before any records existed, got NXDOMAIN, and cached
that for an hour. Every press of "Verify configuration" inside that window
re-read the cached negative. Two tells: **0/5 rather than 3/5** — slow
propagation trickles in, a negative cache blocks all five identically — and the
message saying it "could not determine the current DNS value" rather than
naming a wrong one. It cleared once the TTL expired.

**Speed.** Six awaited round trips before the first token became two
(`7aef5a3`). Search fan-out **8014ms → 608ms** (`3e7ffaa`). A search cache that
survives a deploy (`73694b5`). Cold start fixed **for free** — a GitHub Actions
cron pings `/health` every 10 minutes, so Render's 22.5s spin-up never lands on
a user (`d8f8d28`).

**Sign-in page 267 KB → 167 KB gzipped** (`9646d47`).

**Legal documents rewritten against the actual code** (`00daf6a`). They were
live and wrong: the contact address was `alopai@example.com`, the subprocessor
list named seven services where the code sends user content to **fourteen**
(Ollama, which receives every message, was absent), and IP addresses were
stored and undisclosed. Now includes legal bases, transfers, retention, GDPR
rights, a full CCPA/CPRA section, and a **13+ minimum (16 in EEA/UK) stated at
sign-up**, not only inside a linked page.

**All four font families self-hosted** (`94dda0c`), removing two third-party
CDNs from the critical path and the GDPR exposure with them.

**Audit retention** — 90 days, swept every 200 writes.

---

## Four traps this repo will set for you

**The local preview serves a stale build, not your source.**
`~/.claude/launch.json` defines `alop-frontend` as `vite preview`, which serves
`dist/`. Edit a component, reload, and you are looking at the last `npm run
build` — with no warning, because the page renders perfectly. This cost real
time this session: a sign-up fix was verified as *not working* three times
before the served `index.html` turned out to reference a hashed production
bundle. **`npm run build` first, every time.** Which is also the rule below.


**Read the built output, not the source.** Three separate things this session
read as correct and shipped the opposite. The CORS fix looked right and broke
every preview deploy. Lazy-loading the magnetic button looked right and still
shipped framer-motion on the critical path, because `manualChunks` had bundled
it with `animejs`, which is imported eagerly — the only symptom was one
`modulepreload` line in the built HTML. "Self-host the Google font" read as one
`<link>` and was actually four families across two CDNs. Each time the source
was persuasive and the artefact was the truth.

**Do not scale Render past one instance** without `RATE_LIMIT_STORE=postgres`.
The in-memory store is per-process, so every limit multiplies by the instance
count, and scaling is a dropdown — no deploy, no review, nothing that flags it.

**Do not add a second free Render service** while the keep-warm cron runs. The
free tier gives 750 instance-hours against a ~730-hour month. One service awake
continuously fits; two exhaust it mid-month, quietly.

---

## Reference

```bash
# Is Clerk production live?
curl -s -o /dev/null -w "%{http_code}\n" https://clerk.alop-ai.com/v1/environment

# Tests
cd backend  && node --test "lib/**/*.test.js"
cd frontend && npm test -- --run

# Regenerate the cascade baseline ONLY when a rendering change is intended,
# and say what moved in the commit message:
UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js
```

- **`node --test lib/`** fails on Node 26 with `MODULE_NOT_FOUND`. Use the
  quoted glob: `node --test "lib/**/*.test.js"`.

**Reading a cascade diff:** strip `[0-9]+` element indices from both sides
first. A raw diff that does NOT shrink when indices are stripped means
something structural moved rather than renumbered. That check has now caught
two real regressions — a stagger that silently deleted the app's only shimmer,
and a font change that would have stopped the guard covering the sign-in card.

**Docs worth reading before changing anything:** `docs/ROADMAP-2026-08-31.md`
(rewritten this session), `docs/DOMAIN-CUTOVER.md`, `docs/ADMIN-CONSOLE.md`,
`docs/FRONTEND.md` §1 (z-index) and §2 (the stylesheet manifest — its order is
asserted by a test *and* printed in the doc, so changing one means changing
both).

---

## Left to build — none of it blocks launch

1. **Watch the live council for a day.** `COUNCIL_TOOLS=1` has never been read
   against real traffic. Watch **unique calls vs members**: seven members
   producing seven unique calls every round means the dedupe is not earning its
   place. The `council` admin command reports this from the database now.
2. **Re-tune the whip deadlines.** 3500ms and 2500ms were reasoned, not
   measured. Needs `msToFirstByte` percentiles, which need real traffic.
3. **`run_code` sandbox.** Blocked on a vendor key that does not exist.
   `node:worker_threads` stays rejected — it shares the process, so the
   isolation boundary would be V8's rather than the OS's, and on the other side
   of it is a live Stripe secret key.
4. **Slice B and D were never specified.** Three specs reference them — always
   as "out of scope", never with a definition — so "do slice B" is not an
   instruction anyone can follow. The router work below is what "AI smartness"
   turned out to mean once someone read the code instead of the label; sign-in
   polish is largely spent, since that page was rewritten in `9646d47`. If more
   is wanted from either, they need a spec first.

5. **Give `server.js` the same treatment as the router.** It is ~1,400 lines and
   nothing tests it directly; `lib/` has 389 tests and `server.js` has none. Two
   security bugs and nine correctness bugs were found this session simply by
   moving pure decisions into `lib/` and calling them. The remaining candidates
   are `getSearchQuery`, `isMemoryOrReferenceQuestion` and the prompt-assembly
   in the council route. **This is now the highest-yield work left**, and the
   yield is measured, not assumed.

6. **`core.autocrlf` is on and there is no `.gitattributes`.** Every commit this
   session warned "LF will be replaced by CRLF". Nothing is broken yet, but the
   failure mode is a one-line edit surfacing as a whole-file diff, which hides
   the real change in review. Fixing it means one `.gitattributes` and one
   normalising commit that touches every file, so it wants to be its own commit
   on a quiet day — not bundled with anything.

---

## Closed since the last handoff — do not reopen

- **The domain.** Live, HTTPS valid, apex canonical.
- **CORS for the new domain.** Verified against the running backend: 204 for
  `alop-ai.com` and `www`, 204 for the old `.vercel.app` alias (rollback path
  intact), **403** for attacker origins.
- **The cmdk swap.** Attempted, rejected on evidence, dependency deleted
  (`64dccce`). `ui/command.jsx` was imported by nobody, and cmdk's input is
  `role="combobox"` where six tests use `getByRole("textbox")` — overriding
  that would have been an accessibility downgrade to adopt a library nothing
  used.
- **`SignInPage.css` outside the guards.** Folded into the manifest
  (`088386d`); it immediately surfaced six duplicates that had always existed
  and were never counted.
- **Duplicate CSS selectors.** Counted this session: **two** remain, both
  deliberate and documented in place (`:root` across two files, `*` twice in
  `base.css`). `DUPLICATE_BUDGET = 10` measures something else — that counter
  splits comma lists — and should not be driven to zero.
- **Google Fonts / Fontshare.** All self-hosted. Zero third-party font requests,
  confirmed in a browser.

---

## Not legal advice

The privacy policy and terms were written against the real data flows, which is
the part templates get wrong and the part that creates exposure. They have
**not** been reviewed by a lawyer. Before taking real money, have someone
qualified in the UAE read them — particularly the liability cap and the
governing-law clause.
