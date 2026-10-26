# Ledgerleave — closeout (DRAFT, 2026-10-26, written at the Phase 3 gate)

The PRD names three phases and an optional experiment (O-8, an LLM policy explainer scored against the goldens), not a Phase 4, so the Phase 3 gate ends with this draft instead of a Phase 4 task list. Everything below is on branch `kickoff` (PR #1), never merged by the agent. Synthetic data only; the numbers measure agreement between a TypeScript implementation and a Python reference written by the same author (D-24), not whether any policy suits a real company.

## What shipped

| Phase | What | Proof (numbers in `docs/EVAL.md`) |
|---|---|---|
| 1 | Two pure engines: accrual (tiers, proration, caps, three policy-year kinds, retroactive forfeiture recompute) and routing (R1–R9 + R7′, frozen chain, void approvals); the request state machine | `leave:eval` 0 diffs on 5057 ledger entries, 198 employee-years, 389 requests; GA-01..GA-20, GR-01..GR-17; `engine:lint` 0 hits |
| 2 | 16 clone tables, append-only triggers, one replay path for history and live writes, outbox (never sent) | the same three files rebuilt from rows: 0 diffs; second replay inserts 0; 759 notices queued, 0 sent |
| Decisions pass | D-42..D-47: account↔employee link, org time zone with one converter, R7′, `OVERLAPPING_REQUEST`, billing removed, archive instead of delete | expected files regenerated, 0 bytes moved; every Phase 1/2 proof re-run, 0 diffs |
| 3 | My leave + preview, inbox, request page, HR console, ledger view, nightly close, `/orgs` | INV harness 0 findings over 10 actions; HR table = `expected_balances.csv` (198 rows); GR-15 walked in a browser; axe 0 violations in light and dark on 8 page states; 408 tests |

## Out of scope (seams only, as the PRD and decisions say)

Half days (O-5) · projected accruals at submit (O-1) · pending requests reserving balance (O-2) · delegator approval (O-3) · restoring cancelled minutes into a new year (O-4) · payout at termination (O-7) · a board step for the CEO (O-9) · blackout rules · payroll, calendar sync, email sending · policy editing in the UI (a new `PolicySet` row is the seam) · multi-location holidays · deploy (none planned; Neon/Vercel only if ever).

## Open for the owner

- **O-14** — the `DELEGATION_DEPTH_EXCEEDED` fallback can still land on the delegating approver (count in the fixtures: 0). Extending D-44 to it is one line per engine plus a golden.
- The template's `/onboarding` list still shows archived orgs (template-owned page); the clone's `/orgs` hides them and the org nav points there.

## By hand (cannot be done from the cloud session)

1. Review PR #1 and merge when satisfied. Delete the throwaway branch `proof/cap-2401` (remote deletes are refused through the proxy).
2. On the Mac: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --shadow-database-url …` (the schema engine is unreachable here; the migrations are hand-written and exercised by every DB test).
3. `~/.claude/CLAUDE.md` port table: ledgerleave → 7300.
4. Re-run `~/Projects/reuse-scan.py` (D-29).
5. Build-log card #14: status, and chips such as `0 diffs vs Python oracle (5057 entries, 389 requests)`, `GR-15 walked in a browser, axe light+dark`.
6. Decide O-14 and whether O-8 (the LLM explainer experiment) is worth a phase.
