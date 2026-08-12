# Hookify setup

## Installed

Installed `hookify@claude-plugins-official` at user scope with:

```text
claude plugin install hookify@claude-plugins-official --scope user
```

Plugin files: `C:\Users\LENOVO\.claude\plugins\cache\claude-plugins-official\hookify\unknown`

The user setting `hookify@claude-plugins-official: true` is in
`C:\Users\LENOVO\.claude\settings.json`.

I read the official README and rule-writing skill before installation:
[hookify README](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/hookify).
The plugin uses Python 3.7+ stdlib hooks and reads project rules dynamically
from `.claude/hookify.*.local.md`.

## Rules

### `block-outside-declared-boundary`

File PreToolUse blocker. The declared boundary for this split dispatch is
`.claude/**` plus `docs/hookify-setup.md`; every other project path is denied.
This names the real shared-tree incident: Claude edited `backend/server.js`
while another agent owned the tree and wrote docs. It also blocks the current
concurrent `frontend/src/**` tree. This rule is intentionally dispatch-scoped:
disable or edit its declared paths before ordinary product-code work.

### `block-unverified-cascade-baseline`

Bash PreToolUse blocker. It blocks `UPDATE_CASCADE_BASELINE=1` unless the same
command contains `npm run build &&`. This names the real incident where a
broken App.css was used to regenerate `cascade.baseline.txt`.
Hookify cannot run PostCSS or remember a previous result, so shell `&&` is the
actual narrow gate supplied here.

### `require-backend-node-test` and `require-frontend-vitest-run`

Stop blockers. They require the exact transcript strings `cd backend && npm
test` and `cd frontend && npx vitest run`. This names the real green-suite
failure: backend Vitest reported 44 “No test suite found” files while the
frontend suite passed despite the broken build. The backend rule explicitly
requires Node's `npm test` gate.

## Evidence: each rule fired

I invoked the installed `pretooluse.py` and `stop.py` with Claude hook JSON
payloads from the repository root. These are the actual stdout results.

Boundary, `Edit` of `backend/server.js`:

```text
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny"}, "systemMessage": "**[block-outside-declared-boundary]**\n**Declared write boundary violation.**\n\nThis split dispatch permits writes only under `.claude/**` and to\n`docs/hookify-setup.md`. The shared-tree incident being guarded was an\nunplanned edit to `backend/server.js` while another agent owned the tree.\nChange the dispatch boundary explicitly before editing another path."}
```

Baseline, Bash command without the build:

```text
{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny"}, "systemMessage": "**[block-unverified-cascade-baseline]**\n**Cascade baseline update blocked until the stylesheet build passes.**\n\nThe real incident used `UPDATE_CASCADE_BASELINE=1` against a broken App.css\nand committed the resulting selector fragments. Run the build and the baseline\nupdate in one `&&` chain so the update cannot run after a failed parse."}
```

Stop with no gates:

```text
{"decision": "block", "reason": "**[require-backend-node-test]**\n**Backend gate not detected.**\n\nThe repository gate is Node's test runner, not Vitest in `backend/`. Run\n`cd backend && npm test` before stopping.\n\n**[require-frontend-vitest-run]**\n**Frontend gate not detected.**\n\nThe repository gate is `npx vitest run` from `frontend/`. Run\n`cd frontend && npx vitest run` before stopping.", "systemMessage": "**[require-backend-node-test]**\n**Backend gate not detected.**\n\nThe repository gate is Node's test runner, not Vitest in `backend/`. Run\n`cd backend && npm test` before stopping.\n\n**[require-frontend-vitest-run]**\n**Frontend gate not detected.**\n\nThe repository gate is `npx vitest run` from `frontend/`. Run\n`cd frontend && npx vitest run` before stopping."}
```

## Evidence: legitimate work stays quiet

The same installed hook returned `{}` for an `Edit` of the absolute and
relative `docs/hookify-setup.md` paths and for a `Write` under `.claude/`.
It returned `{}` for:

```text
cd frontend && npm run build && UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js
```

It also returned `{}` for a Stop payload whose transcript contained both exact
gate commands. No allowed operation was blocked in this matrix.

## Cannot see

The file rule sees only Claude Code `Edit`, `Write`, and `MultiEdit` events. It
cannot see shell redirection, scripts, or file changes made by a Bash,
PowerShell, Codex, or another process. The Bash rule sees only Claude Code's
Bash tool payload and matches text; it does not inspect CSS, run the build, or
verify exit codes. The Stop rules match transcript text, not successful test
results, so they are completion gates rather than proof of correctness.

## Owner must run

After restarting Claude Code so the user-scoped plugin is loaded, from the
repository root run `/hookify:list` and confirm the four rules are enabled.
The repository gates remain:

```bash
cd backend && npm test
cd frontend && npx vitest run
```

To regenerate the CSS baseline, use the guarded single command:

```bash
cd frontend && npm run build && UPDATE_CASCADE_BASELINE=1 npx vitest run src/__tests__/cssSnapshot.test.js
```
