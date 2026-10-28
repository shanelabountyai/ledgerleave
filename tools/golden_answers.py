"""Ledgerleave — kickoff answer key (test oracle, never product code).

Re-derives every golden case in docs/domain-brief.md §8 (GA-01..GA-20, accrual) and §9
(GR-01..GR-17, routing) from tools/leavelib.py and checks each against the value worked by
hand in the brief. Prints one line per case and ends with OK, or exits 1 naming the first
mismatch.

The hand-derived values are the EXPECTED column below. If leavelib disagrees, the brief and
leavelib are out of step: fix them deliberately, never this file's expected value.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import leavelib as L  # noqa: E402
from build_fixtures import POLICIES, HOLIDAYS  # noqa: E402

POL = {p["id"]: L.policy_from_json(p) for p in POLICIES["policies"]}
# hand policies that pin a vocabulary value the fixtures do not use
POL["HAND_HALF_UP"] = L.policy_from_json({
    "id": "HAND_HALF_UP", "leave_type": "PTO",
    "accrual": {"frequency": "MONTHLY", "proration": "DAILY", "rounding": "HALF_UP",
                "tiers": [{"min_tenure_months": 0, "minutes_per_period": 605}]},
    "year": {"type": "CALENDAR"}, "carryover_cap_minutes": 2400, "max_balance_minutes": 12000, "allow_negative": False})
POL["HAND_ANNUAL_GRANT"] = L.policy_from_json({
    "id": "HAND_ANNUAL_GRANT", "leave_type": "PTO",
    "accrual": {"frequency": "ANNIVERSARY", "proration": "NONE", "rounding": "HALF_UP",
                "tiers": [{"min_tenure_months": 0, "minutes_per_period": 4800}]},
    "year": {"type": "CALENDAR"}, "carryover_cap_minutes": 4800, "max_balance_minutes": 12000, "allow_negative": False})

HOL = set(HOLIDAYS)


def emp(eid, hire, mgr="", term="", roles="", et="SALARIED"):
    return L.Employee(eid, eid, hire, term, mgr, "D", "T", et, roles)


def world(employees, assignments, opening=(), requests=(), events=(), delegations=(), changes=(), timesheets=None,
          asof="2025-12-31", ledger_start="2024-01-01"):
    return L.World(policies=POL, org=L.Org(employees, [L.OrgChange(*c) for c in changes]), assignments=assignments,
                   holidays=HOL, timesheets=timesheets or {}, delegations=[L.Delegation(*d) for d in delegations],
                   requests=[L.Request(*r) for r in requests], events=[L.ReqEvent(*e) for e in events],
                   opening=list(opening), routing=L.RoutingTable(), pay_anchor="2024-01-01", pay_length=14,
                   ledger_start=ledger_start, asof=asof)


def run(w):
    s = L.Simulation(w)
    s.run()
    return s


def one(eid, hire, policy, lt="PTO", end="", opening=0, term=""):
    """A single employee on one policy from hire; returns (employees, assignments, opening)."""
    return [emp(eid, hire, term=term)], [L.Assignment(eid, lt, policy, hire, end or term)], ([(eid, lt, opening)] if opening else [])


def flat_timesheets(eid, lo, hi, minutes):
    return {(eid, L.fmt(pe)): minutes for pe in L.pay_period_ends(L.parse_d("2024-01-01"), 14, L.parse_d(lo), L.parse_d(hi))}


def main() -> int:
    bad = 0
    out = []

    def check(gid, desc, got, exp):
        nonlocal bad
        ok = got == exp
        bad += 0 if ok else 1
        out.append(f"{gid:6} {'ok ' if ok else 'BAD'} {desc}: {got!r}" + ("" if ok else f"  expected {exp!r}"))

    # ------------------------------------------------------------------ accrual goldens
    e, a, o = one("X", "2024-01-01", "PTO_SALARIED")
    s = run(world(e, a, o))
    check("GA-01", "full month, tier 0 (as of 01-30, 01-31)", (s.ledger.balance("X", "PTO", "2024-01-30"), s.ledger.balance("X", "PTO", "2024-01-31")), (0, 600))

    e, a, o = one("X", "2024-03-17", "PTO_SALARIED")
    s = run(world(e, a, o))
    check("GA-02", "mid-month hire, 15/31 of 600 = 290.32 -> 290; then +600", (s.ledger.balance("X", "PTO", "2024-03-31"), s.ledger.balance("X", "PTO", "2024-04-30")), (290, 890))

    e, a, o = one("X", "2024-02-15", "PTO_SALARIED")
    s = run(world(e, a, o))
    check("GA-03", "leap-month hire, 15/29 of 600 = 310.34 -> 310", s.ledger.balance("X", "PTO", "2024-02-29"), 310)

    e, a, o = one("X", "2024-04-28", "HAND_HALF_UP")
    s = run(world(e, a, o))
    check("GA-04", "HALF_UP on exactly .5: 605*3/30 = 60.5 -> 61", s.ledger.balance("X", "PTO", "2024-04-30"), 61)

    e, a, o = one("X", "2022-08-20", "PTO_SALARIED")
    s = run(world(e, a, o))
    jul = [x for x in s.ledger.rows("X", "PTO") if x.effective == "2024-07-31"][0].minutes
    aug = [x for x in s.ledger.rows("X", "PTO") if x.effective == "2024-08-31"][0].minutes
    check("GA-05", "tier crossing at 24 months: Jul 600, Aug 720; balance 08-31", (jul, aug, s.ledger.balance("X", "PTO", "2024-08-31")), (600, 720, 4920))

    e, a, o = one("X", "2024-01-01", "PTO_SALARIED")
    s = run(world(e, a, o))
    check("GA-06", "carryover: 7200 accrued, cap 2400 -> forfeit 4800 after the Dec accrual (as of 12-30, 12-31)",
          (s.ledger.balance("X", "PTO", "2024-12-30"), s.ledger.balance("X", "PTO", "2024-12-31"), s.ledger.forfeited_at("X", "PTO", "2024-12-31")), (6600, 2400, 4800))

    e, a, o = one("X", "2015-01-05", "PTO_SALARIED", opening=11600)
    e.append(emp("M", "2010-01-04"))
    e[0].manager_id = "M"
    s = run(world(e, a, o, requests=[("R1", "X", "PTO", "2024-03-04", "2024-03-05", "2024-02-19")],
                  events=[("R1", 1, "2024-02-19", "X", "SUBMIT"), ("R1", 2, "2024-02-20", "M", "APPROVE")]))
    acc = {x.effective: (x.minutes, x.capped_minutes) for x in s.ledger.rows("X", "PTO") if x.kind == "ACCRUAL"}
    check("GA-07", "max-balance cap 12000: Jan 400 (440 capped), Feb 0 (840 capped), usage 960 reopens, Mar 840, Apr 120",
          (acc["2024-01-31"], acc["2024-02-29"], acc["2024-03-31"], acc["2024-04-30"], s.ledger.balance("X", "PTO", "2024-04-30")),
          ((400, 440), (0, 840), (840, 0), (120, 720), 12000))

    e, a, o = one("X", "2024-01-01", "PTO_SALARIED")
    e.append(emp("M", "2010-01-04"))
    e[0].manager_id = "M"
    s = run(world(e, a, o, requests=[("R1", "X", "PTO", "2024-07-03", "2024-07-08", "2024-06-17")],
                  events=[("R1", 1, "2024-06-17", "X", "SUBMIT"), ("R1", 2, "2024-06-18", "M", "APPROVE")]))
    usage = [(x.effective, x.minutes) for x in s.ledger.rows("X", "PTO") if x.kind == "USAGE"]
    check("GA-08", "usage per working day; Jul 4 holiday and the weekend skipped", usage, [("2024-07-03", -480), ("2024-07-05", -480), ("2024-07-08", -480)])

    s = run(world(e, a, o, requests=[("R1", "X", "PTO", "2024-12-30", "2025-01-03", "2024-12-02")],
                  events=[("R1", 1, "2024-12-02", "X", "SUBMIT"), ("R1", 2, "2024-12-03", "M", "APPROVE")]))
    rows = {(r["year"]): r for r in L.employee_year_rows(s.ledger, e, [2024, 2025]) if r["employee_id"] == "X"}
    check("GA-09", "request spanning Dec 31: 2024 used 960 forfeited 3840; 2025 used 960; balance 01-31",
          (rows[2024]["used"], rows[2024]["forfeited"], rows[2025]["used"], s.ledger.balance("X", "PTO", "2025-01-31")), (960, 3840, 960, 2040))

    s = run(world(e, a, o, requests=[("R1", "X", "PTO", "2024-12-16", "2024-12-17", "2024-12-02")],
                  events=[("R1", 1, "2024-12-02", "X", "SUBMIT"), ("R1", 2, "2024-12-03", "M", "APPROVE"), ("R1", 3, "2025-01-08", "X", "CANCEL")]))
    rows = {(r["year"]): r for r in L.employee_year_rows(s.ledger, e, [2024, 2025]) if r["employee_id"] == "X"}
    forf = [(x.effective, x.minutes, x.codes) for x in s.ledger.rows("X", "PTO") if x.kind == "FORFEITURE" and x.effective < "2025"]
    check("GA-10", "cancelled after year end: reversal lands in 2024, forfeiture recomputed 3840 -> 4800; 2025 balance unchanged",
          (rows[2024]["used"], rows[2024]["forfeited"], s.ledger.balance("X", "PTO", "2025-01-08"), forf),
          (0, 4800, 2400, [("2024-12-31", -3840, "CARRYOVER_FORFEITURE"), ("2024-12-31", -960, "CARRYOVER_RECOMPUTED")]))

    e, a, o = one("X", "2024-01-01", "PTO_HOURLY")
    ts = {("X", "2024-01-14"): 4790, ("X", "2024-01-28"): 4800}
    s = run(world(e, a, o, timesheets=ts, asof="2024-01-31"))
    check("GA-11", "hourly FLOOR: 4790/30 = 159.67 -> 159; 4800/30 = 160", [x.minutes for x in s.ledger.rows("X", "PTO")], [159, 160])

    e, a, o = one("X", "2024-02-29", "PTO_HOURLY")
    s = run(world(e, a, o, timesheets=flat_timesheets("X", "2024-02-29", "2025-03-09", 4800), asof="2025-03-09"))
    check("GA-12", "leap-day hire: 26 periods x160 = 4160; anniversary boundary clamps to 2025-02-28; forfeit 1760; then +160",
          (s.ledger.balance("X", "PTO", "2025-02-27"), s.ledger.forfeited_at("X", "PTO", "2025-02-28"), s.ledger.balance("X", "PTO", "2025-03-09")), (4160, 1760, 2560))

    e, a, o = one("X", "2024-03-20", "SICK_STD", lt="SICK")
    s = run(world(e, a, o, asof="2024-03-31"))
    check("GA-13", "sick, proration NONE: hired 4 days before the period end gets the full 120", s.ledger.balance("X", "SICK", "2024-03-24"), 120)

    e, a, o = one("X", "2022-01-03", "SICK_STD", lt="SICK", opening=2700)
    s = run(world(e, a, o, asof="2024-07-14"))
    acc = sum(x.minutes for x in s.ledger.rows("X", "SICK") if x.kind == "ACCRUAL" and x.effective <= "2024-06-30")
    check("GA-14", "sick max 2880 then policy-year boundary Jun 30 cap 2400: accrued 180 by 06-30, forfeit 480, then +120",
          (acc, s.ledger.balance("X", "SICK", "2024-06-30"), s.ledger.forfeited_at("X", "SICK", "2024-06-30"), s.ledger.balance("X", "SICK", "2024-07-14")), (180, 2400, 480, 2520))

    e, a, o = one("X", "2024-03-01", "PTO_SALARIED")
    e.append(emp("M", "2010-01-04"))
    e[0].manager_id = "M"
    s = run(world(e, a, o, requests=[("R1", "X", "PTO", "2024-03-18", "2024-03-22", "2024-03-04")],
                  events=[("R1", 1, "2024-03-04", "X", "SUBMIT"), ("R1", 2, "2024-03-05", "M", "APPROVE")], asof="2024-03-31"))
    check("GA-15", "allow_negative=false: 2400 asked, 0 available -> DENIED INSUFFICIENT_BALANCE, no usage, balance 03-31 = 600",
          (s.reqs["R1"].state, s.reqs["R1"].final_code, s.ledger.balance("X", "PTO", "2024-03-31")), ("DENIED", "INSUFFICIENT_BALANCE", 600))

    e, a, o = one("X", "2024-03-01", "SICK_STD", lt="SICK")
    e.append(emp("M", "2010-01-04"))
    e[0].manager_id = "M"
    s = run(world(e, a, o, requests=[("R1", "X", "SICK", "2024-03-05", "2024-03-06", "2024-03-05")],
                  events=[("R1", 1, "2024-03-05", "X", "SUBMIT"), ("R1", 2, "2024-03-06", "M", "APPROVE")], asof="2024-03-31"))
    check("GA-16", "allow_negative=true: balance -960 after approval, -840 after the 03-10 accrual",
          (s.reqs["R1"].state, s.ledger.balance("X", "SICK", "2024-03-06"), s.ledger.balance("X", "SICK", "2024-03-10")), ("APPROVED", -960, -840))

    e, a, o = one("X", "2024-01-01", "PTO_SALARIED")
    e.append(emp("M", "2010-01-04"))
    e[0].manager_id = "M"
    s = run(world(e, a, o, requests=[("R1", "X", "PTO", "2024-06-10", "2024-06-11", "2024-05-06"), ("R2", "X", "PTO", "2024-06-17", "2024-06-20", "2024-05-15")],
                  events=[("R1", 1, "2024-05-06", "X", "SUBMIT"), ("R1", 2, "2024-05-10", "M", "APPROVE"), ("R2", 1, "2024-05-15", "X", "SUBMIT")], asof="2024-05-15"))
    check("GA-17", "balance vs available on 05-15: balance 2400, available 1440; 1920 asked -> DENIED",
          (s.ledger.balance("X", "PTO", "2024-05-15"), s.ledger.available("X", "PTO") , s.reqs["R2"].final_code), (2400, 1440, "INSUFFICIENT_BALANCE"))

    e = [emp("X", "2024-01-01", et="HOURLY")]
    a = [L.Assignment("X", "PTO", "PTO_HOURLY", "2024-01-01", "2025-06-29"), L.Assignment("X", "PTO", "PTO_SALARIED", "2025-06-30", "")]
    s = run(world(e, a, timesheets=flat_timesheets("X", "2024-01-01", "2025-06-29", 4800), asof="2025-07-31"))
    tr = [(x.kind, x.policy_id, x.minutes) for x in s.ledger.rows("X", "PTO") if x.kind.startswith("TRANSFER")]
    jun = [x for x in s.ledger.rows("X", "PTO") if x.effective == "2025-06-30" and x.kind == "ACCRUAL"][0]
    check("GA-18", "hourly->salaried on 2025-06-30: 2024 4160, anniversary forfeit 1760, 13x160 -> 4480; transfer; Jun 30 1/30 of 600 = 20; Jul 600",
          (s.ledger.balance("X", "PTO", "2025-06-29"), tr, (jun.minutes, jun.codes), s.ledger.balance("X", "PTO", "2025-07-31")),
          (4480, [("TRANSFER_OUT", "PTO_HOURLY", -4480), ("TRANSFER_IN", "PTO_SALARIED", 4480)], (20, "ACCRUAL_MONTHLY+PRORATED_DAILY"), 5100))

    e, a, o = one("X", "2024-01-01", "PTO_SALARIED", term="2024-05-10")
    s = run(world(e, a, o))
    check("GA-19", "termination 05-10: May prorated 600*10/31 = 193.5 -> 194; no accrual or forfeiture after",
          (s.ledger.balance("X", "PTO", "2024-05-31"), s.ledger.balance("X", "PTO", "2025-12-31"), len(s.ledger.rows("X", "PTO"))), (2594, 2594, 5))

    e, a, o = one("X", "2023-05-15", "HAND_ANNUAL_GRANT")
    s = run(world(e, a, o))
    check("GA-20", "ANNIVERSARY grant 4800 on 2024-05-15 and 2025-05-15; CALENDAR cap 4800 -> no forfeit in 2024, 4800 in 2025",
          (s.ledger.balance("X", "PTO", "2024-05-14"), s.ledger.balance("X", "PTO", "2024-12-31"), s.ledger.balance("X", "PTO", "2025-05-15"), s.ledger.balance("X", "PTO", "2025-12-31")),
          (0, 4800, 9600, 4800))

    # ------------------------------------------------------------------ routing goldens (hand org, brief §9)
    H = [emp("H1", "2010-01-04"), emp("H2", "2012-01-09", "H1"), emp("H3", "2015-01-05", "H2"), emp("H4", "2018-01-08", "H3"),
         emp("H5", "2019-01-07", "H3"), emp("H6", "2013-01-07", "H1"), emp("H7", "2016-01-04", "H6", roles="HR"),
         emp("H8", "2020-01-06", "H7", roles="HR"), emp("H9", "2014-01-06", "H2", term="2025-03-31"), emp("H10", "2021-01-04", "H9")]
    org = L.Org(H, [])
    T = L.RoutingTable()
    PTO, SICK = POL["PTO_SALARIED"], POL["SICK_STD"]
    D = "2025-05-05"

    def r(requester, days, policy=PTO, dlg=(), submit=D, o=org):
        return L.chain_str(L.route(o, T, policy, [L.Delegation(*x) for x in dlg], requester, submit, days))

    check("GR-01", "IC, 2 days", r("H4", 2), "MANAGER:H3[MANAGER_OF_REQUESTER]")
    check("GR-02", "IC, 6 days -> skip-level", r("H4", 6), "MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]")
    check("GR-03", "IC, 11 days -> + HR primary", r("H4", 11),
          "MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H7[HR_ROLE_HOLDER]")
    check("GR-04", "manager delegating to a peer of the requester", r("H4", 2, dlg=[("H3", "H5", "2025-05-01", "2025-05-09")]),
          "MANAGER:H5[MANAGER_OF_REQUESTER,DELEGATED]")
    check("GR-05", "delegate also delegating -> depth exceeded -> HR fallback",
          r("H4", 2, dlg=[("H3", "H5", "2025-05-01", "2025-05-09"), ("H5", "H2", "2025-05-05", "2025-05-06")]),
          "MANAGER:H7[MANAGER_OF_REQUESTER,DELEGATION_DEPTH_EXCEEDED,FALLBACK_TO_HR]")
    check("GR-06", "HR primary asks 11 days: HR step is self -> manager -> duplicate of step 1", r("H7", 11),
          "MANAGER:H6[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H1[MANAGER_OF_MANAGER]|~HR:H6[HR_ROLE_HOLDER,SELF_APPROVAL_TO_MANAGER,DUPLICATE_APPROVER_COLLAPSED]")
    check("GR-07", "CEO, 2 days: the CEO's manager is HR", r("H1", 2), "MANAGER:H7[MANAGER_OF_REQUESTER,CEO_MANAGER_IS_HR]")
    check("GR-08", "CEO, 11 days: skip-level and HR both collapse into HR", r("H1", 11),
          "MANAGER:H7[MANAGER_OF_REQUESTER,CEO_MANAGER_IS_HR]|~SKIP_LEVEL:H7[MANAGER_OF_MANAGER,CEO_MANAGER_IS_HR,DUPLICATE_APPROVER_COLLAPSED]|~HR:H7[HR_ROLE_HOLDER,DUPLICATE_APPROVER_COLLAPSED]")
    check("GR-09", "VP, 6 days: skip-level above the CEO is HR", r("H2", 6),
          "MANAGER:H1[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H7[MANAGER_OF_MANAGER,CEO_MANAGER_IS_HR]")
    check("GR-10", "manager delegates to the requester: step dropped, empty chain -> HR fallback",
          r("H4", 2, dlg=[("H3", "H4", "2025-05-01", "2025-05-09")]),
          "~MANAGER:H4[MANAGER_OF_REQUESTER,DELEGATED,DELEGATE_IS_REQUESTER_STEP_DROPPED]|FALLBACK:H7[EMPTY_CHAIN_TO_HR,FALLBACK_TO_HR]")
    check("GR-11", "manager delegates to the skip-level: one approval, not two",
          r("H4", 6, dlg=[("H3", "H2", "2025-05-01", "2025-05-09")]),
          "MANAGER:H2[MANAGER_OF_REQUESTER,DELEGATED]|~SKIP_LEVEL:H2[MANAGER_OF_MANAGER,DUPLICATE_APPROVER_COLLAPSED]")
    check("GR-12", "manager terminated, reports not yet moved: climb to the manager's manager", r("H10", 2, submit="2025-04-07"),
          "MANAGER:H2[MANAGER_OF_REQUESTER,APPROVER_INACTIVE_TO_MANAGER]")
    check("GR-13", "sick 4 days: no skip-level step for sick, HR over 3", r("H4", 4, policy=SICK),
          "MANAGER:H3[MANAGER_OF_REQUESTER]|HR:H7[HR_ROLE_HOLDER]")
    check("GR-14", "HR primary delegating to the HR backup", r("H4", 11, dlg=[("H7", "H8", "2025-05-01", "2025-05-09")]),
          "MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H8[HR_ROLE_HOLDER,DELEGATED]")
    # GR-15: frozen chain and eligibility at approval time
    assigns = [L.Assignment(h.id, "PTO", "PTO_SALARIED", h.hire_date, h.term_date) for h in H]
    s = run(world(H, assigns, opening=[(h.id, "PTO", 2400) for h in H],
                  requests=[("Q1", "H4", "PTO", "2025-05-19", "2025-05-20", D), ("Q2", "H4", "PTO", "2025-06-02", "2025-06-16", D)],
                  events=[("Q1", 1, D, "H4", "SUBMIT"), ("Q1", 2, "2025-05-08", "H2", "APPROVE"), ("Q1", 3, "2025-05-09", "H3", "APPROVE"),
                          ("Q2", 1, D, "H4", "SUBMIT"), ("Q2", 2, "2025-05-06", "H3", "APPROVE"), ("Q2", 3, "2025-05-07", "H2", "APPROVE"),
                          ("Q2", 4, "2025-05-08", "H7", "APPROVE"), ("Q2", 5, "2025-05-09", "H8", "REASSIGN", "H8"), ("Q2", 6, "2025-05-12", "H8", "APPROVE")],
                  changes=[("2025-05-07", "H4", "MANAGER", "H3", "H2"), ("2025-05-06", "H7", "ROLE_REVOKED", "HR", "HR")]))
    q1, q2 = s.reqs["Q1"], s.reqs["Q2"]
    check("GR-15", "frozen chain: new manager's approval void, old manager approves; revoked HR role void, reassigned and approved",
          (q1.chain, q1.log, q1.state, q2.chain, q2.log[3:], q2.state),
          ("MANAGER:H3[MANAGER_OF_REQUESTER]",
           ["SUBMIT:H4:2025-05-05:CHAIN_FROZEN", "VOID_APPROVE:H2:2025-05-08:APPROVER_NOT_STEP_APPROVER", "APPROVE:H3:2025-05-09:MANAGER"], "APPROVED",
           "MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H7[HR_ROLE_HOLDER]",
           ["VOID_APPROVE:H7:2025-05-08:APPROVER_INELIGIBLE_ROLE_REVOKED", "REASSIGN:H8:2025-05-09:STEP_REASSIGNED->H8", "APPROVE:H8:2025-05-12:HR"], "APPROVED"))

    # GR-16 (D-44): the DELEGATE_LACKS_HR_ROLE fallback skips the delegator; the delegator only when nobody else holds HR
    dlg_h7 = [("H7", "H5", "2025-05-01", "2025-05-09")]
    org_b = L.Org(H, [L.OrgChange("2025-05-01", "H8", "ROLE_REVOKED", "HR", "HR")])
    check("GR-16", "HR primary delegates the HR step to a non-HR peer: next HR holder, else the delegator with a code",
          (r("H4", 11, dlg=dlg_h7), r("H4", 11, dlg=dlg_h7, o=org_b)),
          ("MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H8[HR_ROLE_HOLDER,DELEGATE_LACKS_HR_ROLE,FALLBACK_TO_HR]",
           "MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H7[HR_ROLE_HOLDER,DELEGATE_LACKS_HR_ROLE,FALLBACK_TO_DELEGATOR]"))
    # GR-18 (D-56): the DELEGATION_DEPTH_EXCEEDED fallback skips the delegator too; a non-HR delegator still reaches the CEO
    dlg18 = [("H7", "H5", "2025-05-01", "2025-05-09"), ("H5", "H2", "2025-05-05", "2025-05-06")]
    org_c = L.Org(H, [L.OrgChange("2025-05-01", "H7", "ROLE_REVOKED", "HR", "HR"), L.OrgChange("2025-05-01", "H8", "ROLE_REVOKED", "HR", "HR")])
    check("GR-18", "HR primary's delegate also delegates: next HR holder, else the delegator; no HR at all -> CEO",
          (r("H4", 11, dlg=dlg18), r("H4", 11, dlg=dlg18, o=org_b),
           r("H4", 2, dlg=[("H3", "H5", "2025-05-01", "2025-05-09"), ("H5", "H2", "2025-05-05", "2025-05-06")], o=org_c)),
          ("MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H8[HR_ROLE_HOLDER,DELEGATION_DEPTH_EXCEEDED,FALLBACK_TO_HR]",
           "MANAGER:H3[MANAGER_OF_REQUESTER]|SKIP_LEVEL:H2[MANAGER_OF_MANAGER]|HR:H7[HR_ROLE_HOLDER,DELEGATION_DEPTH_EXCEEDED,FALLBACK_TO_DELEGATOR]",
           "MANAGER:H1[MANAGER_OF_REQUESTER,DELEGATION_DEPTH_EXCEEDED,FALLBACK_TO_CEO]"))
    # GR-17 (D-45): a submit overlapping the employee's own PENDING or APPROVED request is denied before A8
    assigns17 = assigns + [L.Assignment("H4", "SICK", "SICK_STD", "2018-01-08", "")]
    s = run(world(H, assigns17, opening=[(h.id, "PTO", 2400) for h in H],
                  requests=[("P1", "H4", "PTO", "2025-05-19", "2025-05-20", D), ("P2", "H4", "SICK", "2025-05-20", "2025-05-21", "2025-05-07"),
                            ("P3", "H4", "PTO", "2025-05-21", "2025-05-22", "2025-05-07"), ("P4", "H4", "PTO", "2025-05-19", "2025-05-19", "2025-05-09"),
                            ("P5", "H4", "PTO", "2025-05-22", "2025-05-22", "2025-05-09")],
                  events=[("P1", 1, D, "H4", "SUBMIT"), ("P1", 2, "2025-05-06", "H3", "APPROVE"), ("P2", 1, "2025-05-07", "H4", "SUBMIT"),
                          ("P3", 1, "2025-05-07", "H4", "SUBMIT"), ("P1", 3, "2025-05-08", "H4", "CANCEL"),
                          ("P4", 1, "2025-05-09", "H4", "SUBMIT"), ("P5", 1, "2025-05-09", "H4", "SUBMIT")],
                  asof="2025-05-09"))
    lab = lambda q: f"PENDING_{q.step + 1}" if q.state == "PENDING" else q.state  # noqa: E731
    p = s.reqs
    check("GR-17", "overlap with own approved (other type) or pending request -> system denial; denied/cancelled ones do not block",
          (lab(p["P2"]), p["P2"].final_code, p["P2"].chain, p["P2"].log, lab(p["P3"]), lab(p["P4"]), lab(p["P5"]), p["P5"].final_code),
          ("DENIED", "OVERLAPPING_REQUEST", "MANAGER:H3[MANAGER_OF_REQUESTER]",
           ["SUBMIT:H4:2025-05-07:CHAIN_FROZEN", "SYSTEM_DENY:SYSTEM:2025-05-07:OVERLAPPING_REQUEST"], "PENDING_1", "PENDING_1", "DENIED", "OVERLAPPING_REQUEST"))

    print("\n".join(out))
    print()
    if bad:
        print(f"FAIL: {bad} mismatch(es)")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
