# Moving to the custom domain

Four systems have to agree: Vercel, Clerk, Render and Stripe. **The order below
is chosen so that nothing is ever briefly broken** — every step leaves the app
working on the old domain until the last one.

Read the whole thing before starting. The riskiest step is #5, and it is
riskiest because its failure is silent on the server.

Throughout, `alop.com` stands in for whatever you buy.

---

## The failure you are avoiding

Moving Clerk to a production instance while the API still only accepts the
`.vercel.app` origin gives you an app that **loads fine and cannot do anything**.
Every request fails CORS in the browser.

Nothing in Render's logs looks wrong, because refusing a disallowed origin *is*
the server working correctly. You would be debugging the frontend for an hour.

The console command in step 8 answers this in one call.

---

## 1. Buy it, and point it at Vercel

Registrar → Vercel project → **Settings → Domains → Add**. Add both `alop.com`
and `www.alop.com`; pick one as primary and let Vercel redirect the other.

Vercel gives you the records. Wait for it to show **Valid Configuration** before
going further — everything after this depends on DNS resolving.

## 2. Do NOT change any env vars yet

The app is still live on `alop-ai-omega.vercel.app` and should stay that way
until Clerk is ready. Once DNS is valid, `alop.com` serves the same deployment
with the same dev Clerk instance, which is fine and temporary.

## 3. Create the Clerk production instance

Clerk dashboard → the environment switcher → **Create production instance**.

Clerk will ask for the domain and give you **CNAME records** (`clerk`,
`accounts`, plus DKIM/mail records). Add them at your registrar alongside the
Vercel ones. Wait for Clerk to verify.

**Users do not migrate between instances.** Everyone re-registers. That is the
reason to do this now rather than later.

Configure on the production instance before switching: the sign-in methods you
want (Google is enabled today), and the allowed redirect origins —
`https://alop.com` and `https://www.alop.com`.

## 4. Update Vercel's environment

| Variable | New value |
|---|---|
| `VITE_API_BASE` | unchanged — `https://alop-ai.onrender.com` |
| `CLERK_PUBLISHABLE_KEY` (or `VITE_CLERK_PUBLISHABLE_KEY`) | the `pk_live_…` key |

**Redeploy.** Vite bakes env vars into the bundle at build time — changing the
variable without a redeploy changes nothing at all.

## 5. Update Render's environment — ALL THREE TOGETHER

This is the step that breaks things if done piecemeal.

```
FRONTEND_URL=https://alop.com
ALLOWED_ORIGINS=https://www.alop.com,https://alop-ai-omega.vercel.app
CLERK_SECRET_KEY=sk_live_…
```

Keep the `.vercel.app` alias in `ALLOWED_ORIGINS` for now. It costs nothing and
it means a rollback is one Vercel setting rather than another Render deploy.

`FRONTEND_URL` is also used for Stripe's success and cancel URLs, so it has to
be the domain you actually want people returned to.

Render redeploys on an env change and takes **over five minutes**. Do not
conclude anything before ten.

## 6. Re-point Stripe

Stripe dashboard → **Developers → Webhooks** → the endpoint pointing at
`alop-ai.onrender.com`. The API host has not changed, so the endpoint URL is
fine — but confirm the signing secret in Render still matches, and that the
events you rely on are still subscribed:

- `checkout.session.completed`
- `invoice.paid`
- `customer.subscription.deleted`
- `customer.subscription.updated`

If you are also moving Stripe from test mode to live, the price IDs change:
update `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY` in Render, or
`/api/billing/prices` returns 503 and the upgrade path hides itself.

## 7. Update the desktop app

`~/Documents/alop-desktop/src-tauri/src/main.rs` — one constant:

```rust
const APP_URL: &str = "https://alop.com";
```

It is one constant precisely so this is a one-line change. Rebuild when Smart
App Control is sorted out.

## 8. Verify — do not assume

```bash
curl -s -X POST https://alop-ai.onrender.com/api/admin/console \
  -H "Authorization: Bearer $CLERK_TOKEN" \
  -H "x-terminal-secret: $TERMINAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"command":"origins"}'
```

You want:

```json
{
  "FRONTEND_URL": "https://alop.com",
  "acceptedOrigins": ["https://alop.com", "https://www.alop.com", "https://alop-ai-omega.vercel.app"],
  "clerkInstance": "PRODUCTION",
  "warning": null
}
```

A non-null `warning` names the mismatch outright.

Then the direct checks:

```bash
# the new origin is accepted, an attacker's is not
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://alop.com"            https://alop-ai.onrender.com/health   # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://alop.com.evil.test"  https://alop-ai.onrender.com/health   # 403
```

And in a browser on `https://alop.com`: sign in, send one message, attach a
file, open the upgrade panel. Those four cover Clerk, the council, the upload
path and Stripe.

## 9. Afterwards

- Remove `alop-ai-omega.vercel.app` from `ALLOWED_ORIGINS` once you are
  confident. Every origin on that list is a valid way to reach the API.
- The Clerk **development** instance still exists and still works. Delete it, or
  someone finds the old URL and signs into a parallel universe with its own
  users.
- Rotate `TERMINAL_SECRET` if it has ever been in a shell history you do not
  control.

---

## Rollback

At any point before step 5, nothing has changed for users.

After step 5: set `FRONTEND_URL` back to the `.vercel.app` alias and restore the
`pk_test_`/`sk_test_` keys in Vercel and Render. Because the alias stayed in
`ALLOWED_ORIGINS`, the API keeps accepting it throughout — that is the entire
reason it is still on the list.
