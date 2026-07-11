# Kavi LongMemEval-V2 Isolated Memory

This folder contains Kavi's upstream-protocol adapter for evaluating its memory
system in isolation with LongMemEval-V2. It does not run Kavi as a general
assistant and does not ask the assistant graph to inspect files. The Python
layer only implements the upstream `memory_modules.memory.Memory` interface;
ingestion and retrieval run inside a Node worker that calls Kavi's TypeScript
memory store.

## Architecture

- `kavi_isolated_memory.py` is the LongMemEval upstream-protocol adapter.
- `kavi_memory_runtime.ts` is the persistent Node worker used by the adapter.
- `nodeExpoSqlite.ts` adapts Kavi's `expo-sqlite` sync API to `better-sqlite3`
  for local benchmark execution.
- `build_kavi_memory_runtime.js` bundles the reviewed runtime with Node host
  shims for the mobile SQLite, storage, fetch, crypto, and policy boundaries.
- `smoke_kavi_memory_runtime.py` runs a no-model smoke test against official
  LongMemEval data.

The runtime maps each official trajectory into the same memory-facing shape used
by Kavi's app flows:

- trajectory metadata is represented as a user turn;
- trajectory states are represented as intermediate assistant/tool activity;
- the trajectory outcome is represented as the final assistant turn;
- ingestion runs through `processIngestionTurn`;
- agent-run evidence is recorded as one compact `agent_run` memory per source
  run with bounded goals, tools, sources, artifacts, decisions, risks,
  summaries, and evidence slices;
- direct observations and tool outputs from the same run are also recorded as
  bounded `evidence_span` memories so retrieval can ground answers on compact
  exact evidence before broader run summaries;
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
per-question isolation. Inspect `question_runs[].runtime_stats.fact_counts_by_kind`
to confirm each trajectory is represented by compact agent-run memory records.

## Leaderboard-candidate run

Requirements:

- Python 3.11 environment for the official LongMemEval-V2 repo pinned to
  commit `be15ea6e995462f3391c1a610892df3f67dfa7bd`.
- LongMemEval-V2 data pinned to Hugging Face revision
  `f152293e235517d504809563c833d7190b8c713b` and validated with the released
  checksum manifest.
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

Auxiliary memory models are off by default and never inherit the app's generic
`E2E_OPENAI_MODEL` or `OPENAI_BASE_URL`. To evaluate an explicitly reviewed
operating point with query-image understanding or LLM-assisted fact selection,
set its dedicated `KAVI_LME_QUERY_IMAGE_*` or `KAVI_LME_RETRIEVAL_LLM_*`
variables and enable the corresponding boolean. The runner stores only public
model/endpoint identifiers and API-key environment-variable names, never key
values. It also freezes the clean app commit, complete adapter digest, built
runtime digest, and Node version into both domain runs.

Prepare immutable upstream inputs before setting provider credentials:

```bash
rtk git clone https://github.com/xiaowu0162/LongMemEval-V2.git \
  .private/evals/upstream/LongMemEval-V2
rtk git -C .private/evals/upstream/LongMemEval-V2 checkout \
  be15ea6e995462f3391c1a610892df3f67dfa7bd

rtk .private/evals/venv-longmemeval-py311/bin/python \
  .private/evals/upstream/LongMemEval-V2/data/download_data.py \
  --revision f152293e235517d504809563c833d7190b8c713b \
  --data-root .private/evals/data/longmemeval-v2
```

The runner accepts either a clean checkout or the exact Kavi patch produced by
the runner. Any unrelated, partial, or modified upstream file blocks execution.

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

## Prepare a submission candidate

Do not invoke the upstream packaging scripts directly. They validate coverage
against the questions selected into a run, so a diagnostic subset can otherwise
look packageable. Kavi's fail-closed preparation command additionally requires:

- all 240 released web questions and all 211 released enterprise questions;
- exact pinned question, haystack, trajectory, and score-bearing file hashes;
- the same official reader, evaluator, decoding, and Kavi memory configuration
  in both domains;
- an exact per-question schema whose scores, token totals, memory timings, and
  aggregate metrics recompute from the retained rows;
- the same run-time app commit, adapter digest, runtime bundle digest, and Node
  version, reproduced from the clean candidate checkout;
- a clean Kavi worktree and the exact permitted upstream patch;
- a private sanitized copy with no credentials, signed URLs, unmapped local
  paths, or private provider endpoints.

After both full-domain runs complete, prepare one still-unsubmitted candidate:

```bash
python3 benchmarks/longmemeval_v2/prepare_kavi_submission.py \
  --upstream .private/evals/upstream/LongMemEval-V2 \
  --data-root .private/evals/data/longmemeval-v2 \
  --web-run "$OUTPUT_ROOT/kavi_memory_isolated_web_small" \
  --enterprise-run "$OUTPUT_ROOT/kavi_memory_isolated_enterprise_small" \
  --tier small \
  --submission-name kavi_memory_isolated_small \
  --operating-point balanced
```

The private staging folder contains the upstream archive and a
`kavi_submission_integrity.json` manifest with source pins, content hashes,
question counts, sanitization evidence, and `claimStatus: not_submitted`. The
raw runs are hashed before and after staging and are never modified. Inspect
both the integrity manifest and `submission_overview.json` before sending the
archive through the upstream submission form. A packaged candidate is not an
official result; the public provenance registry remains `not_submitted` until
the benchmark maintainers accept it and publish a review record.
