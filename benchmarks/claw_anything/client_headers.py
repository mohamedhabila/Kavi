"""Extra HTTP headers for every OpenAI-compatible client Claw-Anything creates.

Claw-Anything's model provider and judge build ``openai.OpenAI`` clients with no way to
add headers. An endpoint that needs one (Anthropic's OpenAI-compatible API with a key
that is not scoped to a workspace needs ``anthropic-workspace-id``) gets it from
``CLAW_ANYTHING_EXTRA_HEADERS``, a JSON object of header names to values. ``install()``
must run before Claw-Anything's modules are imported: they bind ``OpenAI`` at import.
"""

from __future__ import annotations

import json
import os

ENV_NAME = "CLAW_ANYTHING_EXTRA_HEADERS"


def extra_headers() -> dict[str, str]:
    raw = os.environ.get(ENV_NAME, "").strip()
    if not raw:
        return {}
    try:
        headers = json.loads(raw)
    except json.JSONDecodeError as error:
        raise SystemExit(f"{ENV_NAME} is not JSON: {error}") from error
    if not isinstance(headers, dict) or not all(
        isinstance(name, str) and isinstance(value, str) for name, value in headers.items()
    ):
        raise SystemExit(f"{ENV_NAME} must be a JSON object of header names to string values.")
    return headers


def install() -> None:
    headers = extra_headers()
    if not headers:
        return
    import openai

    base = openai.OpenAI

    class OpenAIWithHeaders(base):  # type: ignore[misc, valid-type]
        def __init__(self, *args: object, default_headers: dict[str, str] | None = None, **kwargs: object) -> None:
            super().__init__(*args, default_headers={**headers, **(default_headers or {})}, **kwargs)

    openai.OpenAI = OpenAIWithHeaders  # type: ignore[misc]
