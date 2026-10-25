"""Ledgerleave — reference engine run and evaluation (test oracle, never product code).

Reads a fixtures directory produced by build_fixtures.py, replays every accrual, request
event and year boundary in posting order (brief §5) through tools/leavelib.py, and prints
measured numbers only: a summary, then one line per employee-year-leave type (accrued,
capped, used, forfeited, balance in minutes). With --requests it also prints one line per
request (frozen chain, final state). With --write-expected it writes

  fixtures/ledger.csv             every ledger entry in posting order
  fixtures/expected_balances.csv  the employee-year table
  fixtures/expected_requests.csv  per request: working days, minutes, chain, final state, event log

The TypeScript engines must reproduce all three byte for byte (`npm run leave:eval` diffs them).

Usage: python3 tools/reference_leave.py [--fixtures DIR] [--write-expected] [--requests]
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import leavelib as L  # noqa: E402
from build_fixtures import load_world  # noqa: E402

LEDGER_COLS = ["entry_id", "employee_id", "leave_type", "policy_id", "kind", "effective", "posted", "minutes", "capped_minutes", "codes", "ref", "seq"]
BAL_COLS = ["employee_id", "year", "leave_type", "opening", "accrued", "capped", "used", "forfeited", "balance_end"]
REQ_COLS = ["request_id", "employee_id", "leave_type", "policy_id", "start", "end", "submitted_on", "working_days", "minutes",
            "chain", "final_state", "final_code", "log"]


def write_csv(path: str, rows: list[dict], cols: list[str]) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({c: r[c] for c in cols})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"))
    ap.add_argument("--write-expected", action="store_true")
    ap.add_argument("--requests", action="store_true")
    args = ap.parse_args()

    w = load_world(args.fixtures)
    sim = L.Simulation(w)
    sim.run()
    led = sim.ledger

    years = [int(w.ledger_start[:4]), int(w.asof[:4])]
    bal_rows = L.employee_year_rows(led, list(w.org.emp.values()), years)
    req_rows = []
    for rid in sorted(sim.reqs):
        rs = sim.reqs[rid]
        req_rows.append({"request_id": rid, "employee_id": rs.req.employee_id, "leave_type": rs.req.leave_type, "policy_id": rs.policy_id,
                         "start": rs.req.start, "end": rs.req.end, "submitted_on": rs.req.submitted_on, "working_days": rs.working_days,
                         "minutes": rs.minutes, "chain": rs.chain, "final_state": rs.state if rs.state != "PENDING" else f"PENDING_{rs.step + 1}",
                         "final_code": rs.final_code, "log": ";".join(rs.log)})

    kinds = Counter(e.kind for e in led.entries)
    states = Counter(r["final_state"] for r in req_rows)
    codes = Counter(r["final_code"] for r in req_rows if r["final_code"])
    step_counts = Counter(len([s for s in sim.reqs[r["request_id"]].steps if s.kept]) for r in req_rows)
    route_codes = Counter()
    for rs in sim.reqs.values():
        for s in rs.steps:
            for c in s.codes:
                route_codes[c] += 1
    accr_codes = Counter()
    for e in led.entries:
        if e.kind == "ACCRUAL":
            for c in e.codes.split("+"):
                accr_codes[c] += 1

    print(f"fixtures: {os.path.basename(os.path.normpath(args.fixtures))}  ledger {w.ledger_start}..{w.asof}  employees {len(w.org.emp)}")
    print(f"ledger_entries: {len(led.entries)}")
    for k in ("ADJUSTMENT", "ACCRUAL", "USAGE", "USAGE_REVERSAL", "FORFEITURE", "TRANSFER_OUT", "TRANSFER_IN"):
        print(f"  {k}: {kinds.get(k, 0)}")
    print(f"accrual_codes: {dict(sorted(accr_codes.items()))}")
    print(f"forfeiture_recomputed_entries: {sim.recomputed}")
    print(f"requests: {len(req_rows)}")
    print(f"final_states: {dict(sorted(states.items()))}")
    print(f"final_codes: {dict(sorted(codes.items()))}")
    print(f"kept_steps_per_request: {dict(sorted(step_counts.items()))}")
    print(f"routing_codes: {dict(sorted(route_codes.items()))}")
    print(f"void_events: {sim.voided}  ignored_events: {sim.ignored}")
    for y in years:
        for lt in ("PTO", "SICK"):
            rs = [r for r in bal_rows if r["year"] == y and r["leave_type"] == lt]
            print(f"{y} {lt}: rows {len(rs)} accrued {sum(r['accrued'] for r in rs)} capped {sum(r['capped'] for r in rs)} "
                  f"used {sum(r['used'] for r in rs)} forfeited {sum(r['forfeited'] for r in rs)} balance_end {sum(r['balance_end'] for r in rs)}")
    print()
    print("employee_id year type   opening accrued capped   used forfeited balance_end")
    for r in bal_rows:
        print(f"{r['employee_id']:11} {r['year']} {r['leave_type']:5} {r['opening']:8} {r['accrued']:7} {r['capped']:6} "
              f"{r['used']:6} {r['forfeited']:9} {r['balance_end']:11}")
    if args.requests:
        print()
        for r in req_rows:
            print(f"{r['request_id']} {r['employee_id']} {r['leave_type']} {r['start']}..{r['end']} wd={r['working_days']} {r['final_state']} {r['final_code']} {r['chain']}")

    if args.write_expected:
        write_csv(os.path.join(args.fixtures, "ledger.csv"), [vars(e) for e in led.entries], LEDGER_COLS)
        write_csv(os.path.join(args.fixtures, "expected_balances.csv"), bal_rows, BAL_COLS)
        write_csv(os.path.join(args.fixtures, "expected_requests.csv"), req_rows, REQ_COLS)
        print(f"\nwrote ledger.csv ({len(led.entries)}), expected_balances.csv ({len(bal_rows)}), expected_requests.csv ({len(req_rows)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
