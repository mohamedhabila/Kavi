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
- [`evaluation/klae-private-governance.schema.json`](../evaluation/klae-private-governance.schema.json):
  public schema for private split registries and evaluator-controlled packs.
- [`evaluation/klae-private-registry.template.json`](../evaluation/klae-private-registry.template.json):
  metadata-only starting point with zero digests and no cases or gold.
- [`evaluation/judge-calibration.schema.json`](../evaluation/judge-calibration.schema.json):
  private calibration-input and content-free aggregate-report contract.
- [`evaluation/statistics.schema.json`](../evaluation/statistics.schema.json):
  deterministic trial-set and public statistics-report contract.
- [`evaluation/intent-frame.schema.json`](../evaluation/intent-frame.schema.json):
  evaluator-only intent-frame input and content-free aggregate-report contract.

Validate all public governance artifacts without a provider key, private pack,
or network access:

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

Every full private split independently covers all KLAE families, the four
mode transitions derived from actual turns, positive/negative/mixed controls,
and short (2-3 turns), medium (4-15 turns), and long (16+ turns) case histories.
Lifecycle coverage is causal: a relevant user interaction must occur before
and after a new conversation, background, reboot, or provider-change boundary;
kill/relaunch and offline/online windows must be exercised end to end. Each
opaque longitudinal persona owns exactly one set of cases, has at least 30
strictly chronological interactions, and spans at least four non-overlapping
time periods that each contain an interaction. Persona IDs, assignments, time
boundaries, inputs, and gold remain private.

### Private KLAE release procedure

Use one owner-only directory per release attempt. Names shown here are generic;
never copy real custodian identities or local locators into public reports.

```text
.private/evals/<release-id>/
  registry.json
  development.pack.json
  locked-validation.pack.json
  sealed-held-out.pack.json
```

The validator accepts only regular JSON files under `.private/evals`, rejects
`..` traversal and every symlink component, and reads no file larger than
32 MiB. The three `packPath` values are relative to `registry.json`. Keep the
directory mode `0700` and files mode `0600`; do not mount it into the app,
commit it, or upload it as CI evidence.

Ownership is part of validity, not an administrative note:

1. Candidate maintainers may inspect and iterate on the development split.
2. A validation custodian keeps the locked pack from the candidate and returns
   results only. Its access reviewer must also be independent from the
   candidate.
3. A different held-out custodian owns the sealed pack. That owner must be
   distinct from candidate maintainers, the registry owner, and both other
   split owners. The candidate receives aggregate results, never pack bytes.
4. The registry owner records pack IDs, byte digests, counts, custody, and an
   access review performed no earlier than the baseline freeze. The evaluator
   runs the release check on a custody-controlled machine that can read all
   three files; custody does not transfer to the candidate.

Create a release without editing the public template in place:

1. Copy `evaluation/klae-private-registry.template.json` to the owner-only
   release directory as `registry.json`.
2. Freeze a clean app commit, the complete evaluation configuration snapshot,
   and the complete production prompt snapshot. Give the baseline a new opaque
   ID and set `registryState` to `frozen`.
3. Replace every template identity and timestamp. Keep `goldExposure` equal to
   `evaluator_only`; the app process receives only chronological case inputs.
4. Validate the case counts and coverage locally. Put the raw SHA-256 of each
   final pack into its descriptor. Any byte change requires a new digest.
5. Complete the independent access reviews, then hash `registry.json` last.
   Store that registry digest in the release ledger outside the registry. Do
   not modify a frozen registry; create a new release directory and digest.

Use a byte digest, not a JSON reserialization digest. This keyless Node command
works identically for every pack, snapshot, and registry:

```bash
node -e 'const c=require("node:crypto"),f=require("node:fs"),p=process.argv[1];process.stdout.write(c.createHash("sha256").update(f.readFileSync(p)).digest("hex")+"\n")' -- <file>
```

Run the fail-closed gate with values copied from the independent freeze ledger:

```bash
npm run check:evaluation-release -- \
  --registry .private/evals/<release-id>/registry.json \
  --registry-sha <registry-sha256> \
  --candidate-id <candidate-id> \
  --baseline-id <baseline-id> \
  --app-sha <40-character-app-commit> \
  --configuration-sha <configuration-sha256> \
  --prompt-sha <prompt-sha256>
```

All flags are required. Release mode fails on missing packs, a template or zero
digest, count/coverage drift, checksum changes, baseline mismatch, unsafe file
resolution, invalid custody, candidate access to a restricted pack, or any
contamination status other than `clean`. It is still a governance check, not a
scenario runner and not evidence of a score.

Treat baseline resets and contamination as append-only decisions:

- Tuning after a locked-validation result creates a new baseline. Retire that
  locked pack for further tuning loops and obtain an independently prepared
  replacement before making another release claim.
- If candidate access to locked or held-out bytes or gold is detected, mark the
  current registry `invalidated`, record a reason, preserve the audit record,
  and stop. Never change it back to `clean`.
- A contaminated held-out pack is permanently ineligible for that candidate.
  A separate custodian must prepare a new pack, digest, registry, and access
  review against a newly frozen baseline.
- Changes to app code, production prompts, evaluation configuration, pack
  bytes, or custody metadata require a new frozen registry digest. There is no
  compatibility alias or fallback to an older registry or pack schema.

Public evidence may include the public schema and template, the checked-in
12-case representative pack, schema versions, split sizes, aggregate coverage
gate results, aggregate metrics, and immutable app/configuration/prompt/pack/
registry digests. It must not include the private registry body, local custody
paths, owner or reviewer identities, access notes, persona IDs or time periods,
case inputs, fixtures, assertions, gold, transcripts, raw outputs, or the
private validator command with its local arguments. A public run-manifest
artifact reference is rejected if it points into a `.private`, `private`,
`gold`, or `golden` path component, regardless of artifact visibility.

### Evaluator calibration gate

Deterministic structural evaluators identify themselves as
`deterministic_structural` and freeze implementation and rubric digests. They
do not need an LLM-judge agreement study. An `llm_judge` must be calibrated on
private, independently held human labels before its results are claim-eligible.

The private calibration file contains only opaque IDs, declared families, and
human/judge labels; prompt, rubric, model, and judge configurations are present
only as SHA-256 fingerprints. It requires at least 100 resolved human binary
labels, at least 20% of each class, and at least five resolved labels in every
declared family. Human `ambiguous` examples are reported separately and never
forced into a class. A judge `ambiguous` label against a resolved human label
counts as disagreement. A disagreement rate greater than or equal to 5% fails
the gate.

Freeze custody in this order:

1. Freeze the judge/model/prompt/rubric configuration and human-label bytes.
2. Record `humanLabelsFrozenAt`, then run and freeze judge predictions.
3. Record `judgePredictionsFrozenAt`, which must be strictly later than both
   configuration and human-label freezes.
4. Release human labels only after predictions are frozen, then perform the
   independent access review. Candidate access or pre-freeze label exposure
   invalidates custody.

The label fingerprints use versioned canonical projections sorted by opaque
example ID. Compute them locally without printing labels:

```bash
node -e 'const f=require("node:fs"),m=require("./scripts/lib/judgeCalibration"),v=JSON.parse(f.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify({humanLabelsSha256:m.digestCalibrationProjection(v.examples,"human"),judgePredictionsSha256:m.digestCalibrationProjection(v.examples,"judge")})+"\n")' -- .private/evals/<release-id>/judge-calibration.json
```

After placing those digests in the frozen input, run the keyless gate:

```bash
npm run check:judge-calibration -- \
  --input .private/evals/<release-id>/judge-calibration.json \
  --output .artifacts/judge-calibration-report.json
```

The command writes the aggregate report even when the gate fails and exits
nonzero when `claimEligible=false`. Public output contains counts, family
coverage, disagreement rate, evaluator fingerprints, and the input digest. It
contains no examples, labels, prompts, identities, or private paths. Reference
this report from the existing `evaluation_run` manifest; it is a calibration
artifact, not another product runner.

### Evaluator-only intent-frame baseline

The intent-frame scorer measures whether a separately produced, pre-execution
candidate frame matches evaluator-owned labels. It does not run the app, add a
model call to the request path, inject a frame into prompts, or change graph
behavior. Gold labels remain under evaluator control and are never mounted into
the app process.

The closed frame has ten fields:

| Field                  | Meaning                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `goal`                 | Requested outcome or subgoals.                                             |
| `entities`             | People, objects, apps, locations, records, or other referenced entities.   |
| `constraints`          | Hard limits the result or execution must respect.                          |
| `preferences`          | Soft choices that should guide an otherwise valid result.                  |
| `missingInformation`   | Facts that must be clarified before a safe or correct next action.         |
| `requestedAction`      | Closed action class such as answer, clarify, plan, execute, or remember.   |
| `requestedMode`        | Chitchat, agentic, either, or clarification before routing.                |
| `approvalRisk`         | No approval, approval required, prohibited, or unknown.                    |
| `temporalRequirements` | Deadlines, ordering, recurrence, duration, or explicit absence of timing.  |
| `successCriteria`      | Observable conditions that make the requested outcome complete.           |

Multi-value fields contain bounded canonical atoms. Use the sole atom `none`
for an explicit absence; combining `none` with another atom invalidates the
input. Action, mode, and approval risk use closed enums. Candidate frames
cannot contain request text, tool calls, execution traces, assistant output,
final answers, artifacts, or arbitrary extra properties. This prevents the
scorer from rewarding post-execution or answer leakage.

Build a real baseline in this order:

1. Freeze the implementation that produces candidate frames and its rubric.
   Candidate production must happen before tools execute and before a final
   answer exists. Run it as a separate evaluator adapter until a product change
   is independently justified; do not add it to the app's hot path for this
   evaluation.
2. Freeze the exact request-context artifact presented to that producer. Put a
   nonzero byte SHA-256 in `requestSha256`; do not put raw request text in the
   scoring input.
3. Have the gold custodian label each field as `scorable`, `ambiguous`, or
   `unscorable`. Ambiguous and unscorable fields require a reason and carry no
   forced target value.
4. Join candidate and gold records only on the evaluator machine. Record the
   original case ID, request digest, language, and product area. Freeze a
   `minimumScorableCoverage` between 0.5 and 1 before inspecting scores.
5. Compute both canonical projection digests. Each projection is sorted by case
   ID and binds case ID, request digest, language, product area, and either the
   candidate frame or gold frame. Reassociation or coverage relabeling then
   changes the digest.
6. Run the scorer and attach its public report to the corresponding
   `evaluation_run` evidence. A real product baseline additionally requires the
   frozen candidate artifact and product-run provenance; the checked-in
   synthetic fixture is not such a baseline.

Compute the projections without printing case content:

```bash
node -e 'const f=require("node:fs"),m=require("./scripts/lib/intentFrameEvaluation"),v=JSON.parse(f.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify({candidateArtifactSha256:m.digestIntentFrameProjection(v.cases,"candidate"),goldLabelsSha256:m.digestIntentFrameProjection(v.cases,"gold")})+"\n")' -- .private/evals/<release-id>/intent-frames.json
```

Copy those values into `source`, then run:

```bash
npm run evaluate:intent-frame -- \
  --input .private/evals/<release-id>/intent-frames.json \
  --output .artifacts/intent-frame-report.json
```

For every field, the scorer aggregates set-based true positives, false
positives, and false negatives over scorable labels, then derives precision,
recall, and F1. Enum fields are singleton sets. `macroF1` is the unweighted
mean of field F1 values, so fields with more atoms cannot dominate it.
Ambiguous and unscorable labels are excluded from confusion counts but remain
visible as exact per-field and total counts. Every field also publishes
`coverageRate = scorable / cases`; any field below the frozen minimum makes the
report ineligible even when its resolved subset has perfect F1.

`claimEligible` means that the scoring evidence, frozen digests, closed
contract, and minimum coverage rule are valid. It is not a capability pass bar
and does not mean the app reached a product-quality target. Set capability
targets in the versioned evaluation plan and apply them to an eligible real
run. The content-free report contains only digests, counts, coverage metadata,
and aggregate metrics—never case IDs, request digests, atoms, labels, or local
paths.

The multilingual, multi-product JSON fixture under `__tests__/fixtures` is
original synthetic data. It validates scoring math, ambiguity handling,
selection-bias resistance, digest binding, and leakage rejection. It does not
demonstrate multilingual intent understanding by the app. Do not describe a
product intent baseline until a real separately produced pre-execution
candidate artifact has been scored.

### Deterministic trial statistics

The statistics command consumes one private `evaluation_trial_set` associated
with an already validated `evaluation_run` manifest. Freeze its scenario
manifest, ordered trial seeds, `k`, comparison roles, bootstrap settings, and
their canonical digests before execution. The input must contain exactly one
trial for every scenario, declared trial index, and matching seed. A requested
paired comparison likewise requires one reference/candidate pair per grid
cell, and candidate scores must exactly match the same candidate trial.

Compute the two authoring digests with the implementation used by the gate:

```bash
node -e 'const f=require("node:fs"),m=require("./scripts/lib/evaluationStatisticsMath"),v=JSON.parse(f.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify({aggregationConfigSha256:m.digestCanonicalValue(v.aggregation),scenarioManifestSha256:m.digestCanonicalValue(v.scenarioManifest)})+"\n")' -- .private/evals/<release-id>/trial-set.json
```

Then create the content-free aggregate:

```bash
npm run aggregate:evaluation -- \
  --input .private/evals/<release-id>/trial-set.json \
  --output .artifacts/evaluation-statistics-report.json
```

Reliability metrics are scenario-level:

- `passAt1` is qualified success on the first frozen trial.
- `passAtK` is the observed fraction with at least one qualified success among
  the first frozen `k` trials. It is deliberately not the combinatorial
  pass-at-k estimator used for sampling from a larger candidate pool.
- `allPass` requires qualified success on every declared trial.

A qualified success excludes accidental success and requires every declared
safety invariant to pass. Scenarios with missing, duplicate, skipped,
ambiguous, infrastructure-invalid, or unevaluated safety evidence are excluded
from rate denominators and make the report claim-ineligible; they are never
silently counted as product failures. A zero resolved denominator produces
`null` rate and interval, not a fabricated 0%. Each binary rate includes the
Wilson 95% interval over resolved scenarios.

Paired task and rubric deltas use
`paired_scenario_cluster_percentile_v1`. The evaluator first averages trial
deltas within each scenario, sorts opaque scenario clusters by code point, and
then resamples whole scenario clusters with replacement using the recorded
Mulberry32 seed. The 2.5th and 97.5th percentiles use linear interpolation at
position `(sampleCount - 1) * p`. Every resolved pair remains in its cluster;
an endpoint marked accidental contributes qualified task and rubric score 0
instead of disappearing and changing weights. Resolved, qualified, and
accidental endpoint counts remain separate.

The public report includes all 20 failure-taxonomy categories, including zero
counts, plus skipped/missing/ambiguous/infrastructure evidence, accidental
successes, and every safety invariant. It contains no scenario or pair IDs,
trial seeds, text, labels, or private locators. `claimEligible=true` means the
evidence is complete and internally valid; it does not mean a product target,
release threshold, benchmark rank, or safety bar was attained.

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
