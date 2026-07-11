#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any

from run_kavi_isolated import (
    DATA_REVISION,
    METHOD,
    UPSTREAM_COMMIT,
    build_runtime,
    load_longmemeval_provenance,
    node_version,
    require_clean_app,
    verify_data_snapshot,
    verify_upstream,
)
from submission_readiness import (
    SubmissionReadinessError,
    require,
    validate_domain_run,
    validate_frozen_runtime_identity,
    validate_run_pair,
)
from submission_staging import (
    path_replacements,
    require_not_submitted,
    run_artifact_sha256,
    sanitize_package_tree,
    sha256_file,
    stage_domain_run,
    tree_sha256,
)


SAFE_NAME_RE = re.compile(r"[A-Za-z0-9._-]+")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate complete Kavi LongMemEval-V2 runs and build a sanitized, "
            "still-unsubmitted upstream leaderboard candidate."
        )
    )
    parser.add_argument("--upstream", required=True, type=Path)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--web-run", required=True, type=Path)
    parser.add_argument("--enterprise-run", required=True, type=Path)
    parser.add_argument("--tier", choices=["small", "medium"], required=True)
    parser.add_argument("--submission-name", required=True)
    parser.add_argument("--operating-point", default="balanced")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path(".private/evals/submission-staging/longmemeval-v2"),
    )
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def require_safe_name(value: str, field: str) -> None:
    require(
        bool(SAFE_NAME_RE.fullmatch(value)),
        f"{field} may contain only letters, numbers, '.', '_', and '-'",
    )


def require_private_output_root(repo_root: Path, output_root: Path) -> Path:
    private_root = (repo_root / ".private" / "evals").resolve()
    resolved = output_root.expanduser()
    if not resolved.is_absolute():
        resolved = repo_root / resolved
    resolved = resolved.resolve()
    require(
        resolved != private_root and private_root in resolved.parents,
        "Submission staging must stay under .private/evals",
    )
    return resolved


def run_upstream(command: list[str], upstream: Path) -> None:
    subprocess.run(command, cwd=upstream, check=True)


def write_manifest(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    path.chmod(0o600)


def apply_private_permissions(root: Path) -> None:
    for path in root.rglob("*"):
        path.chmod(0o700 if path.is_dir() else 0o600)
    root.chmod(0o700)


def cleanup_incomplete_candidate(candidate_root: Path) -> bool:
    marker = candidate_root / ".kavi-submission-building"
    if not marker.is_file():
        return False
    shutil.rmtree(candidate_root)
    return True


def _build_candidate(args: argparse.Namespace) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[2]
    require_safe_name(args.submission_name, "submission_name")
    require_safe_name(args.operating_point, "operating_point")
    output_root = require_private_output_root(repo_root, args.output_root)
    candidate_root = output_root / args.submission_name
    if candidate_root.exists():
        require(args.force, "Candidate staging directory already exists; use --force")

    provenance_path = repo_root / "evaluation" / "benchmark-provenance.json"
    require_not_submitted(provenance_path)
    subprocess.run(
        ["npm", "run", "check:evaluation-contract"], cwd=repo_root, check=True
    )
    app_commit = require_clean_app(repo_root)
    provenance = load_longmemeval_provenance(repo_root)
    upstream = args.upstream.expanduser().resolve()
    data_root = args.data_root.expanduser().resolve()
    web_run = args.web_run.expanduser().resolve()
    enterprise_run = args.enterprise_run.expanduser().resolve()
    adapter_source = repo_root / "benchmarks" / "longmemeval_v2" / "kavi_isolated_memory.py"
    upstream_state = verify_upstream(upstream, adapter_source)
    data_snapshot = verify_data_snapshot(data_root)

    web_validation = validate_domain_run(web_run, data_root, "web", args.tier)
    enterprise_validation = validate_domain_run(
        enterprise_run, data_root, "enterprise", args.tier
    )
    validate_run_pair(web_validation, enterprise_validation)
    node_binary = web_validation.memory_identity.get("node_binary")
    require(isinstance(node_binary, str) and bool(node_binary), "Frozen node_binary is invalid")
    rebuilt_runtime = build_runtime(repo_root, node_binary)
    rebuilt_runtime_sha256 = sha256_file(rebuilt_runtime)
    rebuilt_node_version = node_version(node_binary)
    for validation in (web_validation, enterprise_validation):
        validate_frozen_runtime_identity(
            validation,
            app_commit_sha=app_commit,
            adapter_source_sha256=provenance["adapter"]["sourceSha256"],
            runtime_bundle_sha256=rebuilt_runtime_sha256,
            node_version=rebuilt_node_version,
        )
    require(
        require_clean_app(repo_root) == app_commit,
        "Kavi app revision changed during candidate runtime verification",
    )
    raw_hashes_before = {
        "web": run_artifact_sha256(web_run),
        "enterprise": run_artifact_sha256(enterprise_run),
    }

    if candidate_root.exists():
        shutil.rmtree(candidate_root)
    candidate_root.mkdir(parents=True, mode=0o700)
    building_marker = candidate_root / ".kavi-submission-building"
    building_marker.write_text("incomplete\n", encoding="utf-8")
    building_marker.chmod(0o600)

    staging_inputs = candidate_root / "sanitized_inputs"
    package_workspace = candidate_root / "upstream_workspace"
    staged_web = staging_inputs / f"{METHOD}_web_{args.tier}"
    staged_enterprise = staging_inputs / f"{METHOD}_enterprise_{args.tier}"
    replacements = path_replacements(
        (
            (candidate_root, "<LONGMEMEVAL_SUBMISSION_STAGING>"),
            (web_run, "<LONGMEMEVAL_WEB_RUN>"),
            (enterprise_run, "<LONGMEMEVAL_ENTERPRISE_RUN>"),
            (data_root, "<LONGMEMEVAL_DATA>"),
            (upstream, "<LONGMEMEVAL_UPSTREAM>"),
            (repo_root, "<KAVI_REPOSITORY>"),
        )
    )
    web_report = stage_domain_run(web_run, staged_web, replacements)
    enterprise_report = stage_domain_run(
        enterprise_run, staged_enterprise, replacements
    )

    step_one = upstream / "leaderboard" / "build_submission_step_1_single_operating_point.py"
    step_two = upstream / "leaderboard" / "build_submission_step_2_build_package.py"
    run_upstream(
        [
            sys.executable,
            str(step_one),
            str(staged_web),
            str(staged_enterprise),
            args.submission_name,
            args.operating_point,
            args.tier,
            "--method",
            METHOD,
            "--output-root",
            str(package_workspace),
        ],
        upstream,
    )
    operating_point = (
        package_workspace
        / args.submission_name
        / "operating_points"
        / args.operating_point
    )
    first_package_report = sanitize_package_tree(operating_point, replacements)
    run_upstream(
        [
            sys.executable,
            str(step_two),
            args.submission_name,
            str(repo_root / "benchmarks" / "longmemeval_v2" / "SYSTEM_DESCRIPTION.md"),
            str(adapter_source),
            str(operating_point),
            "--output-root",
            str(package_workspace),
        ],
        upstream,
    )
    package_dir = package_workspace / args.submission_name
    archive_path = package_workspace / f"{args.submission_name}.tar.gz"
    final_package_report = sanitize_package_tree(package_dir, replacements)
    archive_path.unlink()
    if str(upstream) not in sys.path:
        sys.path.insert(0, str(upstream))
    from leaderboard.submission_utils import create_tarball

    create_tarball(package_dir, archive_path)
    apply_private_permissions(candidate_root)

    raw_hashes_after = {
        "web": run_artifact_sha256(web_run),
        "enterprise": run_artifact_sha256(enterprise_run),
    }
    require(
        raw_hashes_after == raw_hashes_before,
        "Raw evaluation artifacts changed during candidate preparation",
    )
    require(
        verify_upstream(upstream, adapter_source) == upstream_state,
        "Pinned upstream checkout changed during candidate preparation",
    )
    require_not_submitted(provenance_path)
    manifest = {
        "schemaVersion": 1,
        "kind": "kavi_longmemeval_v2_submission_candidate",
        "claimStatus": "not_submitted",
        "generatedAtUtc": datetime.now(timezone.utc).isoformat(),
        "app": {
            "commitSha": app_commit,
            "adapterSourceSha256": provenance["adapter"]["sourceSha256"],
            "runtimeBundleSha256": rebuilt_runtime_sha256,
            "nodeVersion": rebuilt_node_version,
        },
        "upstream": {
            "commitSha": UPSTREAM_COMMIT,
            "checkoutState": upstream_state,
        },
        "data": {
            "revision": DATA_REVISION,
            **data_snapshot,
        },
        "candidate": {
            "submissionName": args.submission_name,
            "operatingPoint": args.operating_point,
            "method": METHOD,
            "tier": args.tier,
            "questionCounts": {
                "web": web_validation.question_count,
                "enterprise": enterprise_validation.question_count,
            },
            "rawRunArtifactSha256": raw_hashes_before,
            "sanitizedInputSha256": {
                "web": run_artifact_sha256(staged_web),
                "enterprise": run_artifact_sha256(staged_enterprise),
            },
            "packageTreeSha256": tree_sha256(package_dir),
            "archiveSha256": sha256_file(archive_path),
            "archiveFile": archive_path.name,
        },
        "sanitization": {
            "filesWritten": (
                web_report.files_written
                + enterprise_report.files_written
                + first_package_report.files_written
                + final_package_report.files_written
            ),
            "pathReplacements": (
                web_report.path_replacements
                + enterprise_report.path_replacements
                + first_package_report.path_replacements
                + final_package_report.path_replacements
            ),
            "rawRunsMutated": False,
        },
        "submission": {
            "resultStatus": "not_submitted",
            "submissionRecordUrl": None,
            "maintainerAcceptanceRequired": True,
        },
    }
    manifest_path = candidate_root / "kavi_submission_integrity.json"
    write_manifest(manifest_path, manifest)
    building_marker.unlink()
    return {
        "candidate_root": str(candidate_root),
        "archive": str(archive_path),
        "integrity_manifest": str(manifest_path),
        "claim_status": "not_submitted",
    }


def build_candidate(args: argparse.Namespace) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[2]
    require_safe_name(args.submission_name, "submission_name")
    output_root = require_private_output_root(repo_root, args.output_root)
    candidate_root = output_root / args.submission_name
    try:
        return _build_candidate(args)
    except BaseException:
        cleanup_incomplete_candidate(candidate_root)
        raise


def main() -> None:
    try:
        result = build_candidate(parse_args())
    except (RuntimeError, SubmissionReadinessError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"error: {exc}") from exc
    print(json.dumps(result, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
