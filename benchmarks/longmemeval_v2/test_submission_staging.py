from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import submission_staging as staging


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


class SubmissionStagingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo_root = self.root / "repository"
        self.data_root = self.root / "dataset"
        self.upstream = self.root / "upstream"
        self.run_dir = self.root / "raw-run"
        for path in (self.repo_root, self.data_root, self.upstream):
            path.mkdir()
        runtime_dir = self.run_dir / "runtime_inputs"
        runtime_dir.mkdir(parents=True)
        write_json(
            self.run_dir / "aggregated_metrics.json",
            {"overall": {"count_all_questions": 1}},
        )
        (self.run_dir / "per_question.jsonl").write_text(
            json.dumps(
                {
                    "question_id": "question-1",
                    "screenshot_path": str(self.data_root / "question.png"),
                }
            )
            + "\n",
            encoding="utf-8",
        )
        write_json(
            self.run_dir / "run_args.json",
            {
                "output_dir": str(self.run_dir),
                "base_url": "https://reader.example.test/v1",
                "api_key_env": "OPENROUTER_API_KEY",
            },
        )
        write_json(
            runtime_dir / "questions.json",
            [{"id": "question-1", "image": str(self.data_root / "question.png")}],
        )
        write_json(runtime_dir / "haystack.json", {"question-1": ["run-1"]})
        write_json(
            runtime_dir / "memory_config.json",
            {
                "memory_type": "kavi_memory_isolated",
                "memory_params": {
                    "repo_root": str(self.repo_root),
                    "runtime_bundle_path": str(self.repo_root / "runtime.cjs"),
                },
            },
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def replacements(self) -> tuple[tuple[str, str], ...]:
        return staging.path_replacements(
            (
                (self.run_dir, "<LONGMEMEVAL_RUN>"),
                (self.repo_root, "<KAVI_REPOSITORY>"),
                (self.data_root, "<LONGMEMEVAL_DATA>"),
                (self.upstream, "<LONGMEMEVAL_UPSTREAM>"),
            )
        )

    def test_stages_only_required_files_without_mutating_raw_run(self) -> None:
        before = staging.run_artifact_sha256(self.run_dir)
        target = self.root / "staged"

        report = staging.stage_domain_run(
            self.run_dir, target, self.replacements()
        )

        self.assertEqual(staging.run_artifact_sha256(self.run_dir), before)
        self.assertEqual(report.files_written, 6)
        self.assertGreaterEqual(report.path_replacements, 4)
        staged_text = "\n".join(
            path.read_text(encoding="utf-8")
            for path in staging.required_run_paths(target)
        )
        self.assertIn("<KAVI_REPOSITORY>", staged_text)
        self.assertIn("<LONGMEMEVAL_DATA>", staged_text)
        self.assertIn("<LONGMEMEVAL_RUN>", staged_text)
        self.assertNotIn(str(self.root), staged_text)

    def test_rejects_provider_credentials_without_echoing_them(self) -> None:
        secret = "sk-or-v1-abcdefghijklmnopqrstuvwxyz012345"
        write_json(
            self.run_dir / "run_args.json",
            {"base_url": "https://reader.example.test/v1", "credential": secret},
        )

        with self.assertRaises(staging.SubmissionReadinessError) as context:
            staging.stage_domain_run(
                self.run_dir, self.root / "staged", self.replacements()
            )

        self.assertIn("provider_credential", str(context.exception))
        self.assertNotIn(secret, str(context.exception))

    def test_rejects_unmapped_local_paths(self) -> None:
        write_json(
            self.run_dir / "run_args.json",
            {
                "base_url": "https://reader.example.test/v1",
                "unmapped": "/Users/someone/private/output.json",
            },
        )

        with self.assertRaisesRegex(
            staging.SubmissionReadinessError, "Unmapped local path"
        ):
            staging.stage_domain_run(
                self.run_dir, self.root / "staged", self.replacements()
            )

    def test_rejects_private_network_metadata(self) -> None:
        write_json(
            self.run_dir / "run_args.json",
            {"base_url": "https://192.168.1.20/v1"},
        )

        with self.assertRaisesRegex(
            staging.SubmissionReadinessError, "Private network"
        ):
            staging.stage_domain_run(
                self.run_dir, self.root / "staged", self.replacements()
            )

    def test_requires_not_submitted_governance_state(self) -> None:
        provenance = self.root / "provenance.json"
        write_json(
            provenance,
            {
                "adapters": [
                    {
                        "id": "longmemeval-v2",
                        "submission": {
                            "resultStatus": "not_submitted",
                            "submissionRecordUrl": None,
                        },
                    }
                ]
            },
        )
        staging.require_not_submitted(provenance)
        payload = json.loads(provenance.read_text(encoding="utf-8"))
        payload["adapters"][0]["submission"] = {
            "resultStatus": "accepted",
            "submissionRecordUrl": None,
        }
        write_json(provenance, payload)

        with self.assertRaisesRegex(
            staging.SubmissionReadinessError, "unclaimed not_submitted"
        ):
            staging.require_not_submitted(provenance)


if __name__ == "__main__":
    unittest.main()
