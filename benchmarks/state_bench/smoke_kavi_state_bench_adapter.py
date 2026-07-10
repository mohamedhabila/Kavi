#!/usr/bin/env python3
"""No-provider smoke for the installed STATE-Bench Kavi retrieval hook."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", required=True, type=Path)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--domain", default="travel")
    parser.add_argument("--query", default="Cancel a flight and calculate the refund")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    upstream = args.upstream.resolve()
    sys.path.insert(0, str(upstream))
    adapter_path = upstream / "agents/kavi_state_bench_agent.py"
    spec = importlib.util.spec_from_file_location(
        "kavi_state_bench_agent", adapter_path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load installed Kavi STATE-Bench adapter")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    agent = object.__new__(module.KaviStateBenchAgent)
    agent._kavi_node = "node"
    agent._kavi_runtime = args.runtime.resolve()
    agent._kavi_artifact = args.artifact.resolve()
    agent.runtime_context = SimpleNamespace(domain=args.domain)
    learnings = agent.retrieve_learnings(args.query, top_k=3)
    if (
        not learnings
        or len(learnings) > 3
        or not all(isinstance(item, str) for item in learnings)
    ):
        raise RuntimeError("Kavi STATE-Bench adapter returned invalid learnings")
    agent.runtime_context = SimpleNamespace(domain="held_out_cross_domain")
    try:
        agent.retrieve_learnings(args.query, top_k=3)
    except RuntimeError:
        pass
    else:
        raise RuntimeError("Kavi STATE-Bench adapter did not reject an invalid domain")
    print(
        json.dumps(
            {"status": "ok", "domain": args.domain, "learnings": learnings}, indent=2
        )
    )


if __name__ == "__main__":
    main()
