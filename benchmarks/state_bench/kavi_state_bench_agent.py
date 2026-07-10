"""Official STATE-Bench v0.8.0 Agent Learning hook for Kavi learnings."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from state_bench.agents.state_bench import StateBenchAgent

_RUNTIME_ENV = "KAVI_STATE_BENCH_RUNTIME"
_ARTIFACT_ENV = "KAVI_STATE_BENCH_ARTIFACT"
_NODE_ENV = "KAVI_STATE_BENCH_NODE"
_DOMAINS = {"travel", "customer_support", "shopping_assistant"}


def _required_file(env_name: str) -> Path:
    raw = os.environ.get(env_name, "").strip()
    if not raw:
        raise RuntimeError(f"{env_name} is required")
    path = Path(raw).expanduser().resolve()
    if not path.is_file() or path.is_symlink():
        raise RuntimeError(f"{env_name} must point to a regular file")
    return path


def _query_runtime(
    node: str,
    runtime: str,
    artifact: str,
    domain: str,
    query: str,
    top_k: int,
) -> tuple[str, ...]:
    completed = subprocess.run(
        [
            node,
            runtime,
            "query",
            "--artifact",
            artifact,
            "--domain",
            domain,
            "--query-stdin",
            "--top-k",
            str(top_k),
        ],
        check=False,
        capture_output=True,
        text=True,
        input=query,
        timeout=15,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip()[:500]
        raise RuntimeError(f"Kavi learning retrieval failed: {detail}")
    if len(completed.stdout) > 65_536:
        raise RuntimeError("Kavi learning retrieval response exceeded the safety bound")
    payload = json.loads(completed.stdout)
    learnings = payload.get("learnings") if isinstance(payload, dict) else None
    if not isinstance(learnings, list) or any(
        not isinstance(item, str) for item in learnings
    ):
        raise TypeError("Kavi learning retrieval must return list[str]")
    if len(learnings) > top_k:
        raise RuntimeError("Kavi learning retrieval exceeded benchmark top_k")
    return tuple(learnings)


class KaviStateBenchAgent(StateBenchAgent):
    """Built-in tool-calling agent with Kavi's read-only learned-experience retrieval."""

    def __init__(self, *args, runtime_context=None, **kwargs):
        self._kavi_runtime = _required_file(_RUNTIME_ENV)
        self._kavi_artifact = _required_file(_ARTIFACT_ENV)
        self._kavi_node = os.environ.get(_NODE_ENV, "node").strip() or "node"
        super().__init__(*args, runtime_context=runtime_context, **kwargs)

    def retrieve_learnings(self, query: str, top_k: int = 3) -> list[str]:
        if not isinstance(query, str) or not query.strip():
            raise ValueError("retrieve_learnings requires a non-empty query")
        normalized_query = query.strip()
        if len(normalized_query) > 2000:
            raise ValueError("retrieve_learnings query exceeds the safety bound")
        if not isinstance(top_k, int) or isinstance(top_k, bool) or not 1 <= top_k <= 3:
            raise ValueError("retrieve_learnings top_k must be between 1 and 3")
        domain = getattr(self.runtime_context, "domain", None)
        if domain not in _DOMAINS:
            raise RuntimeError("STATE-Bench runtime context has an invalid domain")
        return list(
            _query_runtime(
                self._kavi_node,
                str(self._kavi_runtime),
                str(self._kavi_artifact),
                domain,
                normalized_query,
                top_k,
            )
        )


__all__ = ["KaviStateBenchAgent"]
