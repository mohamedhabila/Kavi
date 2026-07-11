from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
import ipaddress
import re
import math


METHOD = "kavi_memory_isolated"
EXPECTED_DOMAIN_COUNTS = {"web": 240, "enterprise": 211}
EXPECTED_PROTOCOL_FIELDS: dict[str, object] = {
    "temperature": 0.6,
    "top_p": 0.95,
    "top_k": 20,
    "max_completion_tokens": 20_000,
    "memory_context_max_tokens": 200_000,
    "reader_enable_thinking": True,
    "reasoning_effort": "none",
    "evaluator_reasoning_effort": "medium",
    "evaluator_max_completion_tokens": 4_096,
    "presence_penalty": None,
    "repetition_penalty": None,
    "shuffle_questions_seed": None,
    "skip_evaluation": False,
}
PROTOCOL_IDENTITY_FIELDS = (
    "model",
    "base_url",
    "api_key_env",
    "evaluator_model",
    "evaluator_base_url",
    "evaluator_api_key_env",
    *EXPECTED_PROTOCOL_FIELDS.keys(),
)
REQUIRED_RUN_FILES = (
    "aggregated_metrics.json",
    "per_question.jsonl",
    "run_args.json",
)
REQUIRED_RUNTIME_FILES = (
    "questions.json",
    "haystack.json",
    "memory_config.json",
)
ENV_NAME_RE = re.compile(r"[A-Z][A-Z0-9_]*")
SHA256_RE = re.compile(r"[a-f0-9]{64}")
COMMIT_SHA_RE = re.compile(r"[a-f0-9]{40}")
CATEGORY_MAP = {
    "static-environment": "static",
    "static-environment-abs": "static-abs",
    "dynamic-environment": "dynamic",
    "dynamic-environment-abs": "dynamic-abs",
    "procedure": "procedure",
    "procedure-abs": "procedure-abs",
    "errors-gotchas": "gotchas",
}
NON_ABSTENTION_CATEGORIES = ("static", "dynamic", "procedure", "gotchas")
ABSTENTION_CATEGORIES = ("static-abs", "dynamic-abs", "procedure-abs")
COMBINED_ABSTENTION_CATEGORY_PAIRS = {
    "static": ("static", "static-abs"),
    "dynamic": ("dynamic", "dynamic-abs"),
    "procedure": ("procedure", "procedure-abs"),
}
PER_QUESTION_KEYS = {
    "index",
    "stream_index",
    "question_id",
    "question_type",
    "category",
    "is_abstention_problem",
    "eval_function",
    "question_text",
    "question_image",
    "haystack_ids",
    "memory_context",
    "memory_query_duration_seconds",
    "memory_post_query_duration_seconds",
    "memory_post_query_metadata",
    "memory_context_original_token_count",
    "memory_context_token_count",
    "memory_context_was_truncated",
    "prompt_messages",
    "answer_gold",
    "response_raw",
    "response_parsed_boxed",
    "is_unknown",
    "score",
    "score_bool",
    "usage",
    "timestamp_utc",
}
AGGREGATED_METRIC_KEYS = {
    "overall",
    "non_abstention_by_category",
    "abstention_by_category",
    "combined_abstention_by_category",
    "abstention_overall",
    "tokens",
    "memory_context",
    "memory_query",
    "memory_post_query",
    "completed_at_utc",
    "shared_haystack",
}
MEMORY_PARAM_KEYS = {
    "repo_root",
    "workspace_root",
    "runtime_bundle_path",
    "node_binary",
    "app_commit_sha",
    "adapter_source_sha256",
    "runtime_bundle_sha256",
    "node_version",
    "max_items",
    "max_item_chars",
    "chunk_chars",
    "chunk_overlap_chars",
    "min_score",
    "query_image_understanding",
    "query_image_model",
    "query_image_base_url",
    "query_image_api_key_env",
    "retrieval_llm_enabled",
    "retrieval_llm_model",
    "retrieval_llm_base_url",
    "retrieval_llm_api_key_env",
    "retrieval_llm_provider_family",
    "retrieval_llm_protocol",
}


class SubmissionReadinessError(RuntimeError):
    pass


@dataclass(frozen=True)
class DomainRunValidation:
    domain: str
    run_dir: Path
    question_count: int
    question_ids: tuple[str, ...]
    protocol_identity: dict[str, object]
    memory_identity: dict[str, object]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SubmissionReadinessError(message)


def read_json(path: Path) -> Any:
    require(path.is_file() and not path.is_symlink(), f"Missing regular JSON file: {path.name}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SubmissionReadinessError(f"Invalid JSON: {path.name}") from exc


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    require(path.is_file() and not path.is_symlink(), f"Missing regular JSONL file: {path.name}")
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SubmissionReadinessError(
                f"Invalid JSONL at {path.name}:{line_number}"
            ) from exc
        require(isinstance(row, dict), f"Expected object at {path.name}:{line_number}")
        rows.append(row)
    return rows


def question_id(row: dict[str, Any], label: str) -> str:
    value = row.get("id", row.get("question_id"))
    require(isinstance(value, str) and value, f"Missing question id in {label}")
    return value


def expected_runtime_questions(data_root: Path, domain: str) -> list[dict[str, Any]]:
    rows = [row for row in read_jsonl(data_root / "questions.jsonl") if row.get("domain") == domain]
    require(
        len(rows) == EXPECTED_DOMAIN_COUNTS[domain],
        f"Pinned {domain} question count changed: expected {EXPECTED_DOMAIN_COUNTS[domain]}, got {len(rows)}",
    )
    runtime_rows: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        image_value = item.pop("image", None)
        if image_value is not None:
            require(
                isinstance(image_value, str) and image_value,
                f"Invalid image path for {question_id(row, 'pinned questions')}",
            )
            image_path = data_root / image_value
            require(
                image_path.is_file() and not image_path.is_symlink(),
                f"Missing pinned question image for {question_id(row, 'pinned questions')}",
            )
            item["question"] = {
                "text": item["question"],
                "image": str(image_path.resolve()),
            }
        runtime_rows.append(item)
    return runtime_rows


def expected_runtime_haystack(
    data_root: Path,
    tier: str,
    questions: list[dict[str, Any]],
) -> dict[str, list[str]]:
    require(tier in {"small", "medium"}, f"Unsupported tier: {tier}")
    source = read_json(data_root / "haystacks" / f"lme_v2_{tier}.json")
    require(isinstance(source, dict), "Pinned haystack must be an object")
    expected: dict[str, list[str]] = {}
    for question in questions:
        identifier = question_id(question, "pinned questions")
        trajectory_ids = source.get(identifier)
        require(
            isinstance(trajectory_ids, list)
            and all(isinstance(value, str) and value for value in trajectory_ids),
            f"Invalid pinned haystack for question {identifier}",
        )
        expected[identifier] = trajectory_ids
    return expected


def require_exact_path(value: object, expected: Path, field: str) -> None:
    require(isinstance(value, str) and value, f"run_args.{field} must be a path")
    require(
        Path(value).expanduser().resolve() == expected.resolve(),
        f"run_args.{field} does not reference the expected immutable input",
    )


def require_public_https_url(value: object, field: str, *, optional: bool = False) -> None:
    if value is None and optional:
        return
    require(isinstance(value, str) and value, f"run_args.{field} must be a URL")
    parsed = urlsplit(value)
    require(
        parsed.scheme == "https"
        and parsed.hostname
        and parsed.username is None
        and parsed.password is None,
        f"run_args.{field} must use credential-free HTTPS",
    )
    hostname = str(parsed.hostname).lower()
    require(
        hostname != "localhost" and not hostname.endswith((".local", ".internal")),
        f"run_args.{field} must not use a private hostname",
    )
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return
    require(
        address.is_global,
        f"run_args.{field} must not use a private network address",
    )


def validate_protocol(run_args: dict[str, Any], domain: str) -> dict[str, object]:
    require(run_args.get("domain") == domain, f"run_args domain must be {domain}")
    model = str(run_args.get("model", "")).lower()
    evaluator_model = str(run_args.get("evaluator_model", "")).lower()
    require("qwen3.5-9b" in model, "Reader model must be Qwen3.5-9B")
    require("gpt-5.2" in evaluator_model, "Evaluator model must be GPT-5.2")
    for field, expected in EXPECTED_PROTOCOL_FIELDS.items():
        require(
            run_args.get(field) == expected,
            f"run_args.{field} must equal the official Kavi protocol value",
        )
    for field in ("api_key_env", "evaluator_api_key_env"):
        value = run_args.get(field)
        require(
            isinstance(value, str) and ENV_NAME_RE.fullmatch(value),
            f"run_args.{field} must name an environment variable",
        )
    require(run_args.get("api_key_file") is None, "Reader key files are not submission-safe")
    require(
        run_args.get("evaluator_api_key_file") is None,
        "Evaluator key files are not submission-safe",
    )
    require_public_https_url(run_args.get("base_url"), "base_url")
    require_public_https_url(
        run_args.get("evaluator_base_url"), "evaluator_base_url", optional=True
    )
    return {field: run_args.get(field) for field in PROTOCOL_IDENTITY_FIELDS}


def validate_memory_config(payload: Any) -> dict[str, object]:
    require(isinstance(payload, dict), "memory_config.json must contain an object")
    require(
        set(payload) == {"memory_type", "memory_params"},
        "memory_config.json has an unsupported schema",
    )
    require(payload.get("memory_type") == METHOD, f"memory_type must be {METHOD}")
    params = payload.get("memory_params")
    require(isinstance(params, dict), "memory_config.memory_params must be an object")
    require(set(params) == MEMORY_PARAM_KEYS, "memory_config.memory_params has an unsupported schema")

    for field in ("repo_root", "workspace_root", "runtime_bundle_path", "node_binary"):
        require(isinstance(params.get(field), str) and params[field].strip(), f"{field} is invalid")
    require(
        isinstance(params.get("app_commit_sha"), str)
        and COMMIT_SHA_RE.fullmatch(params["app_commit_sha"]) is not None,
        "app_commit_sha is invalid",
    )
    for field in ("adapter_source_sha256", "runtime_bundle_sha256"):
        require(
            isinstance(params.get(field), str) and SHA256_RE.fullmatch(params[field]) is not None,
            f"{field} is invalid",
        )
    require(
        isinstance(params.get("node_version"), str)
        and re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", params["node_version"]) is not None,
        "node_version is invalid",
    )
    max_items = params.get("max_items")
    max_item_chars = params.get("max_item_chars")
    chunk_chars = params.get("chunk_chars")
    chunk_overlap_chars = params.get("chunk_overlap_chars")
    min_score = params.get("min_score")
    require(
        isinstance(max_items, int) and not isinstance(max_items, bool) and 1 <= max_items <= 50,
        "max_items is invalid",
    )
    require(
        isinstance(max_item_chars, int)
        and not isinstance(max_item_chars, bool)
        and 200 <= max_item_chars <= 20_000,
        "max_item_chars is invalid",
    )
    require(
        isinstance(chunk_chars, int)
        and not isinstance(chunk_chars, bool)
        and 800 <= chunk_chars <= 20_000,
        "chunk_chars is invalid",
    )
    require(
        isinstance(chunk_overlap_chars, int)
        and not isinstance(chunk_overlap_chars, bool)
        and 0 <= chunk_overlap_chars < chunk_chars,
        "chunk_overlap_chars is invalid",
    )
    require(
        isinstance(min_score, (int, float))
        and not isinstance(min_score, bool)
        and math.isfinite(float(min_score))
        and 0 <= float(min_score) <= 1,
        "min_score is invalid",
    )

    query_enabled = params.get("query_image_understanding")
    query_model = params.get("query_image_model")
    require(isinstance(query_enabled, bool), "query_image_understanding is invalid")
    require(
        isinstance(query_model, str)
        and (bool(query_model.strip()) if query_enabled else not query_model.strip()),
        "query_image_model is invalid",
    )
    require_public_https_url(params.get("query_image_base_url"), "query_image_base_url")
    require(
        isinstance(params.get("query_image_api_key_env"), str)
        and ENV_NAME_RE.fullmatch(params["query_image_api_key_env"]) is not None,
        "query_image_api_key_env is invalid",
    )

    retrieval_enabled = params.get("retrieval_llm_enabled")
    retrieval_model = params.get("retrieval_llm_model")
    require(isinstance(retrieval_enabled, bool), "retrieval_llm_enabled is invalid")
    require(
        isinstance(retrieval_model, str)
        and (bool(retrieval_model.strip()) if retrieval_enabled else not retrieval_model.strip()),
        "retrieval_llm_model is invalid",
    )
    require_public_https_url(params.get("retrieval_llm_base_url"), "retrieval_llm_base_url")
    require(
        isinstance(params.get("retrieval_llm_api_key_env"), str)
        and ENV_NAME_RE.fullmatch(params["retrieval_llm_api_key_env"]) is not None,
        "retrieval_llm_api_key_env is invalid",
    )
    require(
        params.get("retrieval_llm_provider_family")
        in {
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
        },
        "retrieval_llm_provider_family is invalid",
    )
    require(
        params.get("retrieval_llm_protocol")
        in {
            "auto",
            "openai-responses",
            "openai-chat",
            "anthropic-messages",
            "gemini-native",
        },
        "retrieval_llm_protocol is invalid",
    )
    identity = {
        key: value
        for key, value in params.items()
        if key not in {"repo_root", "workspace_root", "runtime_bundle_path"}
    }
    require(identity, "memory_config must contain explicit method parameters")
    return identity


def finite_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def runtime_question_components(question: dict[str, Any]) -> tuple[str, str | None]:
    value = question.get("question")
    if isinstance(value, str):
        require(bool(value), f"Question text is empty for {question_id(question, 'runtime questions')}")
        return value, None
    require(isinstance(value, dict), "Runtime question content must be text or text plus image")
    text = value.get("text")
    image = value.get("image")
    require(isinstance(text, str) and bool(text), "Runtime question text is invalid")
    require(isinstance(image, str) and bool(image), "Runtime question image is invalid")
    return text, image


def validate_per_question_record(
    record: dict[str, Any],
    question: dict[str, Any],
    haystack_ids: list[str],
    index: int,
) -> None:
    identifier = question_id(question, "runtime questions")
    require(set(record) == PER_QUESTION_KEYS, f"Per-question record schema is invalid for {identifier}")
    question_type = question.get("question_type")
    require(
        isinstance(question_type, str) and question_type in CATEGORY_MAP,
        f"Runtime question type is invalid for {identifier}",
    )
    question_text, question_image = runtime_question_components(question)
    eval_function = question.get("eval_function")
    answer = question.get("answer")
    require(isinstance(eval_function, str) and bool(eval_function), f"Eval function is invalid for {identifier}")
    require(isinstance(answer, str), f"Gold answer is invalid for {identifier}")
    is_abstention = eval_function.split("|", 1)[0] == "llm_abstention_checker"
    expected_metadata = {
        "index": index,
        "stream_index": index,
        "question_id": identifier,
        "question_type": question_type,
        "category": CATEGORY_MAP[question_type],
        "is_abstention_problem": is_abstention,
        "eval_function": eval_function,
        "question_text": question_text,
        "question_image": question_image,
        "haystack_ids": haystack_ids,
        "answer_gold": answer,
    }
    for field, expected in expected_metadata.items():
        require(record.get(field) == expected, f"Per-question {field} mismatch for {identifier}")

    score_bool = record.get("score_bool")
    score = record.get("score")
    require(isinstance(score_bool, bool), f"score_bool is invalid for {identifier}")
    require(
        finite_number(score) and float(score) in {0.0, 1.0},
        f"score is invalid for {identifier}",
    )
    require(float(score) == float(score_bool), f"score and score_bool disagree for {identifier}")
    require(isinstance(record.get("is_unknown"), bool), f"is_unknown is invalid for {identifier}")
    require(isinstance(record.get("response_raw"), str), f"response_raw is invalid for {identifier}")
    require(
        record.get("response_parsed_boxed") is None
        or isinstance(record.get("response_parsed_boxed"), str),
        f"response_parsed_boxed is invalid for {identifier}",
    )
    require(
        isinstance(record.get("timestamp_utc"), str) and bool(record["timestamp_utc"].strip()),
        f"timestamp_utc is invalid for {identifier}",
    )
    require(isinstance(record.get("prompt_messages"), list), f"prompt_messages is invalid for {identifier}")
    memory_context = record.get("memory_context")
    require(isinstance(memory_context, list), f"memory_context is invalid for {identifier}")
    require(
        all(
            isinstance(item, dict)
            and set(item) == {"type", "value"}
            and item.get("type") == "text"
            and isinstance(item.get("value"), str)
            for item in memory_context
        ),
        f"memory_context item schema is invalid for {identifier}",
    )
    require(
        record.get("memory_post_query_metadata") is None
        or isinstance(record.get("memory_post_query_metadata"), dict),
        f"memory_post_query_metadata is invalid for {identifier}",
    )
    for field in ("memory_query_duration_seconds", "memory_post_query_duration_seconds"):
        require(
            finite_number(record.get(field)) and float(record[field]) >= 0,
            f"{field} is invalid for {identifier}",
        )
    original_tokens = record.get("memory_context_original_token_count")
    final_tokens = record.get("memory_context_token_count")
    require(
        isinstance(original_tokens, int)
        and not isinstance(original_tokens, bool)
        and original_tokens >= 0,
        f"memory_context_original_token_count is invalid for {identifier}",
    )
    require(
        isinstance(final_tokens, int)
        and not isinstance(final_tokens, bool)
        and 0 <= final_tokens <= original_tokens,
        f"memory_context_token_count is invalid for {identifier}",
    )
    require(
        record.get("memory_context_was_truncated") is (original_tokens > final_tokens),
        f"memory_context_was_truncated is invalid for {identifier}",
    )
    usage = record.get("usage")
    require(
        isinstance(usage, dict)
        and set(usage) == {"prompt_tokens", "completion_tokens", "total_tokens"},
        f"usage schema is invalid for {identifier}",
    )
    for field in ("prompt_tokens", "completion_tokens", "total_tokens"):
        require(
            isinstance(usage.get(field), int)
            and not isinstance(usage[field], bool)
            and usage[field] >= 0,
            f"usage.{field} is invalid for {identifier}",
        )
    require(
        usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"],
        f"usage totals disagree for {identifier}",
    )


def average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def metric_breakdown(records: list[dict[str, Any]]) -> dict[str, Any]:
    count = len(records)
    if count == 0:
        return {
            "count": 0,
            "pct_correct": None,
            "pct_answered_wrong": None,
            "pct_unknown": None,
        }
    unknown_count = sum(1 for record in records if record["is_unknown"])
    correct_count = sum(
        1 for record in records if record["score_bool"] and not record["is_unknown"]
    )
    wrong_count = count - correct_count - unknown_count
    return {
        "count": count,
        "pct_correct": correct_count / count,
        "pct_answered_wrong": wrong_count / count,
        "pct_unknown": unknown_count / count,
    }


def recompute_aggregated_metrics(records: list[dict[str, Any]]) -> dict[str, Any]:
    require(bool(records), "Cannot aggregate an empty per-question log")
    non_abstention = [record for record in records if not record["is_abstention_problem"]]
    abstention = [record for record in records if record["is_abstention_problem"]]
    overall = {
        "overall_full_set": average([float(record["score"]) for record in records]),
        "overall_non_abstention_only": average(
            [float(record["score"]) for record in non_abstention]
        ),
        "overall_abstention_only": average([float(record["score"]) for record in abstention]),
        "count_all_questions": len(records),
        "count_non_abstention": len(non_abstention),
        "count_abstention": len(abstention),
    }
    non_abstention_by_category = {
        category: metric_breakdown(
            [record for record in non_abstention if record["category"] == category]
        )
        for category in NON_ABSTENTION_CATEGORIES
    }
    abstention_by_category = {
        category: metric_breakdown(
            [record for record in abstention if record["category"] == category]
        )
        for category in ABSTENTION_CATEGORIES
    }
    combined_abstention_by_category = {
        category: metric_breakdown(
            [record for record in records if record["category"] in pair]
        )
        for category, pair in COMBINED_ABSTENTION_CATEGORY_PAIRS.items()
    }

    prompt_tokens = sum(record["usage"]["prompt_tokens"] for record in records)
    completion_tokens = sum(record["usage"]["completion_tokens"] for record in records)
    original_memory_tokens = sum(
        record["memory_context_original_token_count"] for record in records
    )
    final_memory_tokens = sum(record["memory_context_token_count"] for record in records)
    query_durations = [float(record["memory_query_duration_seconds"]) for record in records]
    post_query_durations = [
        float(record["memory_post_query_duration_seconds"]) for record in records
    ]

    def duration_metrics(values: list[float]) -> dict[str, float]:
        ordered = sorted(values)
        total = sum(values)
        return {
            "avg_seconds": total / len(values),
            "p50_seconds": ordered[len(ordered) // 2],
            "p95_seconds": ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))],
            "max_seconds": ordered[-1],
            "total_seconds": total,
        }

    return {
        "overall": overall,
        "non_abstention_by_category": non_abstention_by_category,
        "abstention_by_category": abstention_by_category,
        "combined_abstention_by_category": combined_abstention_by_category,
        "abstention_overall": metric_breakdown(abstention),
        "tokens": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "avg_prompt_tokens": prompt_tokens / len(records),
            "avg_completion_tokens": completion_tokens / len(records),
            "avg_total_tokens": (prompt_tokens + completion_tokens) / len(records),
        },
        "memory_context": {
            "avg_original_tokens": original_memory_tokens / len(records),
            "avg_final_tokens": final_memory_tokens / len(records),
            "num_truncated_sequences": sum(
                int(record["memory_context_was_truncated"]) for record in records
            ),
        },
        "memory_query": duration_metrics(query_durations),
        "memory_post_query": duration_metrics(post_query_durations),
    }


def validate_aggregated_metrics(metrics: Any, records: list[dict[str, Any]], domain: str) -> None:
    require(isinstance(metrics, dict), "aggregated_metrics.json must contain an object")
    require(set(metrics) == AGGREGATED_METRIC_KEYS, "aggregated_metrics.json has an unsupported schema")
    require(
        isinstance(metrics.get("completed_at_utc"), str)
        and bool(metrics["completed_at_utc"].strip()),
        "aggregated_metrics.completed_at_utc is invalid",
    )
    require(metrics.get("shared_haystack") is False, "Kavi runs must use isolated per-question memory")
    recomputed = recompute_aggregated_metrics(records)
    for field, expected in recomputed.items():
        require(
            metrics.get(field) == expected,
            f"{domain} aggregate field {field} does not match per-question evidence",
        )


def validate_domain_run(
    run_dir: Path,
    data_root: Path,
    domain: str,
    tier: str,
) -> DomainRunValidation:
    require(domain in EXPECTED_DOMAIN_COUNTS, f"Unsupported domain: {domain}")
    run_dir = run_dir.expanduser().resolve()
    data_root = data_root.expanduser().resolve()
    require(run_dir.is_dir(), f"Missing {domain} run directory")
    for filename in REQUIRED_RUN_FILES:
        require(
            (run_dir / filename).is_file() and not (run_dir / filename).is_symlink(),
            f"Missing regular {domain} run file: {filename}",
        )
    runtime_dir = run_dir / "runtime_inputs"
    require(runtime_dir.is_dir() and not runtime_dir.is_symlink(), "Missing runtime_inputs")
    for filename in REQUIRED_RUNTIME_FILES:
        require(
            (runtime_dir / filename).is_file()
            and not (runtime_dir / filename).is_symlink(),
            f"Missing regular {domain} runtime input: {filename}",
        )

    expected_questions = expected_runtime_questions(data_root, domain)
    actual_questions = read_json(runtime_dir / "questions.json")
    require(isinstance(actual_questions, list), "runtime questions must be a list")
    require(
        actual_questions == expected_questions,
        f"{domain} runtime questions do not exactly match the complete pinned release",
    )
    expected_haystack = expected_runtime_haystack(data_root, tier, expected_questions)
    require(
        read_json(runtime_dir / "haystack.json") == expected_haystack,
        f"{domain} runtime haystack does not exactly match the pinned {tier} tier",
    )

    run_args = read_json(run_dir / "run_args.json")
    require(isinstance(run_args, dict), "run_args.json must contain an object")
    require_exact_path(run_args.get("output_dir"), run_dir, "output_dir")
    require_exact_path(run_args.get("questions_path"), runtime_dir / "questions.json", "questions_path")
    require_exact_path(run_args.get("haystack_path"), runtime_dir / "haystack.json", "haystack_path")
    require_exact_path(
        run_args.get("memory_config_path"),
        runtime_dir / "memory_config.json",
        "memory_config_path",
    )
    require_exact_path(
        run_args.get("trajectories_path"),
        data_root / "trajectories.jsonl",
        "trajectories_path",
    )
    protocol_identity = validate_protocol(run_args, domain)
    memory_identity = validate_memory_config(read_json(runtime_dir / "memory_config.json"))

    records = read_jsonl(run_dir / "per_question.jsonl")
    question_ids = [question_id(row, "runtime questions") for row in expected_questions]
    record_ids = [question_id(row, "per_question.jsonl") for row in records]
    require(
        len(record_ids) == len(set(record_ids)),
        f"{domain} per-question output contains duplicate ids",
    )
    require(
        Counter(record_ids) == Counter(question_ids),
        f"{domain} per-question output does not cover the complete released set",
    )
    require(
        record_ids == question_ids,
        f"{domain} per-question output order does not match the unshuffled official stream",
    )
    for index, (record, question) in enumerate(zip(records, expected_questions, strict=True)):
        validate_per_question_record(
            record,
            question,
            expected_haystack[question_ids[index]],
            index,
        )
    validate_aggregated_metrics(
        read_json(run_dir / "aggregated_metrics.json"), records, domain
    )
    return DomainRunValidation(
        domain=domain,
        run_dir=run_dir,
        question_count=len(question_ids),
        question_ids=tuple(sorted(question_ids)),
        protocol_identity=protocol_identity,
        memory_identity=memory_identity,
    )


def validate_run_pair(web: DomainRunValidation, enterprise: DomainRunValidation) -> None:
    require(web.domain == "web", "First validated run must be web")
    require(enterprise.domain == "enterprise", "Second validated run must be enterprise")
    require(
        web.protocol_identity == enterprise.protocol_identity,
        "Web and enterprise runs use different reader or evaluator protocols",
    )
    require(
        web.memory_identity == enterprise.memory_identity,
        "Web and enterprise runs use different Kavi memory parameters",
    )


def validate_frozen_runtime_identity(
    run: DomainRunValidation,
    *,
    app_commit_sha: str,
    adapter_source_sha256: str,
    runtime_bundle_sha256: str,
    node_version: str,
) -> None:
    expected = {
        "app_commit_sha": app_commit_sha,
        "adapter_source_sha256": adapter_source_sha256,
        "runtime_bundle_sha256": runtime_bundle_sha256,
        "node_version": node_version,
    }
    for field, value in expected.items():
        require(
            run.memory_identity.get(field) == value,
            f"{run.domain} run {field} does not match the frozen candidate runtime",
        )
