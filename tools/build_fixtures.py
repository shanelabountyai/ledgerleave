"""Ledgerleave — seeded synthetic fixture generator (test oracle, never product code).

Produces, under fixtures/ (default) or --out DIR:
  policies.json        three leave policies + routing table as data (brief §3)
  employees.csv        50 synthetic employees, 4-level reporting tree, HR role holders
  assignments.csv      policy assignments per employee and leave type (one hourly->salaried transfer)
  holidays.csv         company holidays 2024–2025
  timesheets.csv       minutes worked per pay period for hourly employees
  delegations.csv      out-of-office delegations (including a chained pair and a delegate-is-requester)
  org_changes.csv      manager moves and an HR role revoke/grant, each with an effective date
  opening_balances.csv ledger opening balances dated 2023-12-31 for pre-2024 hires
  requests.csv         ~400 leave requests over 2024–2025 with injected traps
  request_events.csv   submit / approve / deny / cancel / reassign events, scripted by actor and date
  MANIFEST.json        seed, counts, trap list, sha256 of every file

Deterministic: python3 tools/build_fixtures.py --seed 20261025 twice gives identical bytes.
Standard library only. No real people: names are drawn from fixed lists.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import random
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import leavelib as L  # noqa: E402

SEED_DEFAULT = 20261025
LEDGER_START = "2024-01-01"
ASOF = "2025-12-31"
PAY_ANCHOR = "2024-01-01"
PAY_LENGTH = 14

POLICIES = {
    "version": 1,
    "work_day_minutes": 480,
    "pay_period": {"anchor_start": PAY_ANCHOR, "length_days": PAY_LENGTH},
    "routing_table": {"steps": ["MANAGER", "SKIP_LEVEL", "HR"], "delegation_max_depth": 1,
                      "fallback_order": ["HR_PRIMARY", "OTHER_HR", "CEO"]},
    "policies": [
        {"id": "PTO_SALARIED", "leave_type": "PTO",
         "accrual": {"frequency": "MONTHLY", "proration": "DAILY", "rounding": "HALF_UP",
                     "tiers": [{"min_tenure_months": 0, "minutes_per_period": 600},
                               {"min_tenure_months": 24, "minutes_per_period": 720},
                               {"min_tenure_months": 60, "minutes_per_period": 840}]},
         "year": {"type": "CALENDAR"}, "carryover_cap_minutes": 2400, "max_balance_minutes": 12000,
         "allow_negative": False, "routing": {"skip_level_over_days": 5, "hr_over_days": 10}},
        {"id": "PTO_HOURLY", "leave_type": "PTO",
         "accrual": {"frequency": "PER_HOURS_WORKED", "minutes_per_60_worked": 2, "proration": "NONE", "rounding": "FLOOR"},
         "year": {"type": "ANNIVERSARY"}, "carryover_cap_minutes": 2400, "max_balance_minutes": 4800,
         "allow_negative": False, "routing": {"skip_level_over_days": 5, "hr_over_days": 10}},
        {"id": "SICK_STD", "leave_type": "SICK",
         "accrual": {"frequency": "PER_PAY_PERIOD", "proration": "NONE", "rounding": "HALF_UP",
                     "tiers": [{"min_tenure_months": 0, "minutes_per_period": 120}]},
         "year": {"type": "POLICY_YEAR", "starts": "07-01"}, "carryover_cap_minutes": 2400, "max_balance_minutes": 2880,
         "allow_negative": True, "routing": {"skip_level_over_days": None, "hr_over_days": 3}},
    ],
}

HOLIDAYS = ["2024-01-01", "2024-01-15", "2024-05-27", "2024-07-04", "2024-09-02", "2024-11-28", "2024-11-29", "2024-12-25",
            "2025-01-01", "2025-01-20", "2025-05-26", "2025-07-04", "2025-09-01", "2025-11-27", "2025-11-28", "2025-12-25"]

FIRST = ["Avery", "Blake", "Casey", "Dana", "Ellis", "Finley", "Gray", "Harper", "Indigo", "Jules", "Kai", "Lane",
         "Morgan", "Noor", "Oakley", "Parker", "Quinn", "Reese", "Sage", "Tatum", "Uma", "Vale", "Wren", "Xan",
         "Yael", "Zion", "Ari", "Bex", "Cyd", "Dev", "Emery", "Flor", "Gale", "Hollis", "Ira", "Jem", "Kit", "Lux",
         "Marlow", "Nico", "Onyx", "Pax", "Rio", "Sloan", "Tove", "Ulla", "Vic", "Wynn", "Yuri", "Zola"]
LAST = ["Abara", "Brennan", "Castellano", "Delacroix", "Eriksen", "Fairweather", "Gutierrez", "Haddad", "Ibarra",
        "Jankowski", "Kowalski", "Lindqvist", "Mbeki", "Nakamura", "Okafor", "Petrov", "Quigley", "Rasmussen",
        "Sato", "Thornton", "Umeh", "Varga", "Whitfield", "Xiong", "Yilmaz", "Zapata", "Achebe", "Bergstrom",
        "Calloway", "Dimitriou", "Esposito", "Fontaine", "Galloway", "Hoshino", "Ivanova", "Joshi", "Kaur",
        "Larsen", "Moreau", "Nwosu", "Oyelaran", "Pham", "Reyes", "Sorensen", "Tanaka", "Ueda", "Vasquez", "Wojcik",
        "Yoon", "Zielinski"]

# (id, title, dept, manager, employment_type, roles, hire_date, term_date)
# Scripted hire dates carry the traps (brief §4); the rest are drawn.
ORG = [
    ("E001", "CEO", "Exec", "", "SALARIED", "", "2015-01-05", ""),
    ("E002", "VP Engineering", "Engineering", "E001", "SALARIED", "", "2016-03-07", ""),
    ("E003", "VP Operations", "Operations", "E001", "SALARIED", "", "2016-09-12", ""),      # T7 max-balance cap
    ("E004", "VP Sales", "Sales", "E001", "SALARIED", "", "2018-02-05", ""),
    ("E005", "VP People", "People", "E001", "SALARIED", "", "2017-06-19", ""),
    ("E006", "HR Manager", "People", "E005", "SALARIED", "HR", "2019-10-14", ""),           # HR primary; role revoked 2025-10-01
    ("E007", "HR Generalist", "People", "E006", "SALARIED", "HR", "2022-01-10", ""),        # HR backup; primary after revoke
    ("E008", "Eng Manager", "Engineering", "E002", "SALARIED", "", None, ""),
    ("E009", "Eng Manager", "Engineering", "E002", "SALARIED", "", "2019-03-10", ""),       # T2 tier 60 crossing 2024-03
    ("E010", "Engineer", "Engineering", "E008", "SALARIED", "", None, ""),
    ("E011", "Engineer", "Engineering", "E008", "SALARIED", "", None, ""),
    ("E012", "Engineer", "Engineering", "E008", "SALARIED", "", "2022-08-20", ""),          # T2 tier 24 crossing 2024-08
    ("E013", "Engineer", "Engineering", "E008", "SALARIED", "", None, ""),
    ("E014", "Engineer", "Engineering", "E008", "SALARIED", "", None, ""),                  # T12 manager change mid-flight
    ("E015", "Engineer", "Engineering", "E009", "SALARIED", "", None, ""),
    ("E016", "Engineer", "Engineering", "E009", "SALARIED", "", None, ""),
    ("E017", "Engineer", "Engineering", "E009", "SALARIED", "", "2024-02-15", ""),          # T1/T5 leap-month proration
    ("E018", "Engineer", "Engineering", "E009", "SALARIED", "", None, ""),
    ("E019", "Engineer", "Engineering", "E009", "SALARIED", "", None, "2025-05-10"),        # T9 termination proration
    ("E020", "Warehouse Manager", "Operations", "E003", "SALARIED", "", None, ""),
    ("E021", "Support Manager", "Operations", "E003", "SALARIED", "", None, "2025-03-31"),  # T13 inactive manager
    ("E022", "Warehouse Associate", "Operations", "E020", "HOURLY", "", None, "2024-10-18"),
    ("E023", "Warehouse Associate", "Operations", "E020", "HOURLY", "", None, ""),
    ("E024", "Warehouse Associate", "Operations", "E020", "HOURLY", "", None, ""),
    ("E025", "Warehouse Associate", "Operations", "E020", "HOURLY", "", None, ""),
    ("E026", "Warehouse Associate", "Operations", "E020", "HOURLY", "", None, ""),
    ("E027", "Support Agent", "Operations", "E021", "HOURLY", "", None, ""),
    ("E028", "Support Agent", "Operations", "E021", "HOURLY", "", None, ""),
    ("E029", "Support Agent", "Operations", "E021", "HOURLY", "", None, ""),
    ("E030", "Support Agent", "Operations", "E021", "HOURLY", "", "2024-02-29", ""),        # T5 leap-day hire, anniversary clamp
    ("E031", "Support Agent", "Operations", "E021", "HOURLY", "", "2024-03-20", ""),        # T1 sick hire mid-period
    ("E032", "Support Agent", "Operations", "E021", "HOURLY", "", None, ""),
    ("E033", "Support Lead", "Operations", "E021", "HOURLY", "", "2023-04-03", ""),         # T10 hourly->salaried 2025-06-30
    ("E034", "Support Agent", "Operations", "E021", "HOURLY", "", None, ""),
    ("E035", "Support Agent", "Operations", "E021", "HOURLY", "", None, ""),
    ("E036", "Sales Manager", "Sales", "E004", "SALARIED", "", None, ""),
    ("E037", "Account Executive", "Sales", "E036", "SALARIED", "", None, ""),               # T11 delegate-is-requester
    ("E038", "Account Executive", "Sales", "E036", "SALARIED", "", None, ""),
    ("E039", "Account Executive", "Sales", "E036", "SALARIED", "", None, ""),
    ("E040", "Account Executive", "Sales", "E036", "SALARIED", "", None, ""),
    ("E041", "Account Executive", "Sales", "E036", "SALARIED", "", None, ""),               # T14 HR role revoked mid-flight
    ("E042", "Account Executive", "Sales", "E036", "SALARIED", "", None, ""),
    ("E043", "Account Executive", "Sales", "E036", "SALARIED", "", None, ""),
    ("E044", "Recruiter", "People", "E005", "SALARIED", "", None, ""),
    ("E045", "Controller", "Finance", "E001", "SALARIED", "", None, ""),
    ("E046", "Accountant", "Finance", "E045", "SALARIED", "", None, ""),
    ("E047", "Accountant", "Finance", "E045", "SALARIED", "", None, ""),
    ("E048", "Warehouse Associate", "Operations", "E020", "HOURLY", "", None, ""),
    ("E049", "Engineer", "Engineering", "E008", "SALARIED", "", "2025-09-08", ""),          # T8 new hire, insufficient balance
    ("E050", "Account Executive", "Sales", "E036", "SALARIED", "", None, ""),
]

DELEGATIONS = [  # approver, delegate, start, end — the first five are traps named in brief §4
    ("E008", "E009", "2024-06-10", "2024-06-21"),   # T15 plain delegation
    ("E002", "E003", "2024-09-02", "2024-09-13"),   # T16 chained pair ...
    ("E003", "E004", "2024-09-09", "2024-09-20"),   # ... depth exceeded for a skip-level to E002 on 09-10
    ("E036", "E037", "2025-02-03", "2025-02-14"),   # T11 delegate is the requester (E037)
    ("E006", "E007", "2025-07-07", "2025-07-18"),   # HR primary delegates to backup
    ("E001", "E005", "2024-11-18", "2024-11-29"),   # CEO delegates to VP People
    ("E020", "E003", "2024-03-18", "2024-03-29"),
    ("E009", "E008", "2024-12-16", "2024-12-27"),
    ("E004", "E001", "2025-04-14", "2025-04-25"),
    ("E045", "E001", "2025-08-04", "2025-08-15"),
    ("E021", "E020", "2024-07-15", "2024-07-26"),
    ("E036", "E004", "2024-05-13", "2024-05-24"),
    ("E005", "E006", "2025-11-03", "2025-11-14"),
    ("E008", "E002", "2025-10-13", "2025-10-24"),
]

ORG_CHANGES = [  # effective, employee, field, old, new
    ("2025-04-03", "E027", "MANAGER", "E021", "E020"),   # after E021 left 03-31; E027's 04-01 request hits R3
    ("2025-04-03", "E028", "MANAGER", "E021", "E020"),
    ("2025-04-03", "E029", "MANAGER", "E021", "E020"),
    ("2025-04-03", "E030", "MANAGER", "E021", "E020"),
    ("2025-04-03", "E031", "MANAGER", "E021", "E020"),
    ("2025-04-03", "E032", "MANAGER", "E021", "E020"),
    ("2025-04-03", "E033", "MANAGER", "E021", "E020"),
    ("2025-04-03", "E034", "MANAGER", "E021", "E020"),
    ("2025-04-03", "E035", "MANAGER", "E021", "E020"),
    ("2025-05-12", "E014", "MANAGER", "E008", "E009"),   # T12 mid-flight manager change
    ("2025-10-01", "E006", "ROLE_REVOKED", "HR", "HR"),  # T14 HR primary loses the role; E007 becomes primary
]

# Scripted requests: (id tag, employee, leave_type, start, end, submit, script). Script is a list of
# (offset_days_from_submit, actor, action[, target]); "A1".."A3" = approver of kept step 1..3.
SCRIPTED = [
    # T6 year-boundary span: Dec 30 2024 – Jan 3 2025 (4 working days; Jan 1 holiday)
    ("S01", "E011", "PTO", "2024-12-30", "2025-01-03", "2024-12-02", [(1, "A1", "APPROVE")]),
    # T4 cancelled after year end: approved in Dec, cancelled Jan 8 -> reversal lands in 2024, forfeiture recomputed
    ("S02", "E013", "PTO", "2024-12-16", "2024-12-17", "2024-12-02", [(1, "A1", "APPROVE"), (37, "SELF", "CANCEL")]),
    # T7 max-balance cap reopened by usage (E003 opening 11600, tier 840)
    ("S03", "E003", "PTO", "2024-04-08", "2024-04-09", "2024-03-25", [(1, "A1", "APPROVE")]),
    # T8 new hire asks for 10 days in month two -> INSUFFICIENT_BALANCE at submit
    ("S04", "E049", "PTO", "2025-10-13", "2025-10-24", "2025-09-29", [(1, "A1", "APPROVE")]),
    # T13 manager terminated 03-31, org change lands 04-03: request on 04-01 climbs to E003
    ("S05", "E027", "PTO", "2025-04-14", "2025-04-15", "2025-04-01", [(2, "A1", "APPROVE")]),
    # T12 manager change mid-flight: E008 is frozen; E009 (new manager) approving is void
    ("S06", "E014", "PTO", "2025-05-26", "2025-05-28", "2025-05-09", [(4, "E009", "APPROVE"), (5, "E008", "APPROVE")]),
    # T14 HR role revoked mid-flight: 12 days -> HR step E006; E006 approving on 10-02 is void; E007 reassigns + approves
    ("S07", "E041", "PTO", "2025-10-20", "2025-11-04", "2025-09-24",
     [(1, "A1", "APPROVE"), (2, "A2", "APPROVE"), (8, "E006", "APPROVE"), (9, "E007", "REASSIGN", "E007"), (10, "E007", "APPROVE")]),
    # T16 chained delegation: E008 asks 7 days on 2024-09-10; skip-level E002 -> E003 -> E004 = depth exceeded -> HR
    ("S08", "E008", "PTO", "2024-09-23", "2024-10-01", "2024-09-10", [(1, "A1", "APPROVE"), (2, "A2", "APPROVE")]),
    # T11 delegate is requester: E036 -> E037; E037's 2-day request has no manager step -> FALLBACK HR
    ("S09", "E037", "PTO", "2025-02-20", "2025-02-21", "2025-02-05", [(1, "A1", "APPROVE")]),
    # T15 plain delegation E008 -> E009
    ("S10", "E010", "PTO", "2024-06-24", "2024-06-25", "2024-06-12", [(1, "A1", "APPROVE")]),
    # CEO request: manager is HR
    ("S11", "E001", "PTO", "2025-03-10", "2025-03-11", "2025-02-24", [(1, "A1", "APPROVE")]),
    # HR primary asks 11 days: HR step is self -> manager (E005) -> duplicate of step 1
    ("S12", "E006", "PTO", "2025-08-04", "2025-08-18", "2025-07-01", [(1, "A1", "APPROVE"), (2, "A2", "APPROVE")]),
    # Retroactive sick request crossing the sick policy-year boundary (June 30): approved July 3
    ("S13", "E024", "SICK", "2025-06-27", "2025-07-01", "2025-07-01", [(2, "A1", "APPROVE")]),
    # Long sick (4 days) -> HR step
    ("S14", "E038", "SICK", "2024-10-07", "2024-10-10", "2024-10-07", [(1, "A1", "APPROVE"), (2, "A2", "APPROVE")]),
    # Pending at as-of: submitted Dec 2025, step 1 approved, step 2 not
    ("S15", "E016", "PTO", "2026-01-12", "2026-01-20", "2025-12-15", [(1, "A1", "APPROVE")]),
    # Denied by approver
    ("S16", "E040", "PTO", "2024-08-12", "2024-08-13", "2024-07-29", [(1, "A1", "DENY")]),
    # Cancelled while pending
    ("S17", "E046", "PTO", "2025-06-09", "2025-06-10", "2025-05-26", [(1, "SELF", "CANCEL")]),
    # Wrong approver (peer) first, then the right one
    ("S18", "E023", "PTO", "2024-05-06", "2024-05-07", "2024-04-22", [(1, "E024", "APPROVE"), (2, "A1", "APPROVE")]),
    # Approved then cancelled before the dates, same year
    ("S19", "E039", "PTO", "2024-03-18", "2024-03-20", "2024-03-04", [(1, "A1", "APPROVE"), (5, "SELF", "CANCEL")]),
    # VP request while CEO delegates to VP People
    ("S20", "E004", "PTO", "2024-12-02", "2024-12-03", "2024-11-20", [(1, "A1", "APPROVE")]),
]


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def write_csv(path: str, rows: list[dict], cols: list[str]) -> bytes:
    buf = io.StringIO()
    wtr = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n")
    wtr.writeheader()
    for r in rows:
        wtr.writerow(r)
    data = buf.getvalue().encode("utf-8")
    with open(path, "wb") as f:
        f.write(data)
    return data


def write_text(path: str, text: str) -> bytes:
    data = text.encode("utf-8")
    with open(path, "wb") as f:
        f.write(data)
    return data


class Gen:
    def __init__(self, seed: int):
        self.rng = random.Random(seed)
        self.seed = seed
        self.employees: list[L.Employee] = []
        self.assignments: list[L.Assignment] = []
        self.timesheets: list[dict] = []
        self.opening: list[dict] = []
        self.requests: list[dict] = []
        self.events: list[dict] = []
        self.busy: dict[str, list[tuple[date, date]]] = {}
        self.traps: dict[str, int] = {}
        self.holidays = set(HOLIDAYS)

    # -- org
    def build_org(self) -> None:
        r = self.rng
        names = list(zip(FIRST, LAST))
        for i, (eid, title, dept, mgr, et, roles, hire, term) in enumerate(ORG):
            if hire is None:
                hire = L.fmt(date(2017, 1, 1) + timedelta(days=r.randrange(0, 2800)))   # 2017-01 .. 2024-08
                # keep the drawn hire date on a weekday
                while L.parse_d(hire).weekday() >= 5:
                    hire = L.fmt(L.parse_d(hire) + timedelta(days=1))
            fn, ln = names[i]
            self.employees.append(L.Employee(eid, f"{fn} {ln}", hire, term, mgr, dept, title, et, roles))
        for e in self.employees:
            if e.id == "E033":
                self.assignments.append(L.Assignment(e.id, "PTO", "PTO_HOURLY", e.hire_date, "2025-06-29"))
                self.assignments.append(L.Assignment(e.id, "PTO", "PTO_SALARIED", "2025-06-30", e.term_date))
            else:
                self.assignments.append(L.Assignment(e.id, "PTO", "PTO_SALARIED" if e.employment_type == "SALARIED" else "PTO_HOURLY",
                                                     e.hire_date, e.term_date))
            self.assignments.append(L.Assignment(e.id, "SICK", "SICK_STD", e.hire_date, e.term_date))
        # opening balances for pre-window hires (the ledger starts 2024-01-01; brief D-12)
        for e in self.employees:
            if e.hire_date < LEDGER_START:
                if e.id == "E003":
                    pto = 11600
                elif e.employment_type == "HOURLY":
                    pto = r.randrange(0, 4000, 10)
                else:
                    pto = r.randrange(0, 2400, 10)
                sick = r.randrange(0, 2880, 10)
                self.opening.append({"employee_id": e.id, "leave_type": "PTO", "minutes": pto})
                self.opening.append({"employee_id": e.id, "leave_type": "SICK", "minutes": sick})
        # timesheets for hourly assignments: minutes worked per pay period while active on the period end
        anchor = L.parse_d(PAY_ANCHOR)
        mix = [4800, 4800, 4800, 4800, 4500, 4790, 5280, 3600, 4200, 4785]
        for a in self.assignments:
            if a.policy_id != "PTO_HOURLY":
                continue
            lo = max(L.parse_d(LEDGER_START), L.parse_d(a.start))
            hi = min(L.parse_d(ASOF), L.parse_d(a.end)) if a.end else L.parse_d(ASOF)
            for pe in L.pay_period_ends(anchor, PAY_LENGTH, lo, hi):
                self.timesheets.append({"employee_id": a.employee_id, "period_end": L.fmt(pe), "minutes_worked": r.choice(mix)})
        self.timesheets.sort(key=lambda t: (t["employee_id"], t["period_end"]))

    # -- requests
    def _free(self, eid: str, s: date, e: date) -> bool:
        for (bs, be) in self.busy.get(eid, []):
            if s <= be + timedelta(days=3) and e >= bs - timedelta(days=3):
                return False
        return True

    def _emp(self, eid: str) -> L.Employee:
        return next(e for e in self.employees if e.id == eid)

    def _add_request(self, rid: str, eid: str, lt: str, s: date, e: date, submit: date, trap: str = "") -> None:
        self.requests.append({"request_id": rid, "employee_id": eid, "leave_type": lt, "start": L.fmt(s), "end": L.fmt(e),
                              "submitted_on": L.fmt(submit), "trap": trap})
        self.busy.setdefault(eid, []).append((s, e))
        if trap:
            self.traps[trap] = self.traps.get(trap, 0) + 1

    def build_requests(self) -> None:
        r = self.rng
        n = 0
        # scripted first so they own their dates
        for tag, eid, lt, s, e, sub, script in SCRIPTED:
            n += 1
            self._add_request(f"R-{n:04d}", eid, lt, L.parse_d(s), L.parse_d(e), L.parse_d(sub), trap=tag)
            self.events.append({"_rid": f"R-{n:04d}", "_script": script})
        # generated
        lo, hi = L.parse_d(LEDGER_START), L.parse_d(ASOF)
        for emp in self.employees:
            if emp.id in ("E003", "E049", "E006", "E008", "E013", "E016", "E024", "E041"):
                continue   # employees whose scripted request needs the balance keep a clean ledger (brief §4)
            e_lo = max(lo, L.parse_d(emp.hire_date) + timedelta(days=45))
            e_hi = min(hi, L.parse_d(emp.term_date) - timedelta(days=14)) if emp.term_date else hi
            if e_lo >= e_hi:
                continue
            years = max(1, round(((e_hi - e_lo).days) / 365))
            n_pto = r.choice([2, 3, 3, 4]) * years
            n_sick = r.randrange(1, 3) * years
            for kind, count in (("PTO", n_pto), ("SICK", n_sick)):
                tries = 0
                made = 0
                while made < count and tries < 40:
                    tries += 1
                    s = e_lo + timedelta(days=r.randrange(0, (e_hi - e_lo).days + 1))
                    length = r.choice([1, 1, 1, 2, 2, 3, 4, 5]) if kind == "PTO" else r.choice([1, 1, 2])
                    if kind == "PTO" and r.random() < 0.12:
                        length = r.choice([6, 7, 11])     # skip-level / HR steps
                    if kind == "SICK" and r.random() < 0.1:
                        length = 4                         # HR step for sick
                    e = s + timedelta(days=length - 1 + (2 if s.weekday() + length > 5 else 0))
                    if not L.working_days(s, e, self.holidays) or e > e_hi or not self._free(emp.id, s, e):
                        continue
                    if kind == "PTO":
                        submit = s - timedelta(days=r.randrange(3, 31))
                    else:
                        submit = s + timedelta(days=r.randrange(0, 3))   # sick is reported after the fact
                    if submit < L.parse_d(emp.hire_date) or submit < lo or submit > hi:
                        continue
                    n += 1
                    rid = f"R-{n:04d}"
                    self._add_request(rid, emp.id, kind, s, e, submit)
                    # outcome script
                    roll = r.random()
                    if submit >= L.parse_d("2025-12-10"):
                        script = [(1, "A1", "APPROVE")]                       # left pending at as-of when 2+ steps
                    elif roll < 0.80:
                        script = [(k + 1, f"A{k + 1}", "APPROVE") for k in range(3)]
                    elif roll < 0.86:
                        script = [(1, "A1", "DENY")]
                    elif roll < 0.90:
                        script = [(1, "SELF", "CANCEL")]
                    elif roll < 0.96:
                        script = [(k + 1, f"A{k + 1}", "APPROVE") for k in range(3)] + [(r.randrange(4, 12), "SELF", "CANCEL")]
                    else:
                        peer = r.choice([x.id for x in self.employees if x.id != emp.id])
                        script = [(1, peer, "APPROVE")] + [(k + 2, f"A{k + 1}", "APPROVE") for k in range(3)]
                    self.events.append({"_rid": rid, "_script": script})
                    made += 1
        self.requests.sort(key=lambda q: (q["submitted_on"], q["request_id"]))

    # -- turn scripts into dated events by resolving "A1".."A3" through the routing engine at submit time
    def script_events(self) -> None:
        world = self.world(events=[])
        sim = L.Simulation(world)
        reqs = {q["request_id"]: q for q in self.requests}
        out = []
        for ev in self.events:
            q = reqs[ev["_rid"]]
            emp = self._emp(q["employee_id"])
            submit = L.parse_d(q["submitted_on"])
            wd = len(L.working_days(L.parse_d(q["start"]), L.parse_d(q["end"]), self.holidays))
            a = sim.assignment_on(emp.id, q["leave_type"], q["start"])
            steps = L.route(world.org, world.routing, world.policies[a.policy_id], world.delegations, emp.id, q["submitted_on"], wd)
            kept = [s for s in steps if s.kept]
            seq = 1
            out.append({"request_id": q["request_id"], "seq": seq, "on": q["submitted_on"], "actor": emp.id, "action": "SUBMIT", "target": ""})
            for item in ev["_script"]:
                off, actor, action = item[0], item[1], item[2]
                target = item[3] if len(item) > 3 else ""
                if actor == "SELF":
                    actor = emp.id
                elif actor.startswith("A"):
                    k = int(actor[1:]) - 1
                    if k >= len(kept):
                        continue
                    actor = kept[k].approver
                seq += 1
                out.append({"request_id": q["request_id"], "seq": seq, "on": L.fmt(submit + timedelta(days=off)),
                            "actor": actor, "action": action, "target": target})
        self.events = out

    # -- prune: a request the engine denies at submit (insufficient balance) keeps only its SUBMIT event
    def prune_system_denied(self) -> None:
        sim = L.Simulation(self.world())
        sim.run()
        denied = {rid for rid, rs in sim.reqs.items() if rs.final_code == "INSUFFICIENT_BALANCE"}
        self.traps["T8_INSUFFICIENT_BALANCE"] = len(denied)
        self.events = [e for e in self.events if e["request_id"] not in denied or e["action"] == "SUBMIT"]

    def world(self, events: list[dict] | None = None) -> L.World:
        evs = self.events if events is None else events
        return L.World(
            policies={p["id"]: L.policy_from_json(p) for p in POLICIES["policies"]},
            org=L.Org(self.employees, [L.OrgChange(*c) for c in ORG_CHANGES]),
            assignments=self.assignments, holidays=self.holidays,
            timesheets={(t["employee_id"], t["period_end"]): t["minutes_worked"] for t in self.timesheets},
            delegations=[L.Delegation(*d) for d in DELEGATIONS],
            requests=[L.Request(q["request_id"], q["employee_id"], q["leave_type"], q["start"], q["end"], q["submitted_on"]) for q in self.requests],
            events=[L.ReqEvent(e["request_id"], int(e["seq"]), e["on"], e["actor"], e["action"], e.get("target", "")) for e in evs],
            opening=[(o["employee_id"], o["leave_type"], int(o["minutes"])) for o in self.opening],
            routing=L.RoutingTable(), pay_anchor=PAY_ANCHOR, pay_length=PAY_LENGTH, ledger_start=LEDGER_START, asof=ASOF,
        )


def load_world(fixtures: str) -> L.World:
    """Read a fixtures directory back into a World (used by reference_leave.py and verify_fixtures.py)."""
    def rows(name):
        with open(os.path.join(fixtures, name), encoding="utf-8", newline="") as f:
            return list(csv.DictReader(f))
    pol = json.load(open(os.path.join(fixtures, "policies.json"), encoding="utf-8"))
    emps = [L.Employee(r["employee_id"], r["name"], r["hire_date"], r["term_date"], r["manager_id"], r["dept"], r["title"],
                       r["employment_type"], r["roles"]) for r in rows("employees.csv")]
    return L.World(
        policies={p["id"]: L.policy_from_json(p) for p in pol["policies"]},
        org=L.Org(emps, [L.OrgChange(r["effective"], r["employee_id"], r["field"], r["old"], r["new"]) for r in rows("org_changes.csv")]),
        assignments=[L.Assignment(r["employee_id"], r["leave_type"], r["policy_id"], r["start"], r["end"]) for r in rows("assignments.csv")],
        holidays={r["date"] for r in rows("holidays.csv")},
        timesheets={(r["employee_id"], r["period_end"]): int(r["minutes_worked"]) for r in rows("timesheets.csv")},
        delegations=[L.Delegation(r["approver_id"], r["delegate_id"], r["start"], r["end"]) for r in rows("delegations.csv")],
        requests=[L.Request(r["request_id"], r["employee_id"], r["leave_type"], r["start"], r["end"], r["submitted_on"]) for r in rows("requests.csv")],
        events=[L.ReqEvent(r["request_id"], int(r["seq"]), r["on"], r["actor"], r["action"], r["target"]) for r in rows("request_events.csv")],
        opening=[(r["employee_id"], r["leave_type"], int(r["minutes"])) for r in rows("opening_balances.csv")],
        routing=L.RoutingTable(delegation_max_depth=pol["routing_table"]["delegation_max_depth"]),
        pay_anchor=pol["pay_period"]["anchor_start"], pay_length=pol["pay_period"]["length_days"],
        ledger_start=LEDGER_START, asof=ASOF,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=SEED_DEFAULT)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    g = Gen(args.seed)
    g.build_org()
    g.build_requests()
    g.script_events()
    g.prune_system_denied()

    h = {}
    h["policies.json"] = sha256_bytes(write_text(os.path.join(args.out, "policies.json"), json.dumps(POLICIES, indent=2) + "\n"))
    h["employees.csv"] = sha256_bytes(write_csv(os.path.join(args.out, "employees.csv"),
                                                [{"employee_id": e.id, "name": e.name, "title": e.title, "dept": e.dept, "manager_id": e.manager_id,
                                                  "employment_type": e.employment_type, "roles": e.roles, "hire_date": e.hire_date, "term_date": e.term_date}
                                                 for e in g.employees],
                                                ["employee_id", "name", "title", "dept", "manager_id", "employment_type", "roles", "hire_date", "term_date"]))
    h["assignments.csv"] = sha256_bytes(write_csv(os.path.join(args.out, "assignments.csv"),
                                                  [{"employee_id": a.employee_id, "leave_type": a.leave_type, "policy_id": a.policy_id, "start": a.start, "end": a.end}
                                                   for a in g.assignments], ["employee_id", "leave_type", "policy_id", "start", "end"]))
    h["holidays.csv"] = sha256_bytes(write_csv(os.path.join(args.out, "holidays.csv"), [{"date": d} for d in HOLIDAYS], ["date"]))
    h["timesheets.csv"] = sha256_bytes(write_csv(os.path.join(args.out, "timesheets.csv"), g.timesheets, ["employee_id", "period_end", "minutes_worked"]))
    h["delegations.csv"] = sha256_bytes(write_csv(os.path.join(args.out, "delegations.csv"),
                                                  [dict(zip(("approver_id", "delegate_id", "start", "end"), d)) for d in DELEGATIONS],
                                                  ["approver_id", "delegate_id", "start", "end"]))
    h["org_changes.csv"] = sha256_bytes(write_csv(os.path.join(args.out, "org_changes.csv"),
                                                  [dict(zip(("effective", "employee_id", "field", "old", "new"), c)) for c in ORG_CHANGES],
                                                  ["effective", "employee_id", "field", "old", "new"]))
    h["opening_balances.csv"] = sha256_bytes(write_csv(os.path.join(args.out, "opening_balances.csv"), g.opening, ["employee_id", "leave_type", "minutes"]))
    h["requests.csv"] = sha256_bytes(write_csv(os.path.join(args.out, "requests.csv"), g.requests,
                                               ["request_id", "employee_id", "leave_type", "start", "end", "submitted_on", "trap"]))
    g.events.sort(key=lambda e: (e["on"], e["request_id"], e["seq"]))
    h["request_events.csv"] = sha256_bytes(write_csv(os.path.join(args.out, "request_events.csv"), g.events,
                                                     ["request_id", "seq", "on", "actor", "action", "target"]))

    manifest = {
        "generator": "tools/build_fixtures.py", "seed": args.seed, "ledger_start": LEDGER_START, "asof": ASOF,
        "counts": {"employees": len(g.employees), "hourly": sum(1 for e in g.employees if e.employment_type == "HOURLY"),
                   "requests": len(g.requests), "request_events": len(g.events), "timesheet_rows": len(g.timesheets),
                   "delegations": len(DELEGATIONS), "org_changes": len(ORG_CHANGES), "opening_rows": len(g.opening),
                   "requests_by_type": {k: sum(1 for q in g.requests if q["leave_type"] == k) for k in ("PTO", "SICK")}},
        "traps": dict(sorted(g.traps.items())),
        "sha256": h,
    }
    mj = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    with open(os.path.join(args.out, "MANIFEST.json"), "w", encoding="utf-8") as f:
        f.write(mj)
    print(mj)
    return 0


if __name__ == "__main__":
    sys.exit(main())
