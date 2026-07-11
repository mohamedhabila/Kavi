#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any
import urllib.request
from urllib.parse import urlsplit


METHOD = "kavi_memory_isolated"
UPSTREAM_COMMIT = "be15ea6e995462f3391c1a610892df3f67dfa7bd"
DATA_REVISION = "f152293e235517d504809563c833d7190b8c713b"
DATA_CHECKSUM_MANIFEST_SHA256 = (
    "b17a18daa52873f915808502217c3c5fab39d20638544f986401155c9e8d67a6"
)
EXPECTED_READER = "qwen3.5-9b"
EXPECTED_EVALUATOR = "gpt-5.2"
DEFAULT_AUXILIARY_BASE_URL = "https://api.openai.com/v1"
ENV_NAME_RE = re.compile(r"[A-Z][A-Z0-9_]*")
SHA256_RE = re.compile(r"[a-f0-9]{64}")
COMMIT_SHA_RE = re.compile(r"[a-f0-9]{40}")
RETRIEVAL_PROVIDER_FAMILIES = {
    "openai",
    "openrouter",
    "deepseek",
    "qwen",
    "kimi",
    "mistral",
    "voyage",
    "anthropic",
    "gemini",
    "ollama",
    "custom",
}
RETRIEVAL_PROTOCOLS = {
    "auto",
    "openai-responses",
    "openai-chat",
    "anthropic-messages",
    "gemini-native",
}
REQUIRED_SCORE_DATA_FILES = {
    "questions.jsonl",
    "trajectories.jsonl",
    "haystacks/lme_v2_small.json",
    "haystacks/lme_v2_medium.json",
}
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
HARNESS_QWEN_THINKING_EXACT_MODEL_LINE = (
    '    if args.base_url and args.model == "Qwen/Qwen3.5-9B" and not args.reader_enable_thinking:\n'
)
HARNESS_QWEN_THINKING_MODEL_ID_LINE = (
    '    if args.base_url and "qwen3.5-9b" in str(args.model).lower() and not args.reader_enable_thinking:\n'
)
HARNESS_MALFORMED_PREMISE_BOXED_LINE = (
    '        "explanation in \\boxed{} explaining why the question is flawed."\n'
)
HARNESS_ESCAPED_PREMISE_BOXED_LINE = (
    '        "explanation in \\\\boxed{} explaining why the question is flawed."\n'
)


def parse_question_ids(raw_values: list[str] | None) -> list[str] | None:
    if not raw_values:
        return None
    out: list[str] = []
    for raw in raw_values:
        out.extend(item.strip() for item in raw.split(",") if item.strip())
    return out or None


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be an explicit boolean")


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
    parser.add_argument("--reader-enable-thinking", action=argparse.BooleanOptionalAction, default=True)
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
    parser.add_argument(
        "--memory-max-items", type=int, default=int(os.getenv("KAVI_LME_MAX_ITEMS", "12"))
    )
    parser.add_argument(
        "--memory-max-item-chars",
        type=int,
        default=int(os.getenv("KAVI_LME_MAX_ITEM_CHARS", "5000")),
    )
    parser.add_argument(
        "--memory-chunk-chars",
        type=int,
        default=int(os.getenv("KAVI_LME_CHUNK_CHARS", "3600")),
    )
    parser.add_argument(
        "--memory-chunk-overlap-chars",
        type=int,
        default=int(os.getenv("KAVI_LME_CHUNK_OVERLAP_CHARS", "320")),
    )
    parser.add_argument(
        "--memory-min-score",
        type=float,
        default=float(os.getenv("KAVI_LME_MIN_SCORE", "0.01")),
    )
    parser.add_argument(
        "--query-image-understanding",
        action=argparse.BooleanOptionalAction,
        default=env_bool("KAVI_LME_QUERY_IMAGE_UNDERSTANDING", False),
    )
    parser.add_argument("--query-image-model", default=os.getenv("KAVI_LME_QUERY_IMAGE_MODEL", ""))
    parser.add_argument(
        "--query-image-base-url",
        default=os.getenv("KAVI_LME_QUERY_IMAGE_BASE_URL", DEFAULT_AUXILIARY_BASE_URL),
    )
    parser.add_argument(
        "--query-image-api-key-env",
        default=os.getenv("KAVI_LME_QUERY_IMAGE_API_KEY_ENV", "OPENAI_API_KEY"),
    )
    parser.add_argument(
        "--retrieval-llm-enabled",
        action=argparse.BooleanOptionalAction,
        default=env_bool("KAVI_LME_RETRIEVAL_LLM_ENABLED", False),
    )
    parser.add_argument(
        "--retrieval-llm-model", default=os.getenv("KAVI_LME_RETRIEVAL_LLM_MODEL", "")
    )
    parser.add_argument(
        "--retrieval-llm-base-url",
        default=os.getenv("KAVI_LME_RETRIEVAL_LLM_BASE_URL", DEFAULT_AUXILIARY_BASE_URL),
    )
    parser.add_argument(
        "--retrieval-llm-api-key-env",
        default=os.getenv("KAVI_LME_RETRIEVAL_LLM_API_KEY_ENV", "OPENAI_API_KEY"),
    )
    parser.add_argument(
        "--retrieval-llm-provider-family",
        choices=sorted(RETRIEVAL_PROVIDER_FAMILIES),
        default=os.getenv("KAVI_LME_RETRIEVAL_LLM_PROVIDER_FAMILY", "openai"),
    )
    parser.add_argument(
        "--retrieval-llm-protocol",
        choices=sorted(RETRIEVAL_PROTOCOLS),
        default=os.getenv("KAVI_LME_RETRIEVAL_LLM_PROTOCOL", "openai-responses"),
    )
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def run_git(upstream: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", *args],
        cwd=upstream,
        check=True,
        capture_output=True,
    )


def git_text(repo_root: Path, *args: str) -> str:
    return run_git(repo_root, *args).stdout.decode("utf-8").strip()


def require_clean_app(repo_root: Path) -> str:
    commit = git_text(repo_root, "rev-parse", "HEAD")
    require(COMMIT_SHA_RE.fullmatch(commit) is not None, "Kavi app commit is invalid")
    status = git_text(repo_root, "status", "--porcelain=v1", "--untracked-files=all")
    require(not status, "LongMemEval-V2 upstream-protocol work requires a clean app worktree")
    return commit


def load_longmemeval_provenance(repo_root: Path) -> dict[str, Any]:
    payload = json.loads(
        (repo_root / "evaluation" / "benchmark-provenance.json").read_text(encoding="utf-8")
    )
    adapters = payload.get("adapters") if isinstance(payload, dict) else None
    require(isinstance(adapters, list), "Benchmark provenance adapters are missing")
    matches = [
        item
        for item in adapters
        if isinstance(item, dict) and item.get("id") == "longmemeval-v2"
    ]
    require(len(matches) == 1, "LongMemEval-V2 provenance must contain exactly one adapter")
    adapter = matches[0]
    adapter_source = adapter.get("adapter")
    require(
        isinstance(adapter_source, dict),
        "LongMemEval-V2 upstream-protocol adapter provenance is missing",
    )
    require(
        adapter_source.get("sourceDigestAlgorithm")
        == "sha256_versionable_path_nul_bytes_nul_v2",
        "LongMemEval-V2 upstream-protocol adapter digest algorithm is unsupported",
    )
    source_sha256 = adapter_source.get("sourceSha256")
    require(
        isinstance(source_sha256, str) and SHA256_RE.fullmatch(source_sha256) is not None,
        "LongMemEval-V2 upstream-protocol adapter source digest is invalid",
    )
    return adapter


def upstream_file(upstream: Path, relative_path: str) -> str:
    return run_git(upstream, "show", f"{UPSTREAM_COMMIT}:{relative_path}").stdout.decode(
        "utf-8"
    )


def render_memory_registry(base_text: str) -> str:
    text = base_text
    import_line = "from .kavi_isolated_memory import KaviIsolatedMemory  # noqa: E402,F401\n"
    if import_line not in text:
        text = text.rstrip() + "\n" + import_line
    return text.rstrip() + "\n"


def render_harness(base_text: str) -> str:
    harness_text = base_text
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
    if HARNESS_QWEN_THINKING_EXACT_MODEL_LINE in harness_text:
        harness_text = harness_text.replace(
            HARNESS_QWEN_THINKING_EXACT_MODEL_LINE,
            HARNESS_QWEN_THINKING_MODEL_ID_LINE,
        )
    if HARNESS_MALFORMED_PREMISE_BOXED_LINE in harness_text:
        harness_text = harness_text.replace(
            HARNESS_MALFORMED_PREMISE_BOXED_LINE,
            HARNESS_ESCAPED_PREMISE_BOXED_LINE,
        )
    return harness_text


def expected_installation(upstream: Path, adapter_source: Path) -> dict[str, bytes]:
    return {
        "evaluation/harness.py": render_harness(
            upstream_file(upstream, "evaluation/harness.py")
        ).encode("utf-8"),
        "memory_modules/memory.py": render_memory_registry(
            upstream_file(upstream, "memory_modules/memory.py")
        ).encode("utf-8"),
        "memory_modules/kavi_isolated_memory.py": adapter_source.read_bytes(),
    }


def verify_upstream(upstream: Path, adapter_source: Path) -> str:
    require((upstream / ".git").exists(), f"LongMemEval-V2 checkout not found: {upstream}")
    head = run_git(upstream, "rev-parse", "HEAD").stdout.decode("ascii").strip()
    require(
        head == UPSTREAM_COMMIT,
        f"LongMemEval-V2 must be pinned to {UPSTREAM_COMMIT}; found {head}",
    )
    status = run_git(
        upstream, "status", "--porcelain=v1", "--untracked-files=all"
    ).stdout.decode("utf-8").splitlines()
    if not status:
        return "clean_base"

    expected = expected_installation(upstream, adapter_source)
    allowed_paths = set(expected)
    changed_paths = {line[3:] for line in status if len(line) >= 4}
    require(
        changed_paths == allowed_paths,
        "LongMemEval-V2 checkout must be clean or contain only the exact installed "
        f"Kavi adapter patch; found {sorted(changed_paths)}",
    )
    for relative_path, expected_bytes in expected.items():
        installed = upstream / relative_path
        require(
            installed.is_file() and installed.read_bytes() == expected_bytes,
            "Installed LongMemEval-V2 upstream-protocol adapter differs from the pinned "
            f"patch: {relative_path}",
        )
    return "exact_adapter_patch"


def install_adapter(upstream: Path, adapter_source: Path) -> None:
    for relative_path, content in expected_installation(upstream, adapter_source).items():
        target = upstream / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_public_https_url(value: object, field: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{field} must be a URL")
    normalized = value.strip().rstrip("/")
    parsed = urlsplit(normalized)
    require(
        parsed.scheme == "https"
        and parsed.hostname is not None
        and parsed.username is None
        and parsed.password is None,
        f"{field} must use credential-free HTTPS",
    )
    hostname = str(parsed.hostname).lower()
    require(
        hostname != "localhost" and not hostname.endswith((".local", ".internal")),
        f"{field} must not use a private hostname",
    )
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return normalized
    require(address.is_global, f"{field} must not use a private network address")
    return normalized


def require_env_name(value: object, field: str) -> str:
    require(
        isinstance(value, str) and ENV_NAME_RE.fullmatch(value.strip()) is not None,
        f"{field} must name an environment variable",
    )
    return value.strip()


def node_version(node_binary: str) -> str:
    result = subprocess.run(
        [node_binary, "--version"], check=True, capture_output=True, text=True
    )
    version = result.stdout.strip()
    require(bool(re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", version)), "Node version is invalid")
    return version


def resolve_effective_memory_params(
    args: argparse.Namespace,
    *,
    app_commit_sha: str,
    adapter_source_sha256: str,
    runtime_bundle_sha256: str,
    resolved_node_version: str,
) -> dict[str, object]:
    require(1 <= args.memory_max_items <= 50, "memory_max_items must be between 1 and 50")
    require(
        200 <= args.memory_max_item_chars <= 20_000,
        "memory_max_item_chars must be between 200 and 20000",
    )
    require(
        800 <= args.memory_chunk_chars <= 20_000,
        "memory_chunk_chars must be between 800 and 20000",
    )
    require(
        0 <= args.memory_chunk_overlap_chars < args.memory_chunk_chars,
        "memory_chunk_overlap_chars must be non-negative and smaller than memory_chunk_chars",
    )
    require(0 <= args.memory_min_score <= 1, "memory_min_score must be between 0 and 1")
    require(COMMIT_SHA_RE.fullmatch(app_commit_sha) is not None, "app_commit_sha is invalid")
    require(
        SHA256_RE.fullmatch(adapter_source_sha256) is not None,
        "adapter_source_sha256 is invalid",
    )
    require(
        SHA256_RE.fullmatch(runtime_bundle_sha256) is not None,
        "runtime_bundle_sha256 is invalid",
    )

    query_image_enabled = bool(args.query_image_understanding)
    query_image_model = str(args.query_image_model or "").strip()
    if query_image_enabled:
        require(bool(query_image_model), "query_image_model is required when image understanding is enabled")
    else:
        require(
            not query_image_model,
            "query_image_model must be empty when image understanding is disabled",
        )
    query_image_base_url = require_public_https_url(
        args.query_image_base_url, "query_image_base_url"
    )
    query_image_api_key_env = require_env_name(
        args.query_image_api_key_env, "query_image_api_key_env"
    )
    if query_image_enabled:
        require(
            bool(os.getenv(query_image_api_key_env)),
            f"Missing query-image API key in {query_image_api_key_env}",
        )

    retrieval_enabled = bool(args.retrieval_llm_enabled)
    retrieval_model = str(args.retrieval_llm_model or "").strip()
    if retrieval_enabled:
        require(bool(retrieval_model), "retrieval_llm_model is required when retrieval LLM is enabled")
    else:
        require(
            not retrieval_model,
            "retrieval_llm_model must be empty when retrieval LLM is disabled",
        )
    retrieval_base_url = require_public_https_url(
        args.retrieval_llm_base_url, "retrieval_llm_base_url"
    )
    retrieval_api_key_env = require_env_name(
        args.retrieval_llm_api_key_env, "retrieval_llm_api_key_env"
    )
    require(
        args.retrieval_llm_provider_family in RETRIEVAL_PROVIDER_FAMILIES,
        "retrieval_llm_provider_family is unsupported",
    )
    require(
        args.retrieval_llm_protocol in RETRIEVAL_PROTOCOLS,
        "retrieval_llm_protocol is unsupported",
    )
    if retrieval_enabled:
        require(
            bool(os.getenv(retrieval_api_key_env)),
            f"Missing retrieval LLM API key in {retrieval_api_key_env}",
        )

    return {
        "app_commit_sha": app_commit_sha,
        "adapter_source_sha256": adapter_source_sha256,
        "runtime_bundle_sha256": runtime_bundle_sha256,
        "node_version": resolved_node_version,
        "max_items": args.memory_max_items,
        "max_item_chars": args.memory_max_item_chars,
        "chunk_chars": args.memory_chunk_chars,
        "chunk_overlap_chars": args.memory_chunk_overlap_chars,
        "min_score": args.memory_min_score,
        "query_image_understanding": query_image_enabled,
        "query_image_model": query_image_model,
        "query_image_base_url": query_image_base_url,
        "query_image_api_key_env": query_image_api_key_env,
        "retrieval_llm_enabled": retrieval_enabled,
        "retrieval_llm_model": retrieval_model,
        "retrieval_llm_base_url": retrieval_base_url,
        "retrieval_llm_api_key_env": retrieval_api_key_env,
        "retrieval_llm_provider_family": args.retrieval_llm_provider_family,
        "retrieval_llm_protocol": args.retrieval_llm_protocol,
    }


def verify_data_snapshot(data_root: Path) -> dict[str, Any]:
    checksum_manifest = data_root / "checksums.sha256"
    require(checksum_manifest.is_file(), f"Missing dataset checksum manifest: {checksum_manifest}")
    digest = hashlib.sha256(checksum_manifest.read_bytes()).hexdigest()
    require(
        digest == DATA_CHECKSUM_MANIFEST_SHA256,
        "LongMemEval-V2 dataset checksum manifest does not match the pinned revision",
    )
    verified_files = 0
    verified_paths: set[str] = set()
    skipped_metadata_files = 0
    data_root_resolved = data_root.resolve()
    for line_number, raw_line in enumerate(
        checksum_manifest.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not raw_line.strip():
            continue
        parts = raw_line.split("  ", maxsplit=1)
        require(
            len(parts) == 2
            and len(parts[0]) == 64
            and all(character in "0123456789abcdef" for character in parts[0]),
            f"Invalid dataset checksum entry at line {line_number}",
        )
        relative_path = Path(parts[1])
        require(
            not relative_path.is_absolute() and ".." not in relative_path.parts,
            f"Unsafe dataset checksum path at line {line_number}",
        )
        relative_name = relative_path.as_posix()
        if (
            relative_name not in REQUIRED_SCORE_DATA_FILES
            and not relative_name.startswith("question_screenshots/")
        ):
            skipped_metadata_files += 1
            continue
        snapshot_file = data_root / relative_path
        resolved_file = snapshot_file.resolve()
        current_path = data_root
        contains_symlink = False
        for path_part in relative_path.parts:
            current_path = current_path / path_part
            contains_symlink = contains_symlink or current_path.is_symlink()
        require(
            resolved_file != data_root_resolved
            and data_root_resolved in resolved_file.parents
            and snapshot_file.is_file()
            and not contains_symlink,
            f"Missing or unsafe dataset file listed at line {line_number}",
        )
        actual_digest = sha256_file(snapshot_file)
        require(
            actual_digest == parts[0],
            f"Dataset file checksum mismatch at line {line_number}: {relative_path.as_posix()}",
        )
        verified_files += 1
        verified_paths.add(relative_name)
    require(verified_files > 0, "Dataset checksum manifest is empty")
    missing_score_files = sorted(REQUIRED_SCORE_DATA_FILES - verified_paths)
    require(
        not missing_score_files,
        f"Dataset checksum manifest is missing score-bearing files: {missing_score_files}",
    )
    return {
        "repository": "https://huggingface.co/datasets/xiaowu0162/longmemeval-v2",
        "revision": DATA_REVISION,
        "checksum_manifest_sha256": digest,
        "verified_files": verified_files,
        "skipped_metadata_files": skipped_metadata_files,
    }


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
    adapter_source = repo_root / "benchmarks" / "longmemeval_v2" / "kavi_isolated_memory.py"
    require(adapter_source.is_file(), f"Missing adapter source: {adapter_source}")
    app_commit_sha = require_clean_app(repo_root)
    subprocess.run(["npm", "run", "check:evaluation-contract"], cwd=repo_root, check=True)
    provenance = load_longmemeval_provenance(repo_root)
    adapter_provenance = provenance["adapter"]
    upstream_state = verify_upstream(upstream, adapter_source)
    validate_model_contract(args)
    reader = validate_reader_endpoint(args)
    require(os.getenv(args.evaluator_api_key_env), f"Missing evaluator API key in {args.evaluator_api_key_env}")
    runtime_bundle = build_runtime(repo_root, args.node_binary)
    runtime_bundle_sha256 = sha256_file(runtime_bundle)
    resolved_node_version = node_version(args.node_binary)
    memory_params = resolve_effective_memory_params(
        args,
        app_commit_sha=app_commit_sha,
        adapter_source_sha256=adapter_provenance["sourceSha256"],
        runtime_bundle_sha256=runtime_bundle_sha256,
        resolved_node_version=resolved_node_version,
    )
    require(
        require_clean_app(repo_root) == app_commit_sha,
        "Kavi app revision changed during LongMemEval-V2 preflight",
    )
    data_snapshot = None
    if args.data_root is not None:
        data_root = args.data_root.expanduser().resolve()
        require(data_root.is_dir(), f"Missing LongMemEval-V2 data root: {args.data_root}")
        data_snapshot = verify_data_snapshot(data_root)
    return {
        "method": METHOD,
        "upstream": str(upstream),
        "upstream_commit": UPSTREAM_COMMIT,
        "upstream_state": upstream_state,
        "reader": reader,
        "evaluator_model": args.evaluator_model,
        "runtime_bundle": str(runtime_bundle),
        "memory_params": memory_params,
        "data_root": str(args.data_root) if args.data_root else None,
        "data_snapshot": data_snapshot,
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
    frozen_memory_params = dict(preflight_result["memory_params"])
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
                **frozen_memory_params,
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
