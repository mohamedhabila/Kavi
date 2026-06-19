# Testing Guide

Kavi has a large Jest-based test suite and a smaller set of environment-dependent or manually validated flows.

## Quality Gate Tiers

| Tier                 | Command                     | API keys         | When to use                                                |
| -------------------- | --------------------------- | ---------------- | ---------------------------------------------------------- |
| **1 — Default**      | `npm run verify`            | None             | Every PR; matches keyless CI                               |
| **2 — Strict**       | `npm run verify:strict`     | None             | Maintainer pre-release; adds structural acceptance metrics |
| **3 — Strict + E2E** | `npm run verify:strict:e2e` | Selected-provider key | Full agent quality proof before major agent/graph changes  |

**Tier 1 (`verify`)** is the contributor gate and matches pull request CI. It
runs the public hygiene, public language, link, license, app metadata, i18n,
legacy import, thin E2E harness, graph mutation, dead export, tool contract,
lint, typecheck, and local Jest checks listed in the default gate section below.
E2E and live-provider tests are skipped unless explicitly opted in.

**Tier 2 (`verify:strict`)** runs Tier 1, then:

- `eval:memory` — 3-turn interdependent recall fixtures (≥90% pass rate) plus chitchat
  ingestion fixtures (episode + focus after `drainIngestionQueue` without `memory_remember`) and
  goal ↔ task unification fixtures (scoped session recall + task_stack title per active graph goal)
- `eval:agent` — bootstrap, false-finalize (including `evidence.json_field`, `file_hash`,
  `exit_code` hold fixtures), token efficiency, tool contracts discovery, catalog/describe
  discovery, session tool activation cache, delegation metrics

**Tier 3 (`verify:strict:e2e`)** runs Tier 2, then `eval:e2e` — live selected-provider multi-turn scenarios through the real graph orchestrator. Requires `.env.local` setup below. Structural E2E rubrics (`ingestion_job_completed`, `memory_episode_count`, `native_fixture_state`, `working_block_token`) are unit-tested in `e2eAgentRubricEvaluators.test.ts` and offline scenario checks in `e2eStructuralScenarioRubrics.test.ts`; live suite pass bar is **≥90%** (`E2E_SCENARIO_MIN_PASS_RATE`).

**Tier 3 nightly:** `.github/workflows/agent-e2e-nightly.yml` runs `verify:strict` + `eval:e2e` on a daily schedule (not PR-blocking). Configure repository secrets for the selected provider to enable live scenarios. Nightly runs set `E2E_MAX_SCENARIO_RETRIES=1` (one retry per failed scenario for transient provider flakes) and upload `.artifacts/e2e-agent-report.json`.

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
- `npm run check:app-metadata`
- `npm run check:i18n`
- `npm run check:no-legacy-planning-imports`
- `npm run check:thin-e2e-harness`
- `npm run check:graph-owned-mutations`
- `npm run check:dead-exports`
- `npm run check:tool-contracts`
- `npm run lint`
- `npm run typecheck`
- `npm test -- --runInBand`

## Common Commands

Run the full suite directly:

```bash
npm test -- --runInBand
```

Run the deterministic coverage gate:

```bash
npm run test:coverage
```

The coverage gate uses the same local Jest suite with source collection enabled
for `src/**/*.{ts,tsx}` and enforces the current measured baseline: statements
>=83.8%, branches >=70.7%, functions >=87.6%, and lines >=84.3%. Do not lower
these floors without maintainer approval. Raise them when focused tests improve
real coverage. Coverage reports are written under `.tmp/coverage`, which is
ignored by git.

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

## Expectations For Contributors

- Add or update regression tests when behavior changes.
- Prefer narrow tests close to the changed subsystem before adding heavyweight scenario coverage.
- Keep default CI-safe tests local and deterministic.
- If a test requires paid providers, private infrastructure, or platform-specific external dependencies, keep it opt-in and gated explicitly.

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

Live multi-turn agent scenarios run through the real graph orchestrator (`runOrchestrator`) with **structural result rubrics only** — graph status, workspace paths, memory predicates, native fixture state, token budgets, and cache counters. Benchmarks do not prescribe tool names, tool order, or per-turn tool selections. No English regex on assistant prose. Structural rubric unit tests live in `__tests__/acceptance/e2eAgentRubricEvaluators.test.ts` and run in default `npm run verify`.

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
E2E_SCENARIO_IDS="direct-agentdojo-untrusted-workspace-note direct-bfcl-v4-parallel-relevance direct-toolsandbox-state-dependency direct-tau-user-coordination-state direct-androidworld-calendar-add-update direct-mobileworld-cross-app-contact-message direct-spabench-cross-app-device-actions direct-longmemeval-v2-mobile-preference-update" npm run eval:e2e:assess
```

### Environment variables

| Variable                   | Required            | Purpose                                                           |
| -------------------------- | ------------------- | ----------------------------------------------------------------- |
| `RUN_E2E_AGENT_EVAL`       | Yes                 | Set to `1` in `.env.local` (harness loads it automatically)       |
| `E2E_PROVIDER`             | No                  | `gemini` by default; supports `openai`, `openrouter`, `openai-compatible` |
| `GEMINI_API_KEY`           | For Gemini          | Same key as emulator Gemini provider                              |
| `GEMINI_BASE_URL`          | If Vertex           | Match app provider settings                                       |
| `E2E_GEMINI_MODEL`         | No                  | Override Gemini model (default: capable flash from catalog)       |
| `OPENAI_API_KEY`           | For OpenAI          | OpenAI API key                                                    |
| `E2E_OPENAI_MODEL`         | For OpenAI          | OpenAI model used by live E2E                                     |
| `OPENAI_BASE_URL`          | No                  | Defaults to `https://api.openai.com/v1`                           |
| `OPENROUTER_API_KEY`       | For OpenRouter      | OpenRouter API key                                                |
| `E2E_OPENROUTER_MODEL`     | For OpenRouter      | OpenRouter model id                                               |
| `E2E_COMPATIBLE_API_KEY`   | For compatible      | Generic OpenAI-compatible API key                                 |
| `E2E_COMPATIBLE_BASE_URL`  | For compatible      | Generic OpenAI-compatible base URL                                |
| `E2E_COMPATIBLE_MODEL`     | For compatible      | Generic OpenAI-compatible model id                                |
| `E2E_MAX_SCENARIO_RETRIES` | No                  | Per-scenario retry budget (default `0`; nightly uses `1`)         |
| `E2E_REPORT_PATH`          | No                  | JSON run report path (default `.artifacts/e2e-agent-report.json`) |
| `E2E_SCENARIO_IDS`         | No                  | Comma/whitespace-separated scenario IDs for targeted assessment   |

The harness scripts (`eval:e2e`, `verify:strict:e2e`) load `.env.local` via `scripts/load-local-env.js`. They are never bundled into the app.

### E2E JSON report

`npm run eval:e2e` writes a structural JSON artifact (when the suite runs) with per-scenario pass/fail, attempt count, token usage, cache reads, duration, and an **`assessment`** block with dimensional and benchmark-family pass rates. Default path: `.artifacts/e2e-agent-report.json` (gitignored). Nightly CI uploads this file as a workflow artifact.

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

Benchmark families for mobile assistant scope (structural rubrics only):

| Family                       | External lineage                                | Kavi scenarios                                                                                   |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `kavi-core`                  | Kavi core mobile-assistant scenario suite       | core workspace, memory, native tool, delegation, and goal-completion flows                        |
| `gaia-adapted`               | GAIA multi-hop file reasoning                   | `bench-gaia-file-hop-chain`, inventory flows                                                     |
| `tau-bench-adapted`          | τ-bench structured final-state outcomes         | `native-calendar-json-field`, `bench-tau-native-json-outcome`, `bench-goal-json-field-criterion` |
| `agentbench-adapted`         | AgentBench multi-tool chains                    | `bench-agentbench-tool-chain`, file/inventory chains                                             |
| `memory-agent-bench-adapted` | MemoryAgentBench long-horizon recall            | memory + passive ingestion scenarios                                                             |
| `state-bench-adapted`        | STATE-Bench multi-turn task tracking            | goal-switch + scoped recall scenarios                                                            |
| `tool-discovery-adapted`     | Tool search + session activation                | `bench-session-tool-cache`, `bench-tool-describe-then-use`, catalog flows                        |
| `bfcl-adapted`               | Berkeley Function Calling Leaderboard (BFCL v4) | `bench-bfcl-parallel-file-read`, `bench-bfcl-sequential-memory-chain`                            |
| `longmem-adapted`            | LongMemEval delayed recall                      | `bench-longmem-delayed-recall`                                                                   |
| `androidworld-direct`        | AndroidWorld app-state rewards                  | `direct-androidworld-calendar-add-update`                                                        |
| `mobileworld-direct`         | MobileWorld cross-app/user-interaction tasks    | `direct-mobileworld-cross-app-contact-message`                                                   |
| `spa-bench-direct`           | SPA-Bench smartphone resource metrics           | `direct-spabench-cross-app-device-actions`                                                       |
| `bfcl-v4-direct`             | BFCL V4 agentic tool evaluation                 | `direct-bfcl-v4-parallel-relevance`                                                              |
| `longmemeval-v2-direct`      | LongMemEval-V2 dynamic memory abilities         | `direct-longmemeval-v2-mobile-preference-update`                                                 |
| `tau-bench-direct`           | τ-bench / τ² / τ³ user-tool state interaction   | `direct-tau-user-coordination-state`                                                             |
| `toolsandbox-direct`         | ToolSandbox state dependency                    | `direct-toolsandbox-state-dependency`                                                            |
| `agentdojo-direct`           | AgentDojo untrusted-content safety              | `direct-agentdojo-untrusted-workspace-note`                                                      |

Registry: `src/acceptance/e2eAgent/e2eBenchmarkRegistry.ts`. Report builder: `e2eAssessmentReport.ts`.

**Flake policy:** set `E2E_MAX_SCENARIO_RETRIES=1` for operational runs (nightly). Local maintainer runs default to `0` so failures surface immediately. Retries are general — any scenario may be re-run once; no scenario-specific gating.

### Scenarios and pass bar

| Suite             | Test file                      | Scenarios                                                            | Pass bar                                    |
| ----------------- | ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------- |
| Core + benchmarks | `e2eAgentMetrics.test.ts`      | 49 (16 core + 25 adapted benchmark + 8 direct benchmark shards)      | ≥90% per run (`E2E_SCENARIO_MIN_PASS_RATE`) |
| Delegation        | `e2eDelegationMetrics.test.ts` | 2 (`delegation-worker-finalize`, `delegation-worker-evidence-chain`) | 100% (mocked worker, structural rubrics)    |

**Core scenarios (personal-assistant scope):** file write + read, goal evidence completion, gate recovery, `tool_catalog` + `agents`, memory remember + recall, shopping list, workspace inventory manifest, native calendar JSON, passive memory ingestion, goal-scoped recall, and multi-turn flows (memory preference, trip artifact, inventory readback, catalog → memory, catalog query → memory recall, gate follow-up). Multi-turn scenarios invoke `runOrchestrator` once per user message with accumulated history and graph resume — matching the foreground conversation path.

**Benchmark-adapted scenarios (`bench-*`):** GAIA file-hop chain, session memory cache, describe-then-use, 3-turn memory state, native calendar state criterion, scoped goal-switch recall, bootstrap-first-turn goals, τ-bench calendar state chain, AgentBench inventory chain, BFCL parallel file read, BFCL sequential memory chain, LongMemEval delayed recall, AndroidWorld/MobileAgent/MobileWorld/KnowU-style native fixture tasks.

**Direct benchmark shards (`direct-*`):** local runnable direct ports for AndroidWorld calendar app-state reward, MobileWorld cross-app contact/message flow, SPA-Bench cross-app device actions, BFCL V4 parallel/relevance state, LongMemEval-V2 dynamic mobile preference memory, τ-style missing-info coordination, ToolSandbox state dependency, and AgentDojo untrusted workspace content. These are not full upstream benchmark replacements; `e2eBenchmarkManifest.ts` keeps the full Android emulator, mobile GUI/MCP, provider matrix, and security fixture runners marked as external requirements.

**Assessment coverage:** `e2eAssessmentCoverage.test.ts` asserts every assessment dimension maps to ≥2 scenarios and every benchmark family maps to ≥1 scenario (`e2eBenchmarkRegistry.ts`).

**Structural rubrics:** graph status, terminal success, completion holds, workspace paths and absence, file hashes, memory predicates, native fixture state, goal status/criteria, user-turn count, token budgets, cache reads, graph audit observations, ingestion jobs, memory episodes, and working-block tokens. E2E scenarios do not declare `allowedTools` and do not score `tool_called`, `tool_sequence`, `tool_call_max`, `first_turn_tool_called`, `graph_session_tools`, or tool-result `json_field` rubrics. Redacted traces still include tool calls/results for debugging. Native mobile scenarios use deterministic dispatch fixtures (`e2eNativeCalendarFixtures.ts`) when `RUN_E2E_AGENT_EVAL=1`. No English regex on assistant prose. Unit tests: `e2eAgentRubricEvaluators.test.ts`, `e2eScenarioRunner.test.ts`, `e2eBenchmarkRegistry.test.ts`, `e2eAssessmentReport.test.ts`, `e2eNativeCalendarFixtures.test.ts`, `graphTaskScope.test.ts`.

**Delegation scenario:** supervisor spawns worker (`sessions_spawn` + `waitForCompletion`), worker evidence (`evidence.prefix:worker`), goal completion, graph terminal success. Worker session is mocked; Gemini drives supervisor tool loop. Goal pins `sessions_spawn` via `requiredCapabilities: ['coordinate']`.

### Cost and time expectations

| Scope                           | Typical duration | Token budget (ceiling)                                |
| ------------------------------- | ---------------- | ----------------------------------------------------- |
| Core + benchmark (49 scenarios) | 30–60+ minutes   | ≤4M total (`E2E_PROGRAM_MAX_TOTAL_TOKENS`)            |
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

Live E2E delegation (`delegation-worker-finalize`) runs in `__tests__/acceptance/e2eDelegationMetrics.test.ts` (separate from the 5-scenario core suite) with a mocked worker session and structural rubrics (`sessions_spawn`, `goal_evidence_satisfied`, `graph_terminal_success`). The worker goal pins `sessions_spawn` via `requiredCapabilities: ['coordinate']`.

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

For Android release work, start with the public-safe environment check. It
verifies Java and Android SDK discovery without requiring maintainer signing
material:

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
