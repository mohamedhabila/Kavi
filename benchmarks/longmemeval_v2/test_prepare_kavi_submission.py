from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import unittest

import prepare_kavi_submission as prepare


class PrepareKaviSubmissionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_requires_private_staging_root(self) -> None:
        private_output = self.root / ".private" / "evals" / "submissions"

        self.assertEqual(
            prepare.require_private_output_root(self.root, private_output),
            private_output.resolve(),
        )
        with self.assertRaisesRegex(
            prepare.SubmissionReadinessError, "under .private/evals"
        ):
            prepare.require_private_output_root(self.root, self.root / "public")

    def test_rejects_unsafe_candidate_names(self) -> None:
        prepare.require_safe_name("kavi_memory_small", "submission_name")

        with self.assertRaisesRegex(
            prepare.SubmissionReadinessError, "letters, numbers"
        ):
            prepare.require_safe_name("../escape", "submission_name")

    def test_cleans_only_marked_incomplete_candidate(self) -> None:
        incomplete = self.root / "incomplete"
        incomplete.mkdir()
        (incomplete / ".kavi-submission-building").write_text("incomplete\n")
        complete = self.root / "complete"
        complete.mkdir()
        (complete / "archive.tar.gz").write_text("complete\n")

        self.assertTrue(prepare.cleanup_incomplete_candidate(incomplete))
        self.assertFalse(incomplete.exists())
        self.assertFalse(prepare.cleanup_incomplete_candidate(complete))
        self.assertTrue(complete.exists())

    def test_clean_app_gate_detects_uncommitted_candidate_code(self) -> None:
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(
            ["git", "config", "user.email", "test@example.invalid"],
            cwd=self.root,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"], cwd=self.root, check=True
        )
        (self.root / "tracked.txt").write_text("clean\n")
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "fixture"], cwd=self.root, check=True
        )

        commit = prepare.require_clean_app(self.root)
        (self.root / "tracked.txt").write_text("dirty\n")

        self.assertEqual(len(commit), 40)
        with self.assertRaisesRegex(
            RuntimeError, "clean app worktree"
        ):
            prepare.require_clean_app(self.root)


if __name__ == "__main__":
    unittest.main()
