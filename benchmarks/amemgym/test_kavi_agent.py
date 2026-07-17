from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from kavi_agent import KaviAMemGymAgent, KaviBridgeError, STATE_FILE
from run_kavi_pilot import build_pilot_item, git_is_clean, parse_period_indices


class FakeBridge:
    def __init__(self) -> None:
        self.requests: list[dict] = []

    def __call__(self, payload: dict) -> dict:
        self.requests.append(payload)
        action = payload["action"]
        if action == "reset":
            return {
                "ok": True,
                "metadata": {
                    "bridge_instance_id": "bridge-1",
                    "provider": {"family": "openrouter", "model": "model"},
                },
            }
        if action == "act":
            return {
                "ok": True,
                "response": "Helpful answer",
                "diagnostics": {"provider_outcome": "valid"},
            }
        if action == "answer_question":
            return {
                "ok": True,
                "response": '{"answer": 2}',
                "usage": {"input_tokens": 10, "output_tokens": 4},
                "diagnostics": {"instrumentation_status": "recorded"},
            }
        if action == "save_state":
            return {"ok": True, "checkpoint": {"turn_count": 1}}
        if action == "load_state":
            return {"ok": True}
        return {"ok": False, "error": "unknown action"}


class KaviAMemGymAgentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.bridge = FakeBridge()
        self.agent = KaviAMemGymAgent(
            bridge_url="http://127.0.0.1:1234",
            bridge_token="secret",
            session_id="session-1",
            request_function=self.bridge,
        )

    def test_on_policy_calls_and_read_only_question(self) -> None:
        self.assertEqual(self.agent.act("Hello"), "Helpful answer")
        self.assertEqual(self.agent.act_diagnostics, [{"provider_outcome": "valid"}])
        response, usage = self.agent.answer_question("Choose")
        self.assertEqual(response, '{"answer": 2}')
        self.assertEqual(usage["input_tokens"], 10)
        self.assertEqual(
            self.agent.answer_diagnostics,
            [{"instrumentation_status": "recorded"}],
        )
        self.assertEqual(
            [request["action"] for request in self.bridge.requests],
            ["reset", "act", "answer_question"],
        )

    def test_checkpoint_excludes_bridge_token_and_can_be_reloaded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.agent.save_state(directory)
            state_text = (Path(directory) / STATE_FILE).read_text(encoding="utf-8")
            self.assertNotIn("secret", state_text)
            self.assertEqual(json.loads(state_text)["session_id"], "session-1")
            self.agent.load_state(directory)
        self.assertEqual(self.bridge.requests[-1]["action"], "load_state")

    def test_off_policy_import_is_explicitly_unsupported(self) -> None:
        with self.assertRaisesRegex(NotImplementedError, "on-policy"):
            self.agent.add_msgs([])

    def test_bridge_errors_are_not_silently_accepted(self) -> None:
        def rejected(_: dict) -> dict:
            return {"ok": False, "error": "failed"}

        with self.assertRaisesRegex(KaviBridgeError, "failed"):
            KaviAMemGymAgent(
                bridge_url="http://127.0.0.1:1234",
                bridge_token="secret",
                session_id="session-1",
                request_function=rejected,
            )


class PilotSelectionTest(unittest.TestCase):
    def test_git_cleanliness_requires_success_and_empty_status(self) -> None:
        with patch(
            "run_kavi_pilot.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout=""),
        ):
            self.assertTrue(git_is_clean(Path("checkout")))
        with patch(
            "run_kavi_pilot.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout=" M scorer.py\n"),
        ):
            self.assertFalse(git_is_clean(Path("checkout")))

    def test_parses_explicit_period_indices_without_duplicates(self) -> None:
        self.assertEqual(parse_period_indices("0, 3"), (0, 3))
        with self.assertRaisesRegex(Exception, "unique"):
            parse_period_indices("0,0")

    def test_selects_sessions_by_structured_exposed_states(self) -> None:
        item = {
            "qas": [{"required_info": ["preference_a", "preference_b"]}],
            "periods": [
                {
                    "sessions": [
                        {"exposed_states": {"preference_a": "one"}, "query": "unrelated text"},
                        {"exposed_states": {"other": "two"}, "query": "preference_a"},
                    ]
                },
                {"sessions": [{"exposed_states": {"preference_b": "three"}}]},
                {"sessions": [{"exposed_states": {"other": "four"}}]},
                {"sessions": [{"exposed_states": {"preference_a": "five"}}]},
            ],
        }
        pilot, selection = build_pilot_item(item, qa_index=0)
        self.assertEqual([len(period["sessions"]) for period in pilot["periods"]], [1, 1, 1])
        self.assertEqual(
            [entry["original_period_index"] for entry in selection],
            [0, 1, 3],
        )
        self.assertEqual(pilot["periods"][0]["sessions"][0]["query"], "unrelated text")


if __name__ == "__main__":
    unittest.main()
