# Moving the backend to Mumbai

Status as of 2026-08-09: **prepared, not executed.** Every file the migration
needs is committed. The steps that create the host, carry the secrets and cut
DNS need an interactive login and are yours — `flyctl` is installed at
`~/.fly/bin/flyctl.exe` and has no token.

## Why, in one measurement

Taken from the user's machine in Dubai, TCP connect to AWS regional endpoints:

| Region | RTT |
|---|---|
| **Mumbai (ap-south-1)** | **43ms** |
| Frankfurt | 134ms |
| Singapore | 173ms |
| Virginia | 262ms |
| Oregon | 271ms |

Supabase is `ap-south-1`. Vercel serves the frontend from `bom1`. The backend
was the only tier outside Mumbai — and it sits *between* the other two, so it
paid that distance on every database round-trip.

**The database leg is what decides this, not the user leg.** A turn makes
roughly five SEQUENTIAL database round-trips but only one user connection, and
the council fans out concurrently so seven model calls cost one round-trip of
network. Latency multiplies by sequential hops. Co-locating with Postgres beats
sitting next to either the user or the model gateway.

Two things this is NOT: it is not a cost decision, and it is not a complaint
about Render. Render sells no region near the UAE. That is the whole reason.

**Fly `bom` over AWS `ap-south-1` ECS.** Fly's Mumbai is a different building
from AWS's, so the database hop lands around 2–8ms instead of the ~1ms an ECS
task in ap-south-1 itself would see. A few milliseconds against a turn measured
in seconds, for a container platform's worth of operations. Not worth it at two
users. Revisit if the database ever becomes the measured bottleneck.

## What is already done

- `backend/Dockerfile` — node:22-slim, `npm ci --omit=dev`, non-root, dumb-init
  so Fly's drain signal does not kill live SSE streams mid-answer.
- `backend/.dockerignore` — `.env` first, so the service-role key cannot be
  baked into an image layer.
- `backend/fly.toml` — `primary_region = "bom"`, no scale-to-zero, `/health`
  check, 512MB.
- `frontend/vercel.json` — CSP `connect-src` now allows **both** the fly.dev
  and onrender.com origins, so there is no window where the frontend cannot
  reach a backend. Remove the Render entry at step 8, not before.
- `.github/workflows/keep-warm.yml` — points at the new host, and carries a
  note that it should probably be deleted (see step 7).
- `backend/scripts/verify-migration.sh` — measures both hosts side by side.

No application code changed. Same `server.js`, same routes, same council, same
`.env` variable names.

## What you have to run

**1. Log in and create the app.**

```bash
export PATH="$HOME/.fly/bin:$PATH"
flyctl auth login
cd backend
flyctl launch --no-deploy --copy-config --name alop-ai-backend --region bom
```

`--copy-config` uses the committed `fly.toml`. If the name is taken, pick
another and update it in **three** places: `fly.toml`, `vercel.json`'s CSP, and
`keep-warm.yml`.

**2. Carry the secrets.** Read them from the Render dashboard. Do not paste
them into a file in the repo, and do not paste them into a chat window.

```bash
flyctl secrets set \
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  CLERK_SECRET_KEY=... CLERK_PUBLISHABLE_KEY=... \
  FRONTEND_URL=https://alop-ai.com ALLOWED_ORIGINS=... ALLOWED_ORIGIN_SUFFIXES=... \
  OPENROUTER_HOST=... OPENROUTER_API_KEY=... \
  STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... \
  STRIPE_PRICE_MONTHLY=... STRIPE_PRICE_YEARLY=... \
  SENTRY_DSN=... \
  GOOGLE_API_KEY=... BRAVE_API_KEY=... TAVILY_API_KEY=... JINA_API_KEY=... \
  GOOGLE_SEARCH_API_KEY=... GOOGLE_CSE_ID=... \
  PERPLEXITY_API_KEY=... SERPER_API_KEY=... SERPAPI_API_KEY=... FIRECRAWL_API_KEY=...
```

`server.js` exits at import time if any of `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `FRONTEND_URL`, or
`OPENROUTER_API_KEY` is missing — so a forgotten secret is a boot crash in the
logs, not a subtle bug. `OPENROUTER_HOST` is defaulted to the public endpoint.
That is the good case.

`FRONTEND_URL` and `ALLOWED_ORIGINS` must keep their CURRENT values. Clerk's
`authorizedParties` is derived from them, and the frontend origin is not moving.
Changing them here is how you get a mystery 401.

**3. Deploy.**

```bash
flyctl deploy --remote-only
```

`--remote-only` builds on Fly's builders. Docker Desktop is not installed here
and does not need to be.

**4. Verify before anything is pointed at it.**

```bash
flyctl status                       # confirm the machine is in bom
curl https://alop-ai-backend.fly.dev/health
bash scripts/verify-migration.sh
```

`/health` TTFB should land near the 43ms Mumbai reference the script prints. If
it does not, the machine is in the wrong region — check `flyctl status` before
blaming the network.

**5. Re-point Stripe. This one is easy to forget and fails silently.**

The webhook endpoint in the Stripe dashboard points at the Render URL. Billing
keeps working right up until a subscription event fires into a dead host. Add
the new endpoint, confirm the signing secret matches `STRIPE_WEBHOOK_SECRET`,
and send a test event before removing the old one.

**6. Point the frontend at it.** In Vercel, set `VITE_API_BASE` to
`https://alop-ai-backend.fly.dev` and redeploy. The CSP already allows it.
Confirm in a browser that a real chat turn streams end to end — sign-in, send,
tokens arriving, sources rendered.

**7. Retire the keep-warm cron.** It exists because Render's free tier spun
down. `auto_stop_machines = false` means there is no idle window left to warm.
It has a recorded history of false reds (GitHub drops scheduled ticks; the
concurrency group cancels merely-QUEUED runs). Keep it only if you will read its
failures as monitoring; otherwise delete the workflow.

**8. Only then, shut Render down.** Leave it running for a day or two after
cutover. Then delete the Render service, and remove `https://alop-ai.onrender.com`
from the CSP `connect-src` in `frontend/vercel.json`.

## What was deliberately left alone

Supabase and Vercel do not move. Supabase is already in the right region and
Vercel is already on the right edge.

**The theoretically optimal layout is different and was not chosen.** Backend
*and* database both in a UAE region (`me-central-1`) would give ~5ms to the user
and ~1ms to the database. That means moving Supabase, which the brief ruled out
— correctly, since it is a live database with real chats in it and the remaining
win over Mumbai is small.
