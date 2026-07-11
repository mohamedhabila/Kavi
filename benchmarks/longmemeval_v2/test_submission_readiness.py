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
                "question_type": "static-environment",
                "answer": "First",
                "eval_function": "norm_phrase_set_match|lower=true",
                "image": None,
            },
            {
                "id": "web-2",
                "domain": "web",
                "question": "Second?",
                "question_type": "dynamic-environment",
                "answer": "Second",
                "eval_function": "norm_phrase_set_match|lower=true",
                "image": None,
            },
            {
                "id": "enterprise-1",
                "domain": "enterprise",
                "question": "Third?",
                "question_type": "procedure",
                "answer": "Third",
                "eval_function": "norm_phrase_set_match|lower=true",
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
                    "app_commit_sha": "a" * 40,
                    "adapter_source_sha256": "b" * 64,
                    "runtime_bundle_sha256": "c" * 64,
                    "node_version": "v22.0.0",
                    "max_items": 12,
                    "max_item_chars": 5000,
                    "chunk_chars": 3600,
                    "chunk_overlap_chars": 320,
                    "min_score": 0.01,
                    "query_image_understanding": False,
                    "query_image_model": "",
                    "query_image_base_url": "https://api.openai.com/v1",
                    "query_image_api_key_env": "OPENAI_API_KEY",
                    "retrieval_llm_enabled": False,
                    "retrieval_llm_model": "",
                    "retrieval_llm_base_url": "https://api.openai.com/v1",
                    "retrieval_llm_api_key_env": "OPENAI_API_KEY",
                    "retrieval_llm_provider_family": "openai",
                    "retrieval_llm_protocol": "openai-responses",
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
        records = [
            self.valid_record(row, index, haystack[row["id"]])
            for index, row in enumerate(questions)
        ]
        (run_dir / "per_question.jsonl").write_text(
            "".join(json.dumps(row) + "\n" for row in records), encoding="utf-8"
        )
        metrics = readiness.recompute_aggregated_metrics(records)
        metrics.update({"completed_at_utc": "2026-07-11T00:00:00Z", "shared_haystack": False})
        write_json(
            run_dir / "aggregated_metrics.json",
            metrics,
        )
        return run_dir

    def valid_record(
        self, question: dict[str, object], index: int, haystack_ids: list[str]
    ) -> dict[str, object]:
        question_type = str(question["question_type"])
        return {
            "index": index,
            "stream_index": index,
            "question_id": question["id"],
            "question_type": question_type,
            "category": readiness.CATEGORY_MAP[question_type],
            "is_abstention_problem": False,
            "eval_function": question["eval_function"],
            "question_text": question["question"],
            "question_image": None,
            "haystack_ids": haystack_ids,
            "memory_context": [{"type": "text", "value": "fixture memory"}],
            "memory_query_duration_seconds": float(index + 1),
            "memory_post_query_duration_seconds": 0.25,
            "memory_post_query_metadata": {},
            "memory_context_original_token_count": 5,
            "memory_context_token_count": 5,
            "memory_context_was_truncated": False,
            "prompt_messages": [],
            "answer_gold": question["answer"],
            "response_raw": "\\boxed{fixture}",
            "response_parsed_boxed": "fixture",
            "is_unknown": False,
            "score": 1.0,
            "score_bool": True,
            "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
            "timestamp_utc": "2026-07-11T00:00:00Z",
        }

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

    def test_rejects_per_question_score_schema_drift(self) -> None:
        run_dir = self.create_run("web")
        records = [
            json.loads(line)
            for line in (run_dir / "per_question.jsonl").read_text().splitlines()
        ]
        records[0].pop("score_bool")
        (run_dir / "per_question.jsonl").write_text(
            "".join(json.dumps(row) + "\n" for row in records), encoding="utf-8"
        )

        with self.assertRaisesRegex(
            readiness.SubmissionReadinessError, "record schema"
        ):
            readiness.validate_domain_run(run_dir, self.data_root, "web", "small")

    def test_rejects_aggregate_score_that_does_not_match_rows(self) -> None:
        run_dir = self.create_run("web")
        metrics = read_json(run_dir / "aggregated_metrics.json")
        metrics["overall"]["overall_full_set"] = 0.0
        write_json(run_dir / "aggregated_metrics.json", metrics)

        with self.assertRaisesRegex(
            readiness.SubmissionReadinessError, "does not match per-question evidence"
        ):
            readiness.validate_domain_run(run_dir, self.data_root, "web", "small")

    def test_rejects_hidden_auxiliary_model_when_its_switch_is_disabled(self) -> None:
        run_dir = self.create_run("web")
        config_path = run_dir / "runtime_inputs/memory_config.json"
        config = read_json(config_path)
        config["memory_params"]["retrieval_llm_model"] = "hidden-model"
        write_json(config_path, config)

        with self.assertRaisesRegex(
            readiness.SubmissionReadinessError, "retrieval_llm_model is invalid"
        ):
            readiness.validate_domain_run(run_dir, self.data_root, "web", "small")


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
