# NEXT

## ▶ State: Phase 1 complete on branch `kickoff` (PR #1, never merged by the agent). Stopped at the Phase 1 gate; Phase 2 not started.

Unattended cloud build session, 2026-10-25, Claude Fable 5.1. Working order and every default taken: `docs/phase-1-plan.md` (contradictions C-1..C-13, defaults §5). Decisions D-29..D-34 and open item O-11 in `docs/decisions.md`. Measured numbers: `docs/EVAL.md`. Draft of the next phase: `docs/phase-2-tasks.md` — **review before anyone starts it.**

### Phase 1 exit criteria — all met

| Criterion | Result | Command |
|---|---|---|
| GA-01..GA-20, GR-01..GR-15 pass in TypeScript | 165 tests green in `tests/unit/leave/` | `npx vitest run tests/unit/leave` |
| `leave:eval` reproduces all three expected files | **0 diffs**: `ledger.csv` 5057 rows, `expected_balances.csv` 198, `expected_requests.csv` 389; 15 void, 0 ignored, 2 recomputed; `--requests` identical to the oracle | `npm run leave:eval` |
| `ledger:verify` 0 diffs | 5057 entries → 198 rows, 0 diffs | `npm run ledger:verify` |
| `leave:route` reproduces S01–S20 | 20 of 20 (chain, working days, minutes, A8 verdict) | `npx vitest run tests/unit/leave/route-cli.test.ts` |
| `docs/EVAL.md` exists | yes, every number next to its command | — |
| CI enforces the gate under a non-UTC `TZ` | job-level `TZ=America/Chicago`; steps `engine:lint → leave:eval → ledger:verify → fixtures:check`; **red run proven** on `proof/cap-2401` (run 40261695679: `leave:eval` the only red step) | `.github/workflows/ci.yml` |
| No forbidden import in the engines | `engine:lint OK: 0 hits` (clock, db, network, model, random, float, `new Date`) | `npm run engine:lint` |
| Pre-Phase-2 check (`skip_level_over_days` 5 → 4 in a copy) | kept steps `{1: 355, 2: 33, 3: 1}` → `{1: 339, 2: 49, 3: 1}`, `leave:eval` exit 1, no code change | `npm run leave:eval -- --fixtures <copy>` |

### What was built (tasks 1.1–1.12, all ticked in `docs/phase-1-tasks.md`)

- `src/accrual/`: `calendar.ts` (C1–C5 on civil-day numbers; shape ported from Bookable, D-32), `minutes.ts` (D-6, `roundDiv`), `policy.ts` (D-15 closed vocabularies, names the failing field; routing table and `work_day_minutes` read and closed — plan C-1/C-2), `events.ts` (A1–A5), `ledger.ts` (L1–L5, append-only), `boundaries.ts` (A6–A7, `POSTING_ORDER` D-9), `simulate.ts` (the day plan; the only module importing both engines; `employeeYearRows`).
- `src/routing/`: `org.ts` (state as of a date), `route.ts` (R1–R9, ordered codes, `chainString`, `stepRequiresHr`), `requests.ts` (S1–S6 as a transition table; returns ledger *effects* instead of posting, so routing imports nothing from accrual).
- `scripts/leave/`: `eval.ts`, `verify.ts`, `route.ts`, `engine-lint.ts`, `load-fixtures.ts`, `csv.ts` (Python `csv` QUOTE_MINIMAL bytes), `report.ts` (the §10 summary, line for line).
- `tsconfig.leave.json`: typechecks the engine files where the generated Prisma client is absent (D-34).

### What was decided (see decisions.md for the why)

D-29 reuse scan skipped (dated) · D-30 port 7300 unverified against `~/.claude/CLAUDE.md`, confirmed against the owner's CLONES.md row · D-31 billing and share links left unwired, not removed · D-32 donors: Bookable read, LoanBook/Adjuster/Bracketry/BoxLoop/Callboard 403 → written fresh · D-33 CI order and job-level TZ · D-34 sandbox limits · O-11 the `DELEGATE_LACKS_HR_ROLE` fallback lands on the delegating HR primary (oracle behaviour kept).

Two of my own hand-derived test expectations were wrong and were corrected against `tools/leavelib.py` before pinning (D-25 in practice): the O-11 case above, and a hand scenario dated on the 2025-05-26 fixture holiday. No expected value from the kit was edited.

### Left open for the owner

- Review `docs/phase-1-plan.md` §4 (C-1..C-13) — especially **C-1** (routing table is data in the file but hard-coded in the oracle; the loader now rejects any other value) and **C-5** (job-level TZ — CI is green with it).
- **O-11** (above). **O-6** overlap validation: Phase 2 task 2.5 or later? **D-31**: delete the billing module or keep it unwired.
- `docs/phase-2-tasks.md` is a draft to review, not a plan to execute.

### Sandbox report (KICKOFF step 4, D-34)

- `npm ci` → `postinstall` → `prisma generate` **fails**: `Error: Failed to fetch sha256 checksum at https://binaries.prisma.sh/all_commits/0edf323efd1d98336f3f0a68684b56f689b900d3/debian-openssl-3.0.x/schema-engine.gz.sha256 - 403 Forbidden`. The `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` workaround was not used. `node_modules` is otherwise complete.
- Locally: `foundation:drift` clean against v1.3.0; `lint` 0 errors; `typecheck` fails only on `Cannot find module '@/generated/prisma/...'` in template test helpers (CI generates it; the engine files typecheck with `tsconfig.leave.json`); `npm test` not run locally (no generated client, no Postgres on 5432) — engine tests run with `npx vitest run tests/unit/leave`; Playwright not attempted. Python 3.13 present; every `tools/*.py` step ran.
- GitHub from this session: `gh api` reads work; **branch deletion is refused** (`git push --delete` and the refs API both 403 through the proxy), so the throwaway branch `proof/cap-2401` still exists.
- Donors: Bookable readable (cloned beside the repo); loanbook, adjuster, bracketry, boxloop, callboard → HTTP 403 "GitHub access to this repository is not enabled for this session".

### CI runs (branch `kickoff`, PR #1)

| Commit | Run | Result |
|---|---|---|
| `51e0337` kit (before this session) | https://github.com/shanelabountyai/ledgerleave/actions/runs/40238855890 | green |
| `41d6979` 1.1 + plan | https://github.com/shanelabountyai/ledgerleave/actions/runs/40259309626 | **red**: `typecheck` (and `check-modules`) — `engine-lint.ts` dynamically imported the not-yet-written `src/accrual/policy`; fixed in `8daf06f` by writing the module and importing it statically |
| `8daf06f` 1.3–1.4 | https://github.com/shanelabountyai/ledgerleave/actions/runs/40259872959 | green |
| `e229074` 1.5–1.8 | https://github.com/shanelabountyai/ledgerleave/actions/runs/40260545550 | green |
| `986406e` 1.9 (`leave:eval` 0 diffs in CI) | https://github.com/shanelabountyai/ledgerleave/actions/runs/40261416672 | green |
| `713f5f5` 1.10–1.11 | https://github.com/shanelabountyai/ledgerleave/actions/runs/40261623265 | in progress when this file was written |
| `38afd24` 1.12 workflow_dispatch | https://github.com/shanelabountyai/ledgerleave/actions/runs/40261689862 | green |
| `proof/cap-2401` (throwaway, cap 2401) | https://github.com/shanelabountyai/ledgerleave/actions/runs/40261695679 | **red on purpose**: `leave:eval` fails, every earlier step green |
| final docs commit | see PR #1 checks | — |

### Still to do by hand (owner)

- Review PR #1; merge when satisfied. The `CLONES.md` row is already on saas-foundation main (`a714ee9`).
- **Delete branch `proof/cap-2401`** (one "PROOF ONLY" commit; the session could not delete remote branches).
- `~/.claude/CLAUDE.md`: add the port row (ledgerleave → 7300); the file was not reachable from the cloud.
- Build-log card #14: name **Ledgerleave**, PRD and repo links, status `in progress`, chips per `docs/portfolio-overlap.md` "Suggested card chips" (now true: `0 diffs vs Python oracle (5057 entries, 389 requests)`).
- Decide D-31 (billing module), O-11, O-6 timing; re-run `~/Projects/reuse-scan.py` on the Mac (D-29).
- Neon and Vercel only if this is ever deployed (not planned; synthetic data).

Kickoff measurements (reference engine on the frozen fixtures, as of 2025-12-31): 50 employees (15 hourly), 5057 ledger entries (3986 accruals of which 1028 hit a max-balance cap, 760 usage days, 70 reversal days, 153 forfeitures of which 2 are recomputes after a retroactive entry), 389 requests (294 approved, 55 denied of which 33 by the system for insufficient balance, 39 cancelled, 1 pending at as-of), 15 void approval events, 0 ignored events. **The TypeScript engines now reproduce every one of these with 0 diffs.** These are the oracle's own answers on the generator's own traps (D-24); they say the TypeScript engines agree with the Python spec, not that the policies are right for any real company.
