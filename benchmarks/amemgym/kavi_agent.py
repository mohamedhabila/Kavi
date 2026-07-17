"""AMemGym adapter for Kavi's exact foreground-chat bridge."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


STATE_FILE = "kavi_amemgym_state.json"
JsonObject = dict[str, Any]
RequestFunction = Callable[[JsonObject], JsonObject]


class KaviBridgeError(RuntimeError):
    """Raised when the local Kavi bridge rejects or cannot complete a request."""


def _require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise KaviBridgeError(f"Bridge response field {field!r} must be non-empty text.")
    return value


class KaviAMemGymAgent:
    """Implements AMemGym's on-policy agent protocol over a loopback bridge.

    The bridge owns the app chat session and calls Kavi's real foreground-chat
    entry point. Credentials remain in the bridge process environment and are
    never included in requests or checkpoints.
    """

    def __init__(
        self,
        *,
        bridge_url: str,
        bridge_token: str,
        session_id: str,
        timeout_seconds: float = 300.0,
        request_function: RequestFunction | None = None,
    ) -> None:
        self.bridge_url = _require_text(bridge_url, "bridge_url").rstrip("/")
        self._bridge_token = _require_text(bridge_token, "bridge_token")
        self.session_id = _require_text(session_id, "session_id")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive.")
        self.timeout_seconds = timeout_seconds
        self._request_function = request_function or self._request_over_http
        self.bridge_metadata: JsonObject = {}
        self.act_diagnostics: list[JsonObject] = []
        self.answer_diagnostics: list[JsonObject] = []
        self.reset()

    def _request_over_http(self, payload: JsonObject) -> JsonObject:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            self.bridge_url,
            data=body,
            headers={
                "Authorization": f"Bearer {self._bridge_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw_response = response.read().decode("utf-8")
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1_000]
            raise KaviBridgeError(
                f"Kavi bridge returned HTTP {error.code}: {detail or error.reason}"
            ) from error
        except URLError as error:
            raise KaviBridgeError(f"Kavi bridge is unavailable: {error.reason}") from error

        try:
            decoded = json.loads(raw_response)
        except json.JSONDecodeError as error:
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
            message = response.get("error")
            raise KaviBridgeError(
                str(message) if message else f"Kavi bridge rejected {action!r}."
            )
        return response

    def reset(self) -> None:
        self.act_diagnostics.clear()
        self.answer_diagnostics.clear()
        response = self._request("reset")
        metadata = response.get("metadata", {})
        if not isinstance(metadata, dict):
            raise KaviBridgeError("Bridge reset metadata must be a JSON object.")
        self.bridge_metadata = metadata

    def act(self, obs: str) -> str:
        observation = _require_text(obs, "observation")
        response = self._request("act", observation=observation)
        diagnostics = response.get("diagnostics", {})
        if not isinstance(diagnostics, dict):
            raise KaviBridgeError("Bridge diagnostics must be a JSON object.")
        self.act_diagnostics.append(diagnostics)
        return _require_text(response.get("response"), "response")

    def answer_question(self, question: str) -> tuple[str, JsonObject]:
        prompt = _require_text(question, "question")
        response = self._request("answer_question", question=prompt)
        usage = response.get("usage", {})
        if not isinstance(usage, dict):
            raise KaviBridgeError("Bridge usage must be a JSON object.")
        diagnostics = response.get("diagnostics", {})
        if not isinstance(diagnostics, dict):
            raise KaviBridgeError("Bridge diagnostics must be a JSON object.")
        self.answer_diagnostics.append(diagnostics)
        return _require_text(response.get("response"), "response"), usage

    def add_msgs(self, msgs: list[JsonObject]) -> None:
        del msgs
        raise NotImplementedError(
            "The Kavi AMemGym pilot supports the upstream on-policy protocol only."
        )

    def save_state(self, local_dir: str) -> None:
        target_dir = Path(local_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        response = self._request("save_state")
        checkpoint = response.get("checkpoint")
        if not isinstance(checkpoint, dict):
            raise KaviBridgeError("Bridge checkpoint must be a JSON object.")

        state = {
            "schema_version": 1,
            "session_id": self.session_id,
            "bridge_instance_id": self.bridge_metadata.get("bridge_instance_id"),
            "checkpoint": checkpoint,
        }
        state_path = target_dir / STATE_FILE
        temporary_path = target_dir / f".{STATE_FILE}.tmp"
        temporary_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary_path, state_path)

    def load_state(self, local_dir: str) -> None:
        state_path = Path(local_dir) / STATE_FILE
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise KaviBridgeError(f"Cannot read Kavi checkpoint at {state_path}.") from error
        if not isinstance(state, dict) or state.get("schema_version") != 1:
            raise KaviBridgeError("Unsupported Kavi AMemGym checkpoint schema.")
        if state.get("session_id") != self.session_id:
            raise KaviBridgeError("Kavi checkpoint belongs to a different session.")
        checkpoint = state.get("checkpoint")
        if not isinstance(checkpoint, dict):
            raise KaviBridgeError("Kavi checkpoint payload is invalid.")
        self._request(
            "load_state",
            bridge_instance_id=state.get("bridge_instance_id"),
            checkpoint=checkpoint,
        )
