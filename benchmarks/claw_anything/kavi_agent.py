"""Claw-Anything agent backend that runs each trial through Kavi.

Claw-Anything owns everything but the agent: the task's mock services, the tool
dispatcher (with its error injection), the trace, the audit snapshots and the
grader. This backend serves the task's tools to Kavi as one MCP integration
whose every call goes back through Claw-Anything's own ``ToolDispatcher``, runs
the request through Kavi's foreground conversation path
(``scripts/claw-anything-task.js``), and writes Kavi's steps into the trace.
"""

from __future__ import annotations

import json
import os
import secrets
import signal
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from claw_anything.agents.base import BaseAgent
from claw_anything.models.content import TextBlock, ToolResultBlock, ToolUseBlock
from claw_anything.models.message import Message
from claw_anything.models.task import TaskDefinition
from claw_anything.models.trace import TokenUsage, ToolDispatch
from claw_anything.runner.dispatcher import ToolDispatcher
from claw_anything.runner.system_prompt import _render_activity_logs_section

KAVI_ROOT = Path(__file__).resolve().parents[2]
TASK_SCRIPT = KAVI_ROOT / "scripts" / "claw-anything-task.js"
#: Jest start-up, provider catalog discovery and teardown, beyond the task's own limit.
STARTUP_MARGIN_S = 180
MAX_DISPATCH_REQUEST_BYTES = 1_000_000
LOG_TAIL_CHARS = 4_000

JsonObject = dict[str, Any]
OnDispatch = Callable[[ToolDispatch], None]


class KaviRunError(RuntimeError):
    """Kavi did not produce a record for the trial (an infrastructure failure)."""


class DispatchBridge:
    """Loopback endpoint through which Kavi's tool calls reach the task's dispatcher."""

    def __init__(self, dispatcher: ToolDispatcher, trace_id: str, on_dispatch: OnDispatch) -> None:
        self.token = secrets.token_urlsafe(32)
        self._dispatcher = dispatcher
        self._trace_id = trace_id
        self._on_dispatch = on_dispatch
        self._lock = threading.Lock()
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}/dispatch"

    def dispatch(self, name: str, tool_input: JsonObject) -> JsonObject:
        """Runs one call through the dispatcher, records it, and returns what the model sees."""
        tool_use = ToolUseBlock(id=f"kavi_{uuid4().hex[:24]}", name=name, input=tool_input)
        result, event = self._dispatcher.dispatch(tool_use, self._trace_id)
        with self._lock:
            self._on_dispatch(event)
        return {"text": "".join(block.text for block in result.content), "isError": result.is_error}

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        bridge = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                del format, args

            def _reply(self, status: int, payload: JsonObject) -> None:
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:
                if self.path != "/dispatch":
                    self._reply(404, {"error": "not found"})
                    return
                if not secrets.compare_digest(
                    self.headers.get("Authorization", ""), f"Bearer {bridge.token}"
                ):
                    self._reply(401, {"error": "unauthorized"})
                    return
                length = int(self.headers.get("Content-Length") or 0)
                if length <= 0 or length > MAX_DISPATCH_REQUEST_BYTES:
                    self._reply(413, {"error": "request body size out of range"})
                    return
                try:
                    payload = json.loads(self.rfile.read(length).decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    self._reply(400, {"error": "request body is not JSON"})
                    return
                name = payload.get("name") if isinstance(payload, dict) else None
                tool_input = payload.get("input") if isinstance(payload, dict) else None
                if not isinstance(name, str) or not isinstance(tool_input, dict):
                    self._reply(400, {"error": "expected {name, input}"})
                    return
                self._reply(200, bridge.dispatch(name, tool_input))

        return Handler

    def __enter__(self) -> DispatchBridge:
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


def activity_logs(workspace_root: Path | None) -> list[JsonObject]:
    """The staged activity logs, as workspace files at their ``logs/…`` paths."""
    if workspace_root is None:
        return []
    logs_dir = workspace_root / "logs"
    if not logs_dir.is_dir():
        return []
    return [
        {"path": path.relative_to(workspace_root).as_posix(), "content": path.read_text(encoding="utf-8")}
        for path in sorted(logs_dir.rglob("*.md"))
        if path.is_file()
    ]


def build_spec(
    task: TaskDefinition, workspace_root: Path | None, dispatch_url: str, out_path: Path
) -> JsonObject:
    """The task as Kavi takes it: tools, request, day, logs, and where to write the record."""
    if not task.execution_date:
        raise KaviRunError(f"Task {task.task_id} has no execution_date.")
    return {
        "taskId": task.task_id,
        "prompt": task.prompt.text,
        "executionDate": str(task.execution_date),
        "timeoutSeconds": int(task.environment.timeout_seconds),
        "tools": [
            {"name": tool.name, "description": tool.description, "inputSchema": tool.input_schema or {"type": "object"}}
            for tool in task.tools
        ],
        "dispatchUrl": dispatch_url,
        "activityLogs": activity_logs(workspace_root),
        # The same "where the logs are" section OpenHarness receives (relative paths, which
        # is where Kavi's workspace holds them).
        "instructions": (
            _render_activity_logs_section(workspace_root, relative=True) if workspace_root else ""
        ),
        "outPath": str(out_path),
    }


def record_messages(record: JsonObject) -> list[tuple[Message, bool]]:
    """Kavi's steps as trace messages; the flag marks the final assistant reply."""
    steps = record.get("assistant") or []
    final_text = str(record.get("finalText") or "")
    messages: list[tuple[Message, bool]] = []
    for step in steps:
        calls = step.get("toolCalls") or []
        blocks: list[Any] = [TextBlock(text=step["text"])] if step.get("text") else []
        blocks += [ToolUseBlock(id=call["id"], name=call["name"], input=call.get("input") or {}) for call in calls]
        if blocks:
            messages.append((Message(role="assistant", content=blocks), False))
        if calls:
            results = [
                ToolResultBlock(
                    tool_use_id=call["id"],
                    content=[TextBlock(text=str(call.get("result") or ""))],
                    is_error=bool(call.get("isError")),
                )
                for call in calls
            ]
            messages.append((Message(role="user", content=results), False))
    ends_with_reply = bool(messages) and messages[-1][0].role == "assistant"
    last_reply = (
        "".join(block.text for block in messages[-1][0].content if isinstance(block, TextBlock))
        if ends_with_reply
        else ""
    )
    if final_text and last_reply != final_text:
        messages.append((Message(role="assistant", content=[TextBlock(text=final_text)]), True))
    elif ends_with_reply:
        messages[-1] = (messages[-1][0], True)
    return messages


def _tail(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[-LOG_TAIL_CHARS:]
    except OSError as error:
        return f"(log unreadable: {error})"


class KaviAgent(BaseAgent):
    """Runs a trial through Kavi; Claw-Anything dispatches, traces and grades as usual."""

    def __init__(self, *, node: str = "node") -> None:
        self._node = node

    def run_task(self, task: TaskDefinition, trace_dir: Path | str, **kwargs: Any):  # type: ignore[override]
        kwargs["agent_type"] = "kavi"
        return super().run_task(task, trace_dir, **kwargs)

    def _execute(self, task: TaskDefinition, *, workspace_root: Path | None = None, **_: Any) -> None:
        trace_path = Path(self._writer.path)
        log_path = trace_path.with_suffix(".kavi.log")
        dispatcher = ToolDispatcher(task.get_endpoint_map())
        try:
            with DispatchBridge(dispatcher, self._trace_id, self.emit_tool_dispatch) as bridge, \
                    tempfile.TemporaryDirectory(prefix="kavi-claw-") as scratch:
                spec_path = Path(scratch) / "spec.json"
                out_path = Path(scratch) / "record.json"
                spec_path.write_text(
                    json.dumps(build_spec(task, workspace_root, bridge.url, out_path), ensure_ascii=False),
                    encoding="utf-8",
                )
                self._run_kavi(task, spec_path, bridge.token, log_path)
                if not out_path.is_file():
                    raise KaviRunError(f"Kavi wrote no record; log tail:\n{_tail(log_path)}")
                record = json.loads(out_path.read_text(encoding="utf-8"))
        finally:
            dispatcher.close()
        self._emit_record(record)
        sidecar = {key: record.get(key) for key in ("completed", "terminalReason", "durationMs", "usage", "costUsd", "errors")}
        trace_path.with_suffix(".kavi.json").write_text(json.dumps(sidecar, ensure_ascii=False), encoding="utf-8")

    def _run_kavi(self, task: TaskDefinition, spec_path: Path, token: str, log_path: Path) -> None:
        env = {**os.environ, "CLAW_ANYTHING_SPEC": str(spec_path), "CLAW_ANYTHING_DISPATCH_TOKEN": token}
        timeout_s = int(task.environment.timeout_seconds) + STARTUP_MARGIN_S
        with open(log_path, "w", encoding="utf-8") as log:
            process = subprocess.Popen(
                [self._node, str(TASK_SCRIPT)],
                cwd=KAVI_ROOT,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                status = process.wait(timeout=timeout_s)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise KaviRunError(f"Kavi did not finish within {timeout_s}s; log tail:\n{_tail(log_path)}")
        if status != 0:
            raise KaviRunError(f"Kavi exited with status {status}; log tail:\n{_tail(log_path)}")

    def _emit_record(self, record: JsonObject) -> None:
        usage = record.get("usage") or {}
        total = TokenUsage(
            input_tokens=int(usage.get("inputTokens") or 0),
            output_tokens=int(usage.get("outputTokens") or 0),
        )
        for message, is_final in record_messages(record):
            if message.role == "assistant":
                self.increment_turn_count()
            self.emit_message(message, total if is_final else None)
