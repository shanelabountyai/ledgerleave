# Kickoff — Ledgerleave (Build Log #14, PTO & Approvals) — cloud-session variant

Paste the block below into a Claude Code cloud session on Fable (`/model claude-fable-5-1`). The kit is this folder; nothing has been cloned, installed or committed yet. The session works on a branch and opens a PR; it never merges.

```
Ledgerleave — PTO & approvals with an accrual engine and an approval-routing engine
(Build Log #14, main track). The kickoff kit is in ./ledgerleave-kickoff/ (this folder).
Nothing exists yet besides the kit.

Read, in order, from the kit: CLAUDE.md, prd-ledgerleave.md, docs/decisions.md
(authoritative), docs/domain-brief.md, docs/portfolio-overlap.md, docs/phase-1-tasks.md.

Steps, in order:
1. Port check. If ~/.claude/CLAUDE.md is reachable, read its port table; if 7300 is claimed,
   stop and tell me which port is free. If the file is not reachable, write
   "port 7300 unverified against the port table" in NEXT.md and continue.
2. Clone the template with shared history (NOT GitHub's "Use this template" button):
     git clone https://github.com/shanelabountyai/saas-foundation.git ledgerleave
     cd ledgerleave && git remote rename origin template
     git checkout -B main v1.3.0
     npm ci
     npm run new-project -- ledgerleave 7300
   Do not run new-project twice. Copy the kit in: CLAUDE.md, KICKOFF.md, NEXT.md,
   prd-ledgerleave.md, docs/*.md, tools/*.py, fixtures/samples/, .claude/settings.json
   (merge the model pin; keep anything the template put there). Add the scope-honesty
   banner from the PRD to README.md verbatim.
3. Add the clone row to saas-foundation/CLONES.md in a separate branch of the template
   repo (v1.3.0, today's date, "PTO & approvals: ledger-derived accrual engine, data-driven
   approval routing with delegation; port 7300; public; synthetic only; not deployed")
   and show me the diff; do not push it until I say so. Put
   ?connection_limit=10&pool_timeout=20 on the local DATABASE_URLs. Confirm vercel.json
   has the house ignoreCommand. Add the ~/.claude/CLAUDE.md port row only if that file is
   reachable; otherwise list it under "Still to do by hand" in NEXT.md.
4. npm run db:setup, then confirm the template is unchanged: npm run foundation:drift and
   npm test pass before any Ledgerleave code exists. If Prisma engines or Playwright
   browsers cannot be downloaded in this sandbox, record exactly which command failed and
   why in NEXT.md and continue; CI is the gate.
5. Oracle check: python3 -I tools/golden_answers.py ends with OK. Then
   python3 -I tools/build_fixtures.py --seed 20261025 (writes fixtures/), then
   python3 -I tools/reference_leave.py --write-expected (writes fixtures/ledger.csv,
   expected_balances.csv, expected_requests.csv and prints the summary), then
   python3 -I tools/verify_fixtures.py ends with OK. Compare the sha256 values with
   docs/domain-brief.md section 12 and fixtures/samples/MANIFEST.json, and the printed
   summary with fixtures/samples/reference_output.txt. Report any mismatch; do not fix
   either side.
6. Reuse check: ~/Projects/reuse-scan.py is not reachable from the cloud. Record in
   docs/decisions.md "reuse scan skipped: not reachable from the cloud;
   docs/portfolio-overlap.md is the manual substitute" with today's date.
7. Read every doc. List anything that contradicts itself or can't be built as written,
   and anything in docs/portfolio-overlap.md whose donor path you could not find when you
   read the donor repos (loanbook, bookable, adjuster, callboard — clone them read-only if
   they are public; otherwise say "not reachable"). Don't resolve these yourself.
8. Create branch `kickoff` and commit in three commits, naming files explicitly (never
   git add -A):
   (a) the new-project rewrite (package.json, playwright.config.ts, .github/workflows/ci.yml,
       README.md, vercel.json);
   (b) the kickoff docs and tools (CLAUDE.md, KICKOFF.md, NEXT.md, prd-ledgerleave.md,
       docs/*.md, tools/*.py, fixtures/samples/, .claude/settings.json);
   (c) the generated fixtures (fixtures/*.csv, fixtures/policies.json,
       fixtures/MANIFEST.json) — show me the hash table first.
   Push the branch to a new public repo shanelabountyai/ledgerleave (gh repo create
   --public, then git remote add origin). Before the push:
   git ls-files | grep -iE "\.env|secret|credential|\.pem$|\.key$" must show only
   .env.example. Open a PR "kickoff: template clone, kit, frozen fixtures" against main.
   Do not merge.
9. Plan first: write the Phase 1 plan as the order you will do tasks 1.1 to 1.12 in, which
   donor you will read for each port in 1.3, and the three places you expect the TypeScript
   calendar to disagree with Python's datetime (week-day, month-end, clamped anniversary).
   Stop and show me the plan, the step 5 output, the contradictions list and the step 4
   sandbox report before writing any product code.

Stop there. Do not create Prisma models, migrations, UI or engine code before I have
reviewed the plan. Update NEXT.md before you stop.

Rules from the first commit: a balance is never stored, only derived from the ledger; the
ledger is append-only; src/accrual/ and src/routing/ import no database, clock, randomness,
network or model client; the approval chain is frozen at submit; time is integer minutes;
dates are YYYY-MM-DD strings, never new Date(string); fixtures are never generated or read
by product code; never edit an expected value to pass a test; never edit template-owned
paths (src/core/**, tests/invariants/**, core migrations, security routes); no new
dependencies without asking; no "correct" or "robust" anywhere without the number; never
merge the PR.
```

## Still to do by hand

- Review and merge the kickoff PR; then merge the `CLONES.md` row in saas-foundation.
- `~/.claude/CLAUDE.md`: add the port row (ledgerleave → 7300) if the session could not.
- Build-log card #14: name **Ledgerleave**, PRD and repo links, status `in progress`, chips per `docs/portfolio-overlap.md` "Suggested card chips".
- Neon and Vercel only if this is ever deployed (not planned; synthetic data).
- Decide O-1..O-10 when they come up; defaults are in force.
