from __future__ import annotations

from dataclasses import dataclass
import hashlib
import ipaddress
import json
from pathlib import Path
import re
from typing import Any, Iterable
from urllib.parse import urlsplit

from submission_readiness import (
    REQUIRED_RUN_FILES,
    REQUIRED_RUNTIME_FILES,
    SubmissionReadinessError,
    require,
)


TEXT_PACKAGE_SUFFIXES = {".json", ".jsonl", ".md", ".py"}
SENSITIVE_VALUE_KEYS = {
    "access_token",
    "api_key",
    "authorization",
    "password",
    "refresh_token",
    "secret",
}
SECRET_PATTERNS = (
    ("provider_credential", re.compile(r"\bsk(?:-proj|-or-v1)?-[A-Za-z0-9_-]{16,}\b")),
    ("bearer_credential", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}")),
    (
        "signed_url",
        re.compile(
            r"(?i)[?&](?:api[_-]?key|signature|sig|token|x-amz-signature)="
            r"[^&#\s]{8,}"
        ),
    ),
)
LOCAL_PATH_PATTERNS = (
    re.compile(r"(?<![A-Za-z0-9])/(?:Users|home|tmp)/[^\s\"']+"),
    re.compile(r"(?<![A-Za-z0-9])/private/var/[^\s\"']+"),
    re.compile(r"(?i)\b[A-Z]:\\Users\\[^\s\"']+"),
)
NETWORK_FIELD_MARKERS = ("base_url", "endpoint", "host", "url")


@dataclass(frozen=True)
class SanitizationReport:
    files_written: int
    path_replacements: int


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def required_run_paths(run_dir: Path) -> list[Path]:
    paths = [run_dir / filename for filename in REQUIRED_RUN_FILES]
    runtime_dir = run_dir / "runtime_inputs"
    paths.extend(runtime_dir / filename for filename in REQUIRED_RUNTIME_FILES)
    for path in paths:
        require(
            path.is_file() and not path.is_symlink(),
            f"Submission input must be a regular file: {path.name}",
        )
    runtime_entries = list(runtime_dir.iterdir())
    actual_runtime_files = {path.name for path in runtime_entries}
    require(
        actual_runtime_files == set(REQUIRED_RUNTIME_FILES)
        and all(path.is_file() and not path.is_symlink() for path in runtime_entries),
        "runtime_inputs must contain exactly the official Kavi runtime files",
    )
    return sorted(paths, key=lambda path: path.relative_to(run_dir).as_posix())


def run_artifact_sha256(run_dir: Path) -> str:
    run_dir = run_dir.resolve()
    digest = hashlib.sha256()
    for path in required_run_paths(run_dir):
        relative = path.relative_to(run_dir).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def tree_sha256(root: Path) -> str:
    root = root.resolve()
    require(root.is_dir(), "Hash root must be a directory")
    paths = sorted(root.rglob("*"), key=lambda path: path.relative_to(root).as_posix())
    require(all(not path.is_symlink() for path in paths), "Submission tree contains a symlink")
    files = [path for path in paths if path.is_file()]
    require(files, "Submission tree contains no files")
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def path_replacements(roots: Iterable[tuple[Path, str]]) -> tuple[tuple[str, str], ...]:
    values: list[tuple[str, str]] = []
    seen: set[str] = set()
    for root, placeholder in roots:
        expanded = root.expanduser().absolute()
        resolved = expanded.resolve()
        for candidate in (expanded, resolved):
            for source in (candidate.as_uri(), str(candidate)):
                if source not in seen:
                    values.append((source, placeholder))
                    seen.add(source)
    return tuple(sorted(values, key=lambda item: len(item[0]), reverse=True))


def require_safe_network_value(value: str, field_path: str) -> None:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return
    hostname = str(parsed.hostname).lower()
    if hostname == "localhost" or hostname.endswith((".local", ".internal")):
        raise SubmissionReadinessError(
            f"Private network value remains at {field_path}"
        )
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return
    if not address.is_global:
        raise SubmissionReadinessError(
            f"Private network value remains at {field_path}"
        )


def sanitize_string(
    value: str,
    field_path: str,
    replacements: tuple[tuple[str, str], ...],
) -> tuple[str, int]:
    sanitized = value
    replacement_count = 0
    for source, placeholder in replacements:
        occurrences = sanitized.count(source)
        if occurrences:
            sanitized = sanitized.replace(source, placeholder)
            replacement_count += occurrences
    for name, pattern in SECRET_PATTERNS:
        if pattern.search(sanitized):
            raise SubmissionReadinessError(f"Rejected {name} at {field_path}")
    if "file://" in sanitized.lower():
        raise SubmissionReadinessError(f"Unmapped file URL remains at {field_path}")
    if any(pattern.search(sanitized) for pattern in LOCAL_PATH_PATTERNS):
        raise SubmissionReadinessError(f"Unmapped local path remains at {field_path}")
    if any(marker in field_path.lower().split(".")[-1] for marker in NETWORK_FIELD_MARKERS):
        require_safe_network_value(sanitized, field_path)
    return sanitized, replacement_count


def sanitize_value(
    value: Any,
    field_path: str,
    replacements: tuple[tuple[str, str], ...],
) -> tuple[Any, int]:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        replacements_made = 0
        for key, child in value.items():
            require(isinstance(key, str), f"Non-string object key at {field_path}")
            child_path = f"{field_path}.{key}"
            if key.lower() in SENSITIVE_VALUE_KEYS and child is not None and child != "":
                raise SubmissionReadinessError(
                    f"Explicit sensitive value remains at {child_path}"
                )
            sanitized_child, child_replacements = sanitize_value(
                child, child_path, replacements
            )
            out[key] = sanitized_child
            replacements_made += child_replacements
        return out, replacements_made
    if isinstance(value, list):
        out_list: list[Any] = []
        replacements_made = 0
        for index, child in enumerate(value):
            sanitized_child, child_replacements = sanitize_value(
                child, f"{field_path}[{index}]", replacements
            )
            out_list.append(sanitized_child)
            replacements_made += child_replacements
        return out_list, replacements_made
    if isinstance(value, str):
        return sanitize_string(value, field_path, replacements)
    return value, 0


def sanitize_json_file(
    source: Path,
    target: Path,
    replacements: tuple[tuple[str, str], ...],
) -> int:
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SubmissionReadinessError(f"Invalid JSON during staging: {source.name}") from exc
    sanitized, replacement_count = sanitize_value(payload, source.name, replacements)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(sanitized, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    target.chmod(0o600)
    return replacement_count


def sanitize_jsonl_file(
    source: Path,
    target: Path,
    replacements: tuple[tuple[str, str], ...],
) -> int:
    rows: list[str] = []
    replacement_count = 0
    for line_number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SubmissionReadinessError(
                f"Invalid JSONL during staging: {source.name}:{line_number}"
            ) from exc
        sanitized, row_replacements = sanitize_value(
            payload, f"{source.name}[{line_number}]", replacements
        )
        rows.append(json.dumps(sanitized, ensure_ascii=True, separators=(",", ":")))
        replacement_count += row_replacements
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(rows) + "\n", encoding="utf-8")
    target.chmod(0o600)
    return replacement_count


def stage_domain_run(
    source: Path,
    target: Path,
    replacements: tuple[tuple[str, str], ...],
) -> SanitizationReport:
    source = source.resolve()
    require(not target.exists(), "Staging target already exists")
    input_paths = required_run_paths(source)
    target.mkdir(parents=True, mode=0o700)
    replacement_count = 0
    for input_path in input_paths:
        relative = input_path.relative_to(source)
        output_path = target / relative
        if input_path.suffix == ".json":
            replacement_count += sanitize_json_file(
                input_path, output_path, replacements
            )
        elif input_path.suffix == ".jsonl":
            replacement_count += sanitize_jsonl_file(
                input_path, output_path, replacements
            )
        else:
            raise SubmissionReadinessError(
                f"Unsupported official run artifact: {relative.as_posix()}"
            )
    return SanitizationReport(
        files_written=len(input_paths), path_replacements=replacement_count
    )


def sanitize_package_tree(
    root: Path,
    replacements: tuple[tuple[str, str], ...],
) -> SanitizationReport:
    files = sorted(path for path in root.rglob("*") if path.is_file())
    require(all(not path.is_symlink() for path in root.rglob("*")), "Package contains symlinks")
    replacement_count = 0
    for path in files:
        require(
            path.suffix in TEXT_PACKAGE_SUFFIXES,
            f"Unsupported package file type: {path.name}",
        )
        if path.suffix == ".json":
            replacement_count += sanitize_json_file(path, path, replacements)
        elif path.suffix == ".jsonl":
            replacement_count += sanitize_jsonl_file(path, path, replacements)
        else:
            sanitized, count = sanitize_string(
                path.read_text(encoding="utf-8"), path.name, replacements
            )
            path.write_text(sanitized, encoding="utf-8")
            path.chmod(0o600)
            replacement_count += count
    return SanitizationReport(
        files_written=len(files), path_replacements=replacement_count
    )


def require_not_submitted(provenance_path: Path) -> None:
    payload = json.loads(provenance_path.read_text(encoding="utf-8"))
    adapters = payload.get("adapters") if isinstance(payload, dict) else None
    require(isinstance(adapters, list), "Benchmark provenance registry is invalid")
    adapter = next(
        (item for item in adapters if isinstance(item, dict) and item.get("id") == "longmemeval-v2"),
        None,
    )
    require(isinstance(adapter, dict), "LongMemEval-V2 provenance entry is missing")
    submission = adapter.get("submission")
    require(isinstance(submission, dict), "LongMemEval-V2 submission state is missing")
    require(
        submission.get("resultStatus") == "not_submitted"
        and submission.get("submissionRecordUrl") is None,
        "Candidate preparation requires an unclaimed not_submitted registry state",
    )
