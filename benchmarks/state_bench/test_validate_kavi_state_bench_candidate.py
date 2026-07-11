"""Fail-closed tests for the STATE-Bench post-run candidate validator."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("validate_kavi_state_bench_candidate.py")
SPEC = importlib.util.spec_from_file_location("validate_kavi_state_bench_candidate", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load STATE-Bench candidate validator")
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def commit_repo(path: Path) -> str:
    subprocess.run(["git", "init", "-q"], cwd=path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "state-validator@example.invalid"],
        cwd=path,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "STATE Validator"], cwd=path, check=True
    )
    subprocess.run(["git", "add", "."], cwd=path, check=True)
    subprocess.run(["git", "commit", "-qm", "fixture"], cwd=path, check=True)
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=path,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


class CandidateValidatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.originals = {
            "COMMIT": VALIDATOR.COMMIT,
            "EXPECTED_DOMAINS": VALIDATOR.EXPECTED_DOMAINS,
            "EXPECTED_RUNS": VALIDATOR.EXPECTED_RUNS,
            "EXPECTED_TASKS_PER_DOMAIN": VALIDATOR.EXPECTED_TASKS_PER_DOMAIN,
        }
        VALIDATOR.EXPECTED_DOMAINS = ("travel",)
        VALIDATOR.EXPECTED_RUNS = 1
        VALIDATOR.EXPECTED_TASKS_PER_DOMAIN = 1
        self.task_id = "held-out-task"
        self.adapter_source = MODULE_PATH.with_name("kavi_state_bench_agent.py")
        self._build_app()
        self._build_upstream()
        self._build_outputs()
        self._build_archive()
        self._build_preparation()

    def tearDown(self) -> None:
        for key, value in self.originals.items():
            setattr(VALIDATOR, key, value)
        self.temp.cleanup()

    def _write_json(self, path: Path, value: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2) + "\n")

    def _build_app(self) -> None:
        self.app = self.root / "app"
        self.app.mkdir()
        (self.app / ".gitignore").write_text(".private/\n")
        (self.app / "README.md").write_text("fixture\n")
        self.app_commit = commit_repo(self.app)
        self.runtime = self.app / ".private/runtime.cjs"
        self.artifact = self.app / ".private/artifact.json"
        self.runtime.parent.mkdir(parents=True)
        self.runtime.write_text("runtime\n")
        self.artifact.write_text("{}\n")

    def _build_upstream(self) -> None:
        self.upstream = self.root / "upstream"
        self.upstream.mkdir()
        prompt_root = self.upstream / "state_bench/domains/travel/prompts"
        prompt_root.mkdir(parents=True)
        prompt_contents = {
            "user_sim_base.md": "simulator\n",
            "judge_task_requirements.md": "requirements\n",
            "judge_ux_quality.md": "ux\n",
            "judge_ux_quality_user.md": "ux-user\n",
        }
        for name, content in prompt_contents.items():
            (prompt_root / name).write_text(content)
        prompt_hashes = {
            f"travel/{name}": hashlib.sha256(content.encode()).hexdigest()
            for name, content in prompt_contents.items()
        }
        protocol = {
            "split_version": "train_test",
            "split": "test",
            "num_runs": 1,
            "domains": ["travel"],
            "official_model": "gpt-5.4",
            "simulator": {
                "model": "gpt-5.4",
                "prompt_hashes": {
                    "travel/user_sim_base.md": prompt_hashes["travel/user_sim_base.md"]
                },
            },
            "judge": {
                "model": "gpt-5.4",
                "reasoning_effort": "high",
                "prompt_hashes": {
                    key: value
                    for key, value in prompt_hashes.items()
                    if "judge_" in key
                },
            },
        }
        self.protocol = protocol
        self._write_json(
            self.upstream / "state_bench/configs/eval_protocols/gpt54.json", protocol
        )
        self._write_json(
            self.upstream / "state_bench/domains/travel/splits/train_test.json",
            {"splits": {"test": [self.task_id]}},
        )
        self._write_json(
            self.upstream
            / "state_bench/domains/travel/tasks"
            / f"{self.task_id}.json",
            {"task_id": self.task_id},
        )
        upstream_commit = commit_repo(self.upstream)
        VALIDATOR.COMMIT = upstream_commit
        target = self.upstream / "agents/kavi_state_bench_agent.py"
        target.parent.mkdir()
        shutil.copyfile(self.adapter_source, target)

    def _trajectory(self) -> dict[str, object]:
        judge_hashes = {
            key.split("/", 1)[1]: value
            for key, value in self.protocol["judge"]["prompt_hashes"].items()
        }
        return {
            "task_id": self.task_id,
            "task_completion_pass": 1,
            "ux_score": 1.0,
            "evaluation_protocol_id": VALIDATOR.EXPECTED_PROTOCOL_ID,
            "scoring_protocol_id": VALIDATOR.EXPECTED_PROTOCOL_ID,
            "agent_name": "KaviStateBenchAgent",
            "agent_model": {"model_name": "fixture-model", "reasoning_level": None},
            "simulator_model": "gpt-5.4",
            "simulator_prompt_hash": self.protocol["simulator"]["prompt_hashes"][
                "travel/user_sim_base.md"
            ],
            "judge_model": "gpt-5.4",
            "judge_reasoning_effort": "high",
            "judge_prompt_hashes": judge_hashes,
        }

    def _build_outputs(self) -> None:
        self.outputs = self.app / ".private/outputs"
        self._write_json(
            self.outputs / "travel/run1" / f"{self.task_id}.json", self._trajectory()
        )
        self._write_json(
            self.outputs / "travel/metrics.json",
            {
                "benchmark_version": "0.8.0",
                "timestamp": "2026-07-11T00:00:00+00:00",
                "evaluation_protocol_id": VALIDATOR.EXPECTED_PROTOCOL_ID,
                "num_runs": 1,
                "agent_model": {"model_name": "fixture-model", "reasoning_level": None},
                "agent_pricing": None,
                "metrics": {
                    "task_completion_pass@1": 1.0,
                    "task_completion_pass^1": 1.0,
                    "mean_ux_score": 1.0,
                    "mean_cost_usd": 0.1,
                },
            },
        )

    def _build_archive(self) -> None:
        self.archive = self.app / ".private/outputs.zip"
        with zipfile.ZipFile(self.archive, "w", zipfile.ZIP_DEFLATED) as package:
            for path in sorted(self.outputs.rglob("*")):
                if path.is_file():
                    package.write(path, f"outputs/{path.relative_to(self.outputs).as_posix()}")

    def _build_preparation(self) -> None:
        self.preparation = self.app / ".private/preparation.json"
        self._write_json(
            self.preparation,
            {
                "schemaVersion": VALIDATOR.PREPARATION_SCHEMA_VERSION,
                "claim": "prepared_adapter",
                "readiness": "full_upstream_ready",
                "createdAt": "2026-07-11T00:00:00+00:00",
                "app": {"commit": self.app_commit},
                "upstream": {"release": VALIDATOR.RELEASE, "commit": VALIDATOR.COMMIT},
                "protocol": {
                    "evaluationProtocolId": VALIDATOR.EXPECTED_PROTOCOL_ID,
                    "domains": ["travel"],
                    "split": "test",
                    "runs": 1,
                    "retrieveLearningsTopK": 3,
                },
                "artifacts": {
                    "runtimeSha256": digest(self.runtime),
                    "artifactSha256": digest(self.artifact),
                    "adapterSha256": digest(self.adapter_source),
                },
            },
        )

    def _args(self) -> argparse.Namespace:
        return argparse.Namespace(
            repo_root=self.app,
            upstream=self.upstream,
            runtime=self.runtime,
            artifact=self.artifact,
            preparation_manifest=self.preparation,
            outputs=self.outputs,
            archive=self.archive,
            out_manifest=self.app / ".private/candidate.json",
        )

    def test_production_constants_require_the_full_official_protocol(self) -> None:
        self.assertEqual(self.originals["EXPECTED_DOMAINS"], (
            "travel",
            "customer_support",
            "shopping_assistant",
        ))
        self.assertEqual(self.originals["EXPECTED_RUNS"], 5)
        self.assertEqual(self.originals["EXPECTED_TASKS_PER_DOMAIN"], 50)

    def test_only_post_run_validation_emits_candidate_status(self) -> None:
        result = VALIDATOR.validate_candidate(self._args())

        self.assertEqual(result["claim"], "official_candidate")
        self.assertEqual(result["officialStatus"], "unsubmitted")
        self.assertEqual(result["protocol"]["heldOutTasksPerDomain"], {"travel": 1})
        self.assertTrue(self._args().out_manifest.is_file())

    def test_missing_held_out_output_fails_without_emitting_a_manifest(self) -> None:
        (self.outputs / "travel/run1" / f"{self.task_id}.json").unlink()

        with self.assertRaisesRegex(RuntimeError, "held-out coverage is incomplete"):
            VALIDATOR.validate_candidate(self._args())
        self.assertFalse(self._args().out_manifest.exists())

    def test_archive_tampering_fails_without_emitting_a_manifest(self) -> None:
        with zipfile.ZipFile(self.archive, "w", zipfile.ZIP_DEFLATED) as package:
            package.writestr(
                f"outputs/travel/run1/{self.task_id}.json", b"tampered\n"
            )
            package.write(
                self.outputs / "travel/metrics.json", "outputs/travel/metrics.json"
            )

        with self.assertRaisesRegex(RuntimeError, "Archive (size|hash) mismatch"):
            VALIDATOR.validate_candidate(self._args())
        self.assertFalse(self._args().out_manifest.exists())


if __name__ == "__main__":
    unittest.main()
