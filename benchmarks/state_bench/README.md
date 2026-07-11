# Kavi STATE-Bench Agent Learning adapter

This adapter targets the official STATE-Bench Agent Learning track at release `v0.8.0`, commit `e2c8d7af51ef48fbbea51bb2ce1fb859af36b423`.

It evaluates one deliberately narrow product claim: whether Kavi's corroborated experience-learning retrieval improves held-out task completion and UX. STATE-Bench still owns the domain tools, simulator, judge, task environments, and scoring. The adapter uses the upstream `StateBenchAgent` tool loop plus Kavi's read-only learned-experience artifact; it is not evidence that the full mobile UI/runtime ran inside STATE-Bench.

## Guardrails

- The official builder accepts only `datasets/train_task_trajectories/` and requires exactly 100 released trajectories per domain.
- Held-out task definitions and environments are never read by the builder.
- A procedure becomes a learning only after at least three independent, directly observed runs satisfy the product learning policy.
- One-off values and raw conversations are not retained. Result fields/states survive only when corroborated across at least 80% of the dominant runs.
- Retrieval is read-only, domain-bound, bounded to the official `top_k=3`, and uses the same product ranking module covered by app tests.
- The pinned per-domain SHA-256 digests must match the released training set before the runtime will query an artifact.
- Unknown provider cost must remain unknown; never report it as `$0`.

## Prepare the pinned checkout

```bash
rtk git clone --branch v0.8.0 --depth 1 \
  https://github.com/microsoft/STATE-Bench.git \
  .private/evals/upstream/STATE-Bench

rtk python3 benchmarks/state_bench/prepare_kavi_state_bench.py

rtk sh -lc 'cd .private/evals/upstream/STATE-Bench && uv sync && cp .env.example .env'
```

Configure the protocol-locked GPT-5.4 simulator/judge client and the built-in agent client exactly as documented by upstream. Then export the two paths printed by the preparation command:

Preparation emits `claim=prepared_adapter` and
`readiness=full_upstream_ready`. It does not create an official candidate. The
private preparation manifest freezes the clean Kavi revision plus the runtime,
learning-artifact, adapter, upstream, and protocol hashes used by the run.

```bash
export KAVI_STATE_BENCH_RUNTIME="<absolute runtime path>"
export KAVI_STATE_BENCH_ARTIFACT="<absolute artifact path>"
```

Run the no-provider retrieval smoke inside the upstream environment:

```bash
rtk uv run --project <kavi-repo>/.private/evals/upstream/STATE-Bench python \
  <kavi-repo>/benchmarks/state_bench/smoke_kavi_state_bench_adapter.py \
  --upstream <kavi-repo>/.private/evals/upstream/STATE-Bench \
  --runtime "$KAVI_STATE_BENCH_RUNTIME" \
  --artifact "$KAVI_STATE_BENCH_ARTIFACT"
```

## Official paired runs

First run the no-learning baseline with the same agent model, reasoning level, worker count, and provider configuration. Then run Kavi learning. Never tune on the held-out outputs.

For each of `travel`, `customer_support`, and `shopping_assistant`:

```bash
rtk uv run python -m state_bench.scripts.run_batch \
  --domain <domain> \
  --agent-class KaviStateBenchAgent \
  --agent-model-name <reported-model-name> \
  --num-runs 5 \
  --retrieve-learnings-top-k 3 \
  --num-workers <approved-workers> \
  --output-dir outputs/<domain>/

rtk uv run python -m state_bench.scripts.compute_metrics \
  --domain <domain> \
  --results-dir outputs/<domain>/ \
  --num-runs 5 \
  --output-dir outputs/<domain>/
```

Keep a separately named no-learning baseline with the same model, reasoning
level, workers, and provider configuration for the product comparison. The
submission candidate directory above contains the learning-on run only, in the
exact upstream `outputs/<domain>` layout. Never tune on held-out outputs.

## Candidate validation

Package the completed output tree, then run the post-run validator from the
same clean Kavi revision used by preparation:

```bash
rtk sh -lc 'cd <state-bench-run-root> && zip -r outputs.zip outputs'

rtk python3 benchmarks/state_bench/validate_kavi_state_bench_candidate.py \
  --outputs <state-bench-run-root>/outputs \
  --archive <state-bench-run-root>/outputs.zip
```

This is the only Kavi command that emits `claim=official_candidate`. It fails
closed unless all three official domains contain exactly five runs of all 50
held-out tasks, every trajectory is scored by the locked GPT-5.4 protocol,
model metadata is stable, the app and upstream revisions are clean and frozen,
preparation hashes still match, and the archive is a byte-for-byte package of
the validated tree. The emitted status remains `unsubmitted`.

Report pass@1, pass^5, UX, and cost for both learning-on and the separately
retained learning-off baseline; a learning method is not a product win if it
increases errors, burden, or cost materially.

Validate the product comparison separately from the learning-on submission
candidate. The comparison gate revalidates every trajectory and metric in both
conditions, requires the same model and reasoning level, verifies both archives,
and emits exact per-domain and aggregate deltas. The declared worker count must
be frozen before the runs and identical for both conditions:

```bash
rtk sh -lc 'cd <state-bench-run-root> && zip -r outputs-baseline.zip outputs-baseline'
rtk sh -lc 'cd <state-bench-run-root> && zip -r outputs-learning.zip outputs-learning'

rtk python3 benchmarks/state_bench/compare_kavi_state_bench_learning.py \
  --baseline-outputs <state-bench-run-root>/outputs-baseline \
  --baseline-archive <state-bench-run-root>/outputs-baseline.zip \
  --candidate-outputs <state-bench-run-root>/outputs-learning \
  --candidate-archive <state-bench-run-root>/outputs-learning.zip \
  --num-workers <approved-workers>
```

This comparison is local causal evidence, not an official submission artifact.
It marks the target met only when pass@1 and UX improve, pass^5 does not regress,
and mean cost rises by no more than 25%. The learning-on candidate remains the
only archive submitted to STATE-Bench.

## Submission

Open an issue in the official repository, attach the validated archive or a
stable download link, describe the method, and link this implementation. A
validated candidate is not an official result: call it official only after
maintainer verification and leaderboard acceptance.

Official references:

- https://github.com/microsoft/STATE-Bench/blob/v0.8.0/docs/AGENT_LEARNING_TRACK.md
- https://github.com/microsoft/STATE-Bench/blob/v0.8.0/docs/SUBMIT.md
