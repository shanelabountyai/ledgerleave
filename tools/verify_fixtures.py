"""Ledgerleave — fixture freeze check (test oracle, never product code).

Regenerates the fixtures with the pinned seed into a temporary directory and compares every
sha256 with fixtures/MANIFEST.json. If fixtures/ also holds the reference engine's outputs
(ledger.csv, expected_balances.csv, expected_requests.csv) they are regenerated and compared
too. Then re-runs golden_answers.py. Prints OK or names the first file whose bytes moved.
Used by `npm run fixtures:check`.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
EXPECTED = ("ledger.csv", "expected_balances.csv", "expected_requests.csv")


def sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main() -> int:
    fixtures = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "fixtures")
    manifest_path = os.path.join(fixtures, "MANIFEST.json")
    if not os.path.exists(manifest_path):
        print(f"no MANIFEST.json in {fixtures}; run tools/build_fixtures.py first")
        return 1
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    seed = manifest["seed"]
    want = dict(manifest["sha256"])
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "build_fixtures.py"), "--seed", str(seed), "--out", tmp],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stderr)
            return 1
        with open(os.path.join(tmp, "MANIFEST.json"), encoding="utf-8") as f:
            fresh = dict(json.load(f)["sha256"])
        if all(os.path.exists(os.path.join(fixtures, n)) for n in EXPECTED):
            r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "reference_leave.py"), "--fixtures", tmp, "--write-expected"],
                               capture_output=True, text=True)
            if r.returncode != 0:
                print(r.stderr)
                return 1
            for n in EXPECTED:
                want[n] = sha(os.path.join(fixtures, n))
                fresh[n] = sha(os.path.join(tmp, n))
    bad = 0
    for name, h in sorted(want.items()):
        got = fresh.get(name)
        if got != h:
            bad += 1
            print(f"MOVED {name}: manifest {h[:12]}… regenerated {str(got)[:12]}…")
        else:
            print(f"ok    {name} {h[:12]}…")
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "golden_answers.py")], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.rstrip().endswith("OK"):
        bad += 1
        print("golden_answers.py did not end with OK")
        print(r.stdout[-2000:])
    if bad:
        print(f"FAIL: {bad}")
        return 1
    print(f"OK seed={seed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
