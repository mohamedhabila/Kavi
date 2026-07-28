# Kavi STATE-Bench Agent Learning adapter

This adapter targets the official STATE-Bench Agent Learning track at release `v0.8.1`, commit `4efcbf2d4fe60df04878859b692d9391f3d5b33a`.

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
git clone --branch v0.8.1 --depth 1 \
  https://github.com/microsoft/STATE-Bench.git \
  .private/evals/upstream/STATE-Bench

python3 benchmarks/state_bench/prepare_kavi_state_bench.py

sh -lc 'cd .private/evals/upstream/STATE-Bench && uv sync && cp .env.example .env'
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
uv run --project <kavi-repo>/.private/evals/upstream/STATE-Bench python \
  <kavi-repo>/benchmarks/state_bench/smoke_kavi_state_bench_adapter.py \
  --upstream <kavi-repo>/.private/evals/upstream/STATE-Bench \
  --runtime "$KAVI_STATE_BENCH_RUNTIME" \
  --artifact "$KAVI_STATE_BENCH_ARTIFACT"
```

## Official paired runs

Before either run, freeze one launch manifest per condition. The comparison
validator accepts only `kavi-state-bench-launch-v1` manifests with this closed
shape:

```json
{
  "schemaVersion": "kavi-state-bench-launch-v1",
  "condition": "baseline",
  "configuration": {
    "appCommit": "<clean-40-character-kavi-commit>",
    "upstream": { "release": "v0.8.1", "commit": "4efcbf2d4fe60df04878859b692d9391f3d5b33a" },
    "evaluationProtocolId": "state_bench_v0.8.1_gpt54",
    "domains": ["travel", "customer_support", "shopping_assistant"],
    "runs": 5,
    "numWorkers": 4,
    "provider": {
      "family": "openai",
      "configurationSha256": "<sha256-of-reviewed-secret-redacted-provider-config>"
    },
    "agentModel": { "model_name": "<agent-model>", "reasoning_level": "<level-or-null>" },
    "agentName": "StateBenchAgent",
    "retrieveLearningsTopK": 0
  },
  "configurationSha256": "<sha256-of-compact-key-sorted-configuration-json>"
}
```

The candidate manifest differs only in `condition`, `agentName` =
`KaviStateBenchAgent`, and `retrieveLearningsTopK` = `3`. The provider digest
must cover the reviewed, credential-free provider launch configuration,
including routing/account or project identity and endpoint selection where
applicable; never put a key in either manifest. Compute and record each entire
manifest's SHA-256 before launching. Store the directory as `0700` and both
files as `0600`.

First run the no-learning baseline with the exact frozen baseline manifest,
then run Kavi learning with the exact frozen candidate manifest. Never tune on
the held-out outputs.

For each of `travel`, `customer_support`, and `shopping_assistant`:

```bash
uv run python -m state_bench.scripts.run_batch \
  --domain <domain> \
  --agent-class KaviStateBenchAgent \
  --agent-model-name <reported-model-name> \
  --num-runs 5 \
  --retrieve-learnings-top-k 3 \
  --num-workers <approved-workers> \
  --output-dir outputs/<domain>/

uv run python -m state_bench.scripts.compute_metrics \
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
sh -lc 'cd <state-bench-run-root> && zip -r outputs.zip outputs'

python3 benchmarks/state_bench/validate_kavi_state_bench_candidate.py \
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
and emits exact per-domain and aggregate deltas. It verifies both immutable
launch-manifest byte digests, recomputes each canonical configuration digest,
and permits only the expected agent-class and learning-setting differences.
Provider identity and worker count therefore come from frozen launch evidence,
not post-run declarations:

```bash
sh -lc 'cd <state-bench-run-root> && zip -r outputs-baseline.zip outputs-baseline'
sh -lc 'cd <state-bench-run-root> && zip -r outputs-learning.zip outputs-learning'

python3 benchmarks/state_bench/compare_kavi_state_bench_learning.py \
  --baseline-outputs <state-bench-run-root>/outputs-baseline \
  --baseline-archive <state-bench-run-root>/outputs-baseline.zip \
  --baseline-launch-manifest <private-run-root>/baseline.launch.json \
  --baseline-launch-manifest-sha256 <frozen-baseline-manifest-sha256> \
  --candidate-outputs <state-bench-run-root>/outputs-learning \
  --candidate-archive <state-bench-run-root>/outputs-learning.zip \
  --candidate-launch-manifest <private-run-root>/candidate.launch.json \
  --candidate-launch-manifest-sha256 <frozen-candidate-manifest-sha256>
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

- https://github.com/microsoft/STATE-Bench/blob/v0.8.1/docs/AGENT_LEARNING_TRACK.md
- https://github.com/microsoft/STATE-Bench/blob/v0.8.1/docs/SUBMIT.md
