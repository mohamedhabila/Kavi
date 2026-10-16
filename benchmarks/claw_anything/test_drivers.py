from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import client_headers
from regrade import strip_grading_results


class ClientHeadersTest(unittest.TestCase):
    def test_reads_a_json_object_of_headers(self) -> None:
        with patch.dict(os.environ, {client_headers.ENV_NAME: '{"anthropic-workspace-id": "wrkspc_1"}'}):
            self.assertEqual(client_headers.extra_headers(), {"anthropic-workspace-id": "wrkspc_1"})

    def test_none_without_the_variable(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(client_headers.extra_headers(), {})

    def test_refuses_headers_that_are_not_names_to_strings(self) -> None:
        for raw in ("not json", '["a"]', '{"a": 1}'):
            with patch.dict(os.environ, {client_headers.ENV_NAME: raw}), self.assertRaises(SystemExit):
                client_headers.extra_headers()

    def test_every_client_built_afterwards_sends_the_headers(self) -> None:
        import openai

        original = openai.OpenAI
        try:
            with patch.dict(os.environ, {client_headers.ENV_NAME: '{"anthropic-workspace-id": "wrkspc_1"}'}):
                client_headers.install()
            client = openai.OpenAI(api_key="key", base_url="https://api.example.com/v1/", default_headers={"x-other": "1"})
            self.assertEqual(client.default_headers["anthropic-workspace-id"], "wrkspc_1")
            self.assertEqual(client.default_headers["x-other"], "1")
        finally:
            openai.OpenAI = original


class StripGradingResultsTest(unittest.TestCase):
    def test_drops_only_the_old_grading_results(self) -> None:
        events = [
            {"type": "trace_start", "task_id": "T1"},
            {"type": "message", "message": {"role": "user", "content": []}},
            {"type": "trace_end"},
            {"type": "grading_result", "task_score": 0.3},
        ]
        with tempfile.TemporaryDirectory() as scratch:
            trace = Path(scratch) / "t.jsonl"
            trace.write_text("\n".join(json.dumps(event) for event in events) + "\n", encoding="utf-8")

            strip_grading_results(trace)

            kept = [json.loads(line)["type"] for line in trace.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(kept, ["trace_start", "message", "trace_end"])


if __name__ == "__main__":
    unittest.main()
