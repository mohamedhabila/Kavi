# Testing Guide

Kavi has a large Jest-based test suite and a smaller set of
environment-dependent or manually validated flows.

## Quality Gate Tiers

| Tier                 | Command                     | API keys              | When to use                                                   |
| -------------------- | --------------------------- | --------------------- | ------------------------------------------------------------- |
| **1 - Default**      | `npm run verify`            | None                  | Every PR; matches keyless CI                                  |
| **2 - Strict**       | `npm run verify:strict`     | None                  | Maintainer pre-release; adds structural acceptance metrics    |
| **3 - Strict + E2E** | `npm run verify:strict:e2e` | Selected-provider key | Full agent-quality validation before major graph/tool changes |

**Tier 1 (`verify`)** is the contributor gate and matches pull request CI. It
runs the public hygiene, public language, link, license, evaluation contract,
app metadata, i18n, legacy import, thin E2E harness, graph mutation, dead
export, tool contract, maintainability, lint, typecheck, and local Jest checks
listed in the default gate section below.
E2E and live-provider tests are skipped unless explicitly opted in.

**Tier 2 (`verify:strict`)** runs Tier 1, then:

- `eval:memory` - 3-turn interdependent recall fixtures (>=90% pass rate),
  chitchat ingestion fixtures, and goal/task unification fixtures.
- `eval:agent` - bootstrap, false-finalize (including `evidence.json_field`, `file_hash`,
  `exit_code` hold fixtures), token efficiency, tool contracts discovery, catalog/describe
  discovery, session tool activation cache, delegation metrics

**Tier 3 (`verify:strict:e2e`)** runs Tier 2, then `eval:e2e`: live
selected-provider multi-turn scenarios through the real graph orchestrator.
Requires `.env.local` setup below. Structural E2E rubrics such as
`ingestion_job_checkpointed`, `ingestion_job_completed`, `memory_episode_count`,
`native_fixture_state`, and
`working_block_token` are unit-tested in
`e2eAgentRubricEvaluators.test.ts`; offline scenario checks live in
`e2eStructuralScenarioRubrics.test.ts`. The live suite pass bar is **>=90%**
(`E2E_SCENARIO_MIN_PASS_RATE`).

**Tier 3 nightly:** `.github/workflows/agent-e2e-nightly.yml` runs
`verify:strict` + `eval:e2e` on a daily schedule (not PR-blocking). Configure
repository secrets for the selected provider to enable live scenarios. Nightly
runs set `E2E_MAX_SCENARIO_RETRIES=1` (one retry per failed scenario for
transient provider flakes) and upload `.artifacts/e2e-agent-report.json`.

Default PR CI uses Tier 1 only. `.github/workflows/ci.yml` installs with
`npm ci` on the Node version from `.nvmrc`, then runs `npm run verify`. Never
commit API keys.

## Default Local Gate

Run this before opening a pull request:

```bash
npm run verify
```

That command currently runs:

- `npm run check:public-hygiene`
- `npm run check:public-language`
- `npm run check:links`
- `npm run check:licenses`
- `npm run check:evaluation-contract`
- `npm run check:app-metadata`
- `npm run check:expo-dependencies`
- `npm run check:i18n`
- `npm run check:canonical-memory-architecture`
- `npm run check:no-legacy-planning-imports`
- `npm run check:thin-e2e-harness`
- `npm run check:graph-owned-mutations`
- `npm run check:dead-exports`
- `npm run check:tool-contracts`
- `npm run check:maintainability`
- `npm run lint`
- `npm run typecheck`
- `npm test -- --runInBand`

## Common Commands

Run the full suite directly:

```bash
npm test -- --runInBand
```

The shared Jest lane validates local-similarity quality, bounded fixture work,
storage, and determinism, and gates process CPU p95 at 200 ms for retrieval and
25 ms for vector creation. The retrieval CPU guard was rounded above the 175.081
ms stress-run p95 observed with three competing fresh Jest processes; it is a
separate regression guard, not a change to the product latency budget. This
keeps unrelated scheduling stalls from masquerading as an algorithm regression.
On an idle, controlled host, run the explicit wall-clock product gate in a fresh
Jest process:

```bash
npm run test:performance:local-similarity
```

That command enforces the same 150 ms retrieval p95 and 25 ms vector-creation
p95 against wall time. A wall-clock failure on a busy shared workstation is
infrastructure-invalid performance evidence; rerun only after removing the host
contention, without changing the budgets.

Run the deterministic coverage gate:

```bash
npm run test:coverage
```

The coverage gate uses the same local Jest suite with source collection
enabled for `src/**/*.{ts,tsx}`. Coverage floors are statements >=83.8%,
branch coverage >=70.7%, function coverage >=87.6%, and line coverage >=84.3%.
Do not lower these floors without maintainer approval. Raise them when focused
tests improve real coverage. Coverage reports are written under
`.tmp/coverage`, which is ignored by git.

Run lint only:

```bash
npm run lint
```

Run Jest in watch mode:

```bash
npm run test:watch
```

Run a single file:

```bash
npm test -- --runInBand __tests__/screens/RemoteWorkScreen.test.tsx
```

Run a name-filtered subset:

```bash
npm test -- --runInBand --testNamePattern="workspace"
```

## Test Categories

- `__tests__/screens`: UI and screen interaction coverage
- `__tests__/components`: component rendering and behavior coverage
- `__tests__/services`: service, integration, transport, storage, and workflow logic
- `__tests__/engine`: orchestration, tool, and execution-guard coverage
- `__tests__/android`: Android-specific contracts and release hardening checks
- `__tests__/integration`: broader scenario tests that still run in the local Jest environment

## Public Evaluation Contract

`npm run check:evaluation-contract` validates the canonical evaluation schema,
contract, 12-case synthetic KLAE development pack, private-pack governance
schema, metadata-only registry template, and evaluator-only intent-frame
contract. It is deterministic, keyless, network-free, and never reads
`.private/evals`. The command validates artifact structure and governance; it
does not execute the scenarios or create a score.

Maintainers and independent evaluators use the opt-in, fail-closed
`npm run check:evaluation-release -- <all release flags>` gate only on a
custody-controlled machine. It validates frozen 40-case development, 40-case
locked validation, and 100-or-more-case held-out packs, their immutable byte
digests, coverage, baseline identity, ownership, and access review. Missing or
incomplete private material is a failure, never a skip. The complete private
layout, ownership handoff, digest command, reset procedure, invocation, and
publication boundary are in [evaluation.md](evaluation.md#private-klae-release-procedure).

LLM-judge calibration, intent-frame scoring, and trial aggregation are
separate, keyless evidence gates over private evaluator inputs; none invokes
the app runner:

```bash
npm run check:judge-calibration -- \
  --input .private/evals/<release-id>/judge-calibration.json \
  --output .artifacts/judge-calibration-report.json

npm run evaluate:intent-frame -- \
  --input .private/evals/<release-id>/intent-frames.json \
  --output .artifacts/intent-frame-report.json

npm run aggregate:evaluation -- \
  --input .private/evals/<release-id>/trial-set.json \
  --output .artifacts/evaluation-statistics-report.json
```

All three commands write content-free aggregate reports and return nonzero when the
evidence is not claim-eligible. Exact freeze ordering, digest commands, metric
definitions, bootstrap semantics, and publication rules are documented in
[evaluator calibration](evaluation.md#evaluator-calibration-gate),
[intent-frame baseline](evaluation.md#evaluator-only-intent-frame-baseline),
and [trial statistics](evaluation.md#deterministic-trial-statistics).

`__tests__/scripts/intentFrameEvaluation.test.ts` uses original synthetic
multilingual/product fixtures to validate the scorer, coverage gate, digest
binding, and leakage controls. It does not run the assistant and is not a
multilingual product-understanding score. A product baseline requires a frozen
pre-execution candidate-frame artifact from a real evaluation run.

See [evaluation.md](evaluation.md) for evaluation lanes, verification labels,
split ownership, structural assertion semantics, metrics, failure categories,
privacy rules, and the boundary between adapted checks and official upstream
results.

## Expectations For Contributors

- Add or update regression tests when behavior changes.
- Prefer narrow tests close to the changed subsystem before adding heavyweight scenario coverage.
- Keep default CI-safe tests local and deterministic.
- If a test requires paid providers, external infrastructure, or
  platform-specific external dependencies, keep it opt-in and gated explicitly.

## Opt-In Live Provider Tests

Two Jest files intentionally call real hosted providers and are excluded from the default contributor gate unless you opt in explicitly:

- `__tests__/services/LlmService.anthropic.live.test.ts`
- `__tests__/services/LlmService.nativeProviders.live.test.ts`

These tests are not part of CI and should only be run when you are validating provider integrations or investigating transport regressions.

Required environment variables:

- `npm run test:live:anthropic`: requires `ANTHROPIC_API_KEY`
- `npm run test:live:native-providers`: requires `ANTHROPIC_API_KEY` and one of `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`

Recommended workflow:

1. Export the required API keys in your shell or secret manager.
2. Run the matching npm script.
3. Unset the keys again when you are done if your shell session is shared.

These tests can incur provider costs, depend on external network health, and may fail for reasons unrelated to local code changes.

## Opt-In E2E Agent Eval

Live multi-turn agent scenarios run through the real graph orchestrator
(`runOrchestrator`) with **structural result rubrics only**: graph status,
workspace paths, memory predicates, native fixture state, token budgets, and
cache counters. The scenarios do not prescribe tool names, tool order, or
per-turn tool selections, and they do not score assistant prose with English
regular expressions. Structural rubric unit tests live in
`__tests__/acceptance/e2eAgentRubricEvaluators.test.ts` and run in default
`npm run verify`.

### Run E2E from docs (contributor checklist)

```bash
cd /path/to/kavi
cp .env.local.example .env.local
# Edit .env.local and set E2E_PROVIDER plus matching key/model variables
npm run eval:e2e
```

Or the full maintainer gate:

```bash
npm run verify:strict:e2e
```

Run only direct benchmark shards:

```bash
E2E_SCENARIO_IDS="direct-agentdojo-untrusted-workspace-note direct-bfcl-v4-parallel-relevance direct-toolsandbox-state-dependency direct-tau-user-coordination-state direct-androidworld-calendar-add-update direct-mobileworld-cross-app-contact-message direct-spabench-cross-app-device-actions direct-longmemeval-v2-mobile-preference-update direct-locomo-temporal-conversation-memory direct-beam-long-dialogue-multi-probe direct-longmemeval-v2-experience-runbook direct-mobileworld-long-horizon-personalization" npm run eval:e2e:assess
```

Run the nine-turn product-native continuity flow on its own:

```bash
E2E_SCENARIO_IDS="organic-mobile-assistant-continuity" npm run eval:e2e:assess
```

This flow keeps evaluator routing on `production_auto` while recording user
mode selections, two persisted relaunches, a preference correction, one
calendar action with attributed memory-retrieval participation, an intentionally
ambiguous agentic no-op, and recovery of partial workspace state. This flow is
continuity/retrieval evidence, not standalone causal-memory evidence: the raw
persisted chat remains available across these relaunches. Causal memory is
evaluated separately by `paired-causal-global-preference`, whose product-created
new conversation begins with zero raw messages while retaining owner-global
memory. Its two passive learning turns must contain zero model-requested tool
calls of any kind as well as zero native invocations; exact per-turn calls remain
available in opt-in private evidence. This prevents a non-native effect from
inflating neutral parity while leaving product behavior and benchmark prompts
unchanged.
Its 240K token ceiling is provisional until clean first-attempt live trials are
available. Recalibrate to `ceil(max observed × 1.25)` after at least three
retries-disabled runs. The nine-turn 810-second scenario deadline is a hard
outer wall-clock bound over execution, relaunch, persistence, and memory
settlement; each foreground model turn remains independently capped at 90 seconds.

### Environment variables

| Variable                   | Required       | Purpose                                                                                |
| -------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `RUN_E2E_AGENT_EVAL`       | Yes            | Set to `1` in `.env.local` (harness loads it automatically)                            |
| `E2E_PROVIDER`             | No             | `gemini` by default; supports `openai`, `anthropic`, `openrouter`, `openai-compatible` |
| `GEMINI_API_KEY`           | For Gemini     | Same key as emulator Gemini provider                                                   |
| `GEMINI_BASE_URL`          | If Vertex      | Match app provider settings                                                            |
| `E2E_GEMINI_MODEL`         | No             | Override Gemini model (default: capable flash from catalog)                            |
| `OPENAI_API_KEY`           | For OpenAI     | OpenAI API key                                                                         |
| `E2E_OPENAI_MODEL`         | For OpenAI     | OpenAI model used by live E2E                                                          |
| `OPENAI_BASE_URL`          | No             | Defaults to `https://api.openai.com/v1`                                                |
| `ANTHROPIC_API_KEY`        | For Anthropic  | Anthropic API key                                                                      |
| `E2E_ANTHROPIC_MODEL`      | For Anthropic  | Anthropic model used by live E2E                                                       |
| `ANTHROPIC_BASE_URL`       | No             | Defaults to `https://api.anthropic.com/v1`                                             |
| `OPENROUTER_API_KEY`       | For OpenRouter | OpenRouter API key                                                                     |
| `E2E_OPENROUTER_MODEL`     | For OpenRouter | OpenRouter model id                                                                    |
| `E2E_COMPATIBLE_API_KEY`   | For compatible | Generic OpenAI-compatible API key                                                      |
| `E2E_COMPATIBLE_BASE_URL`  | For compatible | Generic OpenAI-compatible base URL                                                     |
| `E2E_COMPATIBLE_MODEL`     | For compatible | Generic OpenAI-compatible model id                                                     |
| `E2E_PUBLIC_MODEL_ID`      | For compatible | Path-free public model identity; runtime locator is published only as a SHA-256 digest |
| `E2E_MAX_SCENARIO_RETRIES` | No             | Per-scenario retry budget (default `0`; nightly uses `1`)                              |
| `E2E_REPORT_PATH`          | No             | JSON run report path (default `.artifacts/e2e-agent-report.json`)                      |
| `E2E_REPORT_SUMMARY_PATH`  | No             | Markdown summary path (default `.artifacts/e2e-agent-report.md`)                       |
| `E2E_SCENARIO_IDS`         | No             | Comma/whitespace-separated scenario IDs for targeted assessment                        |
| `E2E_PRIVATE_EVIDENCE_DIR` | No             | Raw local evidence path inside `.private/evals/`; never upload it publicly             |

The harness scripts (`eval:e2e`, `verify:strict:e2e`) load `.env.local` via
`scripts/load-local-env.js`. They are never bundled into the app.

### E2E JSON report

`npm run eval:e2e` writes a structural JSON artifact (when the suite runs) with
per-scenario pass/fail, attempt count, token usage, cache reads, duration, and
an **`assessment`** block with dimensional and benchmark-family pass rates.
Default path: `.artifacts/e2e-agent-report.json` (gitignored). Nightly CI
uploads this file and the derived Markdown summary as workflow artifacts.

Public run metadata records the provider family, hosted model family, a
validated path-free model identity, and canonical SHA-256 endpoint and runtime
model-locator digests. It never records a raw endpoint URL or local model path.
The current JSON contract is `e2e-run-report-v2`; removed v1 URL and absolute
path fields have no compatibility aliases.
Every redacted-trace reference declares `referenceBase: retention_root`; its
path includes the retained run id and is resolved from
`.artifacts/e2e-readiness-runs/`. Nightly artifacts upload that retention tree
with the root report, so references do not dangle. Absolute workstation paths
are not part of the public schema. Raw or private traces are excluded by the
public artifact writer and must remain outside the public E2E retention
directory.

For exact local diagnosis, set
`E2E_PRIVATE_EVIDENCE_DIR=.private/evals/<run-name>`. The runner then writes an
atomic, owner-only `e2e-private-scenario-evidence-v7` file per attempt with raw
turn, selected-mode, result, estimated-cost, memory, per-turn retrieval, native,
graph, and lifecycle evidence. The setting is intentionally opt-in; the
directory is gitignored, cannot escape the private root through `..` or symlinks,
is never referenced by the public report, and must not be included in uploaded
CI artifacts.

Parallel scenario workers exchange entries through the private
`e2e-partial-report-v2` envelope. The writer accepts only
`e2e-run-report-scenario-v2` entries, uses a lock and atomic replacement, and
rejects unversioned or legacy arrays instead of relabeling them as current.
Final retained runs are assembled in a staging directory and atomically
replace a colliding run, preventing stale traces and partial public reports.

`eval:e2e` also writes `.artifacts/e2e-agent-report.md`, a sanitized Markdown
summary for quick review. It includes aggregate pass rates, cache/reliability
metrics, failed scenario IDs, and issue counts, but intentionally excludes
prompts, transcripts, tool outputs, provider error text, raw traces, and
credentials. To regenerate it from an existing JSON report, run:

```bash
npm run eval:e2e:summary
```

Assessment axes (for evidence-based readiness and benchmark coverage):

| Dimension            | What E2E proves                                                                         |
| -------------------- | --------------------------------------------------------------------------------------- |
| `task_understanding` | Bootstrap goals, multi-turn intent, scoped focus                                        |
| `task_completion`    | Workspace artifacts, goal completion, terminal graph                                    |
| `tool_usage`         | Successful native/workspace/memory outcomes produced through the available tool surface |
| `tool_discovery`     | Result success under catalog/retrieval pressure without prescribed tool paths           |
| `token_efficiency`   | Per-scenario budgets, cache reads, `TOOL_SURFACE_TOKEN_AUDIT`                           |
| `memory`             | Explicit recall, passive ingestion, scoped working blocks                               |
| `delegation`         | Spawn, worker evidence, coordinate capability                                           |
| `outcome_validators` | `native_fixture_state`, `file_hash`, `goal_criterion`                                   |
| `control_graph`      | Evidence gates, holds, terminal success                                                 |
| `mobile_native`      | Permission-aware device actions, native app state, and mobile fixtures                  |
| `privacy_safety`     | Sensitive native surfaces, redaction, untrusted content, and approval boundaries        |

Benchmark families for mobile assistant scope (structural rubrics only):

| Family                         | External lineage                                | Kavi scenarios                                                                                   |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `kavi-core`                    | Kavi core mobile-assistant scenario suite       | core workspace, memory, native tool, delegation, and goal-completion flows                       |
| `gaia-adapted`                 | GAIA multi-hop file reasoning                   | `bench-gaia-file-hop-chain`, inventory flows                                                     |
| `tau-bench-adapted`            | τ-bench structured final-state outcomes         | `native-calendar-json-field`, `bench-tau-native-json-outcome`, `bench-goal-json-field-criterion` |
| `agentbench-adapted`           | AgentBench multi-tool chains                    | `bench-agentbench-tool-chain`, file/inventory chains                                             |
| `memory-agent-bench-adapted`   | MemoryAgentBench long-horizon recall            | memory + passive ingestion scenarios                                                             |
| `state-bench-adapted`          | STATE-Bench multi-turn task tracking            | goal-switch + scoped recall scenarios                                                            |
| `tool-discovery-adapted`       | Tool search + session activation                | `bench-session-tool-cache`, `bench-tool-describe-then-use`, catalog flows                        |
| `bfcl-adapted`                 | Berkeley Function Calling Leaderboard (BFCL v4) | `bench-bfcl-parallel-file-read`, `bench-bfcl-sequential-memory-chain`                            |
| `longmem-adapted`              | LongMemEval delayed recall                      | `bench-longmem-delayed-recall`                                                                   |
| `androidworld-adapted`         | AndroidWorld app-state rewards                  | calendar mutation, permission-denial, clipboard/share/notification native fixture flows          |
| `mobile-agent-bench-adapted`   | MobileAgentBench mobile planning/execution      | contact/message draft and media-state native fixture flows                                       |
| `mobileworld-adapted`          | MobileWorld cross-app mobile tasks              | contact discovery, calendar, and cross-app message flows                                         |
| `knowu-bench-adapted`          | KnowU-Bench personalized mobile agents          | memory-driven native contact action from remembered user preference                              |
| `androidworld-direct`          | AndroidWorld app-state rewards                  | `direct-androidworld-calendar-add-update`                                                        |
| `mobileworld-direct`           | MobileWorld cross-app/user-interaction tasks    | `direct-mobileworld-cross-app-contact-message`                                                   |
| `spa-bench-direct`             | SPA-Bench smartphone resource metrics           | `direct-spabench-cross-app-device-actions`                                                       |
| `bfcl-v4-direct`               | BFCL V4 agentic tool evaluation                 | `direct-bfcl-v4-parallel-relevance`                                                              |
| `longmemeval-v2-direct`        | LongMemEval-V2 dynamic memory abilities         | `direct-longmemeval-v2-mobile-preference-update`                                                 |
| `tau-bench-direct`             | τ-bench / τ² / τ³ user-tool state interaction   | `direct-tau-user-coordination-state`                                                             |
| `toolsandbox-direct`           | ToolSandbox state dependency                    | `direct-toolsandbox-state-dependency`                                                            |
| `agentdojo-direct`             | AgentDojo untrusted-content safety              | `direct-agentdojo-untrusted-workspace-note`                                                      |
| `locomo-direct`                | LoCoMo long-term conversational memory          | temporal conversation memory and mobile long-horizon personalization shards                      |
| `beam-direct`                  | BEAM agent memory over long interactions        | long dialogue with fragmented probes, distractors, and structural recall                         |
| `provider-prompt-cache-direct` | Provider prompt-cache behavior                  | long-horizon prompt-cache probes with stable-prefix accounting                                   |

Registry: `src/acceptance/e2eAgent/e2eBenchmarkRegistry.ts`. Report builder: `e2eAssessmentReport.ts`.

**Flake policy:** set `E2E_MAX_SCENARIO_RETRIES=1` for operational runs
(nightly). Local maintainer runs default to `0` so failures surface
immediately. Retries are general: any scenario may be re-run once; there is no
scenario-specific gating.

### Scenarios and pass bar

| Suite             | Test file                      | Scenarios                                                            | Pass bar                                     |
| ----------------- | ------------------------------ | -------------------------------------------------------------------- | -------------------------------------------- |
| Core + benchmarks | `e2eAgentMetrics.test.ts`      | 61 (22 core + 27 adapted benchmark + 12 direct benchmark shards)     | >=90% per run (`E2E_SCENARIO_MIN_PASS_RATE`) |
| Delegation        | `e2eDelegationMetrics.test.ts` | 2 (`delegation-worker-finalize`, `delegation-worker-evidence-chain`) | 100% (mocked worker, structural rubrics)     |

**Core scenarios (personal-assistant scope):** file write + read, goal evidence
completion, gate recovery, `tool_catalog` + `agents`, memory remember + recall,
shopping list, workspace inventory manifest, native calendar JSON, passive
memory ingestion, goal-scoped recall, and multi-turn flows (memory preference,
trip artifact, inventory readback, catalog to memory, catalog query to memory
recall, gate follow-up). Multi-turn scenarios invoke `runOrchestrator` once
per user message with accumulated history and graph resume, matching the
foreground conversation path.

The core suite also includes six longitudinal product flows: chitchat profile
correction, chitchat-to-calendar preference application, agent-outcome
continuity into chitchat, reusable failure-constraint recovery, and profile
continuity across a persisted app relaunch, plus the nine-turn organic mobile
assistant continuity flow. These flows score route,
execution, final-response, agent-run, durable-memory, lifecycle, and verified
end-state evidence independently.

**Benchmark-adapted scenarios (`bench-*`):** GAIA file-hop chain, session
memory cache, prompt-cache long-horizon probes, describe-then-use, 3-turn memory
state, native calendar state criterion, scoped goal-switch recall,
bootstrap-first-turn goals, tau-bench calendar state chain, AgentBench
inventory chain, BFCL parallel file read, BFCL sequential memory chain,
LongMemEval delayed recall/update/abstention, and AndroidWorld, MobileAgent,
MobileWorld, and KnowU-style native fixture tasks.

**Direct benchmark shards (`direct-*`):** local runnable direct ports for
AndroidWorld calendar app-state reward, MobileWorld cross-app contact/message
flow, SPA-Bench cross-app device actions, BFCL V4 parallel/relevance state,
LongMemEval-V2 dynamic mobile preference memory and experience-runbook recall,
LoCoMo-style temporal conversation memory, BEAM-style long-dialogue probes,
tau-style missing-info coordination, ToolSandbox state dependency, and
AgentDojo untrusted workspace content. These are not full upstream benchmark
replacements; `e2eBenchmarkManifest.ts` keeps the full Android emulator, mobile
GUI/MCP, provider matrix, and security fixture runners marked as external
requirements.

**Assessment coverage:** `e2eAssessmentCoverage.test.ts` asserts every
assessment dimension maps to at least 2 scenarios and every benchmark family
maps to at least 1 scenario (`e2eBenchmarkRegistry.ts`).

**Structural rubrics:** graph status, terminal success, completion holds,
workspace paths and absence, file hashes, memory predicates, native fixture
state, goal status/criteria, user-turn count, token budgets, cache reads, graph
audit observations, ingestion jobs, memory episodes, working-block tokens, and
turn-attributed tool-call counts for passive no-action guards.
E2E scenarios do not declare `allowedTools` and do not score `tool_called`,
`tool_sequence`, `tool_call_max`, `first_turn_tool_called`,
`graph_session_tools`, or tool-result `json_field` rubrics. Redacted traces
still include tool calls/results for debugging. Native mobile scenarios use
deterministic fixtures (`e2eNativeMobileFixtures.ts`) installed by the scoped
acceptance environment. Assistant prose is not evaluated with English
regular-expression checks. Unit tests: `e2eAgentRubricEvaluators.test.ts`,
`e2eScenarioRunner.test.ts`, `e2eBenchmarkRegistry.test.ts`,
`e2eAssessmentReport.test.ts`, `e2eNativeMobileFixtures.test.ts`,
`graphTaskScope.test.ts`.

**Delegation scenario:** supervisor spawns worker (`sessions_spawn` +
`waitForCompletion`), worker evidence (`evidence.prefix:worker`), goal
completion, and graph terminal success. The worker session is mocked; the
selected E2E provider drives the supervisor tool loop. Goal pins
`sessions_spawn` via `requiredCapabilities: ['coordinate']`.

### Cost and time expectations

| Scope                           | Typical duration | Token budget (ceiling)                                |
| ------------------------------- | ---------------- | ----------------------------------------------------- |
| Core + benchmark (61 scenarios) | 30–60+ minutes   | ≤4.64M total (`E2E_PROGRAM_MAX_TOTAL_TOKENS`)         |
| Delegation only                 | ~10 seconds      | ≤200K (`E2E_DELEGATION_PROGRAM_MAX_TOTAL_TOKENS`)     |
| Full `eval:e2e`                 | 30–60+ minutes   | Per-scenario ceilings in `E2E_SCENARIO_TOKEN_BUDGETS` |

Token totals are logged per scenario. Provider 400/transient errors can fail individual core scenarios; re-run before treating as a regression.

Never commit `.env.local` or paste keys into issues or PRs.

## Token efficiency metrics

`npm run verify:strict` includes structural token-efficiency acceptance via `__tests__/acceptance/tokenEfficiencyMetrics.test.ts`:

- Turn surface token estimate ≤ model tool budget with full builtin catalog registered
- Goals + pinned profile blocks survive aggressive compaction reinject
- ≥20% tool-definition token reduction vs legacy two-sentence compression on benchmark fixture

Graph observability records `TOOL_SURFACE_TOKEN_AUDIT` after pre-flight budget enforcement (selected count, estimated tokens, eviction list).

## Delegation metrics

`npm run verify:strict` includes structural delegation acceptance via `__tests__/acceptance/delegationMetrics.test.ts`:

- Spawn gate blocked when `dependsOnWorkstreams` goals are incomplete; allowed when complete
- Worker terminal → `GOAL_EVIDENCE_ADDED` with `worker:` prefix → completion gate readiness when goal completed
- Orchestrator passes live `controlGraphGoals` into `sessions_spawn` (no chat-store babysitting)
- Terminal delegation tool JSON applies the same graph events as the UI sub-agent bridge

Live E2E delegation (`delegation-worker-finalize`) runs in
`__tests__/acceptance/e2eDelegationMetrics.test.ts` separately from the core
and benchmark scenario suite. It uses a mocked worker session and structural
rubrics (`sessions_spawn`, `goal_evidence_satisfied`,
`graph_terminal_success`). The worker goal pins `sessions_spawn` via
`requiredCapabilities: ['coordinate']`.

## Tool contract coverage

Default `npm run verify` runs `npm run check:tool-contracts`, which asserts every tool in `TOOL_DEFINITIONS` has a non-empty `contract.capabilities` array.

Structural tests:

- `__tests__/engine/toolCatalogContractConsistency.test.ts` — `tool_catalog` category browse matches registry capability summaries
- `__tests__/acceptance/toolCatalogDiscoveryMetrics.test.ts` — catalog search/describe activates expected tools on turn surface (included in `verify:strict` via `eval:agent`)
- `__tests__/acceptance/goalCapabilityDiscoveryMetrics.test.ts` — goal `requiredCapabilities` resolve expected tools on fixture catalog (included in `verify:strict` via `eval:agent`)

## Routine Output

The default `npm test -- --runInBand` path should stay deterministic and quiet.
If a change introduces repeated renderer warnings, noisy logs, or lint warnings
in an edited area, treat that as part of the change unless there is a documented
reason to defer it.

## Release-Oriented Validation

For Android release work, start with the Android release environment check. It
verifies Java and Android SDK discovery without requiring signing material:

```bash
npm run check:android:release-env
```

Maintainer release builds also need local signing configuration. After signing
is configured outside git, build an APK or App Bundle with:

```bash
npm run build:android:release
npm run build:android:aab
```

For iOS simulator release validation, run:

```bash
npm run build:ios:release-sim
```

This validation builds only the arm64 simulator architecture required by the
pinned LiteRT-LM binary. The architecture override is scoped to this command
and does not change iOS device archive architectures.
