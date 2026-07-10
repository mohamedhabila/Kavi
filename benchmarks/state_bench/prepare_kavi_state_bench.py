#!/usr/bin/env python3
"""Prepare the pinned Kavi adapter inside a clean STATE-Bench v0.8.0 checkout."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

RELEASE = "v0.8.0"
COMMIT = "e2c8d7af51ef48fbbea51bb2ce1fb859af36b423"


def run(
    command: list[str], *, cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--upstream",
        type=Path,
        default=repo_root / ".private/evals/upstream/STATE-Bench",
    )
    parser.add_argument(
        "--runtime",
        type=Path,
        default=repo_root / ".private/evals/runtime/kavi_state_bench.cjs",
    )
    parser.add_argument(
        "--artifact",
        type=Path,
        default=repo_root
        / ".private/evals/data/state_bench/kavi_learning_artifact.json",
    )
    return parser.parse_args()


def verify_upstream(upstream: Path, adapter_source: Path) -> None:
    if not (upstream / ".git").exists():
        raise RuntimeError(f"STATE-Bench checkout not found: {upstream}")
    head = run(["git", "rev-parse", "HEAD"], cwd=upstream).stdout.strip()
    if head != COMMIT:
        raise RuntimeError(
            f"STATE-Bench must be pinned to {RELEASE} ({COMMIT}); found {head}"
        )
    status = run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=upstream
    ).stdout.splitlines()
    allowed_path = "agents/kavi_state_bench_agent.py"
    disallowed = [line for line in status if line[3:] != allowed_path]
    if disallowed:
        raise RuntimeError(
            "STATE-Bench checkout has unrelated changes: " + "; ".join(disallowed)
        )
    installed = upstream / allowed_path
    if installed.exists() and installed.read_bytes() != adapter_source.read_bytes():
        raise RuntimeError("Installed Kavi adapter differs from the pinned source")


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    upstream = args.upstream.expanduser().resolve()
    runtime = args.runtime.expanduser().resolve()
    artifact = args.artifact.expanduser().resolve()
    adapter_source = Path(__file__).with_name("kavi_state_bench_agent.py")
    verify_upstream(upstream, adapter_source)

    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required to build the Kavi learning runtime")
    runtime.parent.mkdir(parents=True, exist_ok=True)
    artifact.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            node,
            str(Path(__file__).with_name("build_kavi_state_bench_runtime.js")),
            "--out",
            str(runtime),
        ],
        cwd=repo_root,
    )
    build_command = [
        node,
        str(runtime),
        "build",
        "--train-dir",
        str(upstream / "datasets/train_task_trajectories"),
        "--out",
        str(artifact),
    ]
    build_result = run(build_command, cwd=repo_root)

    adapter_target = upstream / "agents/kavi_state_bench_agent.py"
    adapter_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(adapter_source, adapter_target)
    inspect_result = run(
        [node, str(runtime), "inspect", "--artifact", str(artifact)],
        cwd=repo_root,
    )
    print(
        json.dumps(
            {
                "claim": "official_candidate",
                "release": RELEASE,
                "commit": COMMIT,
                "agent_class": "KaviStateBenchAgent",
                "runtime": str(runtime),
                "artifact": str(artifact),
                "adapter": str(adapter_target),
                "build": json.loads(build_result.stdout),
                "inspect": json.loads(inspect_result.stdout),
                "environment": {
                    "KAVI_STATE_BENCH_RUNTIME": str(runtime),
                    "KAVI_STATE_BENCH_ARTIFACT": str(artifact),
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
