# AMemGym

This adapter runs a small, live AMemGym pilot through Kavi's real foreground-chat entry point. It is intended to validate that product memory improves a normal chat experience; it does not add benchmark-only memory APIs or prompt heuristics.

## Pinned sources

- Code: [AGI-Eval-Official/amemgym](https://github.com/AGI-Eval-Official/amemgym) at `ffcd18857a3e2b2c61f00730ebdec676e27d3e87` (MIT).
- Data: [AGI-Eval/AMemGym](https://huggingface.co/datasets/AGI-Eval/AMemGym) at `4b8f64f45a8ae7199842397985389aa0a9a9e8da` (CC-BY-4.0).
- `v1.base/data.json` SHA-256: `a63f731508a60104bc27676926134ac4d889fb143141fb4634176f0905fb659a`.

The upstream repository, dataset, virtual environment, run traces, and credentials stay under `.private/` and are not redistributed by this repository. As of the pinned upstream revision, AMemGym publishes a local evaluation protocol but no maintainer-operated leaderboard submission route. A local result must therefore be described as a reproducible AMemGym run, not an official or accepted score.

## What the pilot covers

The default pilot uses item 0, question 0, and original periods 0, 1, and 3. For each selected period it keeps only sessions whose structured `exposed_states` keys intersect the question's `required_info`. No query text, language pattern, or expected answer is used for selection.

This gives three useful checkpoints with five product chat turns:

1. initial preference acquisition;
2. one preference update while retaining the other;
3. a second preference update while retaining the first.

AMemGym's own on-policy user simulator and scorer remain unchanged. The assistant turns use `runForegroundScenario`, which calls the same foreground conversation execution used by the app. Scoring questions use an ephemeral product side thread: it reads the parent conversation's memory but cannot publish the question or answer back into memory.

The default satisfying bar is valid JSON on every answer and at least 2/3 exact accuracy. This is a bounded engineering gate, not a full-benchmark claim.

For a quick diagnostic of one checkpoint, set `AMEMGYM_PILOT_PERIOD_INDICES=0` and `AMEMGYM_PILOT_MIN_ACCURACY=0`. Such a run is diagnostic only and must not be reported as the default pilot.

## Private setup

From the repository root:

```sh
mkdir -p .private/evals/upstream
git clone https://github.com/AGI-Eval-Official/amemgym .private/evals/upstream/amemgym
git -C .private/evals/upstream/amemgym checkout ffcd18857a3e2b2c61f00730ebdec676e27d3e87
git clone https://huggingface.co/datasets/AGI-Eval/AMemGym .private/evals/upstream/amemgym-data
git -C .private/evals/upstream/amemgym-data checkout 4b8f64f45a8ae7199842397985389aa0a9a9e8da
python3 -m venv .private/evals/upstream/amemgym/.venv
.private/evals/upstream/amemgym/.venv/bin/python -m pip install .private/evals/upstream/amemgym
```

Configure the real providers in ignored `.env.local` or in the shell:

```sh
E2E_PROVIDER=openrouter
E2E_OPENROUTER_MODEL=<agent-model>
OPENROUTER_API_KEY=<secret>
OPENAI_API_KEY=<secret>
```

`OPENAI_API_KEY` is used by AMemGym's protocol-locked user simulator. Set `AMEMGYM_SIMULATOR_MODEL` or `AMEMGYM_SIMULATOR_BASE_URL` only when intentionally recording a protocol variant. No key is written to a result.

Run deterministic adapter checks, then the live pilot:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s benchmarks/amemgym -p 'test_*.py'
node ./scripts/amemgym-pilot.js
```

The live runner creates a fresh ignored directory under `.private/evals/runs/amemgym/`. Its `pilot-summary.json` records source revisions, data digest, model identifiers, dependency versions, app commit/dirty state, selection, JSON validity, and score. Raw synthetic conversations remain private by default.

The runner refuses dirty or unpinned upstream code and data. It records a dirty app worktree for local iteration, but such a run is not claim-eligible.

## Claim and publication guardrails

- Do not call the three-period pilot a full AMemGym score.
- Do not publish a run from a dirty worktree as a release claim.
- Do not publish raw traces before secret scanning and synthetic-data review.
- Do not modify upstream prompts, simulator, scorer, or answer fallback and describe the result as protocol-equivalent.
- A parse failure is an invalid run even though upstream records a random fallback choice.
- Expand item, question, and period coverage only after this exact-chat pilot is stable; keep full-run evidence in `.private/`.
