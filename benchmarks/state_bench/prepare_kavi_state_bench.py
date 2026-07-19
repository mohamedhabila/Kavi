#!/usr/bin/env python3
"""Prepare the pinned Kavi adapter inside a clean STATE-Bench v0.8.1 checkout."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

RELEASE = "v0.8.1"
COMMIT = "4efcbf2d4fe60df04878859b692d9391f3d5b33a"
PREPARATION_SCHEMA_VERSION = "kavi-state-bench-preparation-v1"
EXPECTED_PROTOCOL_ID = "state_bench_v0.8.1_gpt54"
EXPECTED_DOMAINS = ["travel", "customer_support", "shopping_assistant"]


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
    parser.add_argument(
        "--manifest",
        type=Path,
        default=repo_root
        / ".private/evals/data/state_bench/kavi_preparation_manifest.json",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def verify_clean_app(repo_root: Path) -> str:
    commit = run(["git", "rev-parse", "HEAD"], cwd=repo_root).stdout.strip()
    status = run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=repo_root
    ).stdout.strip()
    if status:
        raise RuntimeError("Kavi worktree must be clean before STATE-Bench preparation")
    return commit


def build_preparation_record(
    *, app_commit: str, runtime: Path, artifact: Path, adapter: Path
) -> dict[str, object]:
    return {
        "schemaVersion": PREPARATION_SCHEMA_VERSION,
        "claim": "prepared_adapter",
        "readiness": "full_upstream_ready",
        "createdAt": datetime.now(UTC).isoformat(),
        "app": {"commit": app_commit},
        "upstream": {"release": RELEASE, "commit": COMMIT},
        "protocol": {
            "evaluationProtocolId": EXPECTED_PROTOCOL_ID,
            "domains": EXPECTED_DOMAINS,
            "split": "test",
            "runs": 5,
            "retrieveLearningsTopK": 3,
        },
        "artifacts": {
            "runtimeSha256": sha256_file(runtime),
            "artifactSha256": sha256_file(artifact),
            "adapterSha256": sha256_file(adapter),
        },
    }


def write_private_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w") as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


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
    manifest_path = args.manifest.expanduser().resolve()
    adapter_source = Path(__file__).with_name("kavi_state_bench_agent.py")
    verify_upstream(upstream, adapter_source)
    app_commit = verify_clean_app(repo_root)

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
    preparation = build_preparation_record(
        app_commit=app_commit,
        runtime=runtime,
        artifact=artifact,
        adapter=adapter_source,
    )
    write_private_json(manifest_path, preparation)
    print(
        json.dumps(
            {
                **preparation,
                "release": RELEASE,
                "commit": COMMIT,
                "agent_class": "KaviStateBenchAgent",
                "runtime": str(runtime),
                "artifact": str(artifact),
                "adapter": str(adapter_target),
                "preparation_manifest": str(manifest_path),
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
