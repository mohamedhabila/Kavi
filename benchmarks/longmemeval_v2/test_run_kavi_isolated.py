from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import run_kavi_isolated as runner


HARNESS = """NONSHARED_PARALLEL_MEMORY_TYPES = {
}
    shared_haystack = all_haystacks_shared(question_ids, haystack_mapping)
    parser.add_argument("--reasoning-effort", choices=["low", "medium", "high"], default=None)
    if args.base_url and args.model == "Qwen/Qwen3.5-9B" and not args.reader_enable_thinking:
        pass
        "explanation in \\boxed{} explaining why the question is flawed."
"""


class RunKaviIsolatedProvenanceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.upstream = self.root / "upstream"
        (self.upstream / "evaluation").mkdir(parents=True)
        (self.upstream / "memory_modules").mkdir(parents=True)
        (self.upstream / "evaluation" / "harness.py").write_text(HARNESS)
        (self.upstream / "memory_modules" / "memory.py").write_text("REGISTRY = {}\n")
        self.adapter = self.root / "kavi_isolated_memory.py"
        self.adapter.write_text("class KaviIsolatedMemory:\n    pass\n")
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "Test")
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        self.commit = self.git("rev-parse", "HEAD").stdout.strip()
        self.original_commit = runner.UPSTREAM_COMMIT
        self.original_checksum = runner.DATA_CHECKSUM_MANIFEST_SHA256
        self.original_required_files = runner.REQUIRED_SCORE_DATA_FILES
        runner.UPSTREAM_COMMIT = self.commit
        runner.REQUIRED_SCORE_DATA_FILES = {"questions.jsonl"}

    def tearDown(self) -> None:
        runner.UPSTREAM_COMMIT = self.original_commit
        runner.DATA_CHECKSUM_MANIFEST_SHA256 = self.original_checksum
        runner.REQUIRED_SCORE_DATA_FILES = self.original_required_files
        self.temp.cleanup()

    def git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=self.upstream,
            check=True,
            capture_output=True,
            text=True,
        )

    def test_accepts_only_clean_base_or_exact_generated_patch(self) -> None:
        self.assertEqual(runner.verify_upstream(self.upstream, self.adapter), "clean_base")

        runner.install_adapter(self.upstream, self.adapter)

        self.assertIn(
            '"kavi_memory_isolated",',
            (self.upstream / "evaluation" / "harness.py").read_text(),
        )
        self.assertIn(
            "from .kavi_isolated_memory import KaviIsolatedMemory",
            (self.upstream / "memory_modules" / "memory.py").read_text(),
        )
        self.assertEqual(
            runner.verify_upstream(self.upstream, self.adapter), "exact_adapter_patch"
        )
        (self.upstream / "evaluation" / "harness.py").write_text("tampered\n")
        with self.assertRaisesRegex(RuntimeError, "differs from the pinned patch"):
            runner.verify_upstream(self.upstream, self.adapter)

    def test_rejects_unrelated_checkout_changes(self) -> None:
        (self.upstream / "unrelated.txt").write_text("not allowed\n")

        with self.assertRaisesRegex(RuntimeError, "only the exact installed Kavi adapter"):
            runner.verify_upstream(self.upstream, self.adapter)

    def test_verifies_the_pinned_dataset_checksum_manifest(self) -> None:
        data_root = self.root / "data"
        data_root.mkdir()
        questions = data_root / "questions.jsonl"
        questions.write_text('{"id":"fixture"}\n')
        manifest = data_root / "checksums.sha256"
        questions_digest = hashlib.sha256(questions.read_bytes()).hexdigest()
        manifest.write_text(f"{questions_digest}  questions.jsonl\n")
        runner.DATA_CHECKSUM_MANIFEST_SHA256 = hashlib.sha256(manifest.read_bytes()).hexdigest()

        snapshot = runner.verify_data_snapshot(data_root)

        self.assertEqual(snapshot["revision"], runner.DATA_REVISION)
        self.assertEqual(
            snapshot["checksum_manifest_sha256"], runner.DATA_CHECKSUM_MANIFEST_SHA256
        )
        self.assertEqual(snapshot["verified_files"], 1)

    def test_rejects_dataset_content_that_does_not_match_the_manifest(self) -> None:
        data_root = self.root / "data"
        data_root.mkdir()
        questions = data_root / "questions.jsonl"
        questions.write_text("original\n")
        manifest = data_root / "checksums.sha256"
        questions_digest = hashlib.sha256(questions.read_bytes()).hexdigest()
        manifest.write_text(f"{questions_digest}  questions.jsonl\n")
        runner.DATA_CHECKSUM_MANIFEST_SHA256 = hashlib.sha256(manifest.read_bytes()).hexdigest()
        questions.write_text("modified\n")

        with self.assertRaisesRegex(RuntimeError, "file checksum mismatch"):
            runner.verify_data_snapshot(data_root)

    def memory_args(self, **overrides: object) -> argparse.Namespace:
        values: dict[str, object] = {
            "memory_max_items": 12,
            "memory_max_item_chars": 5000,
            "memory_chunk_chars": 3600,
            "memory_chunk_overlap_chars": 320,
            "memory_min_score": 0.01,
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
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_freezes_secret_free_effective_memory_configuration(self) -> None:
        with patch.dict(os.environ, {"E2E_OPENAI_MODEL": "must-not-leak"}, clear=False):
            params = runner.resolve_effective_memory_params(
                self.memory_args(),
                app_commit_sha="a" * 40,
                adapter_source_sha256="b" * 64,
                runtime_bundle_sha256="c" * 64,
                resolved_node_version="v22.0.0",
            )

        self.assertEqual(params["query_image_model"], "")
        self.assertEqual(params["retrieval_llm_model"], "")
        self.assertEqual(params["query_image_api_key_env"], "OPENAI_API_KEY")
        self.assertNotIn("must-not-leak", str(params))

    def test_enabled_auxiliary_model_requires_named_key_without_persisting_it(self) -> None:
        args = self.memory_args(
            retrieval_llm_enabled=True,
            retrieval_llm_model="gpt-5-mini",
        )
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "Missing retrieval LLM API key"):
                runner.resolve_effective_memory_params(
                    args,
                    app_commit_sha="a" * 40,
                    adapter_source_sha256="b" * 64,
                    runtime_bundle_sha256="c" * 64,
                    resolved_node_version="v22.0.0",
                )


if __name__ == "__main__":
    unittest.main()
