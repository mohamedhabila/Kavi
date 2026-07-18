"""MobileWorld adapter for Kavi's graph-owned foreground controller session."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
from collections.abc import Callable
from io import BytesIO
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from uuid import uuid4

from mobile_world.agents.base import BaseAgent
from mobile_world.agents.implementations.general_e2e_agent import (
    parse_response_to_action,
)
from mobile_world.runtime.controller import APP_LOWER_DICT
from mobile_world.runtime.utils.models import JSONAction

JsonObject = dict[str, Any]
RequestFunction = Callable[[JsonObject], JsonObject]
MAX_RESPONSE_BYTES = 1_000_000
MAX_SCREENSHOT_BYTES = 8_000_000


class KaviBridgeError(RuntimeError):
    """Raised when the local Kavi bridge cannot produce a valid host event."""


def _require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise KaviBridgeError(f"Bridge field {field!r} must be non-empty text.")
    return value.strip()


def _require_loopback_url(value: str) -> str:
    parsed = urlparse(_require_text(value, "bridge_url"))
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise KaviBridgeError("Kavi's MobileWorld bridge must use loopback HTTP.")
    return value.rstrip("/")


def _discover_controller_app_identifiers(env: Any) -> list[str]:
    device = _require_text(getattr(env, "device", None), "env.device")
    try:
        result = subprocess.run(
            ["adb", "-s", device, "shell", "pm", "list", "packages"],
            capture_output=True,
            check=False,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise KaviBridgeError("Unable to discover installed Android packages.") from error
    if result.returncode != 0:
        raise KaviBridgeError(
            f"Unable to discover installed Android packages: {result.stderr.strip()}"
        )
    installed_packages = {
        line.removeprefix("package:").strip()
        for line in result.stdout.splitlines()
        if line.startswith("package:")
    }
    identifiers = sorted(
        app_name
        for app_name, package_name in APP_LOWER_DICT.items()
        if package_name in installed_packages
    )
    if not identifiers:
        raise KaviBridgeError("MobileWorld found no launchable app identifiers on the device.")
    return identifiers


def _read_bridge_event(response: JsonObject) -> tuple[str, JsonObject]:
    event = response.get("event")
    if not isinstance(event, dict):
        raise KaviBridgeError("Kavi bridge response must contain one host event.")
    kind = _require_text(event.get("kind"), "event.kind")
    if kind == "controller_action":
        if set(event) != {"kind", "action"} or not isinstance(event.get("action"), dict):
            raise KaviBridgeError("Controller event must contain exactly one action object.")
        return kind, event["action"]
    if kind in {"ask_user", "answer"}:
        if set(event) != {"kind", "text"}:
            raise KaviBridgeError(f"{kind} event must contain exactly one text field.")
        return kind, {"action_type": kind, "text": _require_text(event.get("text"), "event.text")}
    if kind == "status":
        if set(event) != {"kind", "goal_status"} or event.get("goal_status") not in {
            "complete",
            "infeasible",
        }:
            raise KaviBridgeError("Status event must contain a valid goal_status.")
        return kind, {"action_type": "status", "goal_status": event["goal_status"]}
    raise KaviBridgeError(f"Unsupported Kavi host event: {kind!r}.")


class KaviMobileWorldAgent(BaseAgent):
    """Delegates one serialized MobileWorld session to Kavi's foreground graph."""

    def __init__(
        self,
        *,
        model_name: str,
        llm_base_url: str,
        api_key: str = "empty",
        scale_factor: int = 1000,
        request_function: RequestFunction | None = None,
        **kwargs: Any,
    ) -> None:
        env = kwargs.get("env")
        del model_name, llm_base_url, api_key, kwargs
        super().__init__()
        self.bridge_url = _require_loopback_url(
            os.environ.get("KAVI_MOBILEWORLD_BRIDGE_URL", "")
        )
        self._bridge_token = _require_text(
            os.environ.get("KAVI_MOBILEWORLD_BRIDGE_TOKEN", ""), "bridge_token"
        )
        if not isinstance(scale_factor, int) or scale_factor <= 0:
            raise ValueError("scale_factor must be a positive integer.")
        self.scale_factor = scale_factor
        self.controller_app_identifiers = _discover_controller_app_identifiers(env)
        self.session_id = f"mobileworld-{uuid4()}"
        self._request_function = request_function or self._request_over_http
        self.step_index = 0
        self.repair_count = 0
        self._previous_event_kind: str | None = None
        self._previous_screenshot_digest: str | None = None

    def _request_over_http(self, payload: JsonObject) -> JsonObject:
        request = Request(
            self.bridge_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._bridge_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=300) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as error:
            detail = error.read(1_000).decode("utf-8", errors="replace")
            raise KaviBridgeError(
                f"Kavi bridge returned HTTP {error.code}: {detail or error.reason}"
            ) from error
        except URLError as error:
            raise KaviBridgeError(f"Kavi bridge is unavailable: {error.reason}") from error
        if len(raw) > MAX_RESPONSE_BYTES:
            raise KaviBridgeError("Kavi bridge response exceeded the size limit.")
        try:
            decoded = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise KaviBridgeError("Kavi bridge returned invalid JSON.") from error
        if not isinstance(decoded, dict):
            raise KaviBridgeError("Kavi bridge response must be a JSON object.")
        return decoded

    def _request(self, action: str, **fields: Any) -> JsonObject:
        response = self._request_function(
            {"action": action, "session_id": self.session_id, **fields}
        )
        if response.get("ok") is not True:
            raise KaviBridgeError(
                str(response.get("error") or f"Bridge rejected {action!r}.")
            )
        return response

    def initialize_hook(self, instruction: str) -> None:
        self.reset()
        self._request(
            "reset",
            instruction=instruction,
            scale_factor=self.scale_factor,
            controller_app_identifiers=self.controller_app_identifiers,
        )

    @staticmethod
    def _encode_screenshot(image: Any) -> tuple[str, int, int]:
        width, height = image.size
        output = BytesIO()
        image.save(output, format="PNG")
        screenshot = output.getvalue()
        if not screenshot or len(screenshot) > MAX_SCREENSHOT_BYTES:
            raise KaviBridgeError("MobileWorld screenshot is empty or exceeds the size limit.")
        return base64.b64encode(screenshot).decode("ascii"), int(width), int(height)

    def _record_usage(self, response: JsonObject) -> None:
        usage = response.get("usage")
        if not isinstance(usage, dict):
            return
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)
        if isinstance(input_tokens, int) and input_tokens >= 0:
            self._total_prompt_tokens += input_tokens
        if isinstance(output_tokens, int) and output_tokens >= 0:
            self._total_completion_tokens += output_tokens

    def predict(self, observation: dict[str, Any]) -> tuple[str, JSONAction]:
        screenshot = observation.get("screenshot")
        if screenshot is None or not hasattr(screenshot, "save") or not hasattr(screenshot, "size"):
            raise KaviBridgeError("MobileWorld observation does not contain a screenshot.")
        encoded, width, height = self._encode_screenshot(screenshot)
        screenshot_digest = hashlib.sha256(base64.b64decode(encoded)).hexdigest()
        prior_event_observation = None
        if self._previous_event_kind is not None:
            prior_event_observation = {
                "event_kind": self._previous_event_kind,
                "exact_screen_match": screenshot_digest == self._previous_screenshot_digest,
                "ask_user_response": observation.get("ask_user_response"),
                "external_tool_result": observation.get("tool_call"),
            }
        self.step_index += 1
        response = self._request(
            "advance",
            step_index=self.step_index,
            screenshot_base64=encoded,
            screenshot_width=width,
            screenshot_height=height,
            prior_event_observation=prior_event_observation,
        )
        self._record_usage(response)
        event_kind, action_payload = _read_bridge_event(response)
        try:
            parsed = parse_response_to_action(
                json.dumps(action_payload, ensure_ascii=False),
                width,
                height,
                self.scale_factor,
            )
        except (TypeError, ValueError) as error:
            raise KaviBridgeError("Graph-owned host event was rejected by MobileWorld.") from error
        self._previous_event_kind = event_kind
        self._previous_screenshot_digest = screenshot_digest
        transcript = (
            f"Kavi graph event: {event_kind}\n"
            f"Action: {json.dumps(action_payload, ensure_ascii=False)}"
        )
        return transcript, JSONAction(**parsed)

    def reset(self) -> None:
        self.step_index = 0
        self.repair_count = 0
        self._previous_event_kind = None
        self._previous_screenshot_digest = None
