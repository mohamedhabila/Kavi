"""Regression tests for the pinned STATE-Bench checkout verifier."""

from __future__ import annotations

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("prepare_kavi_state_bench.py")
SPEC = importlib.util.spec_from_file_location("prepare_kavi_state_bench", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load STATE-Bench preparation module")
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)


class VerifyUpstreamTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.upstream = Path(self.temporary_directory.name)
        subprocess.run(["git", "init", "-q"], cwd=self.upstream, check=True)
        subprocess.run(
            ["git", "config", "user.email", "state-bench-test@example.invalid"],
            cwd=self.upstream,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "STATE-Bench Test"],
            cwd=self.upstream,
            check=True,
        )
        (self.upstream / "README.md").write_text("fixture\n")
        subprocess.run(["git", "add", "README.md"], cwd=self.upstream, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "fixture"], cwd=self.upstream, check=True
        )
        self.commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.upstream,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.original_commit = PREPARE.COMMIT
        PREPARE.COMMIT = self.commit
        self.source_directory = tempfile.TemporaryDirectory()
        self.adapter_source = Path(self.source_directory.name) / "adapter_source.py"
        self.adapter_source.write_text("class KaviStateBenchAgent: pass\n")

    def tearDown(self) -> None:
        PREPARE.COMMIT = self.original_commit
        self.source_directory.cleanup()
        self.temporary_directory.cleanup()

    def install_adapter(self) -> None:
        target = self.upstream / "agents/kavi_state_bench_agent.py"
        target.parent.mkdir()
        target.write_bytes(self.adapter_source.read_bytes())

    def test_allows_only_the_exact_untracked_adapter_file(self) -> None:
        self.install_adapter()

        PREPARE.verify_upstream(self.upstream, self.adapter_source)

    def test_rejects_an_unrelated_file_inside_the_untracked_directory(self) -> None:
        self.install_adapter()
        (self.upstream / "agents/unrelated.py").write_text("unexpected\n")

        with self.assertRaisesRegex(RuntimeError, "unrelated changes"):
            PREPARE.verify_upstream(self.upstream, self.adapter_source)


if __name__ == "__main__":
    unittest.main()
