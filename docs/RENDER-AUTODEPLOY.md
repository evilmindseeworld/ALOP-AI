# Render auto-deploy

Deployment facts for the backend service, recorded so "is auto-deploy wired?"
is answerable from the repository instead of from a dashboard.

- Service id: `srv-d9btrf61a83c73f1f7o0`
- Deployment branch: `main`
- Root directory: `backend`
- Source: connected through the **Render GitHub App** (not a public Git URL).
  A public-URL connection receives no push events, so `autoDeploy` is inert
  under it — that was the state until 2026-08-20, and every deploy before then
  was `manual` or `deploy_hook`.
- Auto-deploy: expected on every commit to `main`
  (`autoDeploy: yes`, `autoDeployTrigger: commit`).

## Verifying

    render deploys list srv-d9btrf61a83c73f1f7o0 --confirm -o json

The newest entry must carry the merge SHA and an automatic `trigger` — not
`manual`. Then `/health` must return that same `commit`.
