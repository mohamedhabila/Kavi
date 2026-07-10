#!/usr/bin/env python3
"""Dependency-free contract tests for the Python STATE-Bench hook."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


class FakeStateBenchAgent:
    def __init__(self, *args, runtime_context=None, **kwargs):
        self.runtime_context = runtime_context


def load_adapter():
    state_bench = types.ModuleType("state_bench")
    agents = types.ModuleType("state_bench.agents")
    agent_module = types.ModuleType("state_bench.agents.state_bench")
    agent_module.StateBenchAgent = FakeStateBenchAgent
    sys.modules["state_bench"] = state_bench
    sys.modules["state_bench.agents"] = agents
    sys.modules["state_bench.agents.state_bench"] = agent_module
    path = Path(__file__).with_name("kavi_state_bench_agent.py")
    spec = importlib.util.spec_from_file_location(
        "kavi_state_bench_agent_under_test", path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load adapter")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class KaviStateBenchAgentContractTest(unittest.TestCase):
    def setUp(self):
        self.module = load_adapter()
        self.temp = tempfile.TemporaryDirectory()
        self.runtime = Path(self.temp.name) / "runtime.cjs"
        self.artifact = Path(self.temp.name) / "artifact.json"
        self.runtime.write_text("runtime", encoding="utf-8")
        self.artifact.write_text("{}", encoding="utf-8")
        self.env = patch.dict(
            os.environ,
            {
                "KAVI_STATE_BENCH_RUNTIME": str(self.runtime),
                "KAVI_STATE_BENCH_ARTIFACT": str(self.artifact),
            },
        )
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_retrieval_is_domain_bound_and_top_k_bounded(self):
        agent = self.module.KaviStateBenchAgent(
            runtime_context=SimpleNamespace(domain="travel")
        )
        with patch.object(
            self.module,
            "_query_runtime",
            return_value=("learning-a", "learning-b"),
        ) as query:
            self.assertEqual(
                agent.retrieve_learnings("cancel flight", 3),
                ["learning-a", "learning-b"],
            )
            query.assert_called_once_with(
                "node",
                str(self.runtime.resolve()),
                str(self.artifact.resolve()),
                "travel",
                "cancel flight",
                3,
            )

    def test_invalid_domain_and_oversized_query_fail_before_runtime(self):
        agent = self.module.KaviStateBenchAgent(
            runtime_context=SimpleNamespace(domain="not_a_protocol_domain")
        )
        with patch.object(self.module, "_query_runtime") as query:
            with self.assertRaises(RuntimeError):
                agent.retrieve_learnings("cancel flight", 3)
            with self.assertRaises(ValueError):
                agent.retrieve_learnings("x" * 2001, 3)
            with self.assertRaises(ValueError):
                agent.retrieve_learnings("cancel flight", 4)
            query.assert_not_called()

    def test_query_uses_stdin_instead_of_exposing_task_text_in_process_arguments(self):
        completed = subprocess.CompletedProcess([], 0, '{"learnings":["safe"]}\n', "")
        with patch.object(self.module.subprocess, "run", return_value=completed) as run:
            result = self.module._query_runtime(
                "node",
                str(self.runtime),
                str(self.artifact),
                "travel",
                "private task query",
                3,
            )
        self.assertEqual(result, ("safe",))
        command = run.call_args.args[0]
        self.assertIn("--query-stdin", command)
        self.assertNotIn("private task query", command)
        self.assertEqual(run.call_args.kwargs["input"], "private task query")


if __name__ == "__main__":
    unittest.main()
