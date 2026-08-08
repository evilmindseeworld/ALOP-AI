# ALOP-AI

**Read `AGENTS.md` in this directory first.** It holds the project's working
notes — layout, traps, the untrusted-content rule, how migrations get applied,
and how Claude and Codex pair.

It is a single file on purpose. Codex loads `AGENTS.md` natively; this file
points there so the two of us cannot end up working from different facts.
Anything durable you learn about this project goes in `AGENTS.md`, not here.

## Response style

Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.
