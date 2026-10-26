# EVAL — TypeScript engines vs the Python oracle

**What these numbers are (D-24):** `npm run leave:eval` replays the frozen fixtures (seed 20261025, hashes below) through the TypeScript accrual and routing engines and compares the result with the three files `tools/reference_leave.py` wrote from the same inputs. The numbers measure **TypeScript–Python agreement on fixtures written by the same author**. They say nothing about whether the three sample policies suit any real company, and the sick policy is a sample, not any jurisdiction's law (D-26).

Every number below is produced by the command named next to it. Measured 2026-10-25 on branch `kickoff`.

## Agreement

| Measure | Value | Command |
|---|---|---|
| `ledger.csv` | **5057 rows, 0 diffs** (byte for byte) | `npm run leave:eval` |
| `expected_balances.csv` | **198 rows, 0 diffs** | `npm run leave:eval` |
| `expected_requests.csv` | **389 rows, 0 diffs** | `npm run leave:eval` |
| `--requests` output vs `reference_leave.py --requests` | 611 lines identical (summary + 198-row table + 389 request lines); `leave:eval` adds one summary line, `usage_rows_posted_after_effective: 134` | `npm run leave:eval -- --requests` / `python3 -I tools/reference_leave.py --requests` |
| `ledger:verify` (recompute every employee-year from `ledger.csv` alone) | 5057 entries → **198 rows, 0 diffs** | `npm run ledger:verify` |
| Golden cases | GA-01..GA-20 and GR-01..GR-15 pass in TypeScript (`tests/unit/leave/goldens.test.ts`, `routing.test.ts`); `tools/golden_answers.py` prints `OK` | `npx vitest run tests/unit/leave` / `python3 -I tools/golden_answers.py` |
| Scripted requests S01–S20 through `leave:route` | 20 of 20 chains, working days, minutes and A8 verdicts match `expected_requests.csv` | `npx vitest run tests/unit/leave/route-cli.test.ts` |
| Engine purity | 0 hits over `src/accrual/` and `src/routing/` (clock, database, network, model, random, float, `new Date`); `fixtures/policies.json` valid | `npm run engine:lint` |
| Engine unit tests | 162 tests in `tests/unit/leave/` | `npx vitest run tests/unit/leave` |

## The brief §11 table, as measured by TypeScript

Printed by `npm run leave:eval` (identical to `python3 -I tools/reference_leave.py`):

| Measure | Value |
|---|---|
| Ledger entries | **5057**: ADJUSTMENT 86 · ACCRUAL 3986 · USAGE 760 · USAGE_REVERSAL 70 · FORFEITURE 153 · TRANSFER_OUT 1 · TRANSFER_IN 1 |
| Accrual codes | ACCRUAL_HOURS_WORKED 726 · ACCRUAL_MONTHLY 802 · ACCRUAL_PAY_PERIOD 2458 · MAX_BALANCE_CAP 1028 · PRORATED_DAILY 6 |
| Forfeiture recomputes (A7) | **2** (E013 −960 take-back, E024 +480 give-back) |
| Requests | **389**; final states APPROVED 294 · CANCELLED 39 · DENIED 55 · PENDING_2 1 |
| Final codes | APPROVED 294 · CANCELLED_AFTER_APPROVAL 28 · CANCELLED_PENDING 11 · DENIED_BY_APPROVER 22 · INSUFFICIENT_BALANCE 33 |
| Kept steps per request | 1: 355 · 2: 33 · 3: 1 |
| Routing codes | MANAGER_OF_REQUESTER 389 · MANAGER_OF_MANAGER 26 · HR_ROLE_HOLDER 12 · CEO_MANAGER_IS_HR 15 · DELEGATED 12 · DELEGATION_DEPTH_EXCEEDED 2 · DELEGATE_IS_REQUESTER_STEP_DROPPED 2 · EMPTY_CHAIN_TO_HR 2 · FALLBACK_TO_HR 4 · DUPLICATE_APPROVER_COLLAPSED 3 · SELF_APPROVAL_TO_MANAGER 1 · APPROVER_INACTIVE_TO_MANAGER 1 |
| Void / ignored events | **15** / **0** |
| Usage rows posted after their effective date | 134 |
| 2024 PTO (49 rows) | accrued 344027 · capped 13066 · used 95040 · forfeited 199095 · balance_end 127112 |
| 2024 SICK (49) | accrued 113010 · capped 35670 · used 47040 · forfeited 9750 · balance_end 119740 |
| 2025 PTO (50) | accrued 355172 · capped 5946 · used 146880 · forfeited 212505 · balance_end 122899 |
| 2025 SICK (50) | accrued 69290 · capped 76990 · used 42240 · forfeited 16460 · balance_end 130330 |

Codes with count 0 in the fixtures (`DELEGATE_LACKS_HR_ROLE`, `FALLBACK_TO_CEO`, `UNROUTABLE`, `IGNORED_NOT_DRAFT`, `IGNORED_TERMINAL`, `IGNORED_NOT_PENDING`, `CANCEL_NOT_REQUESTER_OR_HR`, `REASSIGN_NOT_HR`, `APPROVER_INACTIVE`) are covered by unit tests in `tests/unit/leave/routing.test.ts` and `goldens.test.ts`, each checked against `tools/leavelib.py` before being pinned.

## Phase 2 — the same answers from the database (measured 2026-10-26, branch `kickoff`)

Phase 2 feeds the engines from tables instead of files and stores what they return. These numbers say the TABLES hold the oracle's answer, and that the write path is idempotent and append-only; they still say nothing about policy fitness (D-24). Each is produced by the command named, locally against PostgreSQL 16 and in CI (`.github/workflows/ci.yml`) against the runner's PostgreSQL 17, run 40321952682 (`96536b9`).

| Measure | Value | Command |
|---|---|---|
| Inputs imported (ten files → ten tables + settings) | Employee 50 · OrgChange 11 · PolicyAssignment 101 · Holiday 16 · Timesheet 726 · Delegation 14 · OpeningBalance 86 · LeaveRequest 389 · RequestCommand 813 · PolicySet 1 | `npm run leave:import` |
| Second import | identical sha256 of every one of the 11 tables (ids and timestamps excluded), **0** commands inserted | `tests/integration/leave/import.test.ts` |
| First replay (engine → tables) | LedgerEntry **5057** · FrozenChain **389** · RequestStep **429** · RequestEvent **813** inserted; engine 15 void, 0 ignored, 2 recomputed; ledger hash `d2a090f80d2b…` | `npm run leave:replay` |
| Second replay | **0 / 0 / 0 / 0** inserted, 0 outbox rows queued, same ledger hash | `npm run leave:replay` (again) |
| `ledger:verify --db` (198 rows recomputed from LedgerEntry alone) | **198 rows, 0 diffs** | `npm run ledger:verify:db` |
| `leave:eval --db` (three reference files rebuilt from rows alone — trigger-assigned entry ids and seqs included; requests from LeaveRequest + FrozenChain + RequestEvent) | `ledger.csv` **5057 rows, 0 diffs** · `expected_balances.csv` **198, 0** · `expected_requests.csv` **389, 0** | `npm run leave:eval:db` |
| Outbox (D-23) | **759** rows, all `QUEUED` (`sentAt` null, 0 attempts): APPROVAL_REQUESTED 382 · APPROVED 322 (294 final + 28 later cancelled) · DENIED 55 (22 by approver + 33 by the system); 0 captured, 0 sent. 759 is counted independently from the SUBMIT/APPROVE/DENY/REASSIGN lines of `expected_requests.csv` | `tests/integration/leave/replay.test.ts` |
| Append-only (non-negotiable 2) | UPDATE and DELETE refused by trigger on LedgerEntry, RequestCommand, RequestEvent, FrozenChain, RequestStep (10 tamper tests, row unchanged); org delete cannot cascade through them; ORM update/delete refused | `tests/integration/leave/tamper.test.ts` |
| Ledger seq by the database | seq 0 → 1, 2, 3 per org with `L-000001`…; a caller seq that is not the next one is refused, never renumbered; natural key unique; unknown kind refused by CHECK | `tamper.test.ts` |
| CHECK vocabularies = TypeScript lists | 7 constraints read back from `pg_constraint` equal `ENTRY_KINDS`, `ACTIONS` (×2), `STATES`, `EVENT_OUTCOMES`, `STEP_IDS`, `ORG_CHANGE_FIELDS` | `tests/integration/leave/schema.test.ts` |
| No stored balance (non-negotiable 1) | 0 columns named like `balance`/`available` in any table; 18 day columns are `CHAR(10)`; 0 `date` columns | `schema.test.ts` |
| Divergence refusal | a CANCEL backdated into a closed day: `ReplayDivergence`, 67 differences named from `L-004991`, **0 rows written** | `replay.test.ts` |
| Prefix growth (D-38) | replay to 2025-06-30, then 2025-12-31 open, then closed: the close inserts only `FORFEITURE` rows effective 2025-12-31; total 5057; `leave:eval --db` 0 diffs | `replay.test.ts` |
| Edited row behind a disabled trigger | one minute changed on `L-000001` → `E001 2024 PTO opening: expected 50, recomputed 51` (and the rows it moves), trigger re-enabled and refusing again | `replay.test.ts` |
| Live actions (task 2.5) | GR-15 Q1/Q2 reproduced through `submitRequest`/`approveRequest`/`reassignStep` in date order, each its own transaction; 2 void approvals wrote 0 ledger rows and 0 outbox rows; cancel after approval mirrors 2 usage rows; A8 denial at submit with its chain frozen | `tests/integration/leave/actions.test.ts` (9 tests) |
| Suite | 386 tests in 47 files green locally under `TZ=America/Chicago` (template invariants + engine + 5 Phase 2 files) | `npm test` |

## Decisions pass + Phase 3 — the same answers on screen (measured 2026-10-26, branch `kickoff`)

The owner's decisions of 2026-10-26 (D-42..D-47) were applied before any Phase 3 code, and every Phase 1 and Phase 2 proof was re-run after the engines changed. Then the pages. These numbers say the screens show what the Phase 2 functions return and that the decided rules hold through the browser; they still say nothing about policy fitness (D-24).

| Measure | Value | Command |
|---|---|---|
| Oracle after D-44 (R7′) and D-45 (`OVERLAPPING_REQUEST`) | `golden_answers.py` OK, now GA-01..GA-20 + **GR-01..GR-17**; expected files regenerated with `--write-expected`: **0 bytes moved** (`ledger.csv` `86ab4ebe…`, `expected_balances.csv` `23fe55b4…`, `expected_requests.csv` `90cdd09a…`) — fixture counts of `DELEGATE_LACKS_HR_ROLE` and of overlapping requests are both 0 | `python3 -I tools/reference_leave.py --write-expected`, `npm run fixtures:check` |
| Phase 1 re-proved | `leave:eval` **0 diffs** (5057 / 198 / 389); `ledger:verify` 198 rows 0 diffs; `engine:lint` 0 hits; 176 engine tests (GR-16 ×4, GR-17 ×3 added) | `npm run leave:eval` … |
| Phase 2 re-proved | import 813 commands; replay 6688 rows; second replay **0**; `ledger:verify --db` 198 rows 0 diffs; `leave:eval --db` 0 diffs ×3; ledger hash `d2a090f80d2b…` — unchanged from Phase 2 | the CI DB steps |
| D-42 `Employee.userId` | linked only by the audited HR action (`employee.linked`/`unlinked`); a matching email is a suggestion; non-member, second link and unknown employee refused with messages | `tests/integration/leave/owner-decisions.test.ts` |
| D-43 one converter | the same instant is 2025-05-04 in Chicago and 2025-05-05 in Kiritimati; both sides of midnight in two zones; DST day; a grep proves `formatToParts`/`Intl.DateTimeFormat` appear only in `src/leave-db/today.ts` | `tests/unit/leave/today.test.ts` (7) |
| D-46 billing removed | 6 manifest paths deleted, 3 marker lines removed, `…_remove_billing` drops 2 tables; `foundation:drift` clean ("modules removed: billing"); CI `modules-removed` green on `6bbb5f3` | `npm run foundation:drift`, CI |
| D-47 archive | archived org: **4** write paths refused with one message, **0** rows changed (11-table snapshot); `OrgArchive` UPDATE/DELETE refused by trigger; delete-org on an org with history → `Refused` with the archive hint, **0** rows changed; an empty org still deletes; **0** files in `src/`, `scripts/`, `prisma/` disable a trigger | `owner-decisions.test.ts` (10) |
| Server actions (3.1) | 10 new `'use server'` actions; INV-01/02/03/04/22 harness **0 findings**; GR-15 walked through the actions as signed-in users with the clock pinned per golden day — 2 voids with their codes, reassign, 2 APPROVED; no-employee / not-HR / archived refusals are `{ error }` messages | `tests/invariants/inv-01-04-22-actions.test.ts`, `tests/integration/leave/ui-actions.test.ts` (8) |
| HR employee-year table (3.4) | **198 rows, 0 diffs** against `expected_balances.csv` (the test reads the oracle file; the page never does) | `tests/integration/leave/read.test.ts` |
| Ledger page (3.5) | E013 PTO: one `CARRYOVER_RECOMPUTED` row, 2024-12-31, **−960**; its running balance = `balance(E013, PTO, 2024-12-31)` | `read.test.ts` |
| Request views | **389** requests, 1 open (`PENDING_2`), as brief §11 | `read.test.ts` |
| Nightly close (3.6) | at 00:30 Chicago on 2025-01-01 the 2024-12-31 forfeitures post once; second run **0 / 0 / 0** inserted; a live action first is still prefix-safe; Honolulu is still on 12-31; an archived org is skipped | `tests/integration/leave/close.test.ts` (4) |
| Browser walk (3.7) | GR-15: H3 approves, H2's approval of Q1 **VOID `APPROVER_NOT_STEP_APPROVER`**, H7's **VOID `APPROVER_INELIGIBLE_ROLE_REVOKED`**, H8 reassigns and approves, both **APPROVED**; D-45 preview and denial; D-47 archive; axe **0 violations in light and in dark** on 8 page states (inbox, request, HR console, my leave, preview, ledger, archived leave page, `/orgs`) | `npm run test:e2e` — 16/16 specs locally (Chromium from `/opt/pw-browsers`) and in CI |
| Suite | **408** tests in 52 files green locally under `TZ=America/Chicago` | `npm test` |

## Fixture hashes (brief §12, `fixtures/MANIFEST.json`)

`npm run fixtures:check` → `OK seed=20261025`. sha256:

| File | Rows | sha256 |
|---|---|---|
| policies.json | 3 policies | `749f50b88106b4f2291b2e0819c6a5b6a0003c96a88e0f23fca6b6eac634f18c` |
| employees.csv | 50 | `05402a209590594e16921302fc83bae2579b47351981109d81756f9466fb8842` |
| assignments.csv | 101 | `12d117c04fed959d1b770eb806315b5b89a926202892e912f358fc41b992af19` |
| holidays.csv | 16 | `47e928e4a4efed89aa5cddd983ce89f634adee47a80ca458d3efb95dcf2481f5` |
| timesheets.csv | 726 | `6b8888122d7934b71ceaf93a0eda8e8fd658221bcd4e6a5db2edc0ba3665a094` |
| delegations.csv | 14 | `ff194bd28b90a512baa329234c9689782ec129b792a755d41d7121ca3d55d8c4` |
| org_changes.csv | 11 | `85272bfd5f43022c4b2524b5197f7549580543ec4fe9f3f5438f7bb2c73215f3` |
| opening_balances.csv | 86 | `6fe72d09e7e3b9e02e204ec108805ed6a25c3845c229d0b6724b8c656353fe64` |
| requests.csv | 389 | `529e33425a6be2800728a9de172495b26cb45483bd41c1615f3ad83cf9ec57d9` |
| request_events.csv | 813 | `1894fa4b1358d2b37c0d562c78fd05fe87d5843587df018608b9cb39f395ed3e` |
| ledger.csv (reference engine) | 5057 | `86ab4ebecabfcd7ebece36f29f8ea99c9318485640b4359b5619d7a2b1025901` |
| expected_balances.csv (reference engine) | 198 | `23fe55b4e91424e01e1448e6979dcbfe75177733b2234c5975badfe8df003dc1` |
| expected_requests.csv (reference engine) | 389 | `90cdd09ae125e05e8d31da8e8c8fdbf295a69a15a9b7419bb1086d5d1a6bf13e` |

## The gate goes red (task 1.12 proof)

Changing one number in a copy of `policies.json`, with **no code change**:

| Change | `leave:eval` result | Where |
|---|---|---|
| `PTO_SALARIED.carryover_cap_minutes` 2400 → 2401 | exit 1: `ledger.csv` 45 differing lines (first: E001's Dec 31 2024 forfeiture −6770 → −6769), `expected_balances.csv` 69 differing lines, `expected_requests.csv` 0 | locally with `--fixtures <copy>`; **CI red run** https://github.com/shanelabountyai/ledgerleave/actions/runs/40261695679 on the throwaway branch `proof/cap-2401` (one commit, "PROOF ONLY"; the session could not delete a remote branch through the proxy — owner deletes it): `lint`, `typecheck`, `engine:lint` green, `leave:eval` red |
| `PTO_SALARIED.routing.skip_level_over_days` 5 → 4 (the pre-Phase-2 check) | exit 1: kept steps per request move from `{1: 355, 2: 33, 3: 1}` to `{1: 339, 2: 49, 3: 1}`; `MANAGER_OF_MANAGER` 26 → 42; `ledger.csv` 4134, `expected_balances.csv` 10, `expected_requests.csv` 16 differing lines | locally with `--fixtures <copy>` |

`fixtures:check` also fails on either change because `policies.json`'s sha256 moves from the manifest.

## Not generated (say so in any write-up)

Half days, overlapping requests, requests before hire or after termination, zero-working-day requests, HR adjustments other than opening balances, policy edits mid-window, several delegations by one approver at once, delegations to inactive people, more than one HR revoke (brief §4). Each is a candidate for a second seed.

## Follow-up — D-53, the O-14 fix (measured 2026-10-26, branch `followups`)

The owner decided O-14 the same way as O-11: the `DELEGATION_DEPTH_EXCEEDED` fallback skips every delegator on the chain (R7″). Decisions first, oracle second, TypeScript third; every proof re-run after the engines changed.

| Measure | Value | Command |
|---|---|---|
| Oracle | `golden_answers.py` OK, now GA-01..GA-20 + **GR-01..GR-18**; GR-18's three parts all print `BAD` against the old R7 (all three landed on H7) | `python3 -I tools/golden_answers.py` |
| Fixtures | `build_fixtures.py --seed 20261025` + `reference_leave.py --write-expected`: **0 of 14 files moved** (`ledger.csv` `86ab4ebe…`, `expected_balances.csv` `23fe55b4…`, `expected_requests.csv` `90cdd09a…`, `MANIFEST.json` `9cf46505…`); `verify_fixtures.py` OK; fixture count of a depth-exceeded fallback landing on a delegator: 0 (R-0008, R-0079 still fall back to E006) | `npm run fixtures:check` |
| Phase 1 re-proved | `leave:eval` **0 diffs** (5057 / 198 / 389); `ledger:verify` 198 rows 0 diffs; `engine:lint` 0 hits | `npm run leave:eval` … |
| Phase 2 re-proved | import 813 commands; replay 6688 rows; second replay **0**; `ledger:verify --db` 198 rows 0 diffs; `leave:eval --db` 0 diffs ×3; ledger hash `d2a090f80d2b…` — unchanged | `leave:*:test -- --org followup-d53` |
| Suite | **413 tests / 52 files** green locally (408 + GR-18 ×3, a delegation cycle, the CEO-as-requester case) | `npm test` |

