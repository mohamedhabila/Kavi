from __future__ import annotations

import base64
import json
import os
import unittest
from io import BytesIO
from unittest.mock import patch

from kavi_agent import KaviBridgeError, KaviMobileWorldAgent
from PIL import Image


class FakeBridge:
    def __init__(self, responses: list[str]) -> None:
        self.responses = list(responses)
        self.requests: list[dict] = []

    def __call__(self, payload: dict) -> dict:
        self.requests.append(payload)
        if payload["action"] == "reset":
            return {"ok": True}
        return {
            "ok": True,
            "response": self.responses.pop(0),
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }


class KaviMobileWorldAgentTest(unittest.TestCase):
    @staticmethod
    def response(thought: str, action: dict) -> str:
        return json.dumps({"thought": thought, "action": action})

    def make_agent(self, bridge: FakeBridge) -> KaviMobileWorldAgent:
        with patch.dict(
            os.environ,
            {
                "KAVI_MOBILEWORLD_BRIDGE_URL": "http://127.0.0.1:1234",
                "KAVI_MOBILEWORLD_BRIDGE_TOKEN": "secret",
            },
            clear=False,
        ):
            return KaviMobileWorldAgent(
                model_name="foreground-chat",
                llm_base_url="http://unused.invalid",
                request_function=bridge,
            )

    def test_parses_with_the_upstream_action_parser(self) -> None:
        bridge = FakeBridge(
            [self.response("Tap the control.", {"action_type": "click", "coordinate": [500, 250]})]
        )
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")
        raw, action = agent.predict({"screenshot": Image.new("RGB", (100, 200))})

        self.assertIn("Tap the control", raw)
        self.assertEqual((action.action_type, action.x, action.y), ("click", 50, 50))
        act_request = bridge.requests[1]
        screenshot = base64.b64decode(act_request["screenshot_base64"])
        self.assertEqual(Image.open(BytesIO(screenshot)).size, (100, 200))
        self.assertEqual(agent.get_total_token_usage()["total_tokens"], 15)

    def test_retries_only_after_typed_action_validation_fails(self) -> None:
        bridge = FakeBridge(
            [
                "This is not an action.",
                self.response("Recover.", {"action_type": "navigate_back"}),
            ]
        )
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")
        _, action = agent.predict({"screenshot": Image.new("RGB", (100, 200))})

        self.assertEqual(action.action_type, "navigate_back")
        self.assertEqual(
            [request["action"] for request in bridge.requests], ["reset", "act", "repair"]
        )
        self.assertEqual(bridge.requests[-1]["validation_error"], "invalid_action_contract")
        self.assertEqual(agent.repair_count, 1)

    def test_does_not_fall_back_to_the_legacy_thought_action_parser(self) -> None:
        bridge = FakeBridge(
            [
                'Thought: Legacy format.\nAction: {"action_type":"navigate_home"}',
                self.response("Use the typed handoff.", {"action_type": "navigate_back"}),
            ]
        )
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")

        _, action = agent.predict({"screenshot": Image.new("RGB", (100, 200))})

        self.assertEqual(action.action_type, "navigate_back")
        self.assertEqual([request["action"] for request in bridge.requests], ["reset", "act", "repair"])

    def test_reports_a_bounded_typed_action_outcome_ledger(self) -> None:
        bridge = FakeBridge(
            [
                self.response("Go back.", {"action_type": "navigate_back"}),
                self.response("Try another route.", {"action_type": "navigate_home"}),
            ]
        )
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")
        screenshot = Image.new("RGB", (100, 200), color="white")

        agent.predict({"screenshot": screenshot})
        agent.predict({"screenshot": screenshot})

        first_request, second_request = bridge.requests[1:3]
        self.assertEqual(first_request["recent_action_outcomes"], [])
        self.assertEqual(
            second_request["recent_action_outcomes"],
            [
                {
                    "proposed_action": {"action_type": "navigate_back"},
                    "parsed_controller_action": {"action_type": "navigate_back"},
                    "observation": {
                        "post_action_observation_received": True,
                        "exact_screen_match": True,
                        "consecutive_exact_screen_matches": 1,
                        "semantic_effect": "unverified",
                        "ask_user_response": None,
                        "external_tool_result": None,
                    },
                }
            ],
        )

    def test_forwards_user_and_external_tool_observations(self) -> None:
        bridge = FakeBridge(
            [
                self.response("Start.", {"action_type": "navigate_home"}),
                self.response("Continue.", {"action_type": "wait"}),
            ]
        )
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")
        screenshot = Image.new("RGB", (100, 200))

        agent.predict({"screenshot": screenshot})
        agent.predict(
            {
                "screenshot": screenshot,
                "ask_user_response": "Use the afternoon time.",
                "tool_call": {"status": "completed", "value": 3},
            }
        )

        outcome = bridge.requests[2]["recent_action_outcomes"][-1]["observation"]
        self.assertEqual(outcome["ask_user_response"], "Use the afternoon time.")
        self.assertEqual(outcome["external_tool_result"], {"status": "completed", "value": 3})

    def test_returns_unknown_after_the_bounded_recovery_budget(self) -> None:
        bridge = FakeBridge(["invalid", "still invalid", "invalid again"])
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")
        _, action = agent.predict({"screenshot": Image.new("RGB", (100, 200))})

        self.assertEqual(action.action_type, "unknown")
        self.assertEqual(len(bridge.requests), 4)
        self.assertEqual(agent.repair_count, 2)

    def test_rejects_a_non_loopback_bridge(self) -> None:
        with patch.dict(
            os.environ,
            {
                "KAVI_MOBILEWORLD_BRIDGE_URL": "https://example.com/bridge",
                "KAVI_MOBILEWORLD_BRIDGE_TOKEN": "secret",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(KaviBridgeError, "loopback"):
                KaviMobileWorldAgent(
                    model_name="foreground-chat",
                    llm_base_url="http://unused.invalid",
                )


if __name__ == "__main__":
    unittest.main()
