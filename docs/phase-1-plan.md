# Phase 1 plan — written before product code (unattended cloud session, 2026-10-25)

What this file is: the order the remaining Phase 1 tasks are done in, which donor is read for each port, every contradiction found between the docs or anything that cannot be built as written, every default taken while the owner was away, and what the sandbox could not run. Companion to `docs/phase-1-tasks.md` (the tasks) and `docs/decisions.md` (D-29..D-34 record the same defaults as decisions). Nothing here changes a resolved decision.

## 1. Order of work

Tasks 1.1 and 1.2 are done (see `NEXT.md`). The rest, in the CLAUDE.md TDD order, each as its own small commits with the failing test first:

| # | Task | Module(s) | Test file | Done when |
|---|---|---|---|---|
| 1 | 1.3 calendar + minutes | `src/accrual/calendar.ts`, `src/accrual/minutes.ts` | `tests/unit/leave/calendar.test.ts` | the C1–C5 acceptance values in task 1.3 pass; the three disagreement traps in §3 below each have a test |
| 2 | 1.4 policy loader | `src/accrual/policy.ts` | `tests/unit/leave/policy.test.ts` | the three fixture policies load; six invalid policies are rejected naming the field; `engine:lint` validates `fixtures/policies.json` |
| 3 | 1.5 accrual events A1–A5 | `src/accrual/events.ts` | `tests/unit/leave/events.test.ts` | event dates, tiers, proration, hours worked and the cap reproduce the GA values that need no ledger (GA-01..05, GA-11, GA-13 arithmetic, GA-19 proration, GA-20 dates) |
| 4 | 1.6 ledger replay | `src/accrual/ledger.ts` | `tests/unit/leave/ledger.test.ts` | L1/L2/`forfeitedAt`; posting-order independence of `balance(asOf)` |
| 5 | 1.7 boundaries + recompute A6–A7 | `src/accrual/boundaries.ts` | `tests/unit/leave/boundaries.test.ts` | boundary dates for the three year types incl. the clamped Feb 29 anniversary; `POSTING_ORDER` is a named constant with a test that fails when swapped |
| 6 | 1.8 routing R1–R9 | `src/routing/org.ts`, `src/routing/route.ts` | `tests/unit/leave/routing.test.ts` | GR-01..GR-14 as exact chain strings; `UNROUTABLE`, `DELEGATE_LACKS_HR_ROLE`, `FALLBACK_TO_CEO` unit tests |
| 7 | 1.9 state machine + simulation + `leave:eval` | `src/routing/requests.ts`, `src/accrual/simulate.ts`, `scripts/leave/{eval,load-fixtures,csv}.ts` | `tests/unit/leave/goldens.test.ts` (GA-01..20 + GR-15 through the simulation), `tests/unit/leave/eval.test.ts` | **0 diffs** on all three expected files; `--requests` matches `reference_leave.py --requests` |
| 8 | 1.10 `ledger:verify` | `scripts/leave/verify.ts` | `tests/unit/leave/verify.test.ts` | 198 rows, 0 diffs; a mutated copy is reported with employee, year and column |
| 9 | 1.11 `leave:route` CLI | `scripts/leave/route.ts` | `tests/unit/leave/route-cli.test.ts` | S01–S20 chains reproduce `expected_requests.csv` |
| 10 | 1.12 `docs/EVAL.md` + CI proof | `docs/EVAL.md`, `.github/workflows/ci.yml` | — | every number produced by a named command; red run (cap 2401 on a throwaway branch) and green run linked in `NEXT.md` |
| 11 | Pre-Phase-2 check | — | — | `skip_level_over_days: 4` in a copy of `policies.json` moves the kept-steps histogram and fails the diff with no code change; then `docs/phase-2-tasks.md` drafted; **stop** |

The golden cases are the acceptance for 1.5–1.7 in `phase-1-tasks.md`, but GA-01..GA-20 are stated as *simulation* results (`run(world(...))` in `golden_answers.py`), so the full GA table lands in step 7 once the simulation exists; steps 3–5 carry unit tests of the same arithmetic on the pure functions.

## 2. Donors per port (task 1.3) — what was readable

| Port | Donor named in `portfolio-overlap.md` | What happened | Lineage recorded |
|---|---|---|---|
| Calendar-axis dates as strings | Bookable `packages/core/time/{types,zone}.ts` | **Read** (cloned beside this repo). Ported: branded `CalendarDay` string type; constructor that rejects malformed *and non-existent* dates (its LD-2: `2027-02-29` throws instead of becoming March 1); `addDays`, `weekdayOf`, `daysBetween` on the calendar axis; the "no `Date` on this axis" comments. **Not ported:** Temporal — this repo adds no date library, so the arithmetic is civil-day numbers (`daysFromCivil`/`civilFromDays`) | D-32; header of `src/accrual/calendar.ts` |
| Integer units module (`asMinutes`, `assertMinutes`, `roundDiv`) | LoanBook `src/ledger/money.ts` | **403** from this session | D-32; written fresh from C5/D-6 |
| Append-only ledger, reversing entries, `ledger:verify` | LoanBook | **403** | D-32; written fresh from L1–L5/D-8 |
| Rules-as-data loader, closed vocabularies, reason traces | Adjuster | **403** | D-32; written fresh from D-15/§3 and the `codes[]` shape in §6 |
| State machine as a table | BoxLoop / Bracketry | **403** | D-32; written fresh from §7 |
| Outbox | Callboard / Showcall | Phase 2; not needed now | — |
| Frozen fixtures + oracle workflow | Housefile kit (beside this repo) | Read: same `tools/` shape as this kit already has | — |

## 3. Where TypeScript is expected to disagree with Python's `datetime` (KICKOFF step 9)

Each gets a unit test in `calendar.test.ts` before any accrual code.

1. **Week-day.** Python `date.weekday()` is Monday = 0; a hand-written `weekdayOf` on civil-day numbers returns a weekday from `(days + k) mod 7` and the offset `k` is the classic off-by-one. Pinned by: `2024-01-01` is a Monday, `2024-07-06` a Saturday, `2024-07-07` a Sunday, `1970-01-01` a Thursday (GA-08 depends on it).
2. **Month-end and leap years.** `days_in_month` via `calendar.monthrange` vs a hand-written table with the Gregorian leap rule: Feb 2024 = 29, Feb 2025 = 28, **Feb 2100 = 28**, Feb 2000 = 29; `lastDayOfMonth` on a date already at month end; and the MONTHLY event loop's "next month end" step (`last_day_of_month(d + 1 day)`), which must not skip a month.
3. **Clamped anniversary and completed months.** `add_months_clamped(2024-02-29, 12) = 2025-02-28`, then `+ 24 = 2026-02-28`, **and `+ 48 = 2028-02-29`** (clamping must be applied from the original day, not accumulated); `completed_months(2022-08-20, 2024-07-31) = 23` / `(…, 2024-08-31) = 24`; hire on the 31st measured in a 30-day month (`completed_months(2024-01-31, 2024-04-30) = 3`, because the hire day clamps to 30 — C4's `min(hire.day, daysIn(d.month))`); and the `max(months, 0)` floor the oracle applies.

One more that is not calendar but ordering: Python's `sorted()` on tuples and strings is code-point order and stable; every JS sort here is written with an explicit comparator on ASCII ids and dates, never relying on default `Array.prototype.sort` on mixed types.

## 4. Contradictions and things not buildable as written

Found reading `CLAUDE.md`, `prd-ledgerleave.md`, `docs/decisions.md`, `docs/domain-brief.md`, `docs/phase-1-tasks.md` and `tools/leavelib.py` together. **None was resolved by changing an expected value**; where the oracle and the prose differ, the oracle (the spec made executable, brief §0) wins and the prose difference is listed for the owner.

| # | Where | What | Default taken |
|---|---|---|---|
| C-1 | `policies.json` `routing_table.steps`, `fallback_order`, `delegation_max_depth` vs D-18 "step order on the table" | The oracle's `route()` hard-codes the step order `[MANAGER, SKIP_LEVEL, HR]`, the fallback order `[HR_PRIMARY, OTHER_HR, CEO]` and one delegation hop; `load_world` reads only `delegation_max_depth` and `RoutingTable` never consults it. The table is data in the file but not data in the engine | The TypeScript loader **reads** all three and **rejects** any value other than exactly those (closed vocabulary, like every other field), so the file is honoured and a divergence is loud instead of silently ignored. Making step order genuinely configurable would need a decision and a golden (D-18) |
| C-2 | `policies.json` `work_day_minutes: 480` vs oracle `WORK_DAY_MINUTES = 480` constant | The oracle never reads the file's value | Loader reads it and rejects anything but 480 (D-6 says a work day is 480); recorded so a future policy edit cannot make the two engines disagree silently |
| C-3 | Brief §7 / D-21 ignored codes vs oracle | The prose lists `IGNORED_TERMINAL` and `IGNORED_NOT_PENDING`; the oracle also logs `IGNORED_NOT_DRAFT` for a second `SUBMIT`. Count in the fixtures is 0 for all three | Implement all three as the oracle does; unit test each |
| C-4 | PRD P0-1 "transfer, D-16"; brief §4 T10 "tenure from real hire" | The transfer decision is **D-14**, not D-16 (D-16 is tiers). Cross-reference typo, harmless | None; noted for the owner |
| C-5 | CLAUDE.md "CI runs with a non-UTC `TZ`" vs the template `ci.yml` | The template sets `TZ` only on the Postgres **service** container; the Node job ran in UTC | `TZ: America/Chicago` at job level (D-33). If a template invariant test turns out to assume UTC, CI will say so |
| C-6 | Brief §11 lists "Usage rows posted after their effective date (retroactive) 134" | `reference_leave.py` does not print that line, and §10's output list does not include it | `leave:eval` prints it as an extra summary line (the summary is not diffed; only the three CSV files are) and `EVAL.md` reports it |
| C-7 | Task 1.5 acceptance "GA-01..GA-05 … pass as vitest cases" | Those goldens are defined by `golden_answers.py` as *simulation* outcomes (`run(world(...))`), which needs the ledger (1.6), boundaries (1.7) and the request path (1.9) | Steps 3–5 test the pure arithmetic with the same numbers; the GA table proper runs in step 7. Nothing is skipped, only moved |
| C-8 | CLAUDE.md `fixtures:check` definition | `verify_fixtures.py` already runs `golden_answers.py`; the CLAUDE.md command runs it a second time | Kept verbatim as CLAUDE.md states it (one redundant second of CI) |
| C-9 | D-5 "remove or leave unwired … via `foundation:check-modules` if present" | `foundation:check-modules` is a CI *proof* that removal would work, not a removal tool; share links are template-owned (`src/core/share`) and cannot be removed in a clone at all | Both left unwired (D-31) |
| C-10 | KICKOFF step 3 "add the clone row to saas-foundation/CLONES.md" | Already done by the owner on the template's main (`a714ee9`) | None |
| C-11 | Brief §5 A7 "ref the triggering request" | For a reversal batch the oracle sets `ref = e.ref` of the earliest-effective entry in the batch, which is the request id — same thing. For an accrual or transfer landing in a closed year (`_post` with `recompute=True`) the ref would be the period end or policy id; this never happens in the fixtures because days are processed in order | Mirror the oracle exactly (`ref` of the triggering entry) |
| C-12 | Brief §6 R5 "a delegate who … is inactive exceeds the depth" vs D-19 wording | D-19 says only "a delegating delegate"; the oracle (and R5) also fallback on an **inactive** delegate under the same code | Follow the oracle and R5; unit test the inactive-delegate case |
| C-13 | `tests/helpers/next.ts` is a vitest `setupFiles` for **every** test | Engine tests get Next mocks loaded they do not need; harmless, but `npm test` also needs `.env.test`, which `db:setup` writes and the sandbox cannot create | Engine tests run locally with `npx vitest run tests/unit/leave`; CI runs `npx vitest run` with the env it already sets |

## 5. Defaults taken (owner can reverse any of them)

1. Proceed past the plan into the engines without a review stop (BUILD-BRIEF §4: Phase 1 writes nothing to a database and lives on a never-merged branch).
2. D-29..D-34 as recorded in `docs/decisions.md`.
3. C-1, C-2, C-3, C-5, C-6, C-7, C-11, C-12, C-13 as in the table above.
4. Module layout: calendar and minutes live under `src/accrual/` (both engines may import the calendar; `src/routing/` imports nothing from `src/accrual/` — `route()` takes a working-day *count*, and the state machine takes the working days as an argument). The simulation (`src/accrual/simulate.ts`) is the one module that imports both engines. Fixture loading, CSV writing and diffing live under `scripts/leave/` so nothing under `src/` does I/O.
5. CSV output mirrors Python's `csv.DictWriter` with `QUOTE_MINIMAL` and `\n` line endings (quote a field only when it holds `,`, `"`, `\n` or `\r`; double the quotes) — the `chain` column is the one that gets quoted. Own code, no CSV library (ask-before-add).
6. Integer division is `(n - n % d) / d` on non-negative integers (exact in doubles); `Math.floor`/`Math.round` are banned by `engine:lint`.

## 6. Sandbox report

See `NEXT.md` → "Sandbox report" and D-34: `prisma generate` 403 (`binaries.prisma.sh`), so `typecheck`, `npm test` and Playwright are CI-only; `lint`, `foundation:drift`, every Python oracle step, `engine:lint`, `fixtures:check` and the engine tests run here.
