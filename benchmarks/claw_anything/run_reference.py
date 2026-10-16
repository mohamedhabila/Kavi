"""Runs Claw-Anything's own CLI and agents unchanged, as the reference arm for Kavi's runs.

Usage (from the Claw-Anything virtualenv; arguments are Claw-Anything's own)::

    python benchmarks/claw_anything/run_reference.py run --task benchmark/tool/<task> \
        --agent loop --config <config.yaml> --model <model id> --trace-dir <dir>

The only addition to Claw-Anything is ``CLAW_ANYTHING_EXTRA_HEADERS`` for an endpoint
that needs a header (client_options.py). Mock services start from Claw-Anything's
checkout, so the CLI runs there.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import client_options  # noqa: E402

client_options.install()

import claw_anything  # noqa: E402


def main(argv: list[str]) -> None:
    checkout = Path(claw_anything.__file__).resolve().parents[2]
    if not (checkout / "mock_services").is_dir():
        raise SystemExit(f"Claw-Anything's mock_services are not at {checkout}.")
    resolved = [str(Path(arg).resolve()) if Path(arg).exists() else arg for arg in argv]
    os.chdir(checkout)
    from claw_anything.cli import main as claw_main

    claw_main(resolved)


if __name__ == "__main__":
    main(sys.argv[1:])
