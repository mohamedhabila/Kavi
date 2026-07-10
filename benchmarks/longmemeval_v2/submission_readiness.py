from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
import ipaddress
import re


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
    require(parsed.scheme == "https" and parsed.hostname, f"run_args.{field} must use HTTPS")
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
    require(payload.get("memory_type") == METHOD, f"memory_type must be {METHOD}")
    params = payload.get("memory_params")
    require(isinstance(params, dict), "memory_config.memory_params must be an object")
    identity = {
        key: value
        for key, value in params.items()
        if key not in {"repo_root", "workspace_root", "runtime_bundle_path"}
    }
    require(identity, "memory_config must contain explicit method parameters")
    return identity


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
    metrics = read_json(run_dir / "aggregated_metrics.json")
    require(isinstance(metrics, dict), "aggregated_metrics.json must contain an object")
    overall = metrics.get("overall")
    require(isinstance(overall, dict), "aggregated_metrics.overall must be an object")
    require(
        overall.get("count_all_questions") == EXPECTED_DOMAIN_COUNTS[domain],
        f"{domain} aggregate count does not cover the complete released set",
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
