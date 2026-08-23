# ALOP Frontend Redesign Release Report

**Release date:** 2026-08-24 (local release pass)
**Product:** ALOP-AI
**Repository:** `evilmindseeworld/ALOP-AI`
**Release state at first issue:** LOCAL COMPLETE; deployment pending
**Sol accounting:** `SOL_HIGH_CALLS = 2`

## 1. Release Commit

The candidate is on `fix/synthesis-degrades-to-council-draft`, three commits ahead of `origin/main`, with PR #7 open and unmerged. `HEAD` is `a8da6fd194c1e371c0e6973fe65abdb60949bf4c`. The redesign, safe provenance, and release checkpoint are still dirty in the shared worktree at this stage. The release commit will be created only from the explicitly reviewed source, test, and release-document files; local screenshots, `.playwright-mcp/`, and `reel-reference-pack/` remain unstaged user artifacts.

## 2. Production State Before Release

Vercel project `alop-ai` production is `dpl_zPesoUGpZvN7Kx91SCTu9hfMFmfL`, serving `main` at `0461c191eb6ce102c1b3cf54cff89185afb44fe8`, READY, with aliases `https://alop-ai.com`, `https://www.alop-ai.com`, and the Vercel aliases. Render service `ALOP-AI` is live at `https://alop-ai.onrender.com`, deploy `dep-da346u2jnfac73bm3k1g`, serving `d8e47a68587af3db199407e995d2e5e3ff9019df` from `main`.

The live platform configuration does not exactly match the repository blueprint: Render reports Singapore, no configured health-check path, and `npm install`, while `render.yaml` describes Frankfurt, `/health`, and `npm ci --omit=dev`. Vercel reports Node 24.x while repository CI uses Node 26. These are recorded deployment-drift findings, not silently changed during a source release.

## 3. Migration Inventory

The repository contains migration files `000_base_schema_lineage.sql` through `030_publishing_ledger.sql` (31 files). Supabase production reports the later tracked entries through `029_workspace_files`; it does not list the older 019/026 names in the migration ledger. Direct schema inspection is therefore authoritative.

| Migration | Purpose / release relevance | Production evidence | Action and risk |
|---|---|---|---|
| 000–003 | Baseline memory, RLS/webhook ledger, chat files | Core tables and constraints exist | No action; reapplying baseline is unrelated to this release. |
| 004–018 | Rate limits, search/cache, audit, facts, spend, cache provenance | Corresponding live tables/functions/columns are present where current code depends on them | No action; migration-lineage drift is a separate maintenance item. |
| 019_turn_ledger.sql | `turns`, `turn_reservations`, checkpoint/reservation functions; required by current turn runtime | `turns` has `meta jsonb`; `turn_reservations` exists; `checkpoint_turn`, `claim_turn_reservation`, and `settle_turn_reservation` exist | No action. Shape is compatible; duplicate application is unnecessary. |
| 020–025 | Cache provenance, memory tiers, jobs, function search paths, request-budget lineage | Production migration/schema probes show the current runtime objects | No action for frontend redesign. |
| 026_stripe_event_state.sql | Stripe event status/attempt/error state | `stripe_events` has `status`, `attempts`, `last_error`, and `stripe_events_unfinished` | No action. Existing live state is compatible; do not backfill or mutate billing rows. |
| 027–029 | Stripe timestamp, chat-file objects, workspace files | Supabase migration list includes all three; tables/columns are present | Already applied; no new action. |
| 030 | Publishing ledger | `publishing_ledger` and its live rows exist | Unrelated to this release; no action. |

The redesign introduces no new SQL migration. It uses the existing tenant-owned `turns.meta` JSONB namespace.

## 4. Migration Actions

`MIGRATION READY` is satisfied by direct production schema readback. `MIGRATION APPLIED` is not claimed because no migration was needed or run. No destructive, billing, RLS, or mass-row operation was performed. The production `turns` table contains 101 rows; no rows were changed by this release pass.

## 5. Backend Deployment

No candidate backend deployment has occurred at the time of this initial report. The intended backend deployment is the exact release commit through the existing Render-connected `main` flow. The current live baseline remains `d8e47a6`; deployment will be accepted only after Render reports the release SHA and `/health` returns it.

## 6. Frontend Deployment

No candidate frontend deployment has occurred at the time of this initial report. The intended frontend deployment is the same release state through the Vercel-connected `main` flow. The current live baseline remains `0461c19`; the redesign preview is not production evidence.

## 7. Production Health

Before release, `https://alop-ai.onrender.com/health` returned HTTP 200 with `status: ok`, one instance, `limitsMultiplied: false`, and `rateLimitStore: postgres`. `https://alop-ai.com/` returned HTTP 200 with Vercel security headers and the configured CSP. The API allowed `https://alop-ai.com` and the retained Vercel alias, and rejected `https://alop-ai.com.evil.test` with HTTP 403.

## 8. Authenticated Chat Verification

Authenticated production chat, streaming, and Clerk state have not yet been verified against the candidate. No credential, MFA, or user-presence action was attempted. Local component and unit coverage is green; this section remains open until the deployed candidate can be exercised safely.

## 9. Council Stage Verification

The candidate preserves truthful keyed `context`, `council`, and `synthesis` frames, including stage text and bounded counts, when the backend route emits them. The live pre-release backend has not yet been exercised through an authenticated candidate turn, so production ordering and route coverage remain pending. The implementation does not manufacture missing phases.

## 10. Completion / Seal Verification

Local semantic tests cover synthesis completion, partial participation, one-seat/no-synthesis, fallback, abort, timeout, refusal, and failure. The completion mark is process completion, not correctness or unanimity. Production route triggering is pending; hard-to-trigger failure routes will be marked `NOT LIVE-TRIGGERED` rather than forced destructively.

## 11. Provenance Readback

The safe record is versioned and bounded under `turns.meta`, tenant-scoped through the owned turn lookup, and hydrated by message/turn identity. It excludes chain-of-thought, hidden prompts, raw provider responses, scratchpads, and unrestricted tool payloads. Old chats without the namespace remain valid. Production currently has zero turns with `meta.provenance`, so candidate write/read/reload verification is pending deployment.

## 12. Sources Verification

The candidate renders a structured source receipt only when safe structured source metadata exists, uses progressive disclosure, preserves meaningful Markdown prose, and removes only an exact duplicate trailing bibliography whose URLs match the structured receipt. Production source-present, source-absent, duplicate, mismatched, reload, and mobile checks are pending an authenticated candidate turn.

## 13. Source Security Verification

The Sol #2 High finding was fixed locally in both the backend provenance serializer and frontend receipt sanitizer. Independent local checks cover public HTTPS, non-URL/malformed input, localhost, loopback, private IPv4/IPv6, link-local, metadata/special-use destinations, and duplicate/unbounded records. Backend provenance security is 4/4; the focused MessageList suite is 43/43. Both layers fail safe; live source verification remains pending deployment.

## 14. Old Chat Compatibility

Production `chats.messages` remains the existing transcript schema, and old messages without provenance are intentionally supported. The candidate does not require rewriting existing chats. A live reload/read of an old conversation is pending authenticated production access.

## 15. Mobile Verification

Local real-component evidence covers 390, 430, 768, and 1440 CSS-pixel widths with no horizontal overflow; the mobile starter grid remains reachable above the composer, long stage copy wraps, and source disclosure is touch/keyboard accessible. Production 360/390/430/768 checks are pending. Physical-device behavior is not claimed.

## 16. Accessibility

The local baseline is 6 automated accessibility tests, 75 contrast checks, 5 reduced-motion checks, plus component tests for live status, disclosure operation, links, focus, and completion semantics. Production DOM semantics can be checked after deploy. Live screen-reader speech is unverified.

## 17. Performance

The local production build passes: 3,896 modules; CSS 109.02 kB / 19.75 kB gzip; latest MessageList chunk 13.65 kB / 5.39 kB gzip. Controlled process geometry measured 0px answer-top movement and CLS 0.000142 desktop / 0 mobile. Local signed-out traces measured desktop LCP 826ms / CLS 0.04 and mobile LCP 750ms / CLS 0.21; the mobile shift cluster is development auth/font-shell evidence only. Actual production desktop/mobile traces remain pending.

## 18. Security

Local backend is 2,120/2,120, frontend is 734/734, server syntax check passes, and `git diff --check` passes. Production CSP, frame, referrer, nosniff, and origin restrictions were read back before release. No security weakening, secret handling, tenant-policy change, or billing mutation was performed.

## 19. Known Limitations

Final Opus browser red-team availability remains unresolved and no verdict is invented. Render/Vercel configuration drift is documented. Authenticated production QA, production provenance/source readback, production performance, physical-device behavior, and live screen-reader speech remain open. The migration ledger’s historical incompleteness is known; the live schema, not the ledger alone, was used for the release decision.

## 20. Rollback Plan

Before candidate deployment, the rollback references are Vercel production deploy `dpl_zPesoUGpZvN7Kx91SCTu9hfMFmfL` / SHA `0461c19` and Render deploy `dep-da346u2jnfac73bm3k1g` / SHA `d8e47a6`. Application rollback is preferred; no database rollback is required because no migration is applied. The source release is expected to be forward-compatible with existing `turns.meta` and old chat messages.

## 21. Remaining Follow-Ups

Complete the normal release flow: create the clean candidate commit, push/merge through the existing main flow, verify exact backend/frontend SHAs, run authenticated chat and reload QA, test live stage/source/completion semantics, measure production performance, and update this report/checkpoint with final status. Separately reconcile Render’s dashboard configuration with `render.yaml` after confirming the desired region/Node/build policy; this is not silently changed during the redesign release.

## 22. Final Release Verdict

Current verdict: **LOCAL COMPLETE / MIGRATION READY / NOT DEPLOYED / PRODUCTION VERIFICATION PENDING**. The candidate has no known local Blocker or High release defect. It is not yet valid to call it `BACKEND DEPLOYED`, `FRONTEND DEPLOYED`, or `PRODUCTION VERIFIED`. Final success requires the live gates listed above, with `SOL_HIGH_CALLS` remaining exactly 2.
