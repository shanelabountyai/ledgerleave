# NEXT

## ▶ State: Phase 1 in progress on branch `kickoff` (PR #1, never merged by the agent)

Unattended cloud build session, 2026-10-25, Claude Fable 5.1. Working order and every default taken: `docs/phase-1-plan.md`. Decisions D-29..D-34 in `docs/decisions.md`.

### Done this session

- **1.1 Scaffold** — `leave:eval` (zero state `0 entries`, exit 0), `ledger:verify`, `leave:route`, `engine:lint` (purity + D-7 date bans + policies.json vocabularies once the loader exists), `fixtures:check` (verbatim from CLAUDE.md) in `package.json`; stubs under `scripts/leave/`; scope banner verbatim in `README.md` plus the D-26 sample label and a Ledgerleave command table; CI runs `engine:lint → leave:eval → ledger:verify → fixtures:check` under job-level `TZ=America/Chicago` (D-33); `.claude/settings.json` already carried the Fable pin from the kit; `?connection_limit=10&pool_timeout=20` is on both CI URLs and written by `scripts/db-setup.ts` for local ones; `vercel.json` carries the template's `ignoreCommand` (the house one, as far as this clone can tell — the template is the house); billing and share links left unwired (D-31); reuse scan skipped (D-29); port 7300 unverified against `~/.claude/CLAUDE.md`, confirmed against the owner's CLONES.md row (D-30); `__pycache__/` gitignored.
- **1.2 Fixtures** — already committed in the kit. `python3 -I tools/verify_fixtures.py` → `OK seed=20261025` (13 files, every sha256 equal to brief §12); `python3 -I tools/golden_answers.py` → `OK`; `python3 -I tools/reference_leave.py` → 5057 entries, 389 requests, 15 void, 2 recomputed, summary identical to `fixtures/samples/reference_output.txt`. `npm run fixtures:check` → OK on the clean checkout.

### Sandbox report (KICKOFF step 4)

- `npm ci` → `postinstall` → `prisma generate` **fails**: `Error: Failed to fetch sha256 checksum at https://binaries.prisma.sh/all_commits/0edf323efd1d98336f3f0a68684b56f689b900d3/debian-openssl-3.0.x/schema-engine.gz.sha256 - 403 Forbidden`. The `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` workaround was not used. `node_modules` is otherwise complete (406 packages).
- Therefore locally: `npm run foundation:drift` → clean against v1.3.0; `npm run lint` → 0 errors (1 template warning in `e2e/billing.spec.ts`); `npm run typecheck` → fails only on `Cannot find module '@/generated/prisma/...'` (8 errors, all in template test helpers that import the generated client); `npm test` → not run (needs the generated client and a migrated Postgres; `pg_isready` → no server on 5432); Playwright → not attempted. **CI is the gate**; CI on the kit commit `51e0337` is green (`ci` and `modules-removed`).
- Python 3.13 is present; every `tools/*.py` step ran.
- Donors: Bookable readable locally; loanbook, adjuster, bracketry, boxloop, callboard → HTTP 403 from this session (D-32).

### CI runs

- `51e0337` (kit, before this session): https://github.com/shanelabountyai/ledgerleave/actions/runs/40238855890 — green.

### Still to do by hand (owner)

- Review PR #1; merge when satisfied. Then merge the `CLONES.md` row in saas-foundation (already present on the template's main as `a714ee9`).
- `~/.claude/CLAUDE.md`: add the port row (ledgerleave → 7300); the file was not reachable from the cloud.
- Build-log card #14: name **Ledgerleave**, PRD and repo links, status `in progress`, chips per `docs/portfolio-overlap.md` "Suggested card chips".
- Decide whether to delete the billing module outright (D-31 left it unwired).
- Re-run `~/Projects/reuse-scan.py` on the Mac (D-29).
- Neon and Vercel only if this is ever deployed (not planned; synthetic data).
- Decide O-1..O-10 when they come up; defaults are in force.

Kickoff measurements (reference engine on the frozen fixtures, as of 2025-12-31): 50 employees (15 hourly), 5057 ledger entries (3986 accruals of which 1028 hit a max-balance cap, 760 usage days, 70 reversal days, 153 forfeitures of which 2 are recomputes after a retroactive entry), 389 requests (294 approved, 55 denied of which 33 by the system for insufficient balance, 39 cancelled, 1 pending at as-of), 15 void approval events, 0 ignored events. These are the oracle's own answers on the generator's own traps (D-24); they say the TypeScript engines agree with the Python spec, not that the policies are right for any real company.
