#!/usr/bin/env python3
"""Validate and compare matched STATE-Bench learning-off and learning-on runs."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import validate_kavi_state_bench_candidate as candidate_validator

COMPARISON_SCHEMA_VERSION = "kavi-state-bench-learning-comparison-v2"
LAUNCH_SCHEMA_VERSION = "kavi-state-bench-launch-v1"
BASELINE_AGENT_NAME = "StateBenchAgent"
CANDIDATE_AGENT_NAME = "KaviStateBenchAgent"
MAX_COST_INCREASE_RATIO = 0.25
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
GIT_COMMIT_PATTERN = re.compile(r"^[a-f0-9]{40}$")
SAFE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")


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


def canonical_json_sha256(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def verify_launch_manifest(
    path: Path,
    expected_sha256: str,
    *,
    condition: str,
    agent_name: str,
    retrieve_learnings_top_k: int,
) -> tuple[dict[str, Any], str]:
    candidate_validator.require(
        bool(SHA256_PATTERN.fullmatch(expected_sha256)) and expected_sha256 != "0" * 64,
        f"{condition} launch manifest digest must be a non-zero lowercase SHA-256",
    )
    actual_sha256 = candidate_validator.sha256_file(
        candidate_validator.regular_file(path, f"{condition} launch manifest")
    )
    candidate_validator.require(
        actual_sha256 == expected_sha256,
        f"{condition} launch manifest changed after its digest was frozen",
    )
    manifest = candidate_validator.load_json(path, f"{condition} launch manifest")
    candidate_validator.require_exact_keys(
        manifest,
        {"schemaVersion", "condition", "configuration", "configurationSha256"},
        f"{condition} launch manifest",
    )
    candidate_validator.require(
        manifest["schemaVersion"] == LAUNCH_SCHEMA_VERSION,
        f"{condition} launch manifest schema is unsupported",
    )
    candidate_validator.require(
        manifest["condition"] == condition,
        f"{condition} launch manifest condition is invalid",
    )
    configuration = manifest["configuration"]
    candidate_validator.require(
        isinstance(configuration, dict),
        f"{condition} launch configuration must be an object",
    )
    candidate_validator.require_exact_keys(
        configuration,
        {
            "appCommit",
            "upstream",
            "evaluationProtocolId",
            "domains",
            "runs",
            "numWorkers",
            "provider",
            "agentModel",
            "agentName",
            "retrieveLearningsTopK",
        },
        f"{condition} launch configuration",
    )
    app_commit = configuration["appCommit"]
    candidate_validator.require(
        isinstance(app_commit, str) and bool(GIT_COMMIT_PATTERN.fullmatch(app_commit)),
        f"{condition} launch app commit is invalid",
    )
    candidate_validator.require(
        configuration["upstream"]
        == {"release": candidate_validator.RELEASE, "commit": candidate_validator.COMMIT},
        f"{condition} launch upstream revision is invalid",
    )
    candidate_validator.require(
        configuration["evaluationProtocolId"] == candidate_validator.EXPECTED_PROTOCOL_ID,
        f"{condition} launch protocol is invalid",
    )
    candidate_validator.require(
        configuration["domains"] == list(candidate_validator.EXPECTED_DOMAINS),
        f"{condition} launch domains are invalid",
    )
    candidate_validator.require(
        configuration["runs"] == candidate_validator.EXPECTED_RUNS,
        f"{condition} launch run count is invalid",
    )
    num_workers = configuration["numWorkers"]
    candidate_validator.require(
        isinstance(num_workers, int) and not isinstance(num_workers, bool) and num_workers > 0,
        f"{condition} launch worker count must be a positive integer",
    )
    provider = configuration["provider"]
    candidate_validator.require(
        isinstance(provider, dict)
        and set(provider) == {"family", "configurationSha256"},
        f"{condition} launch provider identity is invalid",
    )
    provider_family = provider.get("family")
    provider_configuration_sha256 = provider.get("configurationSha256")
    candidate_validator.require(
        isinstance(provider_family, str) and bool(SAFE_ID_PATTERN.fullmatch(provider_family)),
        f"{condition} launch provider family is invalid",
    )
    candidate_validator.require(
        isinstance(provider_configuration_sha256, str)
        and bool(SHA256_PATTERN.fullmatch(provider_configuration_sha256))
        and provider_configuration_sha256 != "0" * 64,
        f"{condition} launch provider configuration digest is invalid",
    )
    configuration["agentModel"] = candidate_validator.canonical_agent_model(
        configuration["agentModel"], f"{condition} launch configuration"
    )
    candidate_validator.require(
        configuration["agentName"] == agent_name,
        f"{condition} launch agent class is invalid",
    )
    candidate_validator.require(
        configuration["retrieveLearningsTopK"] == retrieve_learnings_top_k,
        f"{condition} launch learning setting is invalid",
    )
    expected_configuration_sha256 = canonical_json_sha256(configuration)
    candidate_validator.require(
        manifest["configurationSha256"] == expected_configuration_sha256,
        f"{condition} launch configuration digest does not match its canonical configuration",
    )
    return manifest, actual_sha256


def shared_launch_configuration(configuration: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in configuration.items()
        if key not in {"agentName", "retrieveLearningsTopK"}
    }


def verify_matched_launch_configurations(
    baseline: dict[str, Any], candidate: dict[str, Any], prepared_app_commit: str
) -> None:
    candidate_validator.require(
        shared_launch_configuration(baseline) == shared_launch_configuration(candidate),
        "Learning-off and learning-on launch configurations differ outside the learning condition",
    )
    candidate_validator.require(
        baseline["appCommit"] == prepared_app_commit,
        "Launch manifests do not match the prepared Kavi revision",
    )


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
    parser.add_argument("--baseline-launch-manifest", type=Path, required=True)
    parser.add_argument("--baseline-launch-manifest-sha256", required=True)
    parser.add_argument("--candidate-outputs", type=Path, required=True)
    parser.add_argument("--candidate-archive", type=Path, required=True)
    parser.add_argument("--candidate-launch-manifest", type=Path, required=True)
    parser.add_argument("--candidate-launch-manifest-sha256", required=True)
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
    baseline_launch_path = args.baseline_launch_manifest.expanduser().resolve()
    candidate_outputs = args.candidate_outputs.expanduser().resolve()
    candidate_archive = args.candidate_archive.expanduser().resolve()
    candidate_launch_path = args.candidate_launch_manifest.expanduser().resolve()
    out_manifest = args.out_manifest.expanduser().resolve()

    adapter_source = Path(__file__).with_name("kavi_state_bench_agent.py")
    preparation = candidate_validator.verify_preparation_manifest(
        preparation_path,
        repo_root,
        upstream,
        runtime,
        artifact,
        adapter_source,
    )
    baseline_launch, baseline_launch_sha256 = verify_launch_manifest(
        baseline_launch_path,
        args.baseline_launch_manifest_sha256,
        condition="baseline",
        agent_name=BASELINE_AGENT_NAME,
        retrieve_learnings_top_k=0,
    )
    candidate_launch, candidate_launch_sha256 = verify_launch_manifest(
        candidate_launch_path,
        args.candidate_launch_manifest_sha256,
        condition="candidate",
        agent_name=CANDIDATE_AGENT_NAME,
        retrieve_learnings_top_k=candidate_validator.EXPECTED_TOP_K,
    )
    baseline_launch_configuration = baseline_launch["configuration"]
    candidate_launch_configuration = candidate_launch["configuration"]
    verify_matched_launch_configurations(
        baseline_launch_configuration,
        candidate_launch_configuration,
        preparation["app"]["commit"],
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
        baseline_model == baseline_launch_configuration["agentModel"],
        "Scored trajectory model does not match the frozen launch configuration",
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
            "numWorkersPerCondition": baseline_launch_configuration["numWorkers"],
            "provider": baseline_launch_configuration["provider"],
        },
        "agentModel": baseline_model,
        "conditions": {
            "baseline": {
                "agentName": BASELINE_AGENT_NAME,
                "retrieveLearningsTopK": 0,
                "metricsByDomain": baseline_metrics,
                "archiveSha256": baseline_archive_sha256,
                "launchManifestSha256": baseline_launch_sha256,
                "launchConfigurationSha256": baseline_launch["configurationSha256"],
            },
            "candidate": {
                "agentName": CANDIDATE_AGENT_NAME,
                "retrieveLearningsTopK": candidate_validator.EXPECTED_TOP_K,
                "metricsByDomain": candidate_metrics,
                "archiveSha256": candidate_archive_sha256,
                "launchManifestSha256": candidate_launch_sha256,
                "launchConfigurationSha256": candidate_launch["configurationSha256"],
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
            "baselineLaunchManifestSha256": baseline_launch_sha256,
            "candidateLaunchManifestSha256": candidate_launch_sha256,
        },
    }
    candidate_validator.write_private_json(out_manifest, comparison)
    return {"manifest": str(out_manifest), **comparison}


def main() -> None:
    print(json.dumps(validate_comparison(parse_args()), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
