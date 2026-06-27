#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any
import urllib.request


METHOD = "kavi_memory_isolated"
EXPECTED_READER = "qwen3.5-9b"
EXPECTED_EVALUATOR = "gpt-5.2"
HARNESS_SHARED_HAYSTACK_LINE = "    shared_haystack = all_haystacks_shared(question_ids, haystack_mapping)\n"
HARNESS_KAVI_ISOLATED_LINE = (
    "    shared_haystack = all_haystacks_shared(question_ids, haystack_mapping) "
    "and not (memory_config_template is not None and memory_config_template.get(\"memory_type\") == \"kavi_memory_isolated\")\n"
)
NONSHARED_MEMORY_SET_START = "NONSHARED_PARALLEL_MEMORY_TYPES = {\n"
NONSHARED_KAVI_MEMORY_LINE = '    "kavi_memory_isolated",\n'
HARNESS_REASONING_CHOICES_LINE = (
    '    parser.add_argument("--reasoning-effort", choices=["low", "medium", "high"], default=None)\n'
)
HARNESS_OPENROUTER_REASONING_CHOICES_LINE = (
    '    parser.add_argument("--reasoning-effort", choices=["none", "low", "medium", "high"], default=None)\n'
)


def parse_question_ids(raw_values: list[str] | None) -> list[str] | None:
    if not raw_values:
        return None
    out: list[str] = []
    for raw in raw_values:
        out.extend(item.strip() for item in raw.split(",") if item.strip())
    return out or None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Kavi isolated memory on LongMemEval-V2.")
    parser.add_argument("--upstream", required=True, type=Path)
    parser.add_argument("--data-root", default=os.getenv("DATA_ROOT"), type=Path)
    parser.add_argument("--domain", choices=["web", "enterprise"], required=True)
    parser.add_argument("--tier", choices=["small", "medium"], default=os.getenv("TIER", "small"))
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--question-ids", nargs="*", default=None)
    parser.add_argument("--reader-model", default=os.getenv("READER_MODEL"))
    parser.add_argument("--reader-base-url", default=os.getenv("READER_BASE_URL"))
    parser.add_argument("--reader-api-key-env", default=os.getenv("READER_API_KEY_ENV", "OPENROUTER_API_KEY"))
    parser.add_argument("--reader-temperature", type=float, default=float(os.getenv("READER_TEMPERATURE", "0.6")))
    parser.add_argument("--reader-top-p", type=float, default=float(os.getenv("READER_TOP_P", "0.95")))
    parser.add_argument("--reader-top-k", type=int, default=int(os.getenv("READER_TOP_K", "20")))
    parser.add_argument("--reader-enable-thinking", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument(
        "--reader-reasoning-effort",
        choices=["none", "low", "medium", "high"],
        default=os.getenv("READER_REASONING_EFFORT", "none"),
    )
    parser.add_argument(
        "--reader-max-concurrent-requests",
        type=int,
        default=int(os.getenv("READER_MAX_CONCURRENT_REQUESTS", "16")),
    )
    parser.add_argument("--max-completion-tokens", type=int, default=20000)
    parser.add_argument(
        "--memory-context-max-tokens",
        type=int,
        default=int(os.getenv("KAVI_LME_MEMORY_CONTEXT_MAX_TOKENS", "200000")),
    )
    parser.add_argument(
        "--prompt-build-max-workers",
        type=int,
        default=int(os.getenv("KAVI_LME_PROMPT_BUILD_MAX_WORKERS", "1")),
    )
    parser.add_argument("--evaluator-model", default=os.getenv("EVALUATOR_MODEL", "gpt-5.2"))
    parser.add_argument("--evaluator-api-key-env", default=os.getenv("EVALUATOR_API_KEY_ENV", "OPENAI_API_KEY"))
    parser.add_argument("--evaluator-reasoning-effort", choices=["low", "medium", "high"], default="medium")
    parser.add_argument("--evaluator-max-completion-tokens", type=int, default=4096)
    parser.add_argument("--node-binary", default=os.getenv("KAVI_LME_NODE_BINARY", "node"))
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def install_adapter(upstream: Path, adapter_source: Path) -> None:
    memory_dir = upstream / "memory_modules"
    require(memory_dir.is_dir(), f"Missing upstream memory_modules directory: {memory_dir}")
    target = memory_dir / "kavi_isolated_memory.py"
    shutil.copy2(adapter_source, target)
    memory_py = memory_dir / "memory.py"
    text = memory_py.read_text(encoding="utf-8")
    for legacy in [
        "from .kavi_e2e_bridge_memory import KaviE2EBridgeMemory  # noqa: E402,F401\n",
        "from .kavi_memory import KaviStructuredMemory  # noqa: E402,F401\n",
    ]:
        text = text.replace(legacy, "")
    import_line = "from .kavi_isolated_memory import KaviIsolatedMemory  # noqa: E402,F401\n"
    if import_line not in text:
        text = text.rstrip() + "\n" + import_line
    memory_py.write_text(text.rstrip() + "\n", encoding="utf-8")

    harness_py = upstream / "evaluation" / "harness.py"
    harness_text = harness_py.read_text(encoding="utf-8")
    if NONSHARED_KAVI_MEMORY_LINE not in harness_text:
        set_start = harness_text.find(NONSHARED_MEMORY_SET_START)
        require(set_start >= 0, "Unable to find LongMemEval non-shared memory type set")
        set_end = harness_text.find("}\n", set_start)
        require(set_end >= 0, "Unable to patch LongMemEval non-shared memory type set")
        harness_text = (
            harness_text[:set_end] + NONSHARED_KAVI_MEMORY_LINE + harness_text[set_end:]
        )
    if HARNESS_KAVI_ISOLATED_LINE not in harness_text:
        require(
            HARNESS_SHARED_HAYSTACK_LINE in harness_text,
            "Unable to patch LongMemEval harness shared-haystack selection for Kavi isolation",
        )
        harness_text = harness_text.replace(HARNESS_SHARED_HAYSTACK_LINE, HARNESS_KAVI_ISOLATED_LINE)
    if HARNESS_OPENROUTER_REASONING_CHOICES_LINE not in harness_text:
        require(
            HARNESS_REASONING_CHOICES_LINE in harness_text,
            "Unable to patch LongMemEval harness reader reasoning choices",
        )
        harness_text = harness_text.replace(
            HARNESS_REASONING_CHOICES_LINE,
            HARNESS_OPENROUTER_REASONING_CHOICES_LINE,
        )
    harness_py.write_text(harness_text, encoding="utf-8")


def validate_model_contract(args: argparse.Namespace) -> None:
    require(args.reader_model, "READER_MODEL or --reader-model is required")
    require(args.reader_base_url, "READER_BASE_URL or --reader-base-url is required")
    if EXPECTED_READER not in str(args.reader_model).lower():
        raise RuntimeError(
            "Production LongMemEval-V2 submission requires a reader model containing "
            f"{EXPECTED_READER!r}; got {args.reader_model!r}."
        )
    if EXPECTED_EVALUATOR not in str(args.evaluator_model).lower():
        raise RuntimeError(
            "Production LongMemEval-V2 submission requires EVALUATOR_MODEL containing "
            f"{EXPECTED_EVALUATOR!r}; got {args.evaluator_model!r}."
        )


def validate_reader_endpoint(args: argparse.Namespace) -> dict[str, Any]:
    api_key = os.getenv(args.reader_api_key_env)
    require(api_key, f"Missing reader API key in {args.reader_api_key_env}")
    base_url = str(args.reader_base_url).rstrip("/")
    request = urllib.request.Request(
        f"{base_url}/models",
        headers={"Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    model_ids = sorted(str(item.get("id", "")) for item in payload.get("data", []))
    require(
        args.reader_model in model_ids,
        f"Reader model {args.reader_model!r} was not listed by {base_url}/models",
    )
    return {"base_url": base_url, "model_count": len(model_ids), "reader_model": args.reader_model}


def build_runtime(repo_root: Path, node_binary: str) -> Path:
    bundle = repo_root / ".private" / "evals" / "runtime" / "kavi_memory_runtime.cjs"
    build_script = repo_root / "benchmarks" / "longmemeval_v2" / "build_kavi_memory_runtime.js"
    subprocess.run([node_binary, str(build_script), "--out", str(bundle)], cwd=str(repo_root), check=True)
    return bundle


def preflight(args: argparse.Namespace, upstream: Path, repo_root: Path) -> dict[str, Any]:
    validate_model_contract(args)
    reader = validate_reader_endpoint(args)
    require(os.getenv(args.evaluator_api_key_env), f"Missing evaluator API key in {args.evaluator_api_key_env}")
    adapter_source = repo_root / "benchmarks" / "longmemeval_v2" / "kavi_isolated_memory.py"
    require(upstream.is_dir(), f"Missing upstream checkout: {upstream}")
    require(adapter_source.is_file(), f"Missing adapter source: {adapter_source}")
    runtime_bundle = build_runtime(repo_root, args.node_binary)
    if args.data_root is not None:
        require(args.data_root.expanduser().resolve().is_dir(), f"Missing LongMemEval-V2 data root: {args.data_root}")
    return {
        "method": METHOD,
        "upstream": str(upstream),
        "reader": reader,
        "evaluator_model": args.evaluator_model,
        "runtime_bundle": str(runtime_bundle),
        "data_root": str(args.data_root) if args.data_root else None,
    }


def main() -> None:
    args = parse_args()
    upstream = args.upstream.expanduser().resolve()
    repo_root = Path(__file__).resolve().parents[2]
    adapter_source = repo_root / "benchmarks" / "longmemeval_v2" / "kavi_isolated_memory.py"

    preflight_result = preflight(args, upstream, repo_root)
    if args.preflight_only:
        print(json.dumps(preflight_result, indent=2, ensure_ascii=True))
        return

    require(args.data_root is not None, "DATA_ROOT or --data-root is required for an official run")
    data_root = args.data_root.expanduser().resolve()
    require(data_root.is_dir(), f"Missing LongMemEval-V2 data root: {data_root}")
    runtime_bundle = Path(preflight_result["runtime_bundle"]).resolve()
    install_adapter(upstream, adapter_source)

    if str(upstream) not in sys.path:
        sys.path.insert(0, str(upstream))
    from data.public_data import materialize_runtime_haystack, materialize_runtime_questions

    output_dir = args.output_dir.expanduser().resolve()
    if output_dir.exists() and args.force:
        shutil.rmtree(output_dir)
    require(not output_dir.exists(), f"Output directory already exists: {output_dir}")
    runtime_dir = output_dir / "runtime_inputs"
    runtime_dir.mkdir(parents=True, exist_ok=True)

    selected_questions = materialize_runtime_questions(
        data_root=data_root,
        domain=args.domain,
        question_ids=parse_question_ids(args.question_ids),
        limit=args.limit,
        output_path=runtime_dir / "questions.json",
    )
    materialize_runtime_haystack(
        data_root=data_root,
        tier=args.tier,
        selected_questions=selected_questions,
        output_path=runtime_dir / "haystack.json",
    )
    memory_config_path = runtime_dir / "memory_config.json"
    write_json(
        memory_config_path,
        {
            "memory_type": METHOD,
            "memory_params": {
                "repo_root": str(repo_root),
                "workspace_root": str((output_dir / "kavi_memory_workspaces").resolve()),
                "runtime_bundle_path": str(runtime_bundle),
                "node_binary": args.node_binary,
                "max_items": int(os.getenv("KAVI_LME_MAX_ITEMS", "12")),
                "max_item_chars": int(os.getenv("KAVI_LME_MAX_ITEM_CHARS", "5000")),
                "chunk_chars": int(os.getenv("KAVI_LME_CHUNK_CHARS", "3600")),
                "chunk_overlap_chars": int(os.getenv("KAVI_LME_CHUNK_OVERLAP_CHARS", "320")),
            },
        },
    )

    env = dict(os.environ)
    env["PYTHONPATH"] = str(upstream) + os.pathsep + env.get("PYTHONPATH", "")
    cmd = [
        sys.executable,
        str(upstream / "evaluation" / "harness.py"),
        "--domain",
        args.domain,
        "--questions-path",
        str(runtime_dir / "questions.json"),
        "--haystack-path",
        str(runtime_dir / "haystack.json"),
        "--trajectories-path",
        str(data_root / "trajectories.jsonl"),
        "--memory-config-path",
        str(memory_config_path),
        "--output-dir",
        str(output_dir),
        "--model",
        args.reader_model,
        "--base-url",
        args.reader_base_url,
        "--api-key-env",
        args.reader_api_key_env,
        "--max-completion-tokens",
        str(args.max_completion_tokens),
        "--memory-context-max-tokens",
        str(args.memory_context_max_tokens),
        "--prompt-build-max-workers",
        str(args.prompt_build_max_workers),
        "--reader-max-concurrent-requests",
        str(args.reader_max_concurrent_requests),
        "--evaluator-model",
        args.evaluator_model,
        "--evaluator-api-key-env",
        args.evaluator_api_key_env,
        "--evaluator-reasoning-effort",
        args.evaluator_reasoning_effort,
        "--evaluator-max-completion-tokens",
        str(args.evaluator_max_completion_tokens),
        "--temperature",
        str(args.reader_temperature),
        "--top-p",
        str(args.reader_top_p),
        "--top-k",
        str(args.reader_top_k),
        "--reasoning-effort",
        args.reader_reasoning_effort,
    ]
    if not args.reader_enable_thinking:
        cmd.append("--reader-disable-thinking")

    subprocess.run(cmd, cwd=str(upstream), env=env, check=True)


if __name__ == "__main__":
    main()
