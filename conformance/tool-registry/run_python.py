"""Run the neutral tool-registry replay fixture with native Python handlers."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python/tool-registry/tests"))

from registry_conformance import replay_fixture


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("fixture", type=Path)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(replay_fixture(args.fixture)), separators=(",", ":")))


if __name__ == "__main__":
    main()
