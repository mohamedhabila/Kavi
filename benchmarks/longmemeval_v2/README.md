# Kavi LongMemEval-V2 Isolated Memory

This folder contains the official LongMemEval-V2 integration for Kavi's memory
system in isolation. It does not run Kavi as a general assistant and does not
ask the assistant graph to inspect files. The Python layer only implements the
official `memory_modules.memory.Memory` interface; ingestion and retrieval run
inside a Node worker that calls Kavi's TypeScript memory store.

## Architecture

- `kavi_isolated_memory.py` is the LongMemEval `Memory` adapter.
- `kavi_memory_runtime.ts` is the persistent Node worker used by the adapter.
- `nodeExpoSqlite.ts` adapts Kavi's `expo-sqlite` sync API to `better-sqlite3`
  for local benchmark execution.
- `build_kavi_memory_runtime.js` bundles the runtime and aliases only the
  SQLite host adapter.
- `smoke_kavi_memory_runtime.py` runs a no-model smoke test against official
  LongMemEval data.

The runtime maps each official trajectory into the same memory-facing shape used
by Kavi's app flows:

- trajectory metadata is represented as a user turn;
- trajectory states are represented as intermediate assistant/tool activity;
- the trajectory outcome is represented as the final assistant turn;
- ingestion runs through `processIngestionTurn`;
- structured state evidence is recorded as typed `ui_affordance`,
  `surface_schema`, and `outcome` memories instead of raw semantic facts;
- query-time retrieval runs through `buildUnifiedMemoryAccessContext` in
  `agentic` mode and returns Kavi living-memory sections.

## Smoke

```bash
set -a
. ./.env
set +a

python3 benchmarks/longmemeval_v2/smoke_kavi_memory_runtime.py \
  --upstream .private/evals/upstream/LongMemEval-V2 \
  --data-root .private/evals/data/longmemeval-v2 \
  --domain web \
  --tier small \
  --trajectory-limit 5
```

The smoke writes a JSON artifact under:

```text
.private/evals/runs/longmemeval-v2/kavi_memory_isolated_smoke.json
```

Inspect `query_result.selected` to confirm the returned sources are
`living_memory/section/*`, and inspect `query_result.stats.db_dir` to confirm
per-question isolation. Inspect `query_result.stats.fact_counts_by_kind` to
confirm the import is using typed memory lanes.

## Official Run

Requirements:

- Python 3.11 environment for the official LongMemEval-V2 repo.
- Prepared LongMemEval-V2 data.
- `READER_MODEL` containing `qwen3.5-9b`.
- `READER_BASE_URL` and matching `READER_API_KEY_ENV`.
- `EVALUATOR_MODEL` containing `gpt-5.2`.
- evaluator API key in `EVALUATOR_API_KEY_ENV`.

Reader defaults mirror the official LongMemEval-V2 runner:

- `READER_MODEL=Qwen/Qwen3.5-9B` or an endpoint model id containing `qwen3.5-9b`;
- `READER_TEMPERATURE=0.6`;
- `READER_TOP_P=0.95`;
- `READER_TOP_K=20`;
- `--max-completion-tokens 20000`;
- `--memory-context-max-tokens 200000`;
- reader thinking enabled by default.

Run one domain:

```bash
.private/evals/venv-longmemeval-py311/bin/python benchmarks/longmemeval_v2/run_kavi_isolated.py \
  --upstream .private/evals/upstream/LongMemEval-V2 \
  --data-root .private/evals/data/longmemeval-v2 \
  --domain web \
  --tier small \
  --output-dir .private/evals/runs/longmemeval-v2/kavi_memory_isolated_web_small
```

Run both official small-tier domains:

```bash
export DATA_ROOT="$PWD/.private/evals/data/longmemeval-v2"
export OUTPUT_ROOT="$PWD/.private/evals/runs/longmemeval-v2/kavi_memory_isolated"
export TIER=small

benchmarks/longmemeval_v2/run_kavi_isolated.sh \
  --upstream .private/evals/upstream/LongMemEval-V2
```

## Reader Diagnostics

If a run produces malformed or unexpectedly short reader output, inspect the
saved prompt with the same OpenAI-compatible reader endpoint before changing
memory code:

```bash
.private/evals/venv-longmemeval-py311/bin/python benchmarks/longmemeval_v2/diagnose_reader_prompt.py \
  --env-file .env \
  --prompt-rows .private/evals/runs/longmemeval-v2/kavi_memory_isolated_web_small/prompt_rows.jsonl \
  --question-id 01f6e679 \
  --output .private/evals/runs/longmemeval-v2/diagnostics/reader_01f6e679.json
```

The diagnostic artifact records `finish_reason`, `native_finish_reason`,
reported usage, content length, reasoning length, and the parsed boxed answer.
It does not affect official scoring or submission artifacts.

## Package

After both web and enterprise runs complete, build the official package from
inside the upstream checkout:

```bash
cd .private/evals/upstream/LongMemEval-V2

python leaderboard/build_submission_step_1_single_operating_point.py \
  "$OUTPUT_ROOT/kavi_memory_isolated_web_small" \
  "$OUTPUT_ROOT/kavi_memory_isolated_enterprise_small" \
  kavi_memory_isolated_small \
  balanced \
  small \
  --method kavi_memory_isolated

python leaderboard/build_submission_step_2_build_package.py \
  kavi_memory_isolated_small \
  /path/to/repo/benchmarks/longmemeval_v2/SYSTEM_DESCRIPTION.md \
  /path/to/repo/benchmarks/longmemeval_v2/kavi_isolated_memory.py \
  leaderboard/submissions/kavi_memory_isolated_small/operating_points/balanced
```

Submit only the final `leaderboard/submissions/kavi_memory_isolated_small.tar.gz`
after inspecting `submission_overview.json`.
