"""MobileWorld agent adapter for Kavi's exact foreground-chat bridge."""

from __future__ import annotations

import base64
import json
import os
from collections.abc import Callable
from io import BytesIO
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from uuid import uuid4

from mobile_world.agents.base import BaseAgent
from mobile_world.agents.implementations.general_e2e_agent import (
    parse_action,
    parse_response_to_action,
)
from mobile_world.runtime.utils.models import UNKNOWN, JSONAction

JsonObject = dict[str, Any]
RequestFunction = Callable[[JsonObject], JsonObject]
MAX_RESPONSE_BYTES = 1_000_000
MAX_SCREENSHOT_BYTES = 8_000_000
MAX_ACTION_ATTEMPTS = 3


class KaviBridgeError(RuntimeError):
    """Raised when the local Kavi bridge cannot produce a valid response."""


def _require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise KaviBridgeError(f"Bridge field {field!r} must be non-empty text.")
    return value.strip()


def _require_loopback_url(value: str) -> str:
    parsed = urlparse(_require_text(value, "bridge_url"))
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise KaviBridgeError("Kavi's MobileWorld bridge must use loopback HTTP.")
    return value.rstrip("/")


class KaviMobileWorldAgent(BaseAgent):
    """Delegates MobileWorld policy steps to Kavi's foreground conversation graph."""

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
        del model_name, llm_base_url, api_key, kwargs
        super().__init__()
        bridge_url = os.environ.get("KAVI_MOBILEWORLD_BRIDGE_URL", "")
        bridge_token = os.environ.get("KAVI_MOBILEWORLD_BRIDGE_TOKEN", "")
        self.bridge_url = _require_loopback_url(bridge_url)
        self._bridge_token = _require_text(bridge_token, "bridge_token")
        if not isinstance(scale_factor, int) or scale_factor <= 0:
            raise ValueError("scale_factor must be a positive integer.")
        self.scale_factor = scale_factor
        self.session_id = f"mobileworld-{uuid4()}"
        self._request_function = request_function or self._request_over_http
        self.step_index = 0
        self.repair_count = 0

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
            {
                "action": action,
                "session_id": self.session_id,
                **fields,
            }
        )
        if response.get("ok") is not True:
            raise KaviBridgeError(str(response.get("error") or f"Bridge rejected {action!r}."))
        return response

    def initialize_hook(self, instruction: str) -> None:
        self.reset()
        self._request("reset", instruction=instruction, scale_factor=self.scale_factor)

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
        self.step_index += 1
        last_response = ""

        for attempt in range(MAX_ACTION_ATTEMPTS):
            action = "act" if attempt == 0 else "repair"
            response = self._request(
                action,
                step_index=self.step_index,
                attempt=attempt + 1,
                screenshot_base64=encoded,
                screenshot_width=width,
                screenshot_height=height,
                tool_call=observation.get("tool_call"),
                ask_user_response=observation.get("ask_user_response"),
                **({"validation_error": "invalid_action_contract"} if attempt else {}),
            )
            self._record_usage(response)
            last_response = _require_text(response.get("response"), "response")
            try:
                _, action_text = parse_action(last_response)
                parsed = parse_response_to_action(
                    action_text,
                    width,
                    height,
                    self.scale_factor,
                )
                return last_response, JSONAction(**parsed)
            except (TypeError, ValueError):
                if attempt + 1 < MAX_ACTION_ATTEMPTS:
                    self.repair_count += 1

        return last_response, JSONAction(
            action_type=UNKNOWN,
            text="Kavi did not produce an action accepted by MobileWorld's parser.",
        )

    def reset(self) -> None:
        self.step_index = 0
        self.repair_count = 0
