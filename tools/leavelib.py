"""Ledgerleave — the spec made executable (test oracle, never product code).

Everything in docs/domain-brief.md §3–§7 as plain Python: the calendar axis, policies as
data, the accrual engine (A-rules), the ledger replay, the approval-routing engine
(R-rules) and the request state machine (S-rules). Standard library only. No clock, no
randomness, no I/O: the generator and the reference runner feed it rows and read back
entries. The TypeScript engines under src/accrual/ and src/routing/ are written from the
brief and must agree with this file on every golden case and every fixture row.

Units: minutes (int). Dates: ISO strings on a calendar axis; datetime.date is used only
for arithmetic inside this module and never crosses a timezone.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta

WORK_DAY_MINUTES = 480
HR_ROLE = "HR"

# ----------------------------------------------------------------------------- calendar


def parse_d(s: str) -> date:
    y, m, d = s.split("-")
    return date(int(y), int(m), int(d))


def fmt(d: date) -> str:
    return d.isoformat()


def days_in_month(y: int, m: int) -> int:
    return calendar.monthrange(y, m)[1]


def last_day_of_month(d: date) -> date:
    return date(d.year, d.month, days_in_month(d.year, d.month))


def add_months_clamped(d: date, n: int) -> date:
    """C3: the same day n months later; a day the target month lacks clamps to its last day (Feb 29 -> Feb 28)."""
    y = d.year + (d.month - 1 + n) // 12
    m = (d.month - 1 + n) % 12 + 1
    return date(y, m, min(d.day, days_in_month(y, m)))


def completed_months(hire: date, d: date) -> int:
    """C4: whole months of tenure as of d (inclusive). Hire day clamped to the length of d's month."""
    months = (d.year - hire.year) * 12 + (d.month - hire.month)
    if d.day < min(hire.day, days_in_month(d.year, d.month)):
        months -= 1
    return max(months, 0)


def round_div(num: int, den: int, mode: str) -> int:
    """C5: integer division with the policy's rounding rule. num >= 0, den > 0."""
    assert num >= 0 and den > 0
    if mode == "FLOOR":
        return num // den
    if mode == "HALF_UP":
        return (2 * num + den) // (2 * den)
    raise ValueError(f"unknown rounding {mode}")


def working_days(start: date, end: date, holidays: set[str]) -> list[date]:
    """C1: Monday–Friday, inclusive range, company holidays removed."""
    out = []
    d = start
    while d <= end:
        if d.weekday() < 5 and fmt(d) not in holidays:
            out.append(d)
        d += timedelta(days=1)
    return out


def pay_period_end_for(d: date, anchor: date, length: int) -> date:
    """C2: the end date (inclusive) of the pay period containing d."""
    k = (d - anchor).days // length
    return anchor + timedelta(days=(k + 1) * length - 1)


def pay_period_ends(anchor: date, length: int, lo: date, hi: date) -> list[date]:
    out = []
    e = pay_period_end_for(lo, anchor, length)
    while e <= hi:
        if e >= lo:
            out.append(e)
        e += timedelta(days=length)
    return out


# ----------------------------------------------------------------------------- policies as data


@dataclass
class Tier:
    min_tenure_months: int
    minutes_per_period: int


@dataclass
class Policy:
    id: str
    leave_type: str
    frequency: str                     # MONTHLY | PER_PAY_PERIOD | ANNIVERSARY | PER_HOURS_WORKED
    tiers: list[Tier]
    minutes_per_60_worked: int         # PER_HOURS_WORKED only
    proration: str                     # DAILY | NONE
    rounding: str                      # HALF_UP | FLOOR
    year_type: str                     # CALENDAR | POLICY_YEAR | ANNIVERSARY
    year_starts: str                   # "MM-DD" for POLICY_YEAR
    carryover_cap_minutes: int
    max_balance_minutes: int
    allow_negative: bool
    skip_level_over_days: int | None
    hr_over_days: int | None

    def rate(self, tenure_months: int) -> int:
        """A2: the highest tier whose min_tenure_months <= tenure wins."""
        r = 0
        for t in sorted(self.tiers, key=lambda t: t.min_tenure_months):
            if tenure_months >= t.min_tenure_months:
                r = t.minutes_per_period
        return r


FREQUENCIES = ("MONTHLY", "PER_PAY_PERIOD", "ANNIVERSARY", "PER_HOURS_WORKED")
PRORATIONS = ("DAILY", "NONE")
ROUNDINGS = ("HALF_UP", "FLOOR")
YEAR_TYPES = ("CALENDAR", "POLICY_YEAR", "ANNIVERSARY")


def policy_from_json(j: dict) -> Policy:
    acc = j["accrual"]
    yr = j["year"]
    rt = j.get("routing", {})
    p = Policy(
        id=j["id"], leave_type=j["leave_type"], frequency=acc["frequency"],
        tiers=[Tier(t["min_tenure_months"], t["minutes_per_period"]) for t in acc.get("tiers", [])],
        minutes_per_60_worked=acc.get("minutes_per_60_worked", 0),
        proration=acc.get("proration", "NONE"), rounding=acc["rounding"],
        year_type=yr["type"], year_starts=yr.get("starts", "01-01"),
        carryover_cap_minutes=j["carryover_cap_minutes"], max_balance_minutes=j["max_balance_minutes"],
        allow_negative=bool(j["allow_negative"]),
        skip_level_over_days=rt.get("skip_level_over_days"), hr_over_days=rt.get("hr_over_days"),
    )
    validate_policy(p)
    return p


def validate_policy(p: Policy) -> None:
    assert p.frequency in FREQUENCIES, p.frequency
    assert p.proration in PRORATIONS and p.rounding in ROUNDINGS and p.year_type in YEAR_TYPES
    assert p.carryover_cap_minutes >= 0 and p.max_balance_minutes >= 0
    if p.frequency == "PER_HOURS_WORKED":
        assert p.minutes_per_60_worked > 0 and not p.tiers
    else:
        assert p.tiers and p.tiers[0].min_tenure_months == 0
    if p.frequency != "MONTHLY":
        assert p.proration == "NONE", "DAILY proration is defined for MONTHLY only (A3)"


# ----------------------------------------------------------------------------- org


@dataclass
class Employee:
    id: str
    name: str
    hire_date: str
    term_date: str            # "" while employed
    manager_id: str           # "" for the CEO
    dept: str
    title: str
    employment_type: str      # SALARIED | HOURLY
    roles: str                # "+"-joined, e.g. "HR"


@dataclass
class Assignment:
    employee_id: str
    leave_type: str
    policy_id: str
    start: str
    end: str                  # "" = open


@dataclass
class Delegation:
    approver_id: str
    delegate_id: str
    start: str
    end: str


@dataclass
class OrgChange:
    effective: str
    employee_id: str
    field: str                # MANAGER | ROLE_REVOKED | ROLE_GRANTED
    old: str
    new: str


class Org:
    """Org state as of a date: manager, roles, active. Changes apply from their effective date (inclusive)."""

    def __init__(self, employees: list[Employee], changes: list[OrgChange]):
        self.emp = {e.id: e for e in employees}
        self.changes = sorted(changes, key=lambda c: (c.effective, c.employee_id, c.field))

    def is_active(self, eid: str, d: str) -> bool:
        e = self.emp.get(eid)
        return bool(e) and e.hire_date <= d and (not e.term_date or d <= e.term_date)

    def manager_of(self, eid: str, d: str) -> str:
        m = self.emp[eid].manager_id
        for c in self.changes:
            if c.employee_id == eid and c.field == "MANAGER" and c.effective <= d:
                m = c.new
        return m

    def roles_of(self, eid: str, d: str) -> set[str]:
        r = set(x for x in self.emp[eid].roles.split("+") if x)
        for c in self.changes:
            if c.employee_id == eid and c.effective <= d:
                if c.field == "ROLE_REVOKED":
                    r.discard(c.new)
                elif c.field == "ROLE_GRANTED":
                    r.add(c.new)
        return r

    def hr_holders(self, d: str) -> list[str]:
        """R6: HR role holders active on d, by employee id; the first is the HR primary."""
        return sorted(e for e in self.emp if self.is_active(e, d) and HR_ROLE in self.roles_of(e, d))

    def ceo(self) -> str:
        return sorted(e for e, x in self.emp.items() if not x.manager_id)[0]


# ----------------------------------------------------------------------------- ledger


@dataclass
class Entry:
    entry_id: str
    employee_id: str
    leave_type: str
    policy_id: str
    kind: str                 # ACCRUAL | USAGE | USAGE_REVERSAL | ADJUSTMENT | FORFEITURE | TRANSFER_OUT | TRANSFER_IN
    effective: str
    posted: str
    minutes: int
    capped_minutes: int
    codes: str                # "+"-joined reason codes
    ref: str                  # request id, period end, boundary date, ...
    seq: int


class Ledger:
    def __init__(self):
        self.entries: list[Entry] = []
        self.by_key: dict[tuple[str, str], list[Entry]] = {}

    def post(self, e: Entry) -> Entry:
        e.seq = len(self.entries) + 1
        e.entry_id = f"L-{e.seq:06d}"
        self.entries.append(e)
        self.by_key.setdefault((e.employee_id, e.leave_type), []).append(e)
        return e

    def rows(self, eid: str, lt: str) -> list[Entry]:
        return self.by_key.get((eid, lt), [])

    def balance(self, eid: str, lt: str, asof: str) -> int:
        """L1: balance as of a date = sum of entries effective on or before it, whenever posted."""
        return sum(e.minutes for e in self.rows(eid, lt) if e.effective <= asof)

    def available(self, eid: str, lt: str) -> int:
        """L2: available = sum of every posted entry, including future-dated approved usage."""
        return sum(e.minutes for e in self.rows(eid, lt))

    def forfeited_at(self, eid: str, lt: str, b: str) -> int:
        return -sum(e.minutes for e in self.rows(eid, lt) if e.kind == "FORFEITURE" and e.effective == b)


# ----------------------------------------------------------------------------- accrual engine (A-rules)


def accrual_minutes(policy: Policy, hire: date, assign_start: date, assign_end: date | None, d: date,
                    worked_minutes: int = 0) -> tuple[int, list[str]]:
    """Gross accrual for the event dated d (before the max-balance cap). Returns (minutes, codes)."""
    codes = []
    tenure = completed_months(hire, d)
    if policy.frequency == "PER_HOURS_WORKED":
        codes.append("ACCRUAL_HOURS_WORKED")
        return round_div(worked_minutes * policy.minutes_per_60_worked, 60, policy.rounding), codes
    rate = policy.rate(tenure)
    if policy.frequency == "MONTHLY":
        codes.append("ACCRUAL_MONTHLY")
        if policy.proration == "DAILY":
            first = date(d.year, d.month, 1)
            lo = max(first, assign_start)
            hi = d if assign_end is None else min(d, assign_end)
            active_days = (hi - lo).days + 1
            dim = days_in_month(d.year, d.month)
            if active_days < dim:
                codes.append("PRORATED_DAILY")
                return round_div(rate * active_days, dim, policy.rounding), codes
        return rate, codes
    if policy.frequency == "PER_PAY_PERIOD":
        codes.append("ACCRUAL_PAY_PERIOD")
        return rate, codes
    if policy.frequency == "ANNIVERSARY":
        codes.append("ACCRUAL_ANNIVERSARY")
        return rate, codes
    raise ValueError(policy.frequency)


def accrual_dates(policy: Policy, hire: date, a_start: date, a_end: date | None, lo: date, hi: date,
                  anchor: date, length: int, timesheet_ends: set[str]) -> list[date]:
    """A1: the dates on which this assignment posts an accrual inside [lo, hi]."""
    start = max(lo, a_start)
    end = hi if a_end is None else min(hi, a_end)
    if start > end:
        return []
    out = []
    if policy.frequency == "MONTHLY":
        # A3: one event on the last day of each month the assignment touches, including the month it ends in
        # (prorated by active days); the event date may fall after the assignment's end.
        d = last_day_of_month(start)
        last = min(hi, last_day_of_month(end))
        while d <= last:
            out.append(d)
            d = last_day_of_month(d + timedelta(days=1))
    elif policy.frequency in ("PER_PAY_PERIOD", "PER_HOURS_WORKED"):
        for e in pay_period_ends(anchor, length, start, end):
            if policy.frequency == "PER_PAY_PERIOD" or fmt(e) in timesheet_ends:
                out.append(e)       # A4: posts only when the assignment is active on the period end
    elif policy.frequency == "ANNIVERSARY":
        n = 1
        while True:
            d = add_months_clamped(hire, 12 * n)
            if d > end:
                break
            if d >= start:
                out.append(d)
            n += 1
    return out


def year_boundaries(policy: Policy, hire: date, a_start: date, a_end: date | None, lo: date, hi: date) -> list[date]:
    """A6: the last day of each policy year inside the assignment and [lo, hi]."""
    start = max(lo, a_start)
    end = hi if a_end is None else min(hi, a_end)
    out = []
    if policy.year_type == "CALENDAR":
        for y in range(start.year, end.year + 1):
            b = date(y, 12, 31)
            if start <= b <= end:
                out.append(b)
    elif policy.year_type == "POLICY_YEAR":
        mm, dd = (int(x) for x in policy.year_starts.split("-"))
        for y in range(start.year, end.year + 2):
            b = date(y, mm, dd) - timedelta(days=1)
            if start <= b <= end:
                out.append(b)
    elif policy.year_type == "ANNIVERSARY":
        n = 1
        while True:
            b = add_months_clamped(hire, 12 * n)
            if b > end:
                break
            if b >= start:
                out.append(b)
            n += 1
    return out


# ----------------------------------------------------------------------------- routing engine (R-rules)


@dataclass
class Step:
    step_id: str              # MANAGER | SKIP_LEVEL | HR | FALLBACK
    approver: str
    codes: list[str]
    kept: bool = True
    approved_by: str = ""
    approved_on: str = ""


@dataclass
class RoutingTable:
    skip_level_step: bool = True
    hr_step: bool = True
    delegation_max_depth: int = 1


def step_requires_hr(codes: list[str]) -> bool:
    """S3: a step whose approver was chosen as an HR role holder must be approved by someone holding HR on the
    day of approval. Walk the codes in order; the last selection decides."""
    req = False
    for c in codes:
        if c in ("HR_ROLE_HOLDER", "CEO_MANAGER_IS_HR", "FALLBACK_TO_HR", "EMPTY_CHAIN_TO_HR"):
            req = True
        elif c in ("SELF_APPROVAL_TO_MANAGER", "FALLBACK_TO_CEO", "APPROVER_INACTIVE_TO_MANAGER"):
            req = False
    return req


def chain_str(steps: list[Step]) -> str:
    return "|".join(("" if s.kept else "~") + f"{s.step_id}:{s.approver}[{','.join(s.codes)}]" for s in steps)


def _delegate_of(delegations: list[Delegation], eid: str, d: str) -> str:
    for g in delegations:
        if g.approver_id == eid and g.start <= d <= g.end:
            return g.delegate_id
    return ""


def _fallback(org: Org, requester: str, d: str, codes: list[str], delegator: str = "") -> str:
    """R7: HR primary, then other HR holders, then the CEO; never the requester, never someone inactive.
    A fallback approver is taken as-is: delegation is not applied to it.
    R7' (D-44, D-56): after a failed delegation, also skip the approver who delegated the step away; if that leaves
    no HR holder and the delegator holds HR, the delegator (FALLBACK_TO_DELEGATOR). A non-HR delegator changes nothing."""
    holders = org.hr_holders(d)
    for h in holders:
        if h != requester and h != delegator:
            codes.append("FALLBACK_TO_HR")
            return h
    if delegator in holders:
        codes.append("FALLBACK_TO_DELEGATOR")
        return delegator
    ceo = org.ceo()
    if ceo != requester and org.is_active(ceo, d):
        codes.append("FALLBACK_TO_CEO")
        return ceo
    codes.append("UNROUTABLE")
    return ""


def _manager_of(org: Org, eid: str, requester: str, d: str, codes: list[str]) -> tuple[str, bool]:
    """The manager of eid as of d. The CEO's manager is the HR primary (R2). An inactive manager is skipped
    upward (R3). Returns (approver, is_fallback)."""
    m = org.manager_of(eid, d)
    while m and not org.is_active(m, d):
        codes.append("APPROVER_INACTIVE_TO_MANAGER")
        m = org.manager_of(m, d)
    if m:
        return m, False
    codes.append("CEO_MANAGER_IS_HR")
    holders = org.hr_holders(d)
    if holders:
        return holders[0], False
    return _fallback(org, requester, d, codes), True


def route(org: Org, table: RoutingTable, policy: Policy, delegations: list[Delegation],
          requester: str, submit: str, working_days_count: int) -> list[Step]:
    """R1–R9: the ordered approval chain frozen at submit time."""
    plan = [("MANAGER", "MANAGER_OF_REQUESTER")]
    if table.skip_level_step and policy.skip_level_over_days is not None and working_days_count > policy.skip_level_over_days:
        plan.append(("SKIP_LEVEL", "MANAGER_OF_MANAGER"))
    if table.hr_step and policy.hr_over_days is not None and working_days_count > policy.hr_over_days:
        plan.append(("HR", "HR_ROLE_HOLDER"))
    steps: list[Step] = []
    for step_id, nominal_code in plan:
        codes = [nominal_code]
        fb = False
        if step_id == "MANAGER":
            appr, fb = _manager_of(org, requester, requester, submit, codes)
        elif step_id == "SKIP_LEVEL":
            if not org.manager_of(requester, submit):
                # the CEO's chain never climbs above HR: same HR primary as the MANAGER step, collapsed by R8
                m, fb = _manager_of(org, requester, requester, submit, codes)
                appr = m
            else:
                m, fb = _manager_of(org, requester, requester, submit, codes)
                appr, fb = (_manager_of(org, m, requester, submit, codes) if not fb and m else (m, fb))
        else:  # HR
            holders = org.hr_holders(submit)
            appr = holders[0] if holders else ""
            if not appr:
                appr, fb = _fallback(org, requester, submit, codes), True
        # R4: nobody approves their own request
        if appr == requester and appr:
            codes.append("SELF_APPROVAL_TO_MANAGER")
            appr, fb = _manager_of(org, requester, requester, submit, codes)
        # R5: delegation, one hop, never on a fallback approver
        kept = bool(appr)
        if appr and not fb:
            dlg = _delegate_of(delegations, appr, submit)
            if dlg:
                if _delegate_of(delegations, dlg, submit) or not org.is_active(dlg, submit):
                    codes.append("DELEGATION_DEPTH_EXCEEDED")
                    appr = _fallback(org, requester, submit, codes, appr)
                    kept = bool(appr)
                elif step_requires_hr(codes) and HR_ROLE not in org.roles_of(dlg, submit):
                    codes.append("DELEGATE_LACKS_HR_ROLE")
                    appr = _fallback(org, requester, submit, codes, appr)
                    kept = bool(appr)
                elif dlg == requester:
                    codes.append("DELEGATED")
                    codes.append("DELEGATE_IS_REQUESTER_STEP_DROPPED")
                    appr, kept = dlg, False
                else:
                    codes.append("DELEGATED")
                    appr = dlg
        # R8: one person approves once
        if kept and any(s.kept and s.approver == appr for s in steps):
            codes.append("DUPLICATE_APPROVER_COLLAPSED")
            kept = False
        steps.append(Step(step_id, appr, codes, kept))
    if not any(s.kept for s in steps):
        codes = ["EMPTY_CHAIN_TO_HR"]
        appr = _fallback(org, requester, submit, codes)
        steps.append(Step("FALLBACK", appr, codes, bool(appr)))
    return steps


# ----------------------------------------------------------------------------- request state machine (S-rules)

STATES = ("DRAFT", "SUBMITTED", "PENDING", "APPROVED", "DENIED", "CANCELLED")
# (state, action) -> next state; PENDING carries a step index. Anything not listed is IGNORED_* (S6).
TRANSITIONS = {
    ("DRAFT", "SUBMIT"): "SUBMITTED",          # chain frozen; balance check may deny at once (S1, A8)
    ("SUBMITTED", "ROUTE"): "PENDING",         # automatic, same instant
    ("SUBMITTED", "SYSTEM_DENY"): "DENIED",
    ("PENDING", "APPROVE"): "PENDING|APPROVED",  # next step, or APPROVED on the last kept step (S2)
    ("PENDING", "DENY"): "DENIED",
    ("PENDING", "CANCEL"): "CANCELLED",
    ("PENDING", "REASSIGN"): "PENDING",
    ("APPROVED", "CANCEL"): "CANCELLED",       # writes USAGE_REVERSAL (S4)
}


@dataclass
class Request:
    id: str
    employee_id: str
    leave_type: str
    start: str
    end: str
    submitted_on: str


@dataclass
class ReqEvent:
    request_id: str
    seq: int
    on: str
    actor: str
    action: str               # SUBMIT | APPROVE | DENY | CANCEL | REASSIGN
    target: str = ""          # REASSIGN: new approver


@dataclass
class ReqState:
    req: Request
    policy_id: str = ""
    working_days: int = 0
    minutes: int = 0
    state: str = "DRAFT"
    step: int = 0             # index into kept steps
    steps: list[Step] = field(default_factory=list)
    chain: str = ""           # chain_str at submit; frozen (R9)
    final_code: str = ""
    log: list[str] = field(default_factory=list)   # "ACTION:actor:date:code"

    def kept(self) -> list[Step]:
        return [s for s in self.steps if s.kept]


# ----------------------------------------------------------------------------- simulation


@dataclass
class World:
    policies: dict[str, Policy]
    org: Org
    assignments: list[Assignment]
    holidays: set[str]
    timesheets: dict[tuple[str, str], int]        # (employee, period_end) -> minutes worked
    delegations: list[Delegation]
    requests: list[Request]
    events: list[ReqEvent]
    opening: list[tuple[str, str, int]]           # (employee, leave_type, minutes) effective ledger_start-1
    routing: RoutingTable
    pay_anchor: str
    pay_length: int
    ledger_start: str
    asof: str


class Simulation:
    """Posts everything in posting order (brief §5): per day, class 0 transfers+accruals, class 1 request
    events, class 2 year boundaries. Retroactive entries recompute forfeiture (A7)."""

    def __init__(self, w: World):
        self.w = w
        self.ledger = Ledger()
        self.reqs: dict[str, ReqState] = {}
        self.last_boundary: dict[tuple[str, str], list[str]] = {}
        self.ignored = 0
        self.voided = 0
        self.recomputed = 0

    # -- helpers
    def assignment_on(self, eid: str, lt: str, d: str) -> Assignment | None:
        for a in self.w.assignments:
            if a.employee_id == eid and a.leave_type == lt and a.start <= d and (not a.end or d <= a.end):
                return a
        return None

    def _post(self, recompute: bool = True, **kw) -> Entry:
        e = self.ledger.post(Entry(entry_id="", seq=0, **kw))
        if recompute:
            self._recompute_after([e])
        return e

    def _recompute_after(self, posted: list[Entry]) -> None:
        """A7: after posting a batch of entries, re-derive forfeiture from the earliest closed boundary they touch."""
        if not posted:
            return
        e = min(posted, key=lambda x: x.effective)
        bl = self.last_boundary.get((e.employee_id, e.leave_type), [])
        if e.kind != "FORFEITURE" and bl and e.effective <= bl[-1]:
            self._recompute(e, bl)

    def _recompute(self, e: Entry, boundaries: list[str]) -> None:
        """A7: an entry landing in a closed policy year re-derives every forfeiture from that year on."""
        for b in boundaries:
            if b < e.effective:
                continue
            pol = self.w.policies[self.assignment_on(e.employee_id, e.leave_type, b).policy_id]
            s = sum(x.minutes for x in self.ledger.rows(e.employee_id, e.leave_type)
                    if x.effective <= b and not (x.kind == "FORFEITURE" and x.effective == b))
            target = max(0, s - pol.carryover_cap_minutes)
            delta = target - self.ledger.forfeited_at(e.employee_id, e.leave_type, b)
            if delta:
                self.recomputed += 1
                self.ledger.post(Entry("", e.employee_id, e.leave_type, pol.id, "FORFEITURE", b, e.posted,
                                       -delta, 0, "CARRYOVER_RECOMPUTED", e.ref, 0))

    # -- build the day plan
    def run(self) -> None:
        w = self.w
        lo, hi = parse_d(w.ledger_start), parse_d(w.asof)
        anchor = parse_d(w.pay_anchor)
        days: dict[str, dict[int, list]] = {}

        def add(d: str, cls: int, item) -> None:
            days.setdefault(d, {}).setdefault(cls, []).append(item)

        # opening balances
        open_day = fmt(lo - timedelta(days=1))
        for eid, lt, mins in sorted(w.opening):
            add(open_day, 0, ("OPEN", eid, lt, mins))
        for a in sorted(w.assignments, key=lambda a: (a.employee_id, a.leave_type, a.start)):
            pol = w.policies[a.policy_id]
            emp = w.org.emp[a.employee_id]
            hire = parse_d(emp.hire_date)
            a_start, a_end = parse_d(a.start), (parse_d(a.end) if a.end else None)
            ts_ends = {pe for (e, pe) in w.timesheets if e == a.employee_id}
            for d in accrual_dates(pol, hire, a_start, a_end, lo, hi, anchor, w.pay_length, ts_ends):
                add(fmt(d), 0, ("ACCRUAL", a, fmt(d)))
            for b in year_boundaries(pol, hire, a_start, a_end, lo, hi):
                add(fmt(b), 2, ("BOUNDARY", a, fmt(b)))
            # transfer: this assignment starts the day after another one of the same leave type ends
            prev = [p for p in w.assignments if p.employee_id == a.employee_id and p.leave_type == a.leave_type
                    and p.end and fmt(parse_d(p.end) + timedelta(days=1)) == a.start]
            if prev and lo <= a_start <= hi:
                add(a.start, 0, ("TRANSFER", prev[0], a))
        for r in w.requests:
            self.reqs[r.id] = ReqState(r)
        for ev in w.events:
            if ev.on <= w.asof:
                add(ev.on, 1, ("EVENT", ev))

        for d in sorted(days):
            plan = days[d]
            for item in sorted(plan.get(0, []), key=self._k0):
                self._do_class0(item, d)
            for _, ev in sorted(plan.get(1, []), key=lambda x: (x[1].request_id, x[1].seq)):
                self._do_event(ev)
            for _, a, b in sorted(plan.get(2, []), key=lambda x: (x[1].employee_id, x[1].leave_type)):
                self._do_boundary(a, b)

    @staticmethod
    def _k0(item):
        order = {"OPEN": 0, "TRANSFER": 1, "ACCRUAL": 2}
        if item[0] == "OPEN":
            return (0, item[1], item[2])
        if item[0] == "TRANSFER":
            return (1, item[2].employee_id, item[2].leave_type)
        return (2, item[1].employee_id, item[1].leave_type, item[1].policy_id)

    def _do_class0(self, item, d: str) -> None:
        w = self.w
        if item[0] == "OPEN":
            _, eid, lt, mins = item
            pol = self.assignment_on(eid, lt, w.ledger_start)
            self._post(employee_id=eid, leave_type=lt, policy_id=pol.policy_id if pol else "", kind="ADJUSTMENT",
                       effective=d, posted=d, minutes=mins, capped_minutes=0, codes="OPENING_BALANCE", ref="")
        elif item[0] == "TRANSFER":
            _, old, new = item
            bal = self.ledger.balance(old.employee_id, old.leave_type, d)
            self._post(employee_id=old.employee_id, leave_type=old.leave_type, policy_id=old.policy_id, kind="TRANSFER_OUT",
                       effective=d, posted=d, minutes=-bal, capped_minutes=0, codes="POLICY_TRANSFER_OUT", ref=new.policy_id)
            self._post(employee_id=new.employee_id, leave_type=new.leave_type, policy_id=new.policy_id, kind="TRANSFER_IN",
                       effective=d, posted=d, minutes=bal, capped_minutes=0, codes="POLICY_TRANSFER_IN", ref=old.policy_id)
        else:
            _, a, dd = item
            pol = w.policies[a.policy_id]
            emp = w.org.emp[a.employee_id]
            worked = w.timesheets.get((a.employee_id, dd), 0)
            gross, codes = accrual_minutes(pol, parse_d(emp.hire_date), parse_d(a.start),
                                           parse_d(a.end) if a.end else None, parse_d(dd), worked)
            bal = self.ledger.balance(a.employee_id, a.leave_type, dd)
            room = max(0, pol.max_balance_minutes - bal)
            net = min(gross, room)
            capped = gross - net
            if capped:
                codes.append("MAX_BALANCE_CAP")
            self._post(employee_id=a.employee_id, leave_type=a.leave_type, policy_id=a.policy_id, kind="ACCRUAL",
                       effective=dd, posted=dd, minutes=net, capped_minutes=capped, codes="+".join(codes),
                       ref=dd if pol.frequency != "PER_HOURS_WORKED" else f"{dd}:{worked}")

    def _do_boundary(self, a: Assignment, b: str) -> None:
        pol = self.w.policies[a.policy_id]
        bal = self.ledger.balance(a.employee_id, a.leave_type, b)
        forfeit = max(0, bal - pol.carryover_cap_minutes)
        if forfeit:
            self.ledger.post(Entry("", a.employee_id, a.leave_type, a.policy_id, "FORFEITURE", b, b, -forfeit, 0,
                                   "CARRYOVER_FORFEITURE", b, 0))
        self.last_boundary.setdefault((a.employee_id, a.leave_type), []).append(b)

    # -- request events
    def _do_event(self, ev: ReqEvent) -> None:
        rs = self.reqs[ev.request_id]
        r = rs.req
        w = self.w
        if ev.action == "SUBMIT":
            if rs.state != "DRAFT":
                self._ignore(rs, ev, "IGNORED_NOT_DRAFT")
                return
            wd = working_days(parse_d(r.start), parse_d(r.end), w.holidays)
            a = self.assignment_on(r.employee_id, r.leave_type, r.start)
            rs.working_days, rs.minutes = len(wd), len(wd) * WORK_DAY_MINUTES
            rs.policy_id = a.policy_id if a else ""
            pol = w.policies[rs.policy_id]
            rs.steps = route(w.org, w.routing, pol, w.delegations, r.employee_id, ev.on, rs.working_days)
            rs.chain = chain_str(rs.steps)
            rs.state = "SUBMITTED"
            rs.log.append(f"SUBMIT:{ev.actor}:{ev.on}:CHAIN_FROZEN")
            # D-45: overlap with the same employee's own PENDING or APPROVED request, checked before A8
            if any(o.req.id != r.id and o.req.employee_id == r.employee_id and o.state in ("PENDING", "APPROVED")
                   and o.req.start <= r.end and r.start <= o.req.end for o in self.reqs.values()):
                rs.state, rs.final_code = "DENIED", "OVERLAPPING_REQUEST"
                rs.log.append(f"SYSTEM_DENY:SYSTEM:{ev.on}:OVERLAPPING_REQUEST")
                return
            if not pol.allow_negative and self.ledger.available(r.employee_id, r.leave_type) - rs.minutes < 0:
                rs.state, rs.final_code = "DENIED", "INSUFFICIENT_BALANCE"
                rs.log.append(f"SYSTEM_DENY:SYSTEM:{ev.on}:INSUFFICIENT_BALANCE")
                return
            if not rs.kept():
                rs.state, rs.final_code = "SUBMITTED", "UNROUTABLE"
                return
            rs.state = "PENDING"
            return
        if rs.state in ("APPROVED", "DENIED", "CANCELLED") and not (rs.state == "APPROVED" and ev.action == "CANCEL"):
            self._ignore(rs, ev, "IGNORED_TERMINAL")
            return
        if ev.action == "CANCEL":
            if ev.actor != r.employee_id and HR_ROLE not in w.org.roles_of(ev.actor, ev.on):
                self._void(rs, ev, "CANCEL_NOT_REQUESTER_OR_HR")
                return
            was_approved = rs.state == "APPROVED"
            rs.state, rs.final_code = "CANCELLED", ("CANCELLED_AFTER_APPROVAL" if was_approved else "CANCELLED_PENDING")
            rs.log.append(f"CANCEL:{ev.actor}:{ev.on}:{rs.final_code}")
            if was_approved:
                posted = []
                for u in [x for x in self.ledger.rows(r.employee_id, r.leave_type) if x.kind == "USAGE" and x.ref == r.id]:
                    posted.append(self._post(employee_id=r.employee_id, leave_type=r.leave_type, policy_id=u.policy_id, kind="USAGE_REVERSAL",
                                             effective=u.effective, posted=ev.on, minutes=-u.minutes, capped_minutes=0,
                                             codes="USAGE_REVERSED_CANCELLED", ref=r.id, recompute=False))
                self._recompute_after(posted)   # A7: one recompute per cancellation, not one per day
            return
        if rs.state != "PENDING":
            self._ignore(rs, ev, "IGNORED_NOT_PENDING")
            return
        step = rs.kept()[rs.step]
        if ev.action == "REASSIGN":
            if HR_ROLE not in w.org.roles_of(ev.actor, ev.on):
                self._void(rs, ev, "REASSIGN_NOT_HR")
                return
            step.approver = ev.target
            rs.log.append(f"REASSIGN:{ev.actor}:{ev.on}:STEP_REASSIGNED->{ev.target}")
            return
        # APPROVE / DENY eligibility (S3)
        if ev.actor != step.approver:
            self._void(rs, ev, "APPROVER_NOT_STEP_APPROVER")
            return
        if not w.org.is_active(ev.actor, ev.on):
            self._void(rs, ev, "APPROVER_INACTIVE")
            return
        if step_requires_hr(step.codes) and HR_ROLE not in w.org.roles_of(ev.actor, ev.on):
            self._void(rs, ev, "APPROVER_INELIGIBLE_ROLE_REVOKED")
            return
        if ev.action == "DENY":
            rs.state, rs.final_code = "DENIED", "DENIED_BY_APPROVER"
            rs.log.append(f"DENY:{ev.actor}:{ev.on}:{step.step_id}")
            return
        step.approved_by, step.approved_on = ev.actor, ev.on
        rs.log.append(f"APPROVE:{ev.actor}:{ev.on}:{step.step_id}")
        rs.step += 1
        if rs.step < len(rs.kept()):
            return
        rs.state, rs.final_code = "APPROVED", "APPROVED"
        posted = []
        for d in working_days(parse_d(r.start), parse_d(r.end), w.holidays):
            posted.append(self._post(employee_id=r.employee_id, leave_type=r.leave_type, policy_id=rs.policy_id, kind="USAGE",
                                     effective=fmt(d), posted=ev.on, minutes=-WORK_DAY_MINUTES, capped_minutes=0,
                                     codes="USAGE_APPROVED", ref=r.id, recompute=False))
        self._recompute_after(posted)   # A7: one recompute per approval

    def _ignore(self, rs: ReqState, ev: ReqEvent, code: str) -> None:
        self.ignored += 1
        rs.log.append(f"{ev.action}:{ev.actor}:{ev.on}:{code}")

    def _void(self, rs: ReqState, ev: ReqEvent, code: str) -> None:
        self.voided += 1
        rs.log.append(f"VOID_{ev.action}:{ev.actor}:{ev.on}:{code}")


# ----------------------------------------------------------------------------- reporting


def employee_year_rows(ledger: Ledger, employees: list[Employee], years: list[int]) -> list[dict]:
    """Per employee, year, leave type: opening (adjustments), accrued, capped, used (net of reversals), forfeited,
    balance at year end (L1). Transfers net to zero inside a leave type and are not shown."""
    rows = []
    for e in sorted(employees, key=lambda e: e.id):
        for lt in ("PTO", "SICK"):
            ents = ledger.rows(e.id, lt)
            if not ents:
                continue
            for y in years:
                ys, ye = f"{y}-01-01", f"{y}-12-31"
                inyr = [x for x in ents if ys <= x.effective <= ye]
                if not inyr and not any(x.effective < ys for x in ents):
                    continue
                rows.append({
                    "employee_id": e.id, "year": y, "leave_type": lt,
                    "opening": sum(x.minutes for x in ents if x.effective < ys),
                    "accrued": sum(x.minutes for x in inyr if x.kind == "ACCRUAL"),
                    "capped": sum(x.capped_minutes for x in inyr if x.kind == "ACCRUAL"),
                    "used": -sum(x.minutes for x in inyr if x.kind in ("USAGE", "USAGE_REVERSAL")),
                    "forfeited": -sum(x.minutes for x in inyr if x.kind == "FORFEITURE"),
                    "balance_end": ledger.balance(e.id, lt, ye),
                })
    return rows
