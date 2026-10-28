# Ledgerleave — closeout (DRAFT, 2026-10-26, written at the Phase 3 gate)

The PRD names three phases and an optional experiment (O-8, an LLM policy explainer scored against the goldens), not a Phase 4, so the Phase 3 gate ends with this draft instead of a Phase 4 task list. Everything below is on branch `kickoff` (PR #1), never merged by the agent. Synthetic data only; the numbers measure agreement between a TypeScript implementation and a Python reference written by the same author (D-24), not whether any policy suits a real company.

## What shipped

| Phase | What | Proof (numbers in `docs/EVAL.md`) |
|---|---|---|
| 1 | Two pure engines: accrual (tiers, proration, caps, three policy-year kinds, retroactive forfeiture recompute) and routing (R1–R9 + R7′, frozen chain, void approvals); the request state machine | `leave:eval` 0 diffs on 5057 ledger entries, 198 employee-years, 389 requests; GA-01..GA-20, GR-01..GR-18; `engine:lint` 0 hits |
| 2 | 16 clone tables, append-only triggers, one replay path for history and live writes, outbox (never sent) | the same three files rebuilt from rows: 0 diffs; second replay inserts 0; 759 notices queued, 0 sent |
| Decisions pass | D-42..D-47: account↔employee link, org time zone with one converter, R7′, `OVERLAPPING_REQUEST`, billing removed, archive instead of delete | expected files regenerated, 0 bytes moved; every Phase 1/2 proof re-run, 0 diffs |
| 3 | My leave + preview, inbox, request page, HR console, ledger view, nightly close, `/orgs` | INV harness 0 findings over 10 actions; HR table = `expected_balances.csv` (198 rows); GR-15 walked in a browser; axe 0 violations in light and dark on 8 page states; 408 tests |

## Out of scope (seams only, as the PRD and decisions say)

Half days (O-5) · projected accruals at submit (O-1) · pending requests reserving balance (O-2) · delegator approval (O-3) · restoring cancelled minutes into a new year (O-4) · payout at termination (O-7) · a board step for the CEO (O-9) · blackout rules · payroll, calendar sync, email sending · policy editing in the UI (a new `PolicySet` row is the seam) · multi-location holidays · ~~deploy~~ (reversed 2026-10-27: password-gated demo, D-57).

## Open for the owner

- The template's `/onboarding` list still shows archived orgs (template-owned page); the clone's `/orgs` hides them and the org nav points there.

## By hand

Done 2026-10-27 on the Mac: `proof/cap-2401` deleted · `prisma migrate diff` reports no difference (D-54) · port row 7300 added to `~/.claude/CLAUDE.md` (D-55) · reuse scan run, no missed donor (D-53) · O-14 fixed (D-56: GR-18, 0 bytes moved).

Still open:
1. Review PR #1 and merge when satisfied.
2. Build-log card #14: status, and chips such as `0 diffs vs Python oracle (5057 entries, 389 requests)`, `GR-15 walked in a browser, axe light+dark`.
3. Whether O-8 (the LLM explainer experiment) is worth a phase.
4. Closure deliverables (`~/.claude/CLAUDE.md` definition of done): ~~`docs/DEMO.md`~~ (done 2026-10-27: every terminal command run on the Mac; the browser walk is `e2e/leave.spec.ts`, 8/8 with `demo.spec.ts`), the exec brief, LinkedIn posts, the cost review (deployed per D-57: Vercel builds, Neon compute, no cron).

## Artifacts

| Deliverable | Where |
|---|---|
| Live demo | https://leave.labintelligence.co (shared password, `DEMO_ACCESS_PASSWORD` on Vercel; D-57, D-59) |
| Demo script | `docs/DEMO.md` |
| Exec brief | https://claude.ai/artifact/RR5tjkRw3WiCTGGaUX9ySw (private until shared; still says not deployed) |
| Cost review | D-59: Vercel $0.06, Neon 0.10 h over 2026-10-27..28; cron off; keep auto-deploy on `main` |
| LinkedIn drafts | Lab Intelligence Ledger https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i — posts **135** (AI: both engines agreed on 5,057 entries, told me almost nothing) and **136** (Impact: cancelled December vacation), project `ledgerleave`, drafted 2026-10-27, not yet posted. Held back: gate-goes-red (theme reused), fallback-twice (Scale), void approvals (Scale) |
