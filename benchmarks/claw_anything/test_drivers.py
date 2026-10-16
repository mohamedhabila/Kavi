from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import client_options
from regrade import strip_grading_results


class ClientOptionsTest(unittest.TestCase):
    def test_reads_a_json_object_of_headers(self) -> None:
        with patch.dict(os.environ, {client_options.HEADERS_ENV: '{"anthropic-workspace-id": "wrkspc_1"}'}):
            self.assertEqual(client_options.extra_headers(), {"anthropic-workspace-id": "wrkspc_1"})

    def test_none_without_the_variable(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(client_options.extra_headers(), {})

    def test_refuses_headers_that_are_not_names_to_strings(self) -> None:
        for raw in ("not json", '["a"]', '{"a": 1}'):
            with patch.dict(os.environ, {client_options.HEADERS_ENV: raw}), self.assertRaises(SystemExit):
                client_options.extra_headers()

    def test_every_client_built_afterwards_sends_the_headers(self) -> None:
        import openai

        original = openai.OpenAI
        try:
            with patch.dict(os.environ, {client_options.HEADERS_ENV: '{"anthropic-workspace-id": "wrkspc_1"}'}):
                client_options.install()
            client = openai.OpenAI(api_key="key", base_url="https://api.example.com/v1/", default_headers={"x-other": "1"})
            self.assertEqual(client.default_headers["anthropic-workspace-id"], "wrkspc_1")
            self.assertEqual(client.default_headers["x-other"], "1")
        finally:
            openai.OpenAI = original

    def test_drops_a_field_only_from_the_model_that_rejects_it(self) -> None:
        import openai
        from openai.resources.chat.completions import Completions

        original = openai.OpenAI
        sent: list[dict] = []
        try:
            with patch.dict(os.environ, {client_options.DROP_PARAMS_ENV: '{"claude-sonnet-5-5": ["temperature"]}'}):
                client_options.install()
            with patch.object(Completions, "create", lambda _self, **kwargs: sent.append(kwargs)):
                client = openai.OpenAI(api_key="key", base_url="https://api.example.com/v1/")
                client.chat.completions.create(model="claude-sonnet-5-5", temperature=0.0, messages=[])
                client.chat.completions.create(model="claude-sonnet-4-6", temperature=0.0, messages=[])
        finally:
            openai.OpenAI = original
        self.assertEqual(sent[0], {"model": "claude-sonnet-5-5", "messages": []})
        self.assertEqual(sent[1], {"model": "claude-sonnet-4-6", "temperature": 0.0, "messages": []})

    def test_refuses_drops_that_are_not_models_to_field_lists(self) -> None:
        for raw in ('["temperature"]', '{"m": "temperature"}', '{"m": [1]}'):
            with patch.dict(os.environ, {client_options.DROP_PARAMS_ENV: raw}), self.assertRaises(SystemExit):
                client_options.dropped_params()


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
