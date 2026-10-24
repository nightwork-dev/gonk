from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "conformance" / "tool-registry" / "cases.json"
EXPECTED = ROOT / "conformance" / "tool-registry" / "expected.json"


def test_native_python_replay_matches_generated_typescript_transcript() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
    assert fixture["cases"], "tool-registry conformance fixture must not be empty"
    assert expected["cases"], "tool-registry conformance transcript must not be empty"
    completed = subprocess.run(
        [sys.executable, "-I", str(ROOT / "conformance/tool-registry/run_python.py"), str(FIXTURE)],
        check=True,
        capture_output=True,
        text=True,
    )
    actual = json.loads(completed.stdout)
    assert expected["generatedBy"] == "typescript-tool-registry"
    assert actual["version"] == expected["version"]
    assert [case["id"] for case in actual["cases"]] == [
        case["id"] for case in expected["cases"]
    ]
    for actual_case, expected_case in zip(actual["cases"], expected["cases"], strict=True):
        assert actual_case["events"] == expected_case["events"], expected_case["id"]
