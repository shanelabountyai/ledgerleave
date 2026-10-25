# Ledgerleave — Portfolio Overlap Check

Checked 2026-10-25 against the build-log card list, the saas-foundation `CLONES.md` table and the Housefile kit that was readable from the workspace. **The donor projects' source trees were not readable from here**; the "Where" column names what to look for and the first session must read each donor before porting (CLAUDE.md working rule "port before you write"). Purpose: keep Ledgerleave from re-teaching what a sibling built, and keep the HR-lite surface from eating the two engines.

## Verdict

The card lists four chips. None is built anywhere in the portfolio, but two are close to something:

| Card chip | Already in the portfolio? | What Ledgerleave does |
|---|---|---|
| accrual rules | **No.** LoanBook accrues *interest* on a ledger (a rate × balance × days), Bookable prices time slots; nothing grants an entitlement that grows under tenure tiers, proration and caps | **New:** policy JSON with a closed vocabulary → dated accrual events → ledger rows; balance derived by replay (A1–A5, L1–L2) |
| carryover caps | **No.** Gridline (shelved) had cancel-and-rebill at period ends; nothing measures a year-end state and forfeits above a cap, nor recomputes it after a retroactive entry | **New:** three year types, forfeiture as a row, recompute on retroactive entries (A6–A7, GA-10) |
| approval chains | **Partly.** A2 Marketing-Ops Agent (planned) has approval rows before CRM writes; Callboard/Showcall have single-approver confirmations; Adjuster has decision traces | **New:** an ordered multi-step chain from a routing table, every step with ordered reason codes, frozen at submit, eligibility re-checked at approval (R1–R9, S3) |
| delegation | **No.** Nothing in the portfolio routes around an absent person | **New:** one-hop delegation, depth exceeded, delegate-is-requester, fallback order, HR-role check on delegates (R5–R7) |

Suggested card chips once it ships: `ledger-derived balances (never stored)` · `policy JSON: tiers · proration · 3 year types` · `carryover forfeiture, recomputed on cancel` · `routing table → frozen chain with reason codes` · `delegation + HR fallback` · `0 diffs vs Python oracle (5057 entries, 389 requests)`.

## Reuse — port, do not rebuild

| Capability | Donor | Where to read first | Ledgerleave use |
|---|---|---|---|
| Auth, orgs, roles, invites, audit log, cron, outbox, CI, invariants | saas-foundation v1.3.0 | template | As cloned; billing and share links removed or unwired (D-5) |
| Integer units, one unit module, no floats, lint for floats | LoanBook | `src/ledger/money.ts` (its D11), `ledger:verify` | Minutes module (`asMinutes`, `assertMinutes`, `roundDiv`); `engine:lint` |
| Append-only ledger; reversing entry that references the original; "net" derived | LoanBook | ledger entries and reversal rows; `ledger:verify` replay | `LedgerEntry` kinds, `USAGE_REVERSAL` mirrors, `ledger:verify` (D-8) |
| Calendar-axis dates as strings; no `new Date(string)`; no `@db.Date` | Bookable | its date module and CLAUDE.md rules | C1–C5 calendar module; the TZ-pinned CI |
| Rules as data with a closed vocabulary; validation on load; content hash | Adjuster | `RuleSetVersion`, canonical serializer, its D1/D2/D5 | `policies.json` loader (D-15); routing table as data |
| Decision explanations: a decision carries the rules that fired, in order | Adjuster | decision trace / explanation output | Step `codes[]`, accrual `codes` (D-19) |
| Replay-and-compare verify with coded failures | Adjuster / LoanBook | `decisions:verify`, `ledger:verify` | `leave:eval` three-file diff (D-24) |
| State machine as a transition table; illegal transitions rejected and logged | BoxLoop / Bracketry | subscription state tables; league rules | Request states S1–S6 (D-21) |
| Notifications outbox: queued, templated, never sent in tests | Callboard / Showcall | templates registered into the notifications module at runtime | `APPROVAL_REQUESTED` etc. `QUEUED` (D-23, Phase 2) |
| Frozen fixtures + Python oracle + golden answers script | Housefile / Gridline kit / LoanBook | `tools/`, `fixtures/`, `golden_answers.py`, `verify_fixtures.py` | Same workflow (`build_fixtures.py`, `reference_leave.py`, `golden_answers.py`, `verify_fixtures.py`) |
| One queue entity for all human work items | storage / rental | B-095 | Approver inbox = pending steps (Phase 3) |
| Pure engine, deterministic, one function, append-only history | Bracketry | `src/lib/league/` rules in its CLAUDE.md | `src/accrual/`, `src/routing/` purity rules |
| Model pin in settings | opsagent / gridline / housefile | `.claude/settings.json` | D-3 |

## New — each with the fixture that proves it

| # | Lesson | Not in any sibling because | Proven by |
|---|---|---|---|
| 1 | A balance is a replay, never a stored number | LoanBook stores balances as derived views too, but nothing in the portfolio derives an *entitlement that grows on a schedule* | `ledger:verify` 198 rows, 0 diffs; L1 vs L2 (GA-17) |
| 2 | Policy as data with four frequencies, two prorations, two roundings, three year types | Adjuster's rules decide claims, not time | GA-01..GA-05, GA-11, GA-13, GA-20; six invalid policies rejected |
| 3 | Tier crossing at the event date, not at Jan 1 | — | GA-05; E012, E009 in the fixtures |
| 4 | Max-balance cap measured at posting, reopened by usage | — | GA-07; E003 |
| 5 | Three year boundaries (calendar, policy year, clamped anniversary) with forfeiture as a row | — | GA-06, GA-12, GA-14; 151 forfeitures |
| 6 | Retroactive recompute of forfeiture, in both directions, one row per trigger | Gridline cancels one bill; nothing re-measures a closed period | GA-10 (−960); S13 (+480) |
| 7 | Policy transfer inside one leave type, with tenure from the real hire date | — | GA-18; E033 |
| 8 | Routing as a pure function of org state at submit, with ordered codes | A2 (planned) approves single writes; no chains | GR-01..GR-14; 389 chains |
| 9 | Delegation with depth, self and HR-role rules and a fallback order | — | GR-04, GR-05, GR-10, GR-11, GR-14; S08, S09, S10, S20 |
| 10 | Frozen chain + eligibility at approval → void events | — | GR-15; S06, S07, S18: 15 void events |
| 11 | Submit-time balance check against `available`, deterministic, explained | — | GA-15, GA-16, GA-17; 33 system denials |
| 12 | Three-file byte-for-byte agreement as the product's own number | Siblings verify one output; this one verifies the ledger, the report and the request log together | `leave:eval` 0 diffs at the §12 hashes |

## Guardrails — lessons Ledgerleave must not take

| Lesson | Owner | Rule here |
|---|---|---|
| Double-entry accounting, interest accrual, delinquency | 08 LoanBook | One-sided ledger of minutes; no debit/credit pairs except the zero-sum transfer |
| Rules engine with authoring UI and impact diff | 09 Adjuster | A validated JSON editor and a year-boundary preview; no rule language |
| Billing from measurements, cancel-and-rebill | 10 Gridline (shelved) | Not applicable |
| Slot pricing, availability search | Bookable | Working days only; no slots |
| Live writes to an external system with approval rows | A2 Marketing-Ops Agent | Ledgerleave writes only its own database |
| Scheduler / cron that mutates state | BoxLoop | Accruals are replayed from data; a posting job (P1) must write exactly the replay's rows |
| Entity resolution, imports | 22 Housefile | Employees arrive as a fixture; no import pipeline |
| Tenant isolation, per-tenant billing; public API; webhooks | 19 / 20 (planned) | Foundation orgs as cloned; none |
| Real-time collaboration | planned | Inbox is request/response |
| Learned models | — | D-2; O-8 is an explainer experiment, not the engine |

## How this was checked

- Read: the Housefile kit (CLAUDE.md, PRD, decisions, brief, overlap, phase-1 tasks, tools), the saas-foundation README, CLONES.md and `scripts/new-project.ts`, the common brief. The source trees of loanbook, bookable, adjuster, bracketry, boxloop, callboard and showcall were **not** reachable from the kickoff workspace; the "Where" column is from their kickoff docs and CLONES notes and must be confirmed by reading the code before each port (task 1.3). Public repos (tradepost, gavel) can be cloned read-only from the cloud; private ones may not be reachable — say so in `NEXT.md`.
- `reuse-scan.py` is not reachable from the cloud (D-28); this document is the manual substitute.
