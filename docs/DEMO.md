# Ledgerleave — demo script

About 15 minutes: five minutes of terminal (the engines and the proofs), ten of browser (one request's life through a frozen chain). Synthetic data only; every person is generated or one of the ten hand-written H1–H10. Every terminal command below was run on 2026-10-27 on the Mac and printed what is quoted; `npm start` served `/demo` with the six accounts. The browser walk in §3 is `e2e/leave.spec.ts`, which starts from the same `seedDemoWalk` and passed (8/8 with `demo.spec.ts`) the same day.

## Before the audience arrives (once)

```bash
brew services start postgresql@17      # pg_isready → accepting connections
npm ci
npm run db:setup                       # creates ledgerleave + ledgerleave_test, writes .env.local and .env.test, migrates both
npm run seed:demo                      # the six demo accounts (acme / globex: owner, admin, member)
npm run leave:import -- --org ledgerleave-fixture
npm run leave:replay                   # 6688 rows inserted
npm run leave:seed:walk                # org "walk": the hand org with demo accounts linked and R-0001/R-0002 submitted
npm run build && npm start             # http://localhost:7300
```

`db:setup` never overwrites an existing `.env.*` and never prints a value. `.env.local` gets `DEMO_MODE=1`, which is what makes `/demo` exist; without it `/demo` is a 404. `leave:seed:walk` refuses if org `walk` exists: pass another slug (`npm run leave:seed:walk -- walk2`) for a second run.

**Accounts** — no passwords. `/demo` lists the six `@*.demo.test` accounts as buttons; one click signs in (DEMO_MODE only). They are created by `scripts/seed-demo.ts`, which refuses a cloud database. In org `walk` they act as:

| Account | Hand-org employee | Role in the walk |
|---|---|---|
| `member@acme.demo.test` | H4 Hal (IC) | requester of R-0001 and R-0002 |
| `admin@acme.demo.test` | H3 Hilde (manager) | H4's manager when the chains froze |
| `member@globex.demo.test` | H2 Hugo (VP) | skip-level; becomes H4's manager on 2025-05-07 |
| `admin@globex.demo.test` | H7 Hector (HR manager) | HR step approver; loses the HR role on 2025-05-06 |
| `owner@acme.demo.test` | H8 Heidi (HR generalist) | still holds HR |
| `owner@globex.demo.test` | nobody | org owner (opens the HR console as an org admin) |

The TOTP secret the seed prints is for the template's own MFA screens, not needed here.

## 1. Terminal: the engines agree with the oracle (2 min)

```bash
npm run leave:eval
```
Prints `diff ledger.csv: 0 diffs (5057 rows)`, `expected_balances.csv: 0 diffs (198 rows)`, `expected_requests.csv: 0 diffs (389 rows)`, `leave:eval OK: 0 diffs across 3 files`.

**Say:** "There is no balance column. Every number is the sum of an append-only ledger, and the TypeScript engines replay two years of a 50-person company and match a separate Python reference on every one of 5057 entries. If one minute differed, this exits non-zero and CI goes red — we proved that on purpose once."

```bash
npm run leave:route -- --employee E027 --start 2025-04-14 --end 2025-04-15 --submit 2025-04-01
```
Prints `chain: MANAGER:E003[MANAGER_OF_REQUESTER,APPROVER_INACTIVE_TO_MANAGER]`, `balance check: OK`, `nothing was written.`

**Say:** "E027's manager left the day before. The router doesn't guess: it skips to the next manager up and says why, with an ordered reason code."

```bash
npm run leave:route -- --employee E049 --start 2025-10-13 --end 2025-10-24 --submit 2025-09-29
```
Prints a two-step chain (`MANAGER:E008`, `SKIP_LEVEL:E002`, ten days triggers the skip level) and `DENIED INSUFFICIENT_BALANCE at submit (A8); the chain above is still shown`.

## 2. Terminal: the same answers from the database (2 min)

```bash
npm run leave:replay                   # second time: "leave:replay OK: 0 row(s) inserted", same ledger hash d2a090f8…
npm run leave:eval:db                  # 5057 / 198 / 389, 0 diffs, "read from the database"
```

**Say:** "Replaying is idempotent: the second run writes nothing and the ledger hash is unchanged. And the three reference files rebuild from the rows alone. 759 notices are sitting in an outbox as QUEUED; nothing is ever sent."

## 3. Browser: one request through a frozen chain (8 min)

The GR-15 golden case, clicked. R-0001 (2 days) and R-0002 (11 days) were submitted by H4 on 2025-05-05, so their chains froze before the org changed on 05-06 and 05-07. Clicks are dated on the server's real today.

Open http://localhost:7300/demo for each step; sign in as the account named, then go to the URL.

1. **`admin@acme.demo.test` (H3) → `/o/walk/leave/inbox`.** Both requests are waiting on H3. Click **Approve R-0002**. Status: `R-0002: PENDING_2 — APPROVE:H3:<today>:MANAGER`.
   **Say:** "The inbox is just the chain's current step. Approve moves R-0002 to its second step."
2. **`member@globex.demo.test` (H2) → `/o/walk/leave/inbox`.** **Approve R-0002** → `PENDING_3`. The inbox reads `Requests waiting on Hugo (VP) (H2): 0`, yet R-0001 is listed under his reports. Open **R-0001**, click **Approve R-0001** → `R-0001: VOID — VOID_APPROVE:H2:<today>:APPROVER_NOT_STEP_APPROVER`.
   **Say:** "H2 is H4's manager *now*, but the chain froze at submit naming H3. The approval is logged, voided, and changes nothing. That's the point of freezing: an org chart edit can't reroute a request in flight."
3. **`admin@globex.demo.test` (H7) → inbox → Approve R-0002** → `VOID … APPROVER_INELIGIBLE_ROLE_REVOKED`.
   **Say:** "Same rule for roles: H7 was the HR approver when the chain froze but lost HR on May 6."
4. **`owner@acme.demo.test` (H8) → `/o/walk/leave/hr`.** Show the employee-year table and the outbox (no send button). Under *Reassign the current step of R-0002 to*, pick **H8 Heidi (HR generalist)**, click **Reassign R-0002** → `REASSIGN:H8:<today>:STEP_REASSIGNED->H8`. Then inbox → **Approve R-0002** → `R-0002: APPROVED`.
5. **`admin@acme.demo.test` (H3) → inbox → Approve R-0001** → `R-0001: APPROVED`.
6. **`member@acme.demo.test` (H4) → `/o/walk/leave`.** Both approved; R-0002's HR step shows `(routed to H7, reassigned)`. Preview **SICK 2025-05-20..2025-05-20**: `would be DENIED OVERLAPPING_REQUEST`. Submit it anyway → `R-0003: DENIED (OVERLAPPING_REQUEST)`. Click **My ledger** for the running balance, row by row.
   **Say:** "The preview runs the same engine as the submit, so it can't disagree with it. The balance is summed fresh on every load."
7. *(Optional, ends the org)* **`owner@globex.demo.test` → `/o/walk/leave/hr` → Archive org** with a reason. The org goes read-only with a banner and disappears from `/orgs`. Nothing is deleted.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/demo` is a 404 | `DEMO_MODE=1` missing from `.env.local`, or the build was made before it was set | `grep DEMO_MODE .env.local`; rebuild |
| `/o/walk/leave` is a 404 | `leave:seed:walk` not run, or it used another slug | `npm run leave:seed:walk -- <slug>` and use that slug in the URLs |
| `leave:seed:walk` fails with a unique-constraint error | org `walk` already exists | pass a new slug |
| `leave:route: unknown employee H4` | the CLI reads `fixtures/`; H1–H10 exist only in the database | use a fixture id (`E001`–`E050`) |
| `leave:eval:db` says `org ledgerleave-fixture not found` | `leave:import` not run against `.env.local`'s database | `npm run leave:import -- --org ledgerleave-fixture && npm run leave:replay` |
| A click shows an unexpected state (e.g. R-0002 already APPROVED) | the walk was already clicked through in this org | `npm run leave:seed:walk -- walk2` |
| Port 7300 busy | another `next start` | `lsof -ti :7300 \| xargs kill` |

## Concede before you're asked

- **"0 diffs" is agreement, not correctness.** The TypeScript and the Python oracle were written by the same author from the same brief. It proves the engines do what the brief says, not that the brief suits a real company (D-24).
- **The sick-leave policy is a sample.** Shaped like a statutory accrual floor, not any jurisdiction's law. No HR, payroll or legal advice.
- **Synthetic data, deployed only as a password-gated demo (D-57).** No email, calendar or payroll integration: notices queue and are never sent.
- **Not built:** half days, pending requests reserving balance, payout at termination, policy editing in the UI, blackout dates. The fixtures do not generate half days or zero-day requests.
- **Sign-in in the demo is a button.** `/demo` exists only with `DEMO_MODE=1`; real sign-in is the template's magic link + TOTP.
- **The template's `/onboarding` list still shows archived orgs**; the app's own `/orgs` hides them.
