# Chat creation failure, 2026-08-12

Owner report: after signing in, the first message showed `Failed to create chat`.
That toast is emitted when `POST /api/chats` fails.

## What the public production checks established

At 2026-08-12 18:38 UTC:

- `GET https://alop-ai.onrender.com/health` returned 200 with `{"status":"ok"}`. An active backend deployment was running. Because `/health` does not report a commit or configuration, this does not prove that the OpenRouter migration deployment succeeded; Render can keep the prior deployment live after a failed deploy.
- An unauthenticated `GET /api/chats` returned 401 `Authentication required`. This rules out the missing-`CLERK_PUBLISHABLE_KEY` boot mode, which returns 500 for authenticated routes.
- CORS preflights for `https://alop-ai.com` and `https://alop-ai-omega.vercel.app` both returned 204 with the requesting origin in `Access-Control-Allow-Origin`.

These public checks cannot exercise the authenticated insert. No signed-in browser session or Render dashboard access was available, so the incident's cause is not proven. The remaining high-value evidence is the failed authenticated `POST /api/chats` status and response body, or the matching Render request/error log. That distinguishes authentication, `ensureUser()`, and Supabase chat insertion failures directly.

## Deployment environment check

The current backend requires `OPENROUTER_API_KEY` at boot. Set `OPENROUTER_API_KEY` in the Render backend service's environment, then confirm the deployment containing commit `09cee07` or later is marked live and its boot log has no `Missing required env vars` message. A successful `/health` response from that confirmed deployment proves the required-variable gate passed; an unversioned health response by itself does not.

The frontend now logs chat-creation failures with the HTTP status and response body while retaining the short user-facing toast.
