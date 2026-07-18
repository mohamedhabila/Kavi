from __future__ import annotations

import base64
import os
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

from kavi_agent import KaviBridgeError, KaviMobileWorldAgent, _discover_controller_app_identifiers
from PIL import Image


class FakeBridge:
    def __init__(self, events: list[dict]) -> None:
        self.events = list(events)
        self.requests: list[dict] = []

    def __call__(self, payload: dict) -> dict:
        self.requests.append(payload)
        if payload["action"] == "reset":
            return {"ok": True}
        return {
            "ok": True,
            "event": self.events.pop(0),
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }


class KaviMobileWorldAgentTest(unittest.TestCase):
    def make_agent(self, bridge: FakeBridge) -> KaviMobileWorldAgent:
        with patch.dict(
            os.environ,
            {
                "KAVI_MOBILEWORLD_BRIDGE_URL": "http://127.0.0.1:1234",
                "KAVI_MOBILEWORLD_BRIDGE_TOKEN": "secret",
            },
            clear=False,
        ), patch(
            "kavi_agent._discover_controller_app_identifiers",
            return_value=["clock", "files"],
        ):
            return KaviMobileWorldAgent(
                model_name="foreground-chat",
                llm_base_url="http://unused.invalid",
                request_function=bridge,
            )

    def test_parses_graph_owned_action_with_the_upstream_parser(self) -> None:
        bridge = FakeBridge(
            [
                {
                    "kind": "controller_action",
                    "action": {"action_type": "click", "coordinate": [500, 250]},
                }
            ]
        )
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")
        raw, action = agent.predict({"screenshot": Image.new("RGB", (100, 200))})

        self.assertIn("Kavi graph event: controller_action", raw)
        self.assertEqual((action.action_type, action.x, action.y), ("click", 50, 50))
        advance_request = bridge.requests[1]
        self.assertEqual(advance_request["action"], "advance")
        screenshot = base64.b64decode(advance_request["screenshot_base64"])
        self.assertEqual(Image.open(BytesIO(screenshot)).size, (100, 200))
        self.assertIsNone(advance_request["prior_event_observation"])
        self.assertEqual(agent.get_total_token_usage()["total_tokens"], 15)
        self.assertEqual(bridge.requests[0]["controller_app_identifiers"], ["clock", "files"])

    @patch("kavi_agent.subprocess.run")
    def test_discovers_only_controller_identifiers_installed_on_device(self, run: Mock) -> None:
        run.return_value = SimpleNamespace(
            returncode=0,
            stdout=(
                "package:com.google.android.deskclock\n"
                "package:com.google.android.documentsui\n"
            ),
            stderr="",
        )

        identifiers = _discover_controller_app_identifiers(SimpleNamespace(device="emulator-5554"))

        self.assertIn("clock", identifiers)
        self.assertIn("files", identifiers)
        self.assertNotIn("mail", identifiers)
        run.assert_called_once_with(
            ["adb", "-s", "emulator-5554", "shell", "pm", "list", "packages"],
            capture_output=True,
            check=False,
            text=True,
            timeout=15,
        )

    def test_reports_the_next_observation_as_host_facts_without_an_advisory_ledger(self) -> None:
        bridge = FakeBridge(
            [
                {"kind": "controller_action", "action": {"action_type": "navigate_back"}},
                {"kind": "controller_action", "action": {"action_type": "navigate_home"}},
            ]
        )
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")
        screenshot = Image.new("RGB", (100, 200), color="white")

        agent.predict({"screenshot": screenshot})
        agent.predict(
            {
                "screenshot": screenshot,
                "ask_user_response": "Use the afternoon time.",
                "tool_call": {"status": "completed", "value": 3},
            }
        )

        self.assertEqual(
            bridge.requests[2]["prior_event_observation"],
            {
                "event_kind": "controller_action",
                "observable_delta": "unchanged",
            },
        )
        self.assertNotIn("recent_action_outcomes", bridge.requests[2])
        self.assertEqual(agent.repair_count, 0)

    def test_ignores_transient_pixels_but_reports_material_visual_change(self) -> None:
        bridge = FakeBridge(
            [
                {"kind": "controller_action", "action": {"action_type": "wait"}},
                {"kind": "controller_action", "action": {"action_type": "wait"}},
                {"kind": "controller_action", "action": {"action_type": "wait"}},
            ]
        )
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")
        baseline = Image.new("RGB", (100, 200), color="white")
        transient = baseline.copy()
        transient.putpixel((50, 50), (0, 0, 0))
        material = Image.new("RGB", (100, 200), color="black")

        agent.predict({"screenshot": baseline})
        agent.predict({"screenshot": transient})
        agent.predict({"screenshot": material})

        self.assertEqual(
            bridge.requests[2]["prior_event_observation"]["observable_delta"],
            "unchanged",
        )
        self.assertEqual(
            bridge.requests[3]["prior_event_observation"]["observable_delta"],
            "changed",
        )

    def test_maps_graph_clarification_and_terminal_events(self) -> None:
        bridge = FakeBridge(
            [
                {"kind": "ask_user", "text": "Which time should I use?"},
                {"kind": "status", "goal_status": "infeasible"},
            ]
        )
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")
        screenshot = Image.new("RGB", (100, 200))

        _, clarification = agent.predict({"screenshot": screenshot})
        _, terminal = agent.predict(
            {"screenshot": screenshot, "ask_user_response": "Use 4 PM."}
        )

        self.assertEqual(clarification.action_type, "ask_user")
        self.assertEqual(clarification.text, "Which time should I use?")
        self.assertEqual(terminal.action_type, "answer")
        self.assertEqual(terminal.text, "task failed")
        self.assertEqual(
            bridge.requests[2]["prior_event_observation"]["event_kind"], "ask_user"
        )

    def test_rejects_an_invalid_host_event_without_a_model_repair_loop(self) -> None:
        bridge = FakeBridge([{"kind": "controller_action", "action": "not-an-object"}])
        agent = self.make_agent(bridge)
        agent.initialize("Complete the task")

        with self.assertRaisesRegex(KaviBridgeError, "action object"):
            agent.predict({"screenshot": Image.new("RGB", (100, 200))})

        self.assertEqual([request["action"] for request in bridge.requests], ["reset", "advance"])
        self.assertEqual(agent.repair_count, 0)

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
