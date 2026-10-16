"""Regrades Claw-Anything traces in place with a config's judge.

Usage (from the Claw-Anything virtualenv)::

    python benchmarks/claw_anything/regrade.py <config.yaml> <trace.jsonl>...

Each trace's task is read from its trace_start; its old grading_result is replaced. This
is what ``claw-anything grade --write`` is meant to do, but at the pinned revision the
write-back block sits inside ``_strip_grading_results`` rather than ``cmd_grade``: ``--write``
prints the new grade and leaves the trace unchanged, and calling ``_strip_grading_results``
raises NameError. This driver strips the old result itself. Headers the judge's
endpoint needs come from ``CLAW_ANYTHING_EXTRA_HEADERS`` (client_options.py).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
import client_options  # noqa: E402

client_options.install()

import claw_anything  # noqa: E402


def strip_grading_results(trace: Path) -> None:
    """Drops the trace's grading_result lines, so the new one replaces them."""
    lines = [
        line for line in trace.read_text(encoding="utf-8").splitlines()
        if line.strip() and json.loads(line).get("type") != "grading_result"
    ]
    trace.write_text("\n".join(lines) + "\n", encoding="utf-8")


def regrade(config: Path, trace: Path, checkout: Path) -> tuple[str, float, bool]:
    from claw_anything import cli
    from claw_anything.config import load_config
    from claw_anything.graders.registry import get_grader
    from claw_anything.models.scoring import compute_task_score, is_pass
    from claw_anything.models.task import TaskDefinition
    from claw_anything.trace.reader import load_trace

    task_id = json.loads(trace.read_text(encoding="utf-8").splitlines()[0])["task_id"]
    task_dir = next(
        (checkout / "benchmark" / split / task_id for split in ("tool", "skill", "gui")
         if (checkout / "benchmark" / split / task_id).is_dir()),
        None,
    )
    if task_dir is None:
        raise SystemExit(f"No task directory for {task_id}.")
    cfg = load_config(str(config))
    judge = cli._make_judge(cfg, SimpleNamespace(no_judge=False, judge_model=None, proxy=None))
    start, messages, dispatches, _end, audit_data = load_trace(trace)
    task_yaml = cli._resolve_task_yaml(str(task_dir))
    task = TaskDefinition.from_yaml(task_yaml)
    grader = get_grader(task.task_id, tasks_dir=cli._resolve_tasks_dir(task_yaml), task_dir=task_yaml.parent)
    scores = cli._grade_with_optional_params(
        grader, messages, dispatches, task, audit_data=audit_data, judge=judge,
    )
    task_score = compute_task_score(scores)
    passed = is_pass(task_score)
    strip_grading_results(trace)
    cli._append_grading_to_trace(trace, start.trace_id, task.task_id, scores, task_score, passed)
    return task.task_id, task_score, passed


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        raise SystemExit(__doc__)
    config = Path(argv[0]).resolve()
    traces = [Path(arg).resolve() for arg in argv[1:]]
    checkout = Path(claw_anything.__file__).resolve().parents[2]
    os.chdir(checkout)
    for trace in traces:
        task_id, score, passed = regrade(config, trace, checkout)
        print(f"{task_id} task_score={score:.4f} passed={passed}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
