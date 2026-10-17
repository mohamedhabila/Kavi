from __future__ import annotations

import json
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from claw_anything.models.content import TextBlock, ToolResultBlock, ToolUseBlock
from claw_anything.models.task import TaskDefinition
from claw_anything.models.trace import ToolDispatch

import kavi_agent
from kavi_agent import (
    DispatchBridge,
    KaviAgent,
    KaviRunError,
    activity_logs,
    build_spec,
    finish_reason_counts,
    record_messages,
)


def task(**overrides: object) -> TaskDefinition:
    return TaskDefinition.model_validate(
        {
            "task_id": "T04_T08_demo",
            "task_name": "Deadline consolidation",
            "execution_date": "2026-04-05",
            "prompt": {"text": "Consolidate my deadlines."},
            "tools": [
                {
                    "name": "gmail_list_messages",
                    "description": "List inbox messages.",
                    "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}},
                }
            ],
            "tool_endpoints": [{"tool_name": "gmail_list_messages", "url": "http://127.0.0.1:9/gmail/messages"}],
            "environment": {"timeout_seconds": 1200, "max_turns": 100},
            **overrides,
        }
    )


class FakeDispatcher:
    def __init__(self, text: str = '{"total": 2}', is_error: bool = False) -> None:
        self.calls: list[ToolUseBlock] = []
        self._text = text
        self._is_error = is_error

    def dispatch(self, tool_use: ToolUseBlock, trace_id: str) -> tuple[ToolResultBlock, ToolDispatch]:
        self.calls.append(tool_use)
        result = ToolResultBlock(
            tool_use_id=tool_use.id, content=[TextBlock(text=self._text)], is_error=self._is_error
        )
        event = ToolDispatch(
            trace_id=trace_id,
            tool_use_id=tool_use.id,
            tool_name=tool_use.name,
            endpoint_url="http://127.0.0.1:9/gmail/messages",
            request_body=tool_use.input,
            response_status=429 if self._is_error else 200,
        )
        return result, event


def post(url: str, body: bytes, token: str | None) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    try:
        with urlopen(Request(url, data=body, headers=headers, method="POST"), timeout=5) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        return error.code, json.loads(error.read())


class DispatchBridgeTest(unittest.TestCase):
    def test_dispatches_each_call_through_the_tasks_dispatcher_and_records_it(self) -> None:
        dispatcher = FakeDispatcher(text='{"error": "rate limited"}', is_error=True)
        events: list[ToolDispatch] = []
        with DispatchBridge(dispatcher, "trace-1", events.append) as bridge:  # type: ignore[arg-type]
            status, reply = post(
                bridge.url, json.dumps({"name": "gmail_list_messages", "input": {"query": "x"}}).encode(), bridge.token
            )

        self.assertEqual(status, 200)
        self.assertEqual(reply, {"text": '{"error": "rate limited"}', "isError": True})
        self.assertEqual([(call.name, call.input) for call in dispatcher.calls], [("gmail_list_messages", {"query": "x"})])
        self.assertEqual([(event.trace_id, event.response_status) for event in events], [("trace-1", 429)])

    def test_refuses_a_request_without_its_token(self) -> None:
        dispatcher = FakeDispatcher()
        with DispatchBridge(dispatcher, "trace-1", lambda event: None) as bridge:  # type: ignore[arg-type]
            body = json.dumps({"name": "gmail_list_messages", "input": {}}).encode()
            self.assertEqual(post(bridge.url, body, "wrong")[0], 401)
            self.assertEqual(post(bridge.url, body, None)[0], 401)
        self.assertEqual(dispatcher.calls, [])

    def test_refuses_a_malformed_request(self) -> None:
        dispatcher = FakeDispatcher()
        with DispatchBridge(dispatcher, "trace-1", lambda event: None) as bridge:  # type: ignore[arg-type]
            self.assertEqual(post(bridge.url, b"not json", bridge.token)[0], 400)
            self.assertEqual(post(bridge.url, json.dumps({"name": "x"}).encode(), bridge.token)[0], 400)
            self.assertEqual(post(bridge.url.replace("/dispatch", "/other"), b"{}", bridge.token)[0], 404)
        self.assertEqual(dispatcher.calls, [])


class BuildSpecTest(unittest.TestCase):
    def test_hands_kavi_the_tools_request_day_logs_and_log_index(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            (root / "logs" / "services").mkdir(parents=True)
            (root / "logs" / "timeline_20260330_20260331.md").write_text("# Week\n", encoding="utf-8")
            (root / "logs" / "services" / "gmail_activity.md").write_text("# Mail\n", encoding="utf-8")

            spec = build_spec(task(), root, "http://127.0.0.1:1/dispatch", root / "record.json")

        self.assertEqual(spec["taskId"], "T04_T08_demo")
        self.assertEqual(spec["prompt"], "Consolidate my deadlines.")
        self.assertEqual(spec["executionDate"], "2026-04-05")
        self.assertEqual(spec["timeoutSeconds"], 1200)
        self.assertEqual(
            spec["tools"],
            [
                {
                    "name": "gmail_list_messages",
                    "description": "List inbox messages.",
                    "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}},
                }
            ],
        )
        self.assertEqual(
            spec["activityLogs"],
            [
                {"path": "logs/services/gmail_activity.md", "content": "# Mail\n"},
                {"path": "logs/timeline_20260330_20260331.md", "content": "# Week\n"},
            ],
        )
        self.assertIn("logs/timeline_20260330_20260331.md", spec["instructions"])
        # The agent guidelines OpenHarness receives, naming the task's app tool families.
        self.assertIn("## Agent Guidelines", spec["instructions"])
        self.assertIn("gmail_*", spec["instructions"])

    def test_a_task_without_logs_gives_none(self) -> None:
        with tempfile.TemporaryDirectory() as workspace:
            self.assertEqual(activity_logs(Path(workspace)), [])
        self.assertEqual(activity_logs(None), [])

    def test_refuses_a_task_without_a_day(self) -> None:
        with self.assertRaises(KaviRunError):
            build_spec(task(execution_date=None), None, "http://127.0.0.1:1/dispatch", Path("record.json"))


class FinishReasonCountsTest(unittest.TestCase):
    def test_counts_each_steps_stop_reason(self) -> None:
        record = {
            "assistant": [
                {"finishReason": "tool_use"},
                {"finishReason": "tool_use"},
                {"finishReason": "max_tokens"},
                {"finishReason": None},
            ]
        }
        self.assertEqual(finish_reason_counts(record), {"tool_use": 2, "max_tokens": 1, "unrecorded": 1})

    def test_no_steps_no_counts(self) -> None:
        self.assertEqual(finish_reason_counts({}), {})


class RecordMessagesTest(unittest.TestCase):
    def test_writes_each_step_and_its_results_and_marks_the_final_reply(self) -> None:
        record = {
            "finalText": "Two deadlines collide on March 28.",
            "assistant": [
                {
                    "text": "Checking your calendar.",
                    "toolCalls": [
                        {"id": "c1", "name": "calendar_list_events", "input": {"days": 8}, "result": "[]", "isError": False},
                        {"id": "c2", "name": "todo_list_tasks", "input": {}, "result": "busy", "isError": True},
                    ],
                },
                {"text": "Two deadlines collide on March 28.", "toolCalls": []},
            ],
        }

        messages = record_messages(record)

        self.assertEqual([(message.role, final) for message, final in messages], [("assistant", False), ("user", False), ("assistant", True)])
        first = messages[0][0].content
        self.assertEqual([type(block) for block in first], [TextBlock, ToolUseBlock, ToolUseBlock])
        results = messages[1][0].content
        self.assertEqual([(block.tool_use_id, block.is_error) for block in results], [("c1", False), ("c2", True)])

    def test_adds_the_final_reply_when_the_last_step_was_a_tool_call(self) -> None:
        record = {
            "finalText": "Done.",
            "assistant": [{"text": "", "toolCalls": [{"id": "c1", "name": "notes_list", "input": {}, "result": "[]", "isError": False}]}],
        }

        messages = record_messages(record)

        self.assertEqual([(message.role, final) for message, final in messages], [("assistant", False), ("user", False), ("assistant", True)])
        self.assertEqual(messages[-1][0].content[0].text, "Done.")

    def test_a_run_that_produced_nothing_has_no_messages(self) -> None:
        self.assertEqual(record_messages({"assistant": [], "finalText": ""}), [])


class RunKaviTest(unittest.TestCase):
    def _agent_with_script(self, body: str) -> tuple[KaviAgent, Path, tempfile.TemporaryDirectory]:
        scratch = tempfile.TemporaryDirectory()
        script = Path(scratch.name) / "task.py"
        script.write_text(textwrap.dedent(body), encoding="utf-8")
        return KaviAgent(node=sys.executable), script, scratch

    def test_reports_a_failed_run_with_its_log(self) -> None:
        agent, script, scratch = self._agent_with_script("import sys\nprint('provider refused')\nsys.exit(3)\n")
        with scratch, patch.object(kavi_agent, "TASK_SCRIPT", script):
            log = Path(scratch.name) / "kavi.log"
            with self.assertRaises(KaviRunError) as raised:
                agent._run_kavi(task(), Path(scratch.name) / "spec.json", "token", log)
        self.assertIn("status 3", str(raised.exception))
        self.assertIn("provider refused", str(raised.exception))

    def test_stops_a_run_that_outlives_its_limit(self) -> None:
        agent, script, scratch = self._agent_with_script("import time\ntime.sleep(30)\n")
        with scratch, patch.object(kavi_agent, "TASK_SCRIPT", script), patch.object(kavi_agent, "STARTUP_MARGIN_S", 0):
            log = Path(scratch.name) / "kavi.log"
            with self.assertRaises(KaviRunError) as raised:
                agent._run_kavi(task(environment={"timeout_seconds": 1}), Path(scratch.name) / "spec.json", "token", log)
        self.assertIn("did not finish within 1s", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
