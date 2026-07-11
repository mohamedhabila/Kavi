#!/usr/bin/env python3
"""Validate and compare matched STATE-Bench learning-off and learning-on runs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import validate_kavi_state_bench_candidate as candidate_validator

COMPARISON_SCHEMA_VERSION = "kavi-state-bench-learning-comparison-v1"
BASELINE_AGENT_NAME = "StateBenchAgent"
CANDIDATE_AGENT_NAME = "KaviStateBenchAgent"
MAX_COST_INCREASE_RATIO = 0.25


def average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def aggregate_metrics(metrics_by_domain: dict[str, dict[str, float]]) -> dict[str, float]:
    candidate_validator.require(
        set(metrics_by_domain) == set(candidate_validator.EXPECTED_DOMAINS),
        "Comparison metrics must contain every official domain",
    )
    metric_names = {
        "task_completion_pass@1",
        f"task_completion_pass^{candidate_validator.EXPECTED_RUNS}",
        "mean_ux_score",
        "mean_cost_usd",
    }
    aggregates: dict[str, float] = {}
    for metric_name in sorted(metric_names):
        values = [metrics_by_domain[domain][metric_name] for domain in candidate_validator.EXPECTED_DOMAINS]
        candidate_validator.require(
            all(candidate_validator.finite_number(value) for value in values),
            f"Comparison metric {metric_name} is invalid",
        )
        aggregates[metric_name] = round(average(values), 6)
    return aggregates


def build_comparison_summary(
    baseline_by_domain: dict[str, dict[str, float]],
    candidate_by_domain: dict[str, dict[str, float]],
) -> dict[str, Any]:
    baseline = aggregate_metrics(baseline_by_domain)
    candidate = aggregate_metrics(candidate_by_domain)
    deltas = {
        metric_name: round(candidate[metric_name] - baseline[metric_name], 6)
        for metric_name in baseline
    }
    baseline_cost = baseline["mean_cost_usd"]
    candidate_cost = candidate["mean_cost_usd"]
    cost_increase_ratio = (
        0.0
        if baseline_cost == 0 and candidate_cost == 0
        else None
        if baseline_cost == 0
        else round((candidate_cost - baseline_cost) / baseline_cost, 6)
    )
    checks = {
        "passAt1Improved": deltas["task_completion_pass@1"] > 0,
        "passAllNonDegraded": deltas[f"task_completion_pass^{candidate_validator.EXPECTED_RUNS}"]
        >= 0,
        "uxImproved": deltas["mean_ux_score"] > 0,
        "costWithinBound": cost_increase_ratio is not None
        and cost_increase_ratio <= MAX_COST_INCREASE_RATIO,
    }
    return {
        "baseline": baseline,
        "candidate": candidate,
        "delta": deltas,
        "costIncreaseRatio": cost_increase_ratio,
        "maxCostIncreaseRatio": MAX_COST_INCREASE_RATIO,
        "checks": checks,
        "targetMet": all(checks.values()),
    }


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=repo_root)
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
        default=repo_root / ".private/evals/data/state_bench/kavi_learning_artifact.json",
    )
    parser.add_argument(
        "--preparation-manifest",
        type=Path,
        default=repo_root / ".private/evals/data/state_bench/kavi_preparation_manifest.json",
    )
    parser.add_argument("--baseline-outputs", type=Path, required=True)
    parser.add_argument("--baseline-archive", type=Path, required=True)
    parser.add_argument("--candidate-outputs", type=Path, required=True)
    parser.add_argument("--candidate-archive", type=Path, required=True)
    parser.add_argument("--num-workers", type=int, required=True)
    parser.add_argument(
        "--out-manifest",
        type=Path,
        default=repo_root
        / ".private/evals/submission-staging/state-bench/kavi_learning_comparison.json",
    )
    return parser.parse_args()


def validate_comparison(args: argparse.Namespace) -> dict[str, Any]:
    repo_root = args.repo_root.expanduser().resolve()
    upstream = args.upstream.expanduser().resolve()
    runtime = args.runtime.expanduser().resolve()
    artifact = args.artifact.expanduser().resolve()
    preparation_path = args.preparation_manifest.expanduser().resolve()
    baseline_outputs = args.baseline_outputs.expanduser().resolve()
    baseline_archive = args.baseline_archive.expanduser().resolve()
    candidate_outputs = args.candidate_outputs.expanduser().resolve()
    candidate_archive = args.candidate_archive.expanduser().resolve()
    out_manifest = args.out_manifest.expanduser().resolve()
    candidate_validator.require(
        isinstance(args.num_workers, int) and not isinstance(args.num_workers, bool) and args.num_workers > 0,
        "num-workers must be a positive integer",
    )

    adapter_source = Path(__file__).with_name("kavi_state_bench_agent.py")
    preparation = candidate_validator.verify_preparation_manifest(
        preparation_path,
        repo_root,
        upstream,
        runtime,
        artifact,
        adapter_source,
    )
    protocol = candidate_validator.verify_protocol(upstream)
    baseline_files, baseline_model, baseline_counts, baseline_metrics = (
        candidate_validator.verify_outputs(
            baseline_outputs,
            upstream,
            protocol,
            BASELINE_AGENT_NAME,
        )
    )
    candidate_files, candidate_model, candidate_counts, candidate_metrics = (
        candidate_validator.verify_outputs(
            candidate_outputs,
            upstream,
            protocol,
            CANDIDATE_AGENT_NAME,
        )
    )
    candidate_validator.require(
        baseline_model == candidate_model,
        "Learning-off and learning-on runs must use the same model and reasoning level",
    )
    candidate_validator.require(
        baseline_counts == candidate_counts,
        "Learning-off and learning-on task coverage differs",
    )
    baseline_archive_sha256 = candidate_validator.verify_archive(
        baseline_archive, baseline_files, "outputs-baseline"
    )
    candidate_archive_sha256 = candidate_validator.verify_archive(
        candidate_archive, candidate_files, "outputs-learning"
    )
    summary = build_comparison_summary(baseline_metrics, candidate_metrics)
    comparison = {
        "schemaVersion": COMPARISON_SCHEMA_VERSION,
        "claim": "matched_learning_comparison",
        "officialStatus": "not_submittable",
        "appCommit": preparation["app"]["commit"],
        "upstream": {
            "release": candidate_validator.RELEASE,
            "commit": candidate_validator.COMMIT,
        },
        "protocol": {
            "evaluationProtocolId": candidate_validator.EXPECTED_PROTOCOL_ID,
            "domains": list(candidate_validator.EXPECTED_DOMAINS),
            "runs": candidate_validator.EXPECTED_RUNS,
            "heldOutTasksPerDomain": baseline_counts,
            "declaredNumWorkersPerCondition": args.num_workers,
        },
        "agentModel": baseline_model,
        "conditions": {
            "baseline": {
                "agentName": BASELINE_AGENT_NAME,
                "retrieveLearningsTopK": 0,
                "metricsByDomain": baseline_metrics,
                "archiveSha256": baseline_archive_sha256,
            },
            "candidate": {
                "agentName": CANDIDATE_AGENT_NAME,
                "retrieveLearningsTopK": candidate_validator.EXPECTED_TOP_K,
                "metricsByDomain": candidate_metrics,
                "archiveSha256": candidate_archive_sha256,
            },
        },
        "summary": summary,
        "provenance": {
            "preparationManifestSha256": candidate_validator.sha256_file(
                preparation_path
            ),
            "runtimeSha256": candidate_validator.sha256_file(runtime),
            "learningArtifactSha256": candidate_validator.sha256_file(artifact),
            "adapterSha256": candidate_validator.sha256_file(adapter_source),
        },
    }
    candidate_validator.write_private_json(out_manifest, comparison)
    return {"manifest": str(out_manifest), **comparison}


def main() -> None:
    print(json.dumps(validate_comparison(parse_args()), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
