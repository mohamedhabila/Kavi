#!/usr/bin/env python3
"""Run a bounded AMemGym pilot through Kavi's exact foreground-chat path."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.metadata
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from kavi_agent import KaviAMemGymAgent


DEFAULT_UPSTREAM_REVISION = "ffcd18857a3e2b2c61f00730ebdec676e27d3e87"
DEFAULT_DATA_REVISION = "4b8f64f45a8ae7199842397985389aa0a9a9e8da"
DEFAULT_DATA_SHA256 = "a63f731508a60104bc27676926134ac4d889fb143141fb4634176f0905fb659a"
PILOT_PERIOD_INDICES = (0, 1, 3)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_revision(path: Path) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
    )
    revision = result.stdout.strip()
    return revision if result.returncode == 0 and len(revision) == 40 else None


def git_is_clean(path: Path) -> bool:
    result = subprocess.run(
        ["git", "-C", str(path), "status", "--porcelain"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and not result.stdout.strip()


def app_revision(project_root: Path) -> tuple[str | None, bool]:
    revision = git_revision(project_root)
    return revision, git_is_clean(project_root)


def dependency_versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    for name in ("backoff", "loguru", "numpy", "openai", "python-dotenv", "tiktoken", "tqdm"):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            continue
    return versions


def build_pilot_item(
    item: dict[str, Any],
    *,
    qa_index: int,
    period_indices: tuple[int, ...] = PILOT_PERIOD_INDICES,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    qas = item.get("qas")
    periods = item.get("periods")
    if not isinstance(qas, list) or not 0 <= qa_index < len(qas):
        raise ValueError(f"qa_index {qa_index} is outside the item question range.")
    if not isinstance(periods, list):
        raise ValueError("AMemGym item periods must be a list.")

    qa = qas[qa_index]
    required_info = qa.get("required_info")
    if not isinstance(required_info, list) or not all(
        isinstance(value, str) and value for value in required_info
    ):
        raise ValueError("AMemGym question required_info must contain state keys.")
    required_keys = set(required_info)

    selected_periods: list[dict[str, Any]] = []
    selection: list[dict[str, Any]] = []
    for period_index in period_indices:
        if not 0 <= period_index < len(periods):
            raise ValueError(f"period_index {period_index} is outside the item period range.")
        period = copy.deepcopy(periods[period_index])
        sessions = period.get("sessions")
        if not isinstance(sessions, list):
            raise ValueError(f"AMemGym period {period_index} sessions must be a list.")
        relevant_sessions = [
            session
            for session in sessions
            if isinstance(session.get("exposed_states"), dict)
            and required_keys.intersection(session["exposed_states"].keys())
        ]
        if not relevant_sessions:
            raise ValueError(
                f"AMemGym period {period_index} exposes none of question {qa_index}'s state keys."
            )
        period["sessions"] = relevant_sessions
        selected_periods.append(period)
        selection.append(
            {
                "original_period_index": period_index,
                "session_count": len(relevant_sessions),
                "exposed_state_keys": sorted(
                    {
                        key
                        for session in relevant_sessions
                        for key in session["exposed_states"].keys()
                        if key in required_keys
                    }
                ),
            }
        )

    pilot_item = copy.deepcopy(item)
    pilot_item["qas"] = [copy.deepcopy(qa)]
    pilot_item["periods"] = selected_periods
    return pilot_item, selection


def parse_period_indices(value: str) -> tuple[int, ...]:
    try:
        indices = tuple(int(part.strip()) for part in value.split(",") if part.strip())
    except ValueError as error:
        raise argparse.ArgumentTypeError("period-indices must be comma-separated integers.") from error
    if not indices or any(index < 0 for index in indices) or len(set(indices)) != len(indices):
        raise argparse.ArgumentTypeError("period-indices must contain unique non-negative integers.")
    return indices


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--upstream-dir",
        type=Path,
        default=project_root / ".private/evals/upstream/amemgym",
    )
    parser.add_argument(
        "--data-file",
        type=Path,
        default=project_root / ".private/evals/upstream/amemgym-data/v1.base/data.json",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--item-index", type=int, default=0)
    parser.add_argument("--qa-index", type=int, default=0)
    parser.add_argument(
        "--period-indices",
        type=parse_period_indices,
        default=PILOT_PERIOD_INDICES,
    )
    parser.add_argument("--min-accuracy", type=float, default=2 / 3)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[2]
    upstream_dir = args.upstream_dir.resolve()
    data_file = args.data_file.resolve()
    output_dir = args.output_dir.resolve()

    if not 0 <= args.min_accuracy <= 1:
        raise ValueError("min-accuracy must be between zero and one.")
    if not (upstream_dir / "src/amemgym/eval/overall.py").is_file():
        raise FileNotFoundError(f"AMemGym checkout is unavailable at {upstream_dir}.")
    if not data_file.is_file():
        raise FileNotFoundError(f"AMemGym dataset is unavailable at {data_file}.")
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError(
            f"AMemGym output must be fresh; choose another directory: {output_dir}"
        )
    output_dir.mkdir(parents=True, exist_ok=True)

    upstream_revision = git_revision(upstream_dir)
    data_revision = git_revision(data_file.parents[1])
    data_sha256 = sha256_file(data_file)
    if upstream_revision != DEFAULT_UPSTREAM_REVISION:
        raise RuntimeError(
            f"AMemGym checkout must be pinned to {DEFAULT_UPSTREAM_REVISION}; got {upstream_revision}."
        )
    if data_revision != DEFAULT_DATA_REVISION or data_sha256 != DEFAULT_DATA_SHA256:
        raise RuntimeError("AMemGym pilot dataset revision or content digest does not match the pin.")
    if not git_is_clean(upstream_dir) or not git_is_clean(data_file.parents[1]):
        raise RuntimeError("AMemGym code and dataset checkouts must be clean.")

    data = load_json(data_file)
    if not isinstance(data, list) or not 0 <= args.item_index < len(data):
        raise ValueError(f"item-index {args.item_index} is outside the dataset range.")
    pilot_item, selection = build_pilot_item(
        data[args.item_index],
        qa_index=args.qa_index,
        period_indices=args.period_indices,
    )

    bridge_url = os.environ.get("KAVI_AMEMGYM_BRIDGE_URL", "").strip()
    bridge_token = os.environ.get("KAVI_AMEMGYM_BRIDGE_TOKEN", "").strip()
    if not bridge_url or not bridge_token:
        raise RuntimeError("KAVI_AMEMGYM_BRIDGE_URL and KAVI_AMEMGYM_BRIDGE_TOKEN are required.")
    simulator_api_key = (
        os.environ.get("AMEMGYM_SIMULATOR_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
    )
    if not simulator_api_key:
        raise RuntimeError("AMemGym's official user simulator requires OPENAI_API_KEY.")

    sys.path.insert(0, str(upstream_dir / "src"))
    try:
        from amemgym.eval.overall import evaluate_item
    except ImportError as error:
        raise RuntimeError(
            "AMemGym dependencies are missing. Install the pinned upstream project in a private venv."
        ) from error

    env_config = load_json(upstream_dir / "configs/env/v1.base.json")
    simulator_base_url = (
        os.environ.get("AMEMGYM_SIMULATOR_BASE_URL", "").strip()
        or os.environ.get("OPENAI_BASE_URL", "").strip()
        or "https://api.openai.com/v1"
    )
    simulator_model = os.environ.get("AMEMGYM_SIMULATOR_MODEL", "").strip() or "gpt-4.1"
    for key in ("llm_config_low_temp", "llm_config_high_temp"):
        env_config[key] = {
            **env_config[key],
            "llm_model": simulator_model,
            "base_url": simulator_base_url,
            "api_key": simulator_api_key,
            "source": "env:amemgym-pilot",
        }

    item_dir = output_dir / str(pilot_item["id"])
    (item_dir / "interactions").mkdir(parents=True, exist_ok=True)
    agent = KaviAMemGymAgent(
        bridge_url=bridge_url,
        bridge_token=bridge_token,
        session_id=f"pilot-{uuid4()}",
    )
    evaluate_item(pilot_item, agent, str(item_dir), env_config, off_policy=False)

    results = load_json(item_dir / "overall_results.json")
    metrics = load_json(item_dir / "overall_metrics.json")
    json_errors = sum(
        1
        for period_results in results
        for result in period_results
        if result.get("json_error") is True
    )
    accuracy_values = metrics.get("accuracy")
    if not isinstance(accuracy_values, list):
        raise RuntimeError("AMemGym did not emit the expected accuracy metric.")
    flat_accuracy = [float(value) for period in accuracy_values for value in period]
    accuracy_mean = sum(flat_accuracy) / len(flat_accuracy)
    gate_passed = json_errors == 0 and accuracy_mean + 1e-12 >= args.min_accuracy

    app_commit, app_clean = app_revision(project_root)
    summary = {
        "kind": "kavi_amemgym_pilot_result",
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "claim_status": "non_official_bounded_pilot",
        "claim_eligible": app_clean and json_errors == 0,
        "sources": {
            "upstream_repository": "https://github.com/AGI-Eval-Official/amemgym",
            "upstream_revision": upstream_revision,
            "dataset_repository": "https://huggingface.co/datasets/AGI-Eval/AMemGym",
            "dataset_revision": data_revision,
            "dataset_sha256": data_sha256,
        },
        "app": {"commit": app_commit, "worktree_clean": app_clean},
        "models": {
            "agent": agent.bridge_metadata.get("provider"),
            "simulator": {"model": simulator_model, "base_url": simulator_base_url},
        },
        "selection": {
            "item_index": args.item_index,
            "item_id": pilot_item["id"],
            "qa_index": args.qa_index,
            "periods": selection,
        },
        "protocol": {
            "mode": "on_policy",
            "exact_upstream_interaction_sampler": True,
            "exact_upstream_scorer": True,
            "question_turn_writes_memory": False,
            "subset_only": True,
        },
        "runtime": {
            "python": sys.version.split()[0],
            "dependencies": dependency_versions(),
        },
        "metrics": {
            "accuracy": accuracy_mean,
            "accuracy_by_selected_period": flat_accuracy,
            "json_errors": json_errors,
            "minimum_accuracy": args.min_accuracy,
            "gate_passed": gate_passed,
        },
        "diagnostics": {
            "chat_turns": agent.act_diagnostics,
            "answer_retrieval": agent.answer_diagnostics,
        },
    }
    summary_path = output_dir / "pilot-summary.json"
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"summary": str(summary_path), "metrics": summary["metrics"]}, indent=2))

    if json_errors:
        print("AMemGym pilot is invalid because at least one answer was not parseable JSON.", file=sys.stderr)
        return 2
    if not gate_passed:
        print(
            f"AMemGym pilot accuracy {accuracy_mean:.3f} is below {args.min_accuracy:.3f}.",
            file=sys.stderr,
        )
        return 3
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"AMemGym pilot failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
