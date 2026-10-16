"""Runs Claw-Anything's own CLI with Kavi as the agent backend.

Usage (from the Claw-Anything virtualenv; arguments are Claw-Anything's own)::

    python benchmarks/claw_anything/run_kavi.py batch --config <config.yaml> \
        --tasks-dir benchmark/tool --cli-only --trials 1 --parallel 1 --model <model id>

Claw-Anything's agent factory is closed to new backends, so this replaces it for
the run with one that returns ``KaviAgent``; the task loading, mock services,
tracing and grading are Claw-Anything's unchanged code. Mock services are
started from Claw-Anything's checkout, so the CLI runs there.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import claw_anything
import claw_anything.agents as claw_agents

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kavi_agent import KaviAgent  # noqa: E402


def make_kavi_agent(cfg: object, args: object, model_id: str) -> KaviAgent:
    del cfg, args, model_id
    return KaviAgent()


def main(argv: list[str]) -> None:
    claw_agents.make_agent = make_kavi_agent
    checkout = Path(claw_anything.__file__).resolve().parents[2]
    if not (checkout / "mock_services").is_dir():
        raise SystemExit(f"Claw-Anything's mock_services are not at {checkout}.")
    resolved = [str(Path(arg).resolve()) if Path(arg).exists() else arg for arg in argv]
    os.chdir(checkout)
    from claw_anything.cli import main as claw_main

    claw_main(resolved)


if __name__ == "__main__":
    main(sys.argv[1:])
