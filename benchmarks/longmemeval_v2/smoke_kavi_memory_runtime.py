#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from typing import Any
from uuid import uuid4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-test the isolated Kavi memory runtime.")
    parser.add_argument("--data-root", default=os.getenv("DATA_ROOT"), type=Path)
    parser.add_argument("--upstream", required=True, type=Path)
    parser.add_argument("--domain", choices=["web", "enterprise"], default="web")
    parser.add_argument("--tier", choices=["small", "medium"], default=os.getenv("TIER", "small"))
    parser.add_argument("--question-id", default=None)
    parser.add_argument("--question-ids", nargs="*", default=None)
    parser.add_argument("--question-limit", type=int, default=None)
    parser.add_argument("--trajectory-limit", type=int, default=100)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(".private/evals/runs/longmemeval-v2/kavi_memory_isolated_smoke.json"),
    )
    parser.add_argument("--node-binary", default=os.getenv("KAVI_LME_NODE_BINARY", "node"))
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def parse_question_ids(args: argparse.Namespace) -> list[str] | None:
    raw_values: list[str] = []
    if args.question_id:
        raw_values.append(args.question_id)
    if args.question_ids:
        raw_values.extend(args.question_ids)
    parsed: list[str] = []
    for raw in raw_values:
        parsed.extend(item.strip() for item in raw.split(",") if item.strip())
    return parsed or None


class RuntimeProcess:
    def __init__(self, *, repo_root: Path, bundle_path: Path, db_dir: Path, node_binary: str) -> None:
        self.counter = 0
        self.stderr_lines: list[str] = []
        env = dict(os.environ)
        env["KAVI_MEMORY_SQLITE_DIR"] = str(db_dir)
        self.process = subprocess.Popen(
            [node_binary, str(bundle_path)],
            cwd=str(repo_root),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _drain_stderr(self) -> None:
        assert self.process.stderr is not None
        for line in self.process.stderr:
            self.stderr_lines.append(line.rstrip())
            self.stderr_lines = self.stderr_lines[-100:]

    def call(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.process.poll() is not None:
            raise RuntimeError(f"runtime exited: {self.process.returncode} stderr={self.stderr_lines}")
        self.counter += 1
        request = {"id": f"smoke-{self.counter}", **payload}
        assert self.process.stdin is not None
        assert self.process.stdout is not None
        self.process.stdin.write(json.dumps(request, ensure_ascii=True) + "\n")
        self.process.stdin.flush()
        response = json.loads(self.process.stdout.readline())
        if not response.get("ok"):
            raise RuntimeError(f"runtime failed: {response}")
        result = response.get("result")
        return result if isinstance(result, dict) else {}

    def close(self) -> None:
        try:
            self.call({"op": "shutdown"})
        finally:
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    data_root = args.data_root.expanduser().resolve() if args.data_root else None
    require(data_root is not None and data_root.is_dir(), "DATA_ROOT or --data-root is required")
    upstream = args.upstream.expanduser().resolve()
    require(upstream.is_dir(), f"Missing upstream checkout: {upstream}")

    bundle_path = repo_root / ".private" / "evals" / "runtime" / "kavi_memory_runtime.cjs"
    build_script = repo_root / "benchmarks" / "longmemeval_v2" / "build_kavi_memory_runtime.js"
    subprocess.run(
        [args.node_binary, str(build_script), "--out", str(bundle_path)],
        cwd=str(repo_root),
        check=True,
    )

    question_ids = parse_question_ids(args)
    questions = [
        row for row in read_jsonl(data_root / "questions.jsonl") if row.get("domain") == args.domain
    ]
    if question_ids:
        selected = set(question_ids)
        questions = [row for row in questions if row.get("id") in selected]
    if args.question_limit is not None:
        questions = questions[: args.question_limit]
    require(questions, "No matching questions found")

    haystack = json.loads((data_root / "haystacks" / f"lme_v2_{args.tier}.json").read_text())
    all_needed_trajectory_ids = {
        trajectory_id
        for question in questions
        for trajectory_id in haystack[str(question["id"])][: args.trajectory_limit]
    }
    trajectories_by_id = {
        str(row["id"]): row
        for row in read_jsonl(data_root / "trajectories.jsonl")
        if str(row.get("id")) in all_needed_trajectory_ids
    }

    question_runs = []
    query_results = []
    total_trajectory_count = 0
    for question in questions:
        question_id = str(question["id"])
        trajectory_ids = list(haystack[question_id][: args.trajectory_limit])
        total_trajectory_count += len(trajectory_ids)
        trajectories = [trajectories_by_id[trajectory_id] for trajectory_id in trajectory_ids]
        db_dir = (
            repo_root
            / ".private"
            / "evals"
            / "runtime"
            / f"smoke-{question_id}-{uuid4().hex[:12]}"
            / "db"
        )
        runtime = RuntimeProcess(
            repo_root=repo_root,
            bundle_path=bundle_path,
            db_dir=db_dir,
            node_binary=args.node_binary,
        )
        try:
            reset = runtime.call({"op": "reset"})
            inserts = [
                runtime.call({"op": "insert", "trajectory": trajectory})
                for trajectory in trajectories
            ]
            question_text = question["question"]
            question_image = None
            if isinstance(question_text, dict):
                question_image = question_text.get("image")
                question_text = question_text.get("text", "")
            query_result = runtime.call(
                {
                    "op": "query",
                    "query": str(question_text),
                    "queryImage": question_image,
                    "questionId": question_id,
                }
            )
            runtime_stats = runtime.call({"op": "stats"})
            query_results.append(query_result)
            question_runs.append(
                {
                    "question_id": question_id,
                    "trajectory_ids": trajectory_ids,
                    "reset": reset,
                    "inserts": inserts,
                    "query_result": query_result,
                    "runtime_stats": runtime_stats,
                }
            )
        finally:
            runtime.close()

    payload = {
        "domain": args.domain,
        "tier": args.tier,
        "question_ids": [str(question["id"]) for question in questions],
        "isolation": "fresh_runtime_per_question",
        "question_runs": question_runs,
        "query_results": query_results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "question_count": len(questions),
                "trajectory_count": total_trajectory_count,
                "returned_items": [len(result.get("memory_context", [])) for result in query_results],
            }
        )
    )


if __name__ == "__main__":
    main()
