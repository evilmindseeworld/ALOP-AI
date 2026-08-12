# Claude Plugins survey for ALOP-AI

This is a repo-specific shortlist, checked against `C:\Users\LENOVO\.claude\settings.json`, the installed-plugin cache, the current `handoff.md`, and the official marketplace. The marketplace is not a shopping list. The owner already rejected the “one idea each from 100 repos” approach: this codebase is too opinionated for that kind of slop injection.

## Worth installing

1. **[hookify](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/hookify)** — highest practical value. A project-local file hook could block edits outside `docs/plugin-survey.md` and `docs/design-proposal-luna.md` during a split session like this one; a stop hook could require the two test commands from `AGENTS.md`. That directly prevents the shared-tree corruption and “claim done without tests” failure modes. Cost: Python/regex hooks, project-local rule files, and false positives; shell commands remain outside its file-event guard.

2. **[claude-security](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-security)** — use for a clean, scoped scan of the backend boundary, especially the service-role tenant checks, Clerk `azp`/middleware path, cache invalidation race, and the CSP rules recorded in `AGENTS.md`. Its independent verification is a better fit than another generic review for the four abort/state races fixed in `2306cf8`. Cost: a long multi-agent run, Python, nondeterministic findings, and timestamped `CLAUDE-SECURITY-*` artifacts in the repo; never run it while Claude is editing a shared tree.

3. **[session-report](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/session-report)** — it reads local Claude transcripts for cache breaks, expensive prompts, subagent and skill usage. It would have sped the p50/p90 investigation in `handoff.md` (1.71s versus 71.42s) and shown whether review prompts were spending tokens without improving coverage. It is not application telemetry and cannot prove why an ALOP turn aborted; it is evidence for where the investigation budget goes. Cost: local transcript parsing and an HTML report in the working directory; keep the report out of concurrent worktrees.

4. **[receipts](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/receipts)** — useful during the next dated handoff refresh. The previous handoff stayed stale across three commits; a local report of projects, sessions, files, commits and PRs would make the “what shipped” section harder to rewrite from memory. Cost: it measures Claude Code activity, not product correctness or test quality, and writes two personal report files in the home directory. It deliberately does not invent dollars or hours saved.

## Already installed and under-used

- **`code-review` and `pr-review-toolkit`** are enabled, but installation is not a review. The missing trigger is an explicit review brief naming the state invariant: trace `resolved`, abort, late fulfilment and late rejection at every layer. That is the wording that found the four races; “does abort fire?” did not.
- **`claude-md-management`** is enabled, but there is no post-commit handoff audit. Trigger it whenever `AGENTS.md`, `CLAUDE.md`, or `handoff.md` describes a changed commit; it should have caught the stale bullet that survived three commits.
- **`playwright`** is enabled, but the signed-in browser pass is still open in `handoff.md`. Trigger it with a real session and a checklist for keyboard-only core flow, 320px reflow, both themes, and focus ownership. The gallery screenshots do not cover authenticated shell behavior.
- **`claude-code-setup`** is enabled, but it needs an explicit “inventory this repo’s automation and test runners” request. That would surface the `node:test` versus Vitest split before someone runs `npx vitest` in `backend/` and misreads 44 “No test suite found” messages.

## Explicitly not worth it for this repo

- **The LSP servers** (`typescript-lsp`, `pyright-lsp`, `gopls-lsp`, and friends) add background diagnostics for languages this checkout does not use as its primary surface. React/Node JavaScript, Vite, and `node:test` already have targeted build/test gates; the LSP fleet is noise and setup cost, not a fix for the real runtime races.
- **The third-party SaaS integrations** (Airtable, Asana, HubSpot, Stripe-adjacent CRM tools, and the rest of `external_plugins/`) have no product task here. They add OAuth, credentials and network boundaries while the app already has search, Firecrawl and Perplexity coverage. More tools also buy roughly 1,500 prompt tokens per council seat per turn.
- **`code-modernization`** is for legacy COBOL/Java/.NET/monolith migrations. A living React/Vite plus Express/Supabase app needs bounded refactors and tests, not `analysis/` and `modernized/` artifact trees.
- **`mcp-server-dev` and `plugin-dev`** are meta-tools for publishing an MCP server or Claude plugin. ALOP consumes tools through its registry; it is not currently shipping a plugin or MCP server. Install them only when that boundary is an actual deliverable.
- **`project-artifact` and `playground`** duplicate things already in this repo: dated Markdown handoffs and `frontend/gallery.html`. Publishing another status page or visual explorer would add maintenance, not product value.
