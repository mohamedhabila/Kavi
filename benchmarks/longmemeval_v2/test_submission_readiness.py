from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import submission_readiness as readiness


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


class SubmissionReadinessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data_root = self.root / "data"
        self.data_root.mkdir()
        self.original_counts = readiness.EXPECTED_DOMAIN_COUNTS
        readiness.EXPECTED_DOMAIN_COUNTS = {"web": 2, "enterprise": 1}
        questions = [
            {
                "id": "web-1",
                "domain": "web",
                "question": "First?",
                "question_type": "static",
                "image": None,
            },
            {
                "id": "web-2",
                "domain": "web",
                "question": "Second?",
                "question_type": "dynamic",
                "image": None,
            },
            {
                "id": "enterprise-1",
                "domain": "enterprise",
                "question": "Third?",
                "question_type": "procedure",
                "image": None,
            },
        ]
        (self.data_root / "questions.jsonl").write_text(
            "".join(json.dumps(row) + "\n" for row in questions), encoding="utf-8"
        )
        (self.data_root / "trajectories.jsonl").write_text("{}\n", encoding="utf-8")
        haystack = {
            "web-1": ["trajectory-1"],
            "web-2": ["trajectory-2"],
            "enterprise-1": ["trajectory-3"],
        }
        write_json(self.data_root / "haystacks" / "lme_v2_small.json", haystack)
        write_json(self.data_root / "haystacks" / "lme_v2_medium.json", haystack)

    def tearDown(self) -> None:
        readiness.EXPECTED_DOMAIN_COUNTS = self.original_counts
        self.temp.cleanup()

    def create_run(self, domain: str) -> Path:
        run_dir = self.root / f"kavi_memory_isolated_{domain}_small"
        runtime_dir = run_dir / "runtime_inputs"
        runtime_dir.mkdir(parents=True)
        questions = readiness.expected_runtime_questions(self.data_root, domain)
        haystack = readiness.expected_runtime_haystack(
            self.data_root, "small", questions
        )
        write_json(runtime_dir / "questions.json", questions)
        write_json(runtime_dir / "haystack.json", haystack)
        write_json(
            runtime_dir / "memory_config.json",
            {
                "memory_type": readiness.METHOD,
                "memory_params": {
                    "repo_root": str(self.root),
                    "workspace_root": str(run_dir / "workspaces"),
                    "runtime_bundle_path": str(self.root / "runtime.cjs"),
                    "node_binary": "node",
                    "max_items": 12,
                },
            },
        )
        run_args = {
            "domain": domain,
            "model": "qwen/qwen3.5-9b",
            "base_url": "https://reader.example.test/v1",
            "api_key_env": "OPENROUTER_API_KEY",
            "api_key_file": None,
            "evaluator_model": "gpt-5.2",
            "evaluator_base_url": None,
            "evaluator_api_key_env": "OPENAI_API_KEY",
            "evaluator_api_key_file": None,
            "output_dir": str(run_dir),
            "questions_path": str(runtime_dir / "questions.json"),
            "haystack_path": str(runtime_dir / "haystack.json"),
            "memory_config_path": str(runtime_dir / "memory_config.json"),
            "trajectories_path": str(self.data_root / "trajectories.jsonl"),
            **readiness.EXPECTED_PROTOCOL_FIELDS,
        }
        write_json(run_dir / "run_args.json", run_args)
        (run_dir / "per_question.jsonl").write_text(
            "".join(json.dumps({"question_id": row["id"]}) + "\n" for row in questions),
            encoding="utf-8",
        )
        write_json(
            run_dir / "aggregated_metrics.json",
            {"overall": {"count_all_questions": len(questions)}},
        )
        return run_dir

    def test_accepts_complete_pinned_pair_with_one_protocol(self) -> None:
        web = readiness.validate_domain_run(
            self.create_run("web"), self.data_root, "web", "small"
        )
        enterprise = readiness.validate_domain_run(
            self.create_run("enterprise"), self.data_root, "enterprise", "small"
        )

        readiness.validate_run_pair(web, enterprise)

        self.assertEqual(web.question_count, 2)
        self.assertEqual(enterprise.question_count, 1)

    def test_rejects_partial_run_even_when_outputs_cover_selected_questions(self) -> None:
        run_dir = self.create_run("web")
        runtime_questions = read_json(run_dir / "runtime_inputs" / "questions.json")
        write_json(run_dir / "runtime_inputs" / "questions.json", runtime_questions[:1])
        write_json(
            run_dir / "runtime_inputs" / "haystack.json",
            {runtime_questions[0]["id"]: ["trajectory-1"]},
        )
        (run_dir / "per_question.jsonl").write_text(
            json.dumps({"question_id": runtime_questions[0]["id"]}) + "\n",
            encoding="utf-8",
        )
        write_json(
            run_dir / "aggregated_metrics.json",
            {"overall": {"count_all_questions": 1}},
        )

        with self.assertRaisesRegex(
            readiness.SubmissionReadinessError, "complete pinned release"
        ):
            readiness.validate_domain_run(run_dir, self.data_root, "web", "small")

    def test_rejects_decoding_drift(self) -> None:
        run_dir = self.create_run("web")
        run_args = read_json(run_dir / "run_args.json")
        run_args["temperature"] = 0
        write_json(run_dir / "run_args.json", run_args)

        with self.assertRaisesRegex(
            readiness.SubmissionReadinessError, "temperature"
        ):
            readiness.validate_domain_run(run_dir, self.data_root, "web", "small")

    def test_rejects_private_reader_endpoint(self) -> None:
        run_dir = self.create_run("web")
        run_args = read_json(run_dir / "run_args.json")
        run_args["base_url"] = "https://127.0.0.1/v1"
        write_json(run_dir / "run_args.json", run_args)

        with self.assertRaisesRegex(
            readiness.SubmissionReadinessError, "private network"
        ):
            readiness.validate_domain_run(run_dir, self.data_root, "web", "small")


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
