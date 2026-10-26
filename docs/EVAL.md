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
