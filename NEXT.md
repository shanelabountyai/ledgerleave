# NEXT

## ▶ Next: look at production with Shane (design system + days shipped 2026-10-28, `d427b8f`)

Done: `docs/design-brief.md`, D-60, `formatDays` (`_ui/days.ts`), one stylesheet, fonts via `next/font/google`. `npm test` 429 passed; e2e `--workers=1` 16 passed (axe light+dark). Pushed to `main` → Vercel rebuilds.
Open: eyeball leave.labintelligence.co (fonts load? pills/chips read OK in dark?). One unexplained run: first `npm test` had 4 failed in 2 files after 1002s, not reproduced on re-run (429/429); suspected DB contention, unconfirmed. Then post Ledger 135/136 (first comments in `docs/CLOSEOUT.md`); share the brief first.

---

## Deploy item (done 2026-10-28)

Done 2026-10-27 (`a8ce2aa`, `4080a55`): steps 1–5 of the checklist.
- D-57 recorded; CLOSEOUT, DEMO.md and the `~/.claude/CLAUDE.md` port row no longer say "not deployed".
- Gate: `src/proxy.ts` + `src/app/demo-gate.ts` + `tests/unit/demo-gate.test.ts` (ported from boxloop via gavel); `FOUNDATION_PATCHES.md` row `0012a96281ad`; drift clean; `npm test` 414 passed / 53 files.
- `npm run seed:cloud`: the only script that reads `.env.cloud` and sets `ALLOW_CLOUD_DB=1`. Runs migrate deploy, seed-demo, leave:import, leave:replay, leave:seed:walk.
- Cron removed from `vercel.json` (restore note in D-57). `CRON_SECRET` stays unset, so `/api/cron` refuses everything (INV-11).
- `.env.cloud` created (gitignored), empty `DATABASE_URL=`, `DIRECT_URL=`, `AUTH_SECRET=`; `APP_URL` set.

Done 2026-10-28: **live at https://leave.labintelligence.co** behind the shared password.
- Neon `ledgerleave` `patient-hill-24275078` (PostgreSQL 17, aws-us-east-2; a first PG 18 project was deleted empty). Vercel `ledgerleave` (`prj_aLXeKTKlbWlXo2b7dgRLv0xuVcZt`), 7 production vars, `CRON_SECRET` unset on purpose. Cloudflare A `leave` → 76.76.21.21 DNS only (the first save never published; re-added).
- `seed:cloud` (Shane ran it; the classifier refuses Claude writing to the production DB): 14 migrations, 6 demo accounts, import, replay 6688 rows / 759 queued / hash `d2a090f8…` (= local), walk org. First run hit the import's 60s transaction timeout over the network; raised to 600s (`da1bbf4`).
- Live checks: every path 401 with the Basic challenge (incl. `/demo`), wrong password 401, `/api/cron` 401, HSTS on.
- D-58 (PR #3, merged `ab76e23`): shared demo accounts cannot archive an org (permanent; everyone shares `owner@globex`).
- PR #1 merged `be7bdad`; production deploys `main`. Work continues on `main`.

Was still to do (all done 2026-10-28 except posting):
1. Shane's signed-in look (no clicks): `/demo` 6 accounts; `admin@acme` inbox shows R-0001/R-0002; `owner@acme` HR page.
2. Ledger posts 135/136: exec-brief and demo links as first comments. Exec brief: replace its "not deployed" line.
3. Cost review: `neonctl projects get patient-hill-24275078 --org-id org-morning-smoke-06224724 --output json`, `vercel usage --group-by project`; baseline + keep/slow/off in D-59 (deploy record: what production found). CLOSEOUT artifacts table: live URL.
4. Known flake (pre-existing): `leave.spec` and `demo.spec` in parallel workers race on `seedDemo`'s org upsert (`Org_slug_key`); passes with `--workers=1`.

Commands (Neon org `org-morning-smoke-06224724`, Vercel scope `shanelabountyai-8212s-projects`):
```bash
neonctl projects create --name ledgerleave --region-id aws-us-east-2 --org-id org-morning-smoke-06224724
neonctl connection-string --project-id <id> --pooled   # -> DATABASE_URL (.env.cloud and Vercel)
neonctl connection-string --project-id <id>            # -> DIRECT_URL  (.env.cloud and Vercel)
vercel link --yes --project ledgerleave --scope shanelabountyai-8212s-projects   # creates the project; Root Directory stays "."
vercel git connect https://github.com/shanelabountyai/ledgerleave
printf 1 | vercel env add DEMO_MODE production
printf 0 | vercel env add EMAIL_ENABLED production     # INV-13: no Resend in the demo; sign-in is /demo only
printf https://leave.labintelligence.co | vercel env add APP_URL production
vercel env add DEMO_ACCESS_PASSWORD production         # secret: Shane pastes
vercel env add AUTH_SECRET production                  # secret: same value as .env.cloud
vercel env add DATABASE_URL production                 # secret: pooled
vercel env add DIRECT_URL production                   # secret: direct
vercel domains add leave.labintelligence.co ledgerleave
# Cloudflare: A record  leave -> 76.76.21.21, DNS only (grey cloud)
```
Production branch: the repo deploys `main`; branch `kickoff` (PR #1) is not merged. Either merge PR #1 or set the production branch to `kickoff` in Vercel.

Ledger posts 135 (AI) and 136 (Impact) are drafted and tightened with a one-line project setup; both unposted. https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i

---

### DEMO.md, 2026-10-27

- `npm run db:setup` wrote `.env.local` (with `DEMO_MODE=1`) and `.env.test` (both gitignored, pool-capped) and migrated `ledgerleave` + `ledgerleave_test`.
- Ran every terminal command in the script: `leave:eval` 0 diffs (5057 / 198 / 389) · `ledger:verify` 198/0 · `leave:route` S05 and S04 · `engine:lint` 0 hits · `fixtures:check` OK · `leave:import` 813 commands · `leave:replay` 6688 then 0 rows, hash `d2a090f8…` · `ledger:verify:db` 198/0 · `leave:eval:db` 0 diffs · `npm start` serves `/demo` with 6 accounts.
- New `npm run leave:seed:walk` (`seedDemoWalk` in `scripts/leave/seed-hand-org.ts`): the e2e walk's starting state, now shared by `e2e/leave.spec.ts` and the demo. Playwright `leave.spec.ts` + `demo.spec.ts`: 8 passed, 0 failed, against a production build.
- CI green on `eb5ef0d`: https://github.com/shanelabountyai/ledgerleave/actions/runs/40563726906 (`ci`, `modules-removed`).
- `foundation:drift` cannot run locally: no `v1.3.0` tag in this checkout (`git fetch template --tags` would fix it); only clone-owned files changed.

## Was: closure deliverables, starting with `docs/DEMO.md`

Order (`~/.claude/CLAUDE.md` definition of done): `docs/DEMO.md` (run every command in it once; needs a local `.env.test`/`.env.local` first — none exist on this Mac) → exec brief (`exec-brief` skill) → LinkedIn posts in the Ledger → cost review (no deploy: CI minutes only). Record every artifact URL in `docs/CLOSEOUT.md`. Also still open: review/merge PR #1, build-log card #14, O-8.

### O-14 fixed, 2026-10-27 (D-56)

One `fallback(…, delegator)` in `tools/leavelib.py` and `src/routing/route.ts` now serves both `DELEGATE_LACKS_HR_ROLE` (D-44) and `DELEGATION_DEPTH_EXCEEDED`: skip the delegator among HR holders; the delegator (`FALLBACK_TO_DELEGATOR`) only if it holds HR and nobody else does; a non-HR delegator still falls through to the CEO. Golden **GR-18** (3 parts). Regenerated: **0 bytes moved**. `golden_answers.py` OK · `leave:eval` 0 diffs (5057 / 198 / 389) · `fixtures:check` OK · `engine:lint` 0 hits · 181 engine tests green · `tsc` clean. CI green on `36d74ed`: https://github.com/shanelabountyai/ledgerleave/actions/runs/40544855392 (`ci`, `modules-removed`). `today.test.ts` cannot run on this Mac (no `.env.test`: missing `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`); CI runs the full suite.

### Mac session 2026-10-27 (done)

- `proof/cap-2401` deleted from GitHub.
- `prisma migrate diff … --exit-code` against a local shadow DB: **No difference detected**, exit 0 (D-54).
- Port 7300 recorded in `~/.claude/CLAUDE.md` (D-55); 6300 stays the next free port.
- Reuse scan: no missed donor (D-53).
- Local checkout now has `node_modules` (`npm ci`; npm held back the install scripts for prisma, esbuild and unrs-resolver, and `migrate diff` ran anyway). There is no `.env.test` on this Mac yet: create it from the conventions recipe (`ledgerleave_test`, `?connection_limit=10&pool_timeout=20`) before the first local `npm test`.

---

## Previous state (2026-10-26), kept as written
## ▶ Was: State: decisions pass + Phase 3 complete on branch `kickoff` (PR #1, never merged by the agent). Stopped at the Phase 3 gate; the PRD names no Phase 4, so `docs/CLOSEOUT.md` is a draft to review.

Cloud session 2026-10-26 (Claude Opus 5.5). Owner decisions D-42..D-47 recorded and applied; build defaults D-48..D-52; every Phase 3 number in `docs/EVAL.md` ("Decisions pass + Phase 3"); tasks ticked with what changed in `docs/phase-3-tasks.md`.

### Decisions applied (owner, 2026-10-26)

| Item | D | Result |
|---|---|---|
| 7 O-12 account ↔ employee | D-42 | nullable unique `Employee.userId`, set only by the audited HR action; email match only suggests |
| 8 O-13 "today" | D-43 | `LeaveSettings.timeZone` (IANA, default America/Chicago); `src/leave-db/today.ts` is the only converter (grep test) |
| 9 O-11 fallback skips the delegator | D-44 | R7′ + `FALLBACK_TO_DELEGATOR` in `leavelib.py` then TS; golden **GR-16**; fixture hits 0 → regenerated, **0 bytes moved** |
| 10 O-6 overlap | D-45 | `OVERLAPPING_REQUEST` before A8 in both engines; golden **GR-17**; no fixture overlaps → `leave:eval` still 0 diffs |
| 11 billing | D-46 | removed by the manifest + `…_remove_billing` migration; drift clean; `modules-removed` green |
| 17 archive, keep Restrict | D-47 | `OrgArchive` (append-only), `assertWritable` on every write path, delete-org refused via the clone hook, no trigger disabled anywhere |

Fixtures were NOT regenerated in content: the regeneration ran and moved 0 bytes; hashes unchanged (`ledger.csv` `86ab4ebe…`, `expected_balances.csv` `23fe55b4…`, `expected_requests.csv` `90cdd09a…`).

### Re-proved before any Phase 3 code

`leave:eval` 0 diffs (5057 / 198 / 389) · `ledger:verify` 198 rows 0 diffs · `fixtures:check` OK · DB: import → replay 6688 rows → replay 0 → `ledger:verify --db` 198/0 → `leave:eval --db` 0 diffs ×3, ledger hash `d2a090f80d2b…` (same as Phase 2).

### Phase 3 (tasks 3.0–3.8, all ticked)

Server actions (10, INV harness 0 findings) · My leave with preview · inbox · request page · HR console · ledger · nightly close · `/orgs` · e2e GR-15 walk + overlap + archive with axe light/dark (D-48: axe-core from node_modules, no new dependency). **408 tests / 52 files** green locally; **16/16 Playwright specs** green locally (Chromium at `/opt/pw-browsers`) and in CI.

### CI runs this session

| Commit | Run | Result |
|---|---|---|
| `b99d7e5` engines D-44/D-45 | https://github.com/shanelabountyai/ledgerleave/actions/runs/40345215197 | green |
| `6bbb5f3` billing removed, schema, guards | https://github.com/shanelabountyai/ledgerleave/actions/runs/40346598856 | green (`ci`, `modules-removed`) |
| `02021a5` Phase 3 pages, close, e2e | https://github.com/shanelabountyai/ledgerleave/actions/runs/40350551073 | green (`ci` incl. Playwright, `modules-removed`) |

No red runs this session. Locally, the e2e walk found two real defects before CI saw them: an inline notice vanished with its card (fixed by D-52) and two pages awaited `params` before the guard (FR-06 harness; fixed).

### Sandbox this session

`prisma generate` with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true`; PostgreSQL 16 local, migrations by `psql -f`; full `npm test`, `next build` and Playwright (preinstalled Chromium) all ran locally. Not runnable here: `prisma migrate deploy/diff` (schema engine 403) and `foundation:check-modules` (no `rsync`) — CI ran both. A parallel session overwrote a shared helper script in the scratchpad; the two affected commit attempts aborted at `git add` and wrote nothing anywhere; ledgerleave's helpers moved to a private folder.

### Open / by hand (owner)

- **O-14** (new): the `DELEGATION_DEPTH_EXCEEDED` fallback has O-11's shape; fixture count 0; not changed (D-44 was scoped to O-11).
- The template `/onboarding` list still shows archived orgs (template-owned); `/orgs` hides them.
- Review PR #1; delete `proof/cap-2401`; run `prisma migrate diff` on the Mac; port row 7300 in `~/.claude/CLAUDE.md`; reuse scan; build-log card. Full list in `docs/CLOSEOUT.md`.

---

## Phase 2 record (2026-10-26), kept as written — was: State: Phase 2 complete on branch `kickoff` (PR #1, never merged by the agent). Stopped at the Phase 2 gate; Phase 3 not started — `docs/phase-3-tasks.md` is a draft to review.

Unattended cloud build sessions: Phase 1 on 2026-10-25, Phase 2 on 2026-10-26 (Claude Fable 5.1). Phase 2 decisions D-35..D-41 and open items O-12, O-13 in `docs/decisions.md`; every Phase 2 number in `docs/EVAL.md` ("Phase 2 — the same answers from the database"); tasks ticked with what changed from the draft in `docs/phase-2-tasks.md`.

### Phase 2 exit criteria — all met (CI run 40321952682 on `96536b9`, then the docs commits)

| Criterion | Result | Command |
|---|---|---|
| `ledger:verify` against the database equals the oracle | 5057 LedgerEntry rows → **198 rows, 0 diffs** | `npm run ledger:verify:db` |
| and the three reference files rebuilt from rows alone | `ledger.csv` 5057 · `expected_balances.csv` 198 · `expected_requests.csv` 389 — **0 diffs each**, trigger-assigned entry ids included | `npm run leave:eval:db` |
| Replaying twice writes nothing the second time | first: 5057 / 389 / 429 / 813 inserted (ledger / chains / steps / events); second: **0 / 0 / 0 / 0**, 0 queued, same ledger hash | `npm run leave:replay` ×2 |
| UPDATE/DELETE rejected by triggers | 5 tables (LedgerEntry, RequestCommand, RequestEvent, FrozenChain, RequestStep): 10 tamper tests, rows unchanged; org delete cannot cascade through; ORM refused | `tests/integration/leave/tamper.test.ts` |
| Outbox holds the expected QUEUED rows, nothing sent | **759** (382 / 322 / 55), all `sentAt` null; count derived from the oracle's log lines; 0 captured; the cron drain is unwired (D-40) | `tests/integration/leave/replay.test.ts` |
| Live writes through the engines | GR-15 reproduced through `submitRequest`/`approveRequest`/`reassignStep`; void approvals write 0 ledger and 0 outbox rows | `tests/integration/leave/actions.test.ts` |
| Suite | 386 tests, 47 files, green locally under `TZ=America/Chicago` and in CI (PostgreSQL 17) | `npm test` |

### What was built (tasks 2.1–2.9, ticked in `docs/phase-2-tasks.md`)

- `prisma/schema/ledgerleave.prisma` + migrations `20261026000000_ledgerleave_init`, `20261026000001_request_command_ordinal`: 16 clone-owned tables, every day `CHAR(10)`, CHECK lists mirroring the TS vocabularies (tested for equality), append-only triggers, ledger seq/entryId assigned by trigger in posting order. `core.prisma` changed only by 15 `// app` back-relations (drift clean).
- `scripts/leave/import-fixtures.ts` (`leave:import`): ten input files → tables, upsert by natural key, commands append-only with a within-day `ordinal`.
- `src/leave-db/replay.ts` (`leave:replay`): World from tables → `Simulation` → insert the missing suffix; stored rows must be a prefix of the engine's answer or `ReplayDivergence` writes nothing (D-38). `src/leave-db/notify.ts` + `templates.ts`: outbox rows per applied event (D-23). `src/leave-db/actions.ts`: submit/approve/deny/cancel/reassign = append a command, replay the day open, one transaction (D-39). `src/leave-db/verify-db.ts` + `scripts/leave/eval-db.ts` (`leave:eval:db`, `ledger:verify:db`): the proofs from rows alone.
- Engine: `RequestEvent.ordinal?` (within-day order for live writes), `Simulation.run({ openAsOfDay })`, a per-event observer — `leave:eval` unchanged at 0 diffs (`tests/unit/leave/live-order.test.ts`).
- `src/app/cron-jobs.ts`: outbox drain unwired; the nightly close seam documented (2.8). `src/app/required-modules.ts`: `['notifications']`.
- CI: after `vitest`, `import → replay → replay → verify --db → eval-db` on the runner's Postgres.

### Red runs this session and what fixed them

| Commit | Run | Red step | Fix |
|---|---|---|---|
| `f8a1935` 2.1/2.2 | https://github.com/shanelabountyai/ledgerleave/actions/runs/40319426296 | `typecheck` (both jobs): a destructured `$queryRawUnsafe` row is possibly undefined under `noUncheckedIndexedAccess`; the local incremental `tsc` had not re-checked the new file | `countRows` helper (`38c2e…` folded into the next push); the local check is now `rm tsconfig.tsbuildinfo && tsc --noEmit` |

Green: `d09b02b` (2.1–2.3) run 40320500813; `96536b9` (2.4–2.9) run 40321952682. CI logs are not readable through the proxy (403 on the log blob); step names and conclusions are.

### Left open for the owner

- **O-12** who acts as whom (User ↔ Employee) and **O-13** the calendar-day source for "today" — both block Phase 3 task 3.0.
- **O-6** overlap validation waited (no decision, no golden); **D-31** billing still unwired not removed; **O-11** unchanged.
- `docs/phase-3-tasks.md` is a draft to review, not a plan to execute.
- Two of my hand derivations were wrong again and corrected against the oracle before pinning (D-25): the H10 chain in `actions.test.ts` (the skip-level climbs to H1, it does not collapse onto H2), and the closed-day forfeiture count in `live-order.test.ts`. No expected value from the kit was edited.

### Sandbox report (D-35)

- `prisma generate` runs with `PRISMA_SCHEMA_ENGINE_BINARY=<any executable>` (the client generator never calls the schema engine); the sandbox's PostgreSQL 16 was online, so migrations were applied with `psql -f` in order and the FULL `npm test` ran locally (386 green). `.env.test` was written locally (gitignored).
- Still CI-only: `prisma migrate deploy` / `migrate diff` (schema engine download is 403), Playwright. There is no `migrate diff` drift check in CI; the migration SQL was hand-written to Prisma's naming and the DB tests exercise every column — a Mac `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --shadow-database-url …` is on the to-do list.
- Donors for the outbox (Callboard/Showcall) and ledger (LoanBook): still 403 from this session; written fresh from D-23 / D-8 (D-32 stands).

### CI runs (branch `kickoff`, PR #1)

| Commit | Run | Result |
|---|---|---|
| `f8a1935` 2.1/2.2 schema, migration, tests | https://github.com/shanelabountyai/ledgerleave/actions/runs/40319426296 | **red**: typecheck (fixed, see above) |
| `d09b02b` 2.1–2.3 + engine ordinal/openAsOfDay | https://github.com/shanelabountyai/ledgerleave/actions/runs/40320500813 | green |
| `96536b9` 2.4–2.9 (replay, outbox, verify/eval --db, actions, CI steps) | https://github.com/shanelabountyai/ledgerleave/actions/runs/40321952682 | green |
| `b2dd3ab` Phase 2 gate docs | https://github.com/shanelabountyai/ledgerleave/actions/runs/40322972976 | green (`ci` and `modules-removed`) |

### Still to do by hand (owner)

- Review PR #1 (Phase 1 + Phase 2); merge when satisfied. Delete branch `proof/cap-2401` (left from Phase 1).
- Run `npx prisma migrate diff` on the Mac (above) and `npm run test:e2e` once (Playwright never ran in the sandbox; CI runs it).
- Decide O-12, O-13, O-6; `~/.claude/CLAUDE.md` port row (ledgerleave → 7300); build-log card #14 chips: `0 diffs vs Python oracle (5057 entries, 389 requests); replayed into Postgres: 198 rows 0 diffs, 759 notices queued, 0 sent`.
- Re-run `~/Projects/reuse-scan.py` on the Mac (D-29).

---

## Phase 1 record (2026-10-25), kept as written

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
| `713f5f5` 1.10–1.11 | https://github.com/shanelabountyai/ledgerleave/actions/runs/40261623265 | green |
| `38afd24` 1.12 workflow_dispatch | https://github.com/shanelabountyai/ledgerleave/actions/runs/40261689862 | green |
| `proof/cap-2401` (throwaway, cap 2401) | https://github.com/shanelabountyai/ledgerleave/actions/runs/40261695679 | **red on purpose**: `leave:eval` fails, every earlier step green |
| `ddcfcaa` 1.12 EVAL.md + Phase 1 gate docs | https://github.com/shanelabountyai/ledgerleave/actions/runs/40262018890 | green (`ci` and `modules-removed`) |

### Still to do by hand (owner)

- Review PR #1; merge when satisfied. The `CLONES.md` row is already on saas-foundation main (`a714ee9`).
- **Delete branch `proof/cap-2401`** (one "PROOF ONLY" commit; the session could not delete remote branches).
- `~/.claude/CLAUDE.md`: add the port row (ledgerleave → 7300); the file was not reachable from the cloud.
- Build-log card #14: name **Ledgerleave**, PRD and repo links, status `in progress`, chips per `docs/portfolio-overlap.md` "Suggested card chips" (now true: `0 diffs vs Python oracle (5057 entries, 389 requests)`).
- Decide D-31 (billing module), O-11, O-6 timing; re-run `~/Projects/reuse-scan.py` on the Mac (D-29).
- Neon and Vercel only if this is ever deployed (not planned; synthetic data).

Kickoff measurements (reference engine on the frozen fixtures, as of 2025-12-31): 50 employees (15 hourly), 5057 ledger entries (3986 accruals of which 1028 hit a max-balance cap, 760 usage days, 70 reversal days, 153 forfeitures of which 2 are recomputes after a retroactive entry), 389 requests (294 approved, 55 denied of which 33 by the system for insufficient balance, 39 cancelled, 1 pending at as-of), 15 void approval events, 0 ignored events. **The TypeScript engines now reproduce every one of these with 0 diffs.** These are the oracle's own answers on the generator's own traps (D-24); they say the TypeScript engines agree with the Python spec, not that the policies are right for any real company.
