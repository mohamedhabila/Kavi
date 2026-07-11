from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

MODULE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(MODULE_DIR))
SPEC = importlib.util.spec_from_file_location(
    "compare_kavi_state_bench_learning",
    MODULE_DIR / "compare_kavi_state_bench_learning.py",
)
assert SPEC and SPEC.loader
COMPARATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPARATOR)


def metrics(
    *, pass_at_1: float, pass_all: float, ux: float, cost: float
) -> dict[str, dict[str, float]]:
    return {
        domain: {
            "task_completion_pass@1": pass_at_1,
            "task_completion_pass@1_std_dev": 0.01,
            "task_completion_pass^5": pass_all,
            "mean_ux_score": ux,
            "mean_cost_usd": cost,
        }
        for domain in COMPARATOR.candidate_validator.EXPECTED_DOMAINS
    }


def launch_manifest(
    *,
    condition: str,
    agent_name: str,
    top_k: int,
    provider_family: str = "openai",
    provider_configuration_sha256: str = "e" * 64,
    num_workers: int = 4,
) -> dict[str, object]:
    configuration = {
        "appCommit": "a" * 40,
        "upstream": {
            "release": COMPARATOR.candidate_validator.RELEASE,
            "commit": COMPARATOR.candidate_validator.COMMIT,
        },
        "evaluationProtocolId": COMPARATOR.candidate_validator.EXPECTED_PROTOCOL_ID,
        "domains": list(COMPARATOR.candidate_validator.EXPECTED_DOMAINS),
        "runs": COMPARATOR.candidate_validator.EXPECTED_RUNS,
        "numWorkers": num_workers,
        "provider": {
            "family": provider_family,
            "configurationSha256": provider_configuration_sha256,
        },
        "agentModel": {"model_name": "gpt-test", "reasoning_level": "high"},
        "agentName": agent_name,
        "retrieveLearningsTopK": top_k,
    }
    return {
        "schemaVersion": COMPARATOR.LAUNCH_SCHEMA_VERSION,
        "condition": condition,
        "configuration": configuration,
        "configurationSha256": COMPARATOR.canonical_json_sha256(configuration),
    }


class StateBenchLearningComparisonTests(unittest.TestCase):
    def test_requires_positive_completion_and_ux_without_material_regressions(self) -> None:
        summary = COMPARATOR.build_comparison_summary(
            metrics(pass_at_1=0.5, pass_all=0.3, ux=4.0, cost=0.10),
            metrics(pass_at_1=0.6, pass_all=0.3, ux=4.2, cost=0.12),
        )

        self.assertTrue(summary["targetMet"])
        self.assertEqual(summary["delta"]["task_completion_pass@1"], 0.1)
        self.assertEqual(summary["costIncreaseRatio"], 0.2)

    def test_fails_the_target_when_baseline_cost_is_zero_but_candidate_cost_is_not(self) -> None:
        summary = COMPARATOR.build_comparison_summary(
            metrics(pass_at_1=0.5, pass_all=0.3, ux=4.0, cost=0.0),
            metrics(pass_at_1=0.6, pass_all=0.4, ux=4.2, cost=0.01),
        )

        self.assertIsNone(summary["costIncreaseRatio"])
        self.assertFalse(summary["checks"]["costWithinBound"])
        self.assertFalse(summary["targetMet"])

    def test_rejects_incomplete_domain_metrics(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "every official domain"):
            COMPARATOR.aggregate_metrics({})

    def test_verifies_frozen_launch_manifest_bytes_and_configuration_digest(self) -> None:
        manifest = launch_manifest(
            condition="baseline",
            agent_name=COMPARATOR.BASELINE_AGENT_NAME,
            top_k=0,
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "baseline-launch.json"
            path.write_text(json.dumps(manifest))
            digest = COMPARATOR.candidate_validator.sha256_file(path)
            loaded, actual_digest = COMPARATOR.verify_launch_manifest(
                path,
                digest,
                condition="baseline",
                agent_name=COMPARATOR.BASELINE_AGENT_NAME,
                retrieve_learnings_top_k=0,
            )

            self.assertEqual(loaded, manifest)
            self.assertEqual(actual_digest, digest)

            path.write_text(json.dumps({**manifest, "condition": "candidate"}))
            with self.assertRaisesRegex(RuntimeError, "changed after its digest was frozen"):
                COMPARATOR.verify_launch_manifest(
                    path,
                    digest,
                    condition="baseline",
                    agent_name=COMPARATOR.BASELINE_AGENT_NAME,
                    retrieve_learnings_top_k=0,
                )

    def test_rejects_provider_or_worker_drift_between_launches(self) -> None:
        baseline = launch_manifest(
            condition="baseline",
            agent_name=COMPARATOR.BASELINE_AGENT_NAME,
            top_k=0,
        )["configuration"]
        candidate = launch_manifest(
            condition="candidate",
            agent_name=COMPARATOR.CANDIDATE_AGENT_NAME,
            top_k=COMPARATOR.candidate_validator.EXPECTED_TOP_K,
            provider_family="openrouter",
        )["configuration"]
        with self.assertRaisesRegex(RuntimeError, "differ outside the learning condition"):
            COMPARATOR.verify_matched_launch_configurations(baseline, candidate, "a" * 40)

        candidate["provider"] = baseline["provider"]
        candidate["numWorkers"] = 8
        with self.assertRaisesRegex(RuntimeError, "differ outside the learning condition"):
            COMPARATOR.verify_matched_launch_configurations(baseline, candidate, "a" * 40)

    def test_validates_both_conditions_with_exact_agent_roles(self) -> None:
        baseline_metrics = metrics(pass_at_1=0.5, pass_all=0.3, ux=4.0, cost=0.10)
        candidate_metrics = metrics(pass_at_1=0.6, pass_all=0.3, ux=4.2, cost=0.11)
        model = {"model_name": "gpt-test", "reasoning_level": "high"}
        counts = {domain: 50 for domain in COMPARATOR.candidate_validator.EXPECTED_DOMAINS}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline_launch_path = root / "baseline-launch.json"
            candidate_launch_path = root / "candidate-launch.json"
            baseline_launch_path.write_text(
                json.dumps(
                    launch_manifest(
                        condition="baseline",
                        agent_name=COMPARATOR.BASELINE_AGENT_NAME,
                        top_k=0,
                    )
                )
            )
            candidate_launch_path.write_text(
                json.dumps(
                    launch_manifest(
                        condition="candidate",
                        agent_name=COMPARATOR.CANDIDATE_AGENT_NAME,
                        top_k=COMPARATOR.candidate_validator.EXPECTED_TOP_K,
                    )
                )
            )
            args = argparse.Namespace(
                repo_root=root,
                upstream=root / "upstream",
                runtime=root / "runtime.cjs",
                artifact=root / "artifact.json",
                preparation_manifest=root / "preparation.json",
                baseline_outputs=root / "baseline",
                baseline_archive=root / "baseline.zip",
                baseline_launch_manifest=baseline_launch_path,
                baseline_launch_manifest_sha256="d" * 64,
                candidate_outputs=root / "candidate",
                candidate_archive=root / "candidate.zip",
                candidate_launch_manifest=candidate_launch_path,
                candidate_launch_manifest_sha256="d" * 64,
                out_manifest=root / "comparison.json",
            )
            validator = COMPARATOR.candidate_validator
            with (
                mock.patch.object(
                    validator,
                    "verify_preparation_manifest",
                    return_value={"app": {"commit": "a" * 40}},
                ),
                mock.patch.object(validator, "verify_protocol", return_value={}),
                mock.patch.object(
                    validator,
                    "verify_outputs",
                    side_effect=[
                        ({}, model, counts, baseline_metrics),
                        ({}, model, counts, candidate_metrics),
                    ],
                ) as verify_outputs,
                mock.patch.object(
                    validator,
                    "verify_archive",
                    side_effect=["b" * 64, "c" * 64],
                ),
                mock.patch.object(validator, "sha256_file", return_value="d" * 64),
                mock.patch.object(validator, "write_private_json") as write_manifest,
            ):
                result = COMPARATOR.validate_comparison(args)

        self.assertEqual(
            [call.args[3] for call in verify_outputs.call_args_list],
            [COMPARATOR.BASELINE_AGENT_NAME, COMPARATOR.CANDIDATE_AGENT_NAME],
        )
        self.assertEqual(result["claim"], "matched_learning_comparison")
        self.assertEqual(result["protocol"]["numWorkersPerCondition"], 4)
        self.assertEqual(result["protocol"]["provider"]["family"], "openai")
        self.assertTrue(result["summary"]["targetMet"])
        self.assertEqual(write_manifest.call_args.args[1], {key: value for key, value in result.items() if key != "manifest"})


if __name__ == "__main__":
    unittest.main()
