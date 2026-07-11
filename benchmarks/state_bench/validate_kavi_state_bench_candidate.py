#!/usr/bin/env python3
"""Validate a complete STATE-Bench v0.8.0 run before candidate packaging."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import stat
import subprocess
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

RELEASE = "v0.8.0"
COMMIT = "e2c8d7af51ef48fbbea51bb2ce1fb859af36b423"
PREPARATION_SCHEMA_VERSION = "kavi-state-bench-preparation-v1"
CANDIDATE_SCHEMA_VERSION = "kavi-state-bench-candidate-v1"
EXPECTED_PROTOCOL_ID = "state_bench_v0.8.0_gpt54"
EXPECTED_DOMAINS = ("travel", "customer_support", "shopping_assistant")
EXPECTED_RUNS = 5
EXPECTED_TASKS_PER_DOMAIN = 50
EXPECTED_TOP_K = 3
MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def run(command: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def regular_file(path: Path, label: str) -> Path:
    require(path.is_file() and not path.is_symlink(), f"{label} must be a regular file: {path}")
    return path


def _closed_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path, label: str) -> dict[str, Any]:
    regular_file(path, label)
    require(path.stat().st_size <= MAX_JSON_BYTES, f"{label} exceeds the JSON size bound")
    try:
        value = json.loads(path.read_text(), object_pairs_hook=_closed_json_object)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as error:
        raise RuntimeError(f"{label} is not valid canonical JSON: {path}") from error
    require(isinstance(value, dict), f"{label} must contain a JSON object")
    return value


def require_exact_keys(value: dict[str, Any], keys: set[str], label: str) -> None:
    require(set(value) == keys, f"{label} has an unsupported schema")


def verify_git_revision(repo: Path, expected: str, label: str) -> None:
    require((repo / ".git").exists(), f"{label} checkout not found: {repo}")
    head = run(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()
    require(head == expected, f"{label} revision mismatch: expected {expected}, found {head}")


def verify_app_checkout(repo_root: Path, expected_commit: str) -> None:
    verify_git_revision(repo_root, expected_commit, "Kavi")
    status = run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=repo_root
    ).stdout.strip()
    require(not status, "Kavi worktree must be clean for candidate validation")


def verify_upstream_checkout(upstream: Path, adapter_source: Path) -> None:
    verify_git_revision(upstream, COMMIT, "STATE-Bench")
    status = run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=upstream
    ).stdout.splitlines()
    allowed = "agents/kavi_state_bench_agent.py"
    require(
        all(len(line) >= 4 and line[3:] == allowed for line in status),
        "STATE-Bench checkout contains changes outside the exact installed Kavi adapter",
    )
    installed = regular_file(upstream / allowed, "installed Kavi adapter")
    require(
        installed.read_bytes() == adapter_source.read_bytes(),
        "Installed Kavi adapter differs from the reviewed source",
    )


def verify_protocol(upstream: Path) -> dict[str, Any]:
    protocol_path = upstream / "state_bench/configs/eval_protocols/gpt54.json"
    protocol = load_json(protocol_path, "STATE-Bench protocol")
    require(protocol.get("split_version") == "train_test", "Protocol split_version must be train_test")
    require(protocol.get("split") == "test", "Protocol split must be test")
    require(protocol.get("num_runs") == EXPECTED_RUNS, "Protocol must require five runs")
    require(protocol.get("domains") == list(EXPECTED_DOMAINS), "Protocol domains are incomplete")
    require(protocol.get("official_model") == "gpt-5.4", "Protocol official model must be GPT-5.4")
    simulator = protocol.get("simulator")
    judge = protocol.get("judge")
    require(isinstance(simulator, dict), "Protocol simulator config is missing")
    require(isinstance(judge, dict), "Protocol judge config is missing")
    require(simulator.get("model") == "gpt-5.4", "Protocol simulator must use GPT-5.4")
    require(judge.get("model") == "gpt-5.4", "Protocol judge must use GPT-5.4")
    require(judge.get("reasoning_effort") == "high", "Protocol judge reasoning must be high")
    for section_name, section in (("simulator", simulator), ("judge", judge)):
        hashes = section.get("prompt_hashes")
        require(isinstance(hashes, dict) and hashes, f"Protocol {section_name} hashes are missing")
        for relative, expected_hash in hashes.items():
            require(
                isinstance(relative, str)
                and isinstance(expected_hash, str)
                and len(expected_hash) == 64,
                f"Protocol {section_name} hash entry is invalid",
            )
            domain, filename = relative.split("/", 1)
            prompt = regular_file(
                upstream / "state_bench/domains" / domain / "prompts" / filename,
                f"{section_name} prompt",
            )
            require(
                sha256_file(prompt) == expected_hash,
                f"Protocol {section_name} prompt hash mismatch: {relative}",
            )
    return protocol


def load_expected_task_ids(upstream: Path, domain: str) -> tuple[str, ...]:
    split = load_json(
        upstream / "state_bench/domains" / domain / "splits/train_test.json",
        f"{domain} split manifest",
    )
    splits = split.get("splits")
    require(isinstance(splits, dict), f"{domain} split manifest is missing splits")
    task_ids = splits.get("test")
    require(
        isinstance(task_ids, list)
        and len(task_ids) == EXPECTED_TASKS_PER_DOMAIN
        and all(isinstance(task_id, str) and task_id.strip() == task_id for task_id in task_ids)
        and len(set(task_ids)) == EXPECTED_TASKS_PER_DOMAIN,
        f"{domain} must contain exactly {EXPECTED_TASKS_PER_DOMAIN} unique held-out task IDs",
    )
    for task_id in task_ids:
        regular_file(
            upstream / "state_bench/domains" / domain / "tasks" / f"{task_id}.json",
            f"{domain} held-out task",
        )
    return tuple(task_ids)


def canonical_agent_model(value: Any, label: str) -> dict[str, str | None]:
    require(isinstance(value, dict), f"{label} agent_model must be an object")
    model_name = value.get("model_name")
    reasoning_level = value.get("reasoning_level")
    require(
        isinstance(model_name, str) and bool(model_name.strip()),
        f"{label} agent_model.model_name is required",
    )
    require(
        reasoning_level is None
        or (isinstance(reasoning_level, str) and bool(reasoning_level.strip())),
        f"{label} agent_model.reasoning_level is invalid",
    )
    return {"model_name": model_name.strip(), "reasoning_level": reasoning_level}


def finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def verify_trajectory(
    path: Path,
    task_id: str,
    domain: str,
    protocol: dict[str, Any],
) -> dict[str, str | None]:
    trajectory = load_json(path, f"{domain} scored trajectory")
    require(trajectory.get("task_id") == task_id, f"Trajectory task_id mismatch: {path}")
    require(not trajectory.get("error"), f"Trajectory contains an execution error: {path}")
    require(
        trajectory.get("task_completion_pass") in (0, 1),
        f"Trajectory is missing task-completion scoring: {path}",
    )
    require(finite_number(trajectory.get("ux_score")), f"Trajectory is missing UX scoring: {path}")
    require(
        trajectory.get("evaluation_protocol_id") == EXPECTED_PROTOCOL_ID,
        f"Trajectory evaluation protocol mismatch: {path}",
    )
    require(
        trajectory.get("scoring_protocol_id") == EXPECTED_PROTOCOL_ID,
        f"Trajectory scoring protocol mismatch: {path}",
    )
    require(trajectory.get("agent_name") == "KaviStateBenchAgent", f"Wrong agent class: {path}")
    simulator = protocol["simulator"]
    judge = protocol["judge"]
    require(trajectory.get("simulator_model") == simulator["model"], f"Wrong simulator: {path}")
    require(trajectory.get("judge_model") == judge["model"], f"Wrong judge: {path}")
    require(
        trajectory.get("judge_reasoning_effort") == judge["reasoning_effort"],
        f"Wrong judge reasoning: {path}",
    )
    simulator_hash = simulator["prompt_hashes"][f"{domain}/user_sim_base.md"]
    require(
        trajectory.get("simulator_prompt_hash") == simulator_hash,
        f"Wrong simulator prompt hash: {path}",
    )
    expected_judge_hashes = {
        key.split("/", 1)[1]: value
        for key, value in judge["prompt_hashes"].items()
        if key.startswith(f"{domain}/")
    }
    require(
        trajectory.get("judge_prompt_hashes") == expected_judge_hashes,
        f"Wrong judge prompt hashes: {path}",
    )
    return canonical_agent_model(trajectory.get("agent_model"), str(path))


def verify_metrics(path: Path, expected_model: dict[str, str | None]) -> None:
    metrics = load_json(path, "STATE-Bench metrics")
    require(metrics.get("benchmark_version") == "0.8.0", f"Metrics version mismatch: {path}")
    require(
        isinstance(metrics.get("timestamp"), str) and bool(metrics["timestamp"].strip()),
        f"Metrics timestamp is missing: {path}",
    )
    require(metrics.get("evaluation_protocol_id") == EXPECTED_PROTOCOL_ID, f"Metrics protocol mismatch: {path}")
    require(metrics.get("num_runs") == EXPECTED_RUNS, f"Metrics run count mismatch: {path}")
    require(canonical_agent_model(metrics.get("agent_model"), str(path)) == expected_model, f"Metrics model mismatch: {path}")
    public_metrics = metrics.get("metrics")
    require(isinstance(public_metrics, dict), f"Metrics payload is missing: {path}")
    for key in (
        "task_completion_pass@1",
        f"task_completion_pass^{EXPECTED_RUNS}",
        "mean_ux_score",
        "mean_cost_usd",
    ):
        require(finite_number(public_metrics.get(key)), f"Metrics field {key} is missing: {path}")


def _walk_regular_files(root: Path) -> dict[str, Path]:
    require(root.is_dir() and not root.is_symlink(), f"Outputs directory is invalid: {root}")
    files: dict[str, Path] = {}
    total_size = 0
    for current, directory_names, file_names in os.walk(root, followlinks=False):
        current_path = Path(current)
        for name in directory_names:
            require(not (current_path / name).is_symlink(), "Outputs must not contain symlinked directories")
        for name in file_names:
            path = current_path / name
            regular_file(path, "output artifact")
            relative = path.relative_to(root).as_posix()
            total_size += path.stat().st_size
            require(total_size <= MAX_ARCHIVE_BYTES, "Outputs exceed the archive size bound")
            files[relative] = path
    return files


def verify_outputs(
    outputs: Path,
    upstream: Path,
    protocol: dict[str, Any],
) -> tuple[dict[str, Path], dict[str, str | None], dict[str, int]]:
    all_files = _walk_regular_files(outputs)
    allowed_files: set[str] = set()
    canonical_model: dict[str, str | None] | None = None
    task_counts: dict[str, int] = {}
    require(set(path.name for path in outputs.iterdir()) == set(EXPECTED_DOMAINS), "Outputs must contain exactly the three official domains")
    for domain in EXPECTED_DOMAINS:
        domain_root = outputs / domain
        require(domain_root.is_dir() and not domain_root.is_symlink(), f"Missing output domain: {domain}")
        task_ids = load_expected_task_ids(upstream, domain)
        task_counts[domain] = len(task_ids)
        for run_index in range(1, EXPECTED_RUNS + 1):
            run_root = domain_root / f"run{run_index}"
            require(run_root.is_dir() and not run_root.is_symlink(), f"Missing {domain}/run{run_index}")
            actual = {path.name for path in run_root.iterdir()}
            expected = {f"{task_id}.json" for task_id in task_ids}
            require(actual == expected, f"{domain}/run{run_index} held-out coverage is incomplete")
            for task_id in task_ids:
                relative = f"{domain}/run{run_index}/{task_id}.json"
                model = verify_trajectory(all_files[relative], task_id, domain, protocol)
                if canonical_model is None:
                    canonical_model = model
                require(model == canonical_model, "Agent model metadata changed within the candidate run")
                allowed_files.add(relative)
        metrics_relative = f"{domain}/metrics.json"
        require(metrics_relative in all_files, f"Missing {domain}/metrics.json")
        require(canonical_model is not None, "No scored trajectories were found")
        verify_metrics(all_files[metrics_relative], canonical_model)
        allowed_files.add(metrics_relative)
        per_task_root = domain_root / "per_task_metrics"
        if per_task_root.exists():
            require(per_task_root.is_dir() and not per_task_root.is_symlink(), "per_task_metrics is invalid")
            expected_per_task = {f"{task_id}.json" for task_id in task_ids}
            require(
                {path.name for path in per_task_root.iterdir()} == expected_per_task,
                f"{domain} per-task metrics coverage is incomplete",
            )
            allowed_files.update(f"{domain}/per_task_metrics/{name}" for name in expected_per_task)
    require(set(all_files) == allowed_files, "Outputs contain unsupported files")
    require(canonical_model is not None, "Candidate has no agent model metadata")
    return all_files, canonical_model, task_counts


def verify_archive(archive: Path, files: dict[str, Path]) -> str:
    regular_file(archive, "STATE-Bench output archive")
    require(archive.stat().st_size <= MAX_ARCHIVE_BYTES, "Archive exceeds the size bound")
    expected = {f"outputs/{relative}": path for relative, path in files.items()}
    with zipfile.ZipFile(archive, "r") as package:
        infos = package.infolist()
        names = [info.filename for info in infos]
        require(len(names) == len(set(names)), "Archive contains duplicate members")
        actual_files: dict[str, zipfile.ZipInfo] = {}
        for info in infos:
            member = PurePosixPath(info.filename)
            require(
                not member.is_absolute()
                and ".." not in member.parts
                and member.parts
                and member.parts[0] == "outputs",
                f"Archive member path is unsafe: {info.filename}",
            )
            unix_mode = info.external_attr >> 16
            require(not stat.S_ISLNK(unix_mode), f"Archive contains a symlink: {info.filename}")
            if not info.is_dir():
                actual_files[info.filename] = info
        require(set(actual_files) == set(expected), "Archive does not exactly match validated outputs")
        for name, source in expected.items():
            info = actual_files[name]
            require(info.file_size == source.stat().st_size, f"Archive size mismatch: {name}")
            require(sha256_bytes(package.read(info)) == sha256_file(source), f"Archive hash mismatch: {name}")
    return sha256_file(archive)


def verify_preparation_manifest(
    path: Path,
    repo_root: Path,
    upstream: Path,
    runtime: Path,
    artifact: Path,
    adapter_source: Path,
) -> dict[str, Any]:
    manifest = load_json(path, "STATE-Bench preparation manifest")
    require_exact_keys(
        manifest,
        {
            "schemaVersion",
            "claim",
            "readiness",
            "createdAt",
            "app",
            "upstream",
            "protocol",
            "artifacts",
        },
        "Preparation manifest",
    )
    require(manifest["schemaVersion"] == PREPARATION_SCHEMA_VERSION, "Preparation schema is unsupported")
    require(manifest["claim"] == "prepared_adapter", "Preparation must not claim candidate status")
    require(manifest["readiness"] == "full_upstream_ready", "Preparation readiness is incomplete")
    app = manifest["app"]
    upstream_record = manifest["upstream"]
    protocol = manifest["protocol"]
    artifacts = manifest["artifacts"]
    require(isinstance(app, dict) and set(app) == {"commit"}, "Preparation app provenance is invalid")
    require(
        isinstance(upstream_record, dict) and set(upstream_record) == {"release", "commit"},
        "Preparation upstream provenance is invalid",
    )
    require(
        upstream_record == {"release": RELEASE, "commit": COMMIT},
        "Preparation upstream revision is stale",
    )
    require(
        protocol
        == {
            "evaluationProtocolId": EXPECTED_PROTOCOL_ID,
            "domains": list(EXPECTED_DOMAINS),
            "split": "test",
            "runs": EXPECTED_RUNS,
            "retrieveLearningsTopK": EXPECTED_TOP_K,
        },
        "Preparation protocol is incomplete",
    )
    require(isinstance(artifacts, dict) and set(artifacts) == {"runtimeSha256", "artifactSha256", "adapterSha256"}, "Preparation artifact provenance is invalid")
    require(artifacts["runtimeSha256"] == sha256_file(regular_file(runtime, "Kavi STATE runtime")), "Runtime changed after preparation")
    require(artifacts["artifactSha256"] == sha256_file(regular_file(artifact, "Kavi learning artifact")), "Learning artifact changed after preparation")
    require(artifacts["adapterSha256"] == sha256_file(adapter_source), "Adapter changed after preparation")
    verify_app_checkout(repo_root, app.get("commit", ""))
    verify_upstream_checkout(upstream, adapter_source)
    return manifest


def write_private_json(path: Path, value: dict[str, Any]) -> None:
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


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=repo_root)
    parser.add_argument("--upstream", type=Path, default=repo_root / ".private/evals/upstream/STATE-Bench")
    parser.add_argument("--runtime", type=Path, default=repo_root / ".private/evals/runtime/kavi_state_bench.cjs")
    parser.add_argument("--artifact", type=Path, default=repo_root / ".private/evals/data/state_bench/kavi_learning_artifact.json")
    parser.add_argument("--preparation-manifest", type=Path, default=repo_root / ".private/evals/data/state_bench/kavi_preparation_manifest.json")
    parser.add_argument("--outputs", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--out-manifest", type=Path, default=repo_root / ".private/evals/submission-staging/state-bench/kavi_candidate_integrity.json")
    return parser.parse_args()


def validate_candidate(args: argparse.Namespace) -> dict[str, Any]:
    repo_root = args.repo_root.expanduser().resolve()
    upstream = args.upstream.expanduser().resolve()
    runtime = args.runtime.expanduser().resolve()
    artifact = args.artifact.expanduser().resolve()
    preparation_path = args.preparation_manifest.expanduser().resolve()
    outputs = args.outputs.expanduser().resolve()
    archive = args.archive.expanduser().resolve()
    out_manifest = args.out_manifest.expanduser().resolve()
    adapter_source = Path(__file__).with_name("kavi_state_bench_agent.py")

    preparation = verify_preparation_manifest(
        preparation_path, repo_root, upstream, runtime, artifact, adapter_source
    )
    protocol = verify_protocol(upstream)
    files, agent_model, task_counts = verify_outputs(outputs, upstream, protocol)
    archive_sha256 = verify_archive(archive, files)
    output_hashes = {
        relative: sha256_file(path) for relative, path in sorted(files.items())
    }
    candidate = {
        "schemaVersion": CANDIDATE_SCHEMA_VERSION,
        "claim": "official_candidate",
        "officialStatus": "unsubmitted",
        "validatedAt": datetime.now(UTC).isoformat(),
        "appCommit": preparation["app"]["commit"],
        "upstream": {"release": RELEASE, "commit": COMMIT},
        "protocol": {
            "evaluationProtocolId": EXPECTED_PROTOCOL_ID,
            "domains": list(EXPECTED_DOMAINS),
            "split": "test",
            "runs": EXPECTED_RUNS,
            "heldOutTasksPerDomain": task_counts,
            "retrieveLearningsTopK": EXPECTED_TOP_K,
        },
        "agentModel": agent_model,
        "provenance": {
            "preparationManifestSha256": sha256_file(preparation_path),
            "runtimeSha256": sha256_file(runtime),
            "learningArtifactSha256": sha256_file(artifact),
            "adapterSha256": sha256_file(adapter_source),
            "outputFileCount": len(output_hashes),
            "outputTreeSha256": sha256_bytes(
                json.dumps(output_hashes, sort_keys=True, separators=(",", ":")).encode()
            ),
            "archiveSha256": archive_sha256,
        },
        "submission": {
            "archive": str(archive),
            "method": "Open a STATE-Bench GitHub issue and await maintainer verification.",
        },
    }
    write_private_json(out_manifest, candidate)
    return {"manifest": str(out_manifest), **candidate}


def main() -> None:
    print(json.dumps(validate_candidate(parse_args()), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
