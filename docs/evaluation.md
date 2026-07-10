# Evaluation Contract

Kavi evaluates product behavior first. Benchmark results are evidence about
that behavior; they are not a reason to add dataset-specific branches to the
app. This document defines the public evaluation vocabulary, claim rules, and
the Kavi Longitudinal Assistant Evaluation (KLAE) development-pack contract.

The machine-readable sources are:

- [`evaluation/schema.json`](../evaluation/schema.json): JSON Schema for the
  contract, case pack, and run manifest.
- [`evaluation/contract.json`](../evaluation/contract.json): canonical enums,
  artifact versions, metrics, failure categories, and claim rules.
- [`evaluation/klae-development.json`](../evaluation/klae-development.json):
  12 original synthetic product cases with visible structural gold state.

Validate all three without a provider key or network access:

```bash
npm run check:evaluation-contract
```

This command validates governance artifacts. It does not execute KLAE or
create a result claim. Scenario execution must use a product-real runner and
emit a conforming `evaluation_run` manifest.

## Evaluation lanes

Every run selects one lane, one protocol-conformance value, one split kind,
and exactly one verification label. These fields answer different questions.

| Lane                 | Purpose                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| `product_native`     | Exercises the real assistant lifecycle, modes, memory, tools, and mobile state.        |
| `memory_isolated`    | Measures a bounded memory interface separately from the full product.                  |
| `full_upstream`      | Runs an upstream benchmark protocol without claiming an official candidate.            |
| `official_candidate` | Freezes clean app and upstream revisions for a protocol-complete submission candidate. |

Protocol conformance is independent of the lane:

| Value            | Meaning                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `product_native` | Kavi's own product protocol.                                                                          |
| `adapted`        | A locally designed scenario or adapter inspired by an external capability; not the upstream protocol. |
| `upstream_full`  | The complete released upstream protocol, locally executed.                                            |
| `official`       | The upstream protocol and submission requirements are satisfied for an official candidate.            |

An adapted or product-native result must not be presented as an official
upstream score. An `official_candidate` requires `official` conformance, clean
app and upstream revisions, recorded upstream provenance, and the upstream
project's own acceptance process where one exists.

## Verification labels

A public run has exactly one of these labels:

| Label                    | What it proves                                                                    |
| ------------------------ | --------------------------------------------------------------------------------- |
| `local_only`             | The recorded configuration ran locally; no review beyond the producer is claimed. |
| `self_published`         | The project published the result and its reproducibility evidence.                |
| `maintainer_reviewed`    | A maintainer reviewed the disclosed configuration and artifacts.                  |
| `independently_verified` | An independent party reproduced or verified the result.                           |
| `hidden_test`            | The scored test data remained evaluator-controlled and hidden from the candidate. |

`hidden_test` describes data custody, not official status. Likewise,
`maintainer_reviewed` does not imply independent reproduction. The run's lane,
protocol conformance, source provenance, and submission record still apply.

## Split governance and anti-overfitting rules

| Split               | Rule                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `development`       | Visible cases for implementation feedback and regression diagnosis.                                               |
| `locked_validation` | A frozen comparison set. Tuning after inspecting results resets the declared baseline.                            |
| `sealed_held_out`   | Gold data has separate ownership. A candidate maintainer who inspects it invalidates that pack for the candidate. |
| `public_benchmark`  | A final external measurement, not a prompt-development loop.                                                      |

The KLAE governance target is 40 development scenarios, 40 locked validation
scenarios, and at least 100 sealed held-out scenarios with separate ownership.
Those private packs stay outside git. The checked-in 12-case development pack
is a representative, redistributable contract fixture, not a substitute for
the private packs and not a leaderboard score.

Production code must not branch on a case ID, family, expected value, benchmark
name, dataset ID, question ID, answer type, golden action, or evaluator rubric.
Adapters may call product interfaces; product code must never import evaluation
data or benchmark packages. Gold state stays outside the app process.

Public benchmark prompts and test examples must not be used to tune production
prompts. If a public example exposes a general product failure, reproduce the
behavior with a new original synthetic product case and fix the shared product
path.

## KLAE case-pack contract

KLAE asks whether persistent context makes Kavi more useful, natural, safe,
and continuous across direct chat and agentic work. The public pack covers all
four concrete mode transitions and representative profile, preference,
correction, temporal, episodic, open-loop, procedure, failure, interference,
abstention, silence, deletion, multilingual, attachment, lifecycle,
delegation, safety, and long-task recovery behavior.

Each case contains four evaluator-owned sections:

- `fixtures`: synthetic starting state. The runner installs this state without
  exposing fixture identifiers or gold values to Kavi.
- `steps`: chronological user turns, allowed attachments, and lifecycle events.
  Only the applicable chronological inputs reach the product.
- `assertions`: structural observations evaluated after a named step. They are
  never included in prompts or tool output.
- `metricIds`: registered dimensions to aggregate after case evaluation.

The pack is intentionally provider-neutral and requires neither network access
nor a paid model. A later live run may choose a hosted provider, but that run
must disclose the model, endpoint digest, pricing status, and other manifest
fields.

### Structural assertion semantics

Assertion targets are stable logical observation paths, not prose snippets.
A product-real runner maps these paths to captured state:

| Root                      | Observation examples                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `turn`                    | Actual mode, structured assistant decision, memory references, answer fact references.   |
| `memory`                  | Current and historical facts, episodes, experience records, indexes, and derived caches. |
| `native`                  | Calendar, contact, message, notification, and other mobile fixture state.                |
| `workspace` or `artifact` | File existence, digest, language metadata, source references, and structured contents.   |
| `run` or `open_loop`      | Execution status, checkpoint recovery, outcomes, retries, and pending work.              |
| `retrieval`               | Candidate and supporting-evidence counts or identifiers.                                 |
| `privacy` or `delegation` | Residual-store counts, leak counts, and task-scoped references.                          |
| `queue` or `lifecycle`    | Ingestion state and persisted lifecycle recovery state.                                  |

Allowed operators are deliberately small:

- `equals` compares a scalar exactly.
- `contains` and `not_contains` test exact scalar membership in a structured
  collection. They are not string-substring or regular-expression checks.
- `exists` and `absent` test structural presence.

Scoring assistant prose with English regular expressions is outside this
contract. The evaluator records an answer, clarification, abstention, or action
as a structured decision and separately checks memory evidence, external state,
artifacts, and completion. A case should not prescribe tool names or tool order
when multiple product-valid routes reach the same verified outcome.

## Metrics

`pass_at_1` is the primary result. Report `pass_at_k` and `all_pass` only beside
`pass_at_1`, with trial count, seeds, and variance or confidence intervals.
Infrastructure errors and accidental successes remain visible.

| Metric ID            | Definition                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `pass_at_1`          | Fraction of cases passing on the first trial.                                                    |
| `pass_at_k`          | Fraction with at least one pass across the declared `k` trials.                                  |
| `all_pass`           | Fraction passing every declared trial; a reliability measure.                                    |
| `task_understanding` | Correct goal, entities, constraints, missing information, action choice, and success conditions. |
| `task_completion`    | Verified requested external state or artifact plus a faithful completion status.                 |
| `memory_write`       | Correct durable writes, updates, withdrawals, scope, and provenance.                             |
| `memory_retrieval`   | Required evidence retrieved without irrelevant, stale, deleted, or cross-scope pollution.        |
| `memory_utilization` | Retrieved evidence used correctly in the answer, decision, or action.                            |
| `false_memory_rate`  | Rate of unsupported, misassigned, stale, or invented memory claims; lower is better.             |
| `privacy_safety`     | Deletion, opt-out, scope, sensitivity, worker-minimization, and leak invariants.                 |
| `latency`            | Recorded end-to-end and relevant stage latency, including distribution statistics.               |
| `cost`               | Measured or configured monetary cost. Missing pricing remains `missing`, never zero.             |
| `resource_use`       | Tokens, storage, network calls, wakeups, and measured mobile resource proxies.                   |

For probabilistic memory work, compare production memory, memory disabled, and
a simple scoped lexical baseline with the same model, prompts, tools, evaluator,
time budget, and trial seeds. Full-context and oracle-evidence conditions are
diagnostics, not product scores.

## Failure taxonomy

Every failed or errored run records one primary category and optional distinct
secondary categories:

| Category                                  | Boundary                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `routing_or_mode_selection`               | The wrong product path or persona executed.                                                      |
| `intent_misunderstanding`                 | Goal, entity, constraint, risk, or success condition was misunderstood.                          |
| `missing_or_unnecessary_clarification`    | Required information was not requested, or the user was asked for information already available. |
| `memory_write_omission`                   | Durable information that should have been written was not.                                       |
| `incorrect_memory_extraction`             | A write had the wrong fact, actor, scope, time, authority, or provenance.                        |
| `scope_or_persona_leak`                   | Evidence crossed a conversation, task, project, persona, or user boundary.                       |
| `retrieval_miss`                          | Required stored evidence did not reach the candidate or selected set.                            |
| `retrieval_pollution`                     | Irrelevant evidence displaced or confused useful evidence.                                       |
| `stale_or_deleted_memory`                 | Superseded, withdrawn, expired, or deleted state resurfaced.                                     |
| `false_memory`                            | The assistant invented or misassigned unsupported memory.                                        |
| `memory_utilization_failure`              | Correct evidence was available but used incorrectly or ignored.                                  |
| `over_personalization_or_sycophancy`      | Memory was applied when irrelevant, inappropriate, or truth-distorting.                          |
| `plan_failure`                            | The chosen plan could not satisfy the request or its constraints.                                |
| `tool_discovery_or_choice`                | The assistant failed to find or select a capable surface.                                        |
| `tool_execution_or_state_mutation`        | Tool use failed or produced incorrect external state.                                            |
| `recovery_or_resume`                      | Checkpoint, retry, reconciliation, or lifecycle recovery failed.                                 |
| `premature_completion`                    | The run finalized before verified success or an honest terminal state.                           |
| `final_response_incomplete_or_unfaithful` | The final response did not match verified outcomes, uncertainty, or remaining work.              |
| `collateral_or_duplicate_side_effect`     | The run changed unrelated state or repeated an external mutation.                                |
| `infrastructure_or_evaluator`             | The environment, provider, harness, or evaluator prevented a valid product judgment.             |

## Run evidence and privacy

A conforming run manifest records app revision and dirty state, upstream
revision when applicable, dataset/config/prompt digests, models, endpoint
digests, host and device details, seeds and trials, pricing status, command
arguments, scenario counts, metrics, classified failures, and artifact
checksums. Commands and public metadata must not contain credentials, raw
endpoint URLs, absolute local paths, or private hostnames.

For app E2E reports, endpoint and runtime model-locator provenance are canonical
SHA-256 digests plus provider, hosted-model family, and a validated path-free
public model identity. Public readiness and redacted-trace indexes contain only
references explicitly based at `retention_root`; each path includes its run id.
The uploaded artifact includes that retention tree. It may contain structural
redacted traces, but never raw or private traces.

The current public trace contract is `e2e-redacted-trace-v2`. Each turn is a
closed projection of the immutable run result: actual route and mode,
completion states, hashed user and final-response identities, bounded AgentRun
counters, memory deltas and persistence-receipt counts, native state
fingerprints, and a verified lifecycle boundary when an app relaunch occurred.
Raw text, raw IDs, memory values, provider payloads, and native arguments are
excluded. Missing or unknown current-schema fields are rejected rather than
silently omitted. A hash is an integrity fingerprint, not anonymization or
permission to publish private input.

Raw scenario evidence is local and opt-in. Set `E2E_PRIVATE_EVIDENCE_DIR` to a
directory that resolves inside `.private/evals/` to write one unique
`e2e-private-scenario-evidence-v2` file per attempt. The private file retains
requested turns, final responses, exact memory and receipt evidence, tool and
native results, graph state, and verified relaunch boundaries for diagnosis.
Directories are owner-only, files are written atomically with mode `0600`,
symlink escapes are rejected, and no private path is included in a public
report. Never upload this directory as a public CI artifact.

Partial report exchange is a private, current-schema-only transaction. Writers
lock and atomically replace `e2e-partial-report-v2`; flush rejects legacy or
unversioned entries. Public runs are built in staging directories and atomically
published with their index, so a crash or colliding run cannot preserve stale
trace files or silently produce a mixed-schema artifact.

The public pack contains only original synthetic content and is licensed under
the repository's MIT license. Raw user data is never evaluation material
without explicit informed opt-in. Public reports exclude private transcripts,
provider payloads, hidden reasoning, credentials, and unnecessary personal
data. Publish structured decisions, action traces, checksums, and redacted
evidence needed to verify the outcome.

## Contributor workflow

For an evaluation or capability change:

1. State one product behavior and its primary metric.
2. Add positive coverage and an adversarial negative control using original
   synthetic content.
3. Keep evaluator gold outside the app process and validate structural outcomes.
4. Record privacy, network, provider, latency, storage, cost, and dependency
   impact where relevant.
5. Run the focused tests, `npm run check:evaluation-contract`, and
   `npm run verify`. Use `npm run verify:strict` for memory, agent, graph,
   orchestration, or end-to-end behavior.
6. Label any published result with one lane, protocol-conformance value, split,
   status, and verification label. State deviations explicitly.

The default contributor gate remains deterministic, keyless, and network-free.
Live providers, benchmark downloads, privileged mobile containers, and
proprietary accounts stay opt-in.
