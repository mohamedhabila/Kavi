"""Endpoint options for every OpenAI-compatible client Claw-Anything creates.

Claw-Anything's model provider and judge build ``openai.OpenAI`` clients with fixed
options. Two endpoints the reference arm uses need more:

- ``CLAW_ANYTHING_EXTRA_HEADERS``: a JSON object of header names to values added to every
  client. Anthropic's OpenAI-compatible API needs ``anthropic-workspace-id`` with a key
  that is not scoped to a workspace.
- ``CLAW_ANYTHING_DROP_PARAMS``: a JSON object of model ids to request fields dropped from
  that model's chat completions. Claw-Anything always sends ``temperature: 0.0``, which
  Claude Sonnet 5.5 rejects ("deprecated for this model") while the judge's model takes it.

``install()`` must run before Claw-Anything's modules are imported: they bind ``OpenAI``
at import.
"""

from __future__ import annotations

import json
import os
from typing import Any

HEADERS_ENV = "CLAW_ANYTHING_EXTRA_HEADERS"
DROP_PARAMS_ENV = "CLAW_ANYTHING_DROP_PARAMS"


def _json_env(name: str) -> Any:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise SystemExit(f"{name} is not JSON: {error}") from error


def extra_headers() -> dict[str, str]:
    headers = _json_env(HEADERS_ENV) or {}
    if not isinstance(headers, dict) or not all(
        isinstance(name, str) and isinstance(value, str) for name, value in headers.items()
    ):
        raise SystemExit(f"{HEADERS_ENV} must be a JSON object of header names to string values.")
    return headers


def dropped_params() -> dict[str, frozenset[str]]:
    drops = _json_env(DROP_PARAMS_ENV) or {}
    if not isinstance(drops, dict) or not all(
        isinstance(model, str) and isinstance(fields, list) and all(isinstance(f, str) for f in fields)
        for model, fields in drops.items()
    ):
        raise SystemExit(f"{DROP_PARAMS_ENV} must be a JSON object of model ids to lists of field names.")
    return {model: frozenset(fields) for model, fields in drops.items()}


def install() -> None:
    headers = extra_headers()
    drops = dropped_params()
    if not headers and not drops:
        return
    import openai

    base = openai.OpenAI

    class OpenAIWithOptions(base):  # type: ignore[misc, valid-type]
        def __init__(self, *args: Any, default_headers: dict[str, str] | None = None, **kwargs: Any) -> None:
            super().__init__(*args, default_headers={**headers, **(default_headers or {})}, **kwargs)
            if drops:
                completions = self.chat.completions
                create = completions.create

                def create_without_dropped(*call_args: Any, **call_kwargs: Any) -> Any:
                    for field in drops.get(str(call_kwargs.get("model", "")), frozenset()):
                        call_kwargs.pop(field, None)
                    return create(*call_args, **call_kwargs)

                completions.create = create_without_dropped  # type: ignore[method-assign]

    openai.OpenAI = OpenAIWithOptions  # type: ignore[misc]
