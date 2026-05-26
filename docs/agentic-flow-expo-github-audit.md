# Agentic Flow Expo/GitHub Audit

Date: 2026-05-26

## Scope

Audit the Android app's Agent mode behavior on a complex execution task:

> Create a simple web app in the GitHub repo named `Expo`, discover the matching repository from the token-accessible GitHub account, commit and push the local changes when ready, rely on `.eas/workflows` to trigger deployment automatically, monitor with Expo tools, and iterate if needed.

The emulator was launched as `Pixel_9_Pro_XL`, package `com.kavi.mobile`. The installed app reported `versionName=1.0.0`, `versionCode=1`, and `lastUpdateTime=2026-05-26 10:22:01`. The open conversation was already in Agent mode with `gemini-3.5-flash` selected and contained the exact failed scenario.

This document now tracks investigation, implementation decisions, and verification status. The final implementation must solve the general tool-discovery and orchestration failure, not only the observed Expo/GitHub scenario.

## Observed Run Evidence

The active agent workflow was cancelled after 5 turns. The UI showed:

- Model: `gemini-3.5-flash`
- Usage: 60,758 tokens, $0.13, 10 calls
- Workflow status: `CANCELLED`
- Workflow chips: `Pilot: Block`, `Stage: Deliver`, `Last tool: Write File`
- Visible tools used: `read_file`, `expo_eas_create_project`, `write_file`
- No GitHub commit, branch, push, workflow-run, or checks tool was used.

The final visible findings were:

- `read_file: Error: file not found: package.json`
- `expo_eas_create_project: Error: Experience with name '@mohamed.habila/simple-web-app' does not exist. (path: app.byFullName)`
- `write_file: Wrote 516 chars to package.json`

The logs show Pilot first queued a review with score `2/20` and the summary:

> The workflow failed to create, commit, or deploy the web app due to missing project files and unregistered EAS experience errors.

After a continuation attempt, the logs show:

- `Tool started: write_file` with a new `package.json`
- `Tool completed: write_file`
- Multiple Pilot calls
- `Pilot blocked finalization`
- `Final response delivered`

## Refined Conclusions

1. Local file work is allowed and useful. The GitHub `commit_files` tool can commit conversation workspace files via `changes[].filePath`, and tests already cover that path. The failure is not local editing itself; the failure is that the run never transitioned from local artifact creation to a discovered GitHub repository commit/push.
2. The app does not provide an app-level linked GitHub repository for the agent. The agent must use GitHub read/discovery tools against the configured token, select the matching repository from user-supplied evidence such as the repo name `Expo`, and avoid fabricating a full repo name when the account/repo owner has not been verified.
3. The agent should not have called `expo_eas_create_project` for this task. The required first Expo step was project discovery/status/probe, then reuse of a suitable configured Expo/EAS project when one is present. Any GitHub repository linkage reported by Expo/EAS is evidence to cross-check, not a substitute for GitHub repository discovery.
4. The heuristic Pilot fallback is a failure mode for this class of execution task. It can be useful for producing a blocker report, but it must not be a normal approval path, and it must expose why the live Pilot evaluator was unavailable.
5. The early review trigger is a first-order orchestration failure. Review/Pilot evaluation must not run while the active capability workflow still has unresolved discovery, inspection, mutation, monitoring, or verification phases, unless the route has produced a real blocker.

## Regression Observed After First Implementation

The rebuilt APK exposed a worse but more precise failure:

- The workflow called a downstream status tool with a fabricated project reference and received `Error: expo-project-not-found`.
- It then called `file_edit` on `package.json` with `oldText: ""`, `newText: ""`, and `edits: []`, which failed validation.
- The generic route state marked that ordinary recoverable tool error as `Route blocked`, immediately moved the run into review/final synthesis, and Pilot then blocked with a heuristic fallback after the live evaluator did not return a schema-complete `pilot_report`.

Root causes identified:

1. The execution lane stripped discovery/read tools even when the capability workflow had selected them as phase prerequisites. This left the model with status/mutation tools before it had evidence for resource ids or file contents.
2. Route-required tools were merged with all planner-preferred tools, so downstream tools remained callable during the discovery phase.
3. Any tool result beginning with `Error:` was treated as a workflow-level hard blocker. Recoverable argument, lookup, and validation errors should instead feed corrective guidance into the next iteration.
4. Tier-1 mutating tools such as `file_edit` stayed loaded even when a route phase had narrowed the callable set to discovery prerequisites.
5. Chat UI review-phase transitions used provider/tool-name lists instead of capability descriptors.
6. The Pilot parser was too strict for Gemini-style structured-output variants and low-token partial reports.

Implementation updates now applied:

- The capability workflow computes prerequisite discovery/inspection requirements from tool descriptors before side-effect tools are eligible.
- Active route phases now provide the preferred tool set. Downstream planner tools are held back until the phase advances, while explicit worker requests can still keep `sessions_spawn` available.
- Execution tool selection preserves phase-required discovery tools but does not preserve arbitrary broad discovery/meta tools.
- Ordinary tool errors are stored as recoverable route feedback and surfaced in the next prompt; only explicit permission/configuration failures become hard route blockers.
- Mutating tier-1 tools are deferred when a route phase has narrowed the active execution tool set and the mutating tool is not phase-preferred.
- Review-phase classification now uses capability descriptors for monitor/wait tools rather than hardcoded provider tool-name lists.
- The Pilot schema now includes ordering and stronger constraints, higher token budgets, wrapped JSON parsing, and partial provider-payload salvage before heuristic fallback.
- The Expo-specific workflow prompt was removed from the orchestrator. The runtime now relies on generic capability contracts plus adapter-level tool contracts instead of provider-specific prompt routing.

## Regression Observed After Second APK Test

The next live emulator run exposed a broader orchestration failure:

- The agent discovered repositories and EAS state, but then wrote user-facing instructions instead of creating files, committing, pushing, and monitoring with tools.
- The assistant repeatedly produced similar plan/instruction drafts and command snippets, which burned tokens without producing required side-effect evidence.
- The workflow reached high usage (`708,243` tokens, 53 calls, 250 log entries in the observed run) while still failing to complete required tool-backed actions.
- Generic or repeated coordination/discovery actions could keep the run in a "working" posture without advancing the capability workflow.

Additional root causes identified:

1. Execution route narrowing treated early discovery/inspection phases as a hard tool boundary, so write-capable local tools were not always visible when inspection proved that requested artifacts were absent.
2. The finalization hold only checked whether workflow phases were active. If route state had been marked complete incorrectly, a text-only instruction draft could proceed toward Pilot/finalization despite missing required execution evidence.
3. Loop recovery for repeated catalog/status behavior told the model to produce final prose. For execution workflows, that is the wrong recovery path; it should switch to the next concrete contract-matched tool.
4. Resume handling reused the previous invalid assistant draft, encouraging duplicate visible output.
5. Generic `wait` was still present in SuperAgent-visible surfaces often enough to remain an attractive idle action.

Implementation updates now applied:

- Execution routes keep low-risk local write/edit tools callable while still restricting broad discovery/meta tools.
- Active workflow phases now load phase tools plus all required advancing tools, so the model can move from "missing file/resource" evidence directly into creation/mutation without asking for permission.
- Finalization now checks missing required tool evidence using capability descriptors, not only phase status. A completed route with no completed `write`, remote mutation, or typed external evidence is held and resumed.
- Orchestrator loop recovery now distinguishes execution workflow loops from ordinary answer loops. Repeated catalog/status behavior in execution mode forces a non-discovery contract-matched tool call instead of final prose.
- Workflow holds resume in a fresh assistant draft instead of appending to the invalid instruction draft, reducing duplicate output.
- Generic `wait` is no longer part of SuperAgent core/session defaults; only typed wait/monitor tools remain useful workflow evidence.

## Regression Observed After Third APK Test

The next emulator run isolated two deeper tool-use failures:

- Gemini repeatedly called the same discovery tools after earlier results were visible in the UI. The model explicitly reasoned that the "other tool results are not shown yet" and called the GitHub repository, file-read, and Expo project-listing tools again.
- Expo tools were selected and called out of lifecycle order. The model tried to operate with a fabricated project reference and did not receive a structured, model-usable correction that identified exact candidate project ids and the next valid arguments.

Root causes identified:

1. Gemini can reuse provider-local function-call ids such as `gemini-call-0` across separate assistant turns. The transcript guard deduplicated tool results globally by call id, so a later result with the same provider-local id could erase or hide the earlier result from the model-visible transcript.
2. Persisted UI/tool messages did not always carry completed tool-call metadata. On resume, the orchestrator could see the assistant tool-call card but not the matching role=`tool` result, causing repeat calls and race-amplified confusion.
3. Synthetic tool-result repair only emitted generic synthetic errors when a role=`tool` message was missing. It did not recover the real completed result already stored on the assistant tool-call metadata.
4. Tool catalog recommendations, loaded tool ordering, deferred prompt samples, and planner candidate ordering were still partly registry-order driven. For a category whose registry listed a guarded creation tool first, the model received a poor first-action signal even though descriptors marked that tool as remote mutation requiring approval.
5. Expo project-reference failures were exposed as thrown execution errors. The model saw "project not found" but not the authoritative candidate ids, selected default, or exact `nextSuggestedArgs` needed to repair the call.

Implementation updates now applied:

- `ensureToolResultPairing()` repairs each assistant turn locally. If an assistant tool call is already marked completed and has a stored result, the guard reconstructs the matching role=`tool` message with that real result. Synthetic fallback ids are scoped by assistant message id, tool-call id, and sequence.
- `deduplicateToolResults()` now deduplicates only within contiguous tool-result groups, preserving repeated provider-local ids across separate turns.
- The orchestrator repairs model-visible transcripts before each model request, after compaction, and after tool execution, so resumed runs receive paired tool calls/results consistently.
- Chat persistence now stores completed/failed `toolCalls` metadata on role=`tool` messages. Resume paths rebuild model-ready messages from the latest store state immediately before calling the orchestrator.
- The orchestrator now awaits the tool-result persistence callback before the next model request and yields one UI/event-loop frame after the result batch. Chat persistence flushes the conversation store for each committed tool result. This is a commit barrier, not a fixed delay: the next LLM request starts only after every tool call has either a committed result or a structured in-progress result.
- Orphaned `pending`/`running` tool calls now repair into structured in-progress tool results instead of synthetic failures, so a resumed model sees "this tool is still running / use a monitor or wait handle" rather than silently repeating the same call.
- A generic `scoreToolLifecyclePriority()` ranks descriptors by capabilities, workflow stages, side effects, and risk hints. It is shared by `tool_catalog`, active tool selection, deferred prompt samples, and planner candidate ordering.
- Deferred backfill now suppresses tools with remote mutation, external-run, destructive, guarded-creation, or approval-risk descriptors generically instead of relying on Expo-specific no-backfill lists.
- Expo tool adapters now validate `projectId` references at the boundary. Missing, invalid, or ambiguous references return structured correction payloads with `status`, `argumentName`, `resourceKind`, candidates, `selection.defaultProjectId`, `nextSuggestedTool`, and exact `nextSuggestedArgs` instead of throwing generic errors.

## Industry Guidance Reviewed

The revised plan is based on current primary-source guidance rather than only local code inspection:

- [MCP Client Best Practices](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices): naive hosts that load every tool into context break down as tool counts grow. The recommended patterns are progressive discovery and programmatic tool calling through a host broker/sandbox so large intermediate results do not flow through the model.
- [OpenAI function calling best practices](https://developers.openai.com/api/docs/guides/function-calling): keep initially available tools small, use tool search for deferred surfaces, describe functions/parameters/output explicitly, use code instead of making the model fill known arguments, and combine functions that are always called in sequence.
- [Gemini function calling best practices](https://ai.google.dev/gemini-api/docs/function-calling): keep active tool sets relevant and bounded, use strong parameter typing and detailed function/parameter descriptions, validate consequential calls, and return informative function-response errors that the model can use.
- [Gemini thought-signature/function-call notes](https://ai.google.dev/gemini-api/docs/thought-signatures): Gemini function-call turns require the tool response to be returned in the correct history context, reinforcing that transcript pairing and resume repair are correctness requirements rather than UI cleanup.
- [Expo EAS project configuration](https://docs.expo.dev/tutorial/eas/configure-development-build/): `eas init` links a project by writing `extra.eas.projectId`; agents should discover and reuse linked project ids instead of inventing names or creating new projects by default.
- [EAS Workflows getting started](https://docs.expo.dev/eas/workflows/get-started/): EAS Workflows are repository/workflow-file driven after the project is synced, so commit/push plus workflow monitoring is the normal automation path when workflows are configured.
- [OpenAI Agents SDK orchestration guide](https://openai.github.io/openai-agents-python/multi_agent/): LLM orchestration is useful for open-ended tasks, but code orchestration is more deterministic for speed, cost, and performance. The guide explicitly calls out structured outputs, chained steps, evaluator loops, parallelism, monitoring, and evals.
- [Google ADK overview](https://adk.dev/get-started/about/): production agent runtimes combine LLM agents with deterministic workflow agents such as sequential, parallel, and loop controllers, plus runner events, tracing, debugging, and evals.
- [LangGraph reference](https://langchain-ai.github.io/langgraph/reference/): long-running agents benefit from durable execution, explicit state, human-in-the-loop interruption, and traceable state transitions.
- [Anthropic tool definition guidance](https://platform.claude.com/docs/es/agents-and-tools/tool-use/define-tools): tool descriptions need detailed "what/when/how/limitations" guidance, complex tools benefit from examples, and fewer more-capable tools reduce selection ambiguity.
- [MCP 2025-11-25 schema](https://modelcontextprotocol.io/specification/2025-11-25/schema): tools can expose structured outputs and annotations such as read-only/destructive/idempotent/open-world hints, but annotations are only hints and cannot be trusted from untrusted servers.

## Best-Practice Architecture Target

The optimal fix is a hybrid agent runtime:

1. A capability registry owns tool metadata, risk, prerequisites, evidence produced, and retrieval ranking.
2. A progressive discovery layer retrieves a small candidate set, but deterministic capability requirements can force mandatory tools into the active set.
3. A code-driven orchestrator owns mandatory workflow phases for high-side-effect tasks: preflight, execute, monitor, evidence gate, final/block.
4. The model remains responsible for local implementation choices and flexible reasoning inside each phase, not for deciding whether mandatory phases can be skipped.
5. Tool calls return structured result envelopes, so finalization and Pilot evaluate typed evidence instead of fragile prose snippets.
6. Evals replay golden trajectories and failure trajectories across providers, especially Gemini, before app release.

## Primary Findings

### 0. Tool discovery is progressive, but not capability-complete

Root cause:

- The app already has a deferred catalog and `tool_catalog`, which matches current guidance for keeping initial tool sets small.
- The catalog and selector are still centered on names, static categories, descriptions, and the LLM planner's shortlist.
- There is no single normalized capability descriptor that answers: what side effect can this tool perform, what evidence does it produce, what resource does it act on, what prerequisites are required, what risk class applies, and which generic workflow stages can use it?
- `ToolDefinition` currently contains `name`, `description`, `input_schema`, and `strict`, but no first-class output schema, risk annotation, examples, workflow stages, or evidence contract.
- Dynamic MCP/skill tools get partial treatment through name conventions such as `skill__github__...`, but their capabilities are not normalized into the same registry as built-in tools.

Relevant code:

- `src/types/index.ts:618` defines `ToolDefinition`.
- `src/engine/tools/toolManager.ts:533` selects tools from static category and preferred-name signals.
- `src/engine/tools/parity-tool-catalog.ts:610` searches catalog text and returns activation names.
- `src/engine/tools/toolManager.ts:1029` builds deferred category summaries.

Implementation:

- Add `ToolCapabilityDescriptor` as an internal registry layer, separate from provider-facing tool definitions:
  - `name`, `source`, `namespace`, `category`, `aliases`
  - `capabilities`: `discover`, `read`, `write`, `commit`, `push`, `deploy`, `monitor`, `wait`, `verify`
  - `resourceKinds`: `conversation_workspace`, `github_repo`, `expo_project`, `eas_workflow`, `browser`, `ssh`, etc.
  - `sideEffects`: `none`, `local_artifact`, `remote_mutation`, `external_run`, `destructive`
  - `risk`: `readOnly`, `destructive`, `idempotent`, `openWorld`, `trustedMetadata`
  - `prerequisites`: required account/token/project/repo/workflow facts
  - `providesEvidence`: typed evidence kinds produced by successful results
  - `workflowStages`: generic workflow stages where the tool can advance state
  - `inputExamples` and optional `outputSchema`
- Build the registry from:
  - static built-in tools
  - Expo tool definitions
  - installed skills
  - connected MCP tools
  - manually curated overrides for critical dynamic tools like GitHub `commit_files`
- Replace name-only category promotion with retrieval over this registry:
  - deterministic capability requirements first
  - lexical/BM25-style matching over names, aliases, descriptions, examples, and workflow stages
  - optional LLM rerank only after the candidate set is bounded
  - hard pinning for required capabilities
- Extend `tool_catalog` to return structured capability matches, not only tool names and prose guidance.
- Treat MCP annotations as untrusted unless the MCP server is trusted; use local overrides for security and evidence policy.

Acceptance criteria:

- Tool selection can answer "which available tool can commit local workspace files to GitHub and produce commit evidence?" without relying on a model to remember `skill__github__commit_files`.
- For high-side-effect execution tasks, the active set is assembled by capability requirements, not by prompt keywords alone.
- Tool search remains progressive and keeps the active set small, but required capability tools cannot be omitted by planner error.

### 0b. The orchestrator should be a hybrid capability workflow, not an LLM-owned workflow

Root cause:

- The current orchestrator has useful pieces: LLM route-mode planning, deferred tool discovery, execution-lane filtering, pending async operation tracking, loop detection, and Pilot review.
- For high-side-effect tasks, those pieces are still coupled through prompt instructions and preferred-tool sets rather than an explicit capability workflow state machine.
- The model can choose an invalid order: create Expo project before resolving configured resources, write local files without discovering/committing to the target GitHub repo, or deliver after a Pilot fallback.
- Mandatory capabilities and required evidence should be code-owned because they are predictable process constraints independent of the user's language.

Relevant code:

- `src/engine/orchestrator.ts:1459` asks an LLM to shortlist tools.
- `src/engine/orchestrator.ts:2813` narrows tools for Gemini/on-device providers.
- `src/engine/pendingAsyncOperations.ts:249` tracks async operations after they exist, but not the entire capability lifecycle before the operation is created.
- `src/services/agents/agentWorkflowPilot.ts:3435` makes final Pilot decisions after the workflow has already drifted.

Implementation:

- Add a generic capability-workflow runtime layer:
  - workflow id
  - ordered stages
  - phase entry conditions
  - allowed/required capabilities per phase
  - state facts produced/consumed by phases
  - transition validators
  - evidence requirements for success and blocker states
  - retry/loop budgets
  - human-interrupt requirements when ambiguity remains
- Let capability contracts own high-risk flow constraints such as local artifact persistence, remote mutation, external execution, monitoring, and verification.
- Inside a stage, the LLM can still decide how to implement the app or interpret a failure, but the runtime decides which capability stage is active and which tools are callable.
- Store workflow state durably on the `AgentRun`: selected resources, local artifact paths, remote mutation evidence, external execution ids, blockers, and last valid transition.
- Add provider-safe structured outputs for planner/Pilot decisions, with validation diagnostics and deterministic blocker fallbacks.

Acceptance criteria:

- Equivalent execution requests enter the same capability stage sequence regardless of user language when the planner emits the same required capabilities.
- The model cannot treat resource-creation tools as valid before existing-resource resolution when a guarded creation contract applies.
- Finalization reads workflow state and typed evidence, not only transcript/tool-result prose.

### 1. The observed Expo/GitHub deployment lacked enforced capability stages

Root cause:

- The prompt in `src/engine/orchestrator.ts` described the correct flow only as advice: discover the GitHub repo, inspect/list Expo projects, verify project/workflow evidence, commit repository changes, then monitor workflow runs.
- That flow is advisory. It is not represented as a deterministic state machine or required capability set.
- In Gemini mode, `orchestrator.ts` narrows tools aggressively and relies on `planPreferredToolsWithLlm()` to choose the right shortlist.
- If the LLM shortlist misses GitHub or chooses the wrong Expo action, the run can still proceed with local file tools plus Expo tools, which is exactly what happened.

Relevant code:

- `src/engine/orchestrator.ts:719` documents the preferred Expo/GitHub workflow.
- `src/engine/orchestrator.ts:1459` builds the LLM tool planner.
- `src/engine/orchestrator.ts:2813` enters the Gemini narrow-tool path.
- `src/engine/tools/parity-definitions.ts:998` tells agents to call `expo_eas_list_projects` first.

Implementation:

- Add a generic capability workflow resolver for execution requests. It activates from planner-produced `routeMode`, `requiredCapabilities`, `requiredToolCategories`, and tool capability descriptors, not from hardcoded English intent terms.
- Force a minimum capability set from tool contracts:
  - local artifact preparation/persistence when local files must be created or edited
  - remote mutation when the user-visible outcome requires committing, pushing, updating, deploying, or otherwise changing remote state
  - external execution monitoring/waiting when deployment/build/workflow state must be observed
  - verification evidence before final delivery
- Keep the LLM planner for semantic interpretation, ranking, and optional extras, but do not let it remove required capability tools once the planner declares the needed capabilities.
- Add a generic workflow progress ledger with stages such as `discover_resource`, `inspect_resource`, `prepare_artifact`, `persist_artifact`, `mutate_remote_state`, `start_external_execution`, `monitor_external_execution`, `await_external_execution`, and `verify_evidence`.

Acceptance criteria:

- A Gemini request requiring local artifacts, remote mutation, and external execution evidence loads tools that cover all declared capabilities together.
- The agent can create files locally, but cannot finalize an execution task until the required remote side effects and verification evidence are present or a blocker is reported.
- Resource-creation tools are guarded by adapter-level resolvers so existing configured resources are reused before creation.

### 2. Dynamic GitHub tools are recognized, but not category-promoted unless the planner names them

Root cause:

- `getToolManagerCategoryForToolName()` maps `skill__github__...` and `mcp__github__...` tools to category `github`.
- `TOOL_CATEGORIES` has no static `github` category or GitHub keywords.
- `selectToolsForRequest()` builds `toolToCategory` only from static `TOOL_CATEGORIES`; if the LLM planner does not explicitly prefer `skill__github__commit_files`, GitHub tools stay deferred.
- Existing tests prove the happy path where `skill__github__commit_files` is preferred. The observed run hit the missing deterministic fallback path.

Relevant code:

- `src/engine/tools/toolManager.ts:289` defines `TOOL_CATEGORIES`.
- `src/engine/tools/toolManager.ts:615` builds the static category lookup.
- `src/engine/tools/toolManager.ts:662` category-promotes only tools found in that static lookup.
- `src/engine/tools/toolManager.ts:907` recognizes dynamic GitHub tool names.
- `__tests__/engine/toolManager.test.ts:609` covers preferred GitHub tool filtering.
- `__tests__/services/integrations.test.ts:539` covers `commit_files` reading conversation workspace `filePath`.

Implementation:

- Do not add user-text keyword promotion as the primary fix. Normalize GitHub/MCP/skill tools through capability descriptors so semantic planning and capability matching can find them independent of request language.
- In `selectToolsForRequest()`, use:
  - `const category = toolToCategory.get(tool.name) ?? getToolManagerCategoryForToolName(tool.name);`
- In execution capability augmentation, search available tools by descriptor:
  - category/source/resource kind
  - required capabilities such as `commit`, `push`, `monitor`, or `verify`
  - evidence kinds produced by successful results
- Keep `write_file` and `file_edit` available. The intended flow is local artifact creation followed by `commit_files` with `changes[].filePath`.

Acceptance criteria:

- If the planner omits a remote-mutation tool family, the capability workflow still loads a tool that satisfies the declared remote-mutation requirement.
- If no required mutating tool is available, the agent blocks before local-only work can be mistaken for remote progress.
- A test demonstrates: local `write_file` creates `package.json`, then `skill__github__commit_files` commits it with `filePath`, and the final evidence includes a commit SHA.

### 3. Linked Expo project discovery is advisory instead of mandatory

Root cause:

- `expo_eas_list_projects` already returns a selection hint and guidance to reuse an existing project.
- `expo_eas_status` and `expo_eas_probe` are designed to verify linked repo, workflow file, branch, and readiness.
- The model was still allowed to call `expo_eas_create_project` first.
- `createExpoProject()` only checks whether a project exists with the newly requested slug, not whether the configured account already has a linked project that should be reused for this task.

Relevant code:

- `src/engine/tools/parity-expo.ts:763` builds the list-project selection hint.
- `src/engine/tools/parity-expo.ts:787` tells agents not to repeat list-projects and to reuse the default project.
- `src/engine/tools/parity-expo.ts:811` executes project creation directly.
- `src/services/expo/eas.ts:1262` lists configured Expo projects.
- `src/services/expo/eas.ts:1317` marks EAS workflow projects without `repoFullName` as missing linked repo.
- `src/services/expo/eas.ts:3989` implements `createExpoProject()`.

Implementation:

- Add a shared resolver, for example `resolveExpoProjectForExecutionTask(args)`, that checks configured projects before create:
  - prefer a single enabled launchable project
  - prefer project matching the linked repo full name
  - prefer project matching explicit `@owner/slug` if present
  - if multiple candidates remain, return a structured ambiguity blocker
  - if none are configured, sync the linked account once, then retry resolution
- Use the resolver in capability-workflow preflight and in Expo create execution.
- Gate `expo_eas_create_project`:
  - allowed when the user explicitly asks to create/register a new Expo project
  - allowed when project discovery confirms no suitable linked project exists
  - otherwise return a guidance result pointing to the existing project id/fullName and next tool `expo_eas_status`
- Keep `expo_eas_create_project` available for real account bootstrap flows, but guard it whenever an existing linked project is already suitable.

Acceptance criteria:

- With one configured linked Expo project, the first Expo tool call is `expo_eas_list_projects` or `expo_eas_status`, not `expo_eas_create_project`.
- If `expo_eas_create_project` is called while a matching linked project exists, it does not create or lookup a new slug; it redirects the agent to the existing project.
- If multiple configured projects exist and none match the request, the agent asks for or reports the needed project choice instead of guessing.

### 4. Expo not-found normalization is still a secondary defect

Root cause:

- The failed create path exposed a real bug: `findExpoProjectByFullNameAsync()` does not normalize Expo's GraphQL message `Experience with name ... does not exist. (path: app.byFullName)`.
- This should not have been on the primary path for the observed task, but it still makes legitimate project creation fragile.

Relevant code:

- `src/services/expo/eas.ts:952` implements `findExpoProjectByFullNameAsync()`.
- `src/services/expo/eas.ts:992` has the incomplete not-found regex.
- `src/services/expo/eas.ts:4009` calls lookup before create.

Implementation:

- Extend not-found normalization to cover:
  - `Experience with name ... does not exist`
  - `does not exist`
  - `app.byFullName`
- Add a regression test where `byFullName` returns that exact GraphQL error and `createExpoProject()` proceeds to `createApp`.
- Keep this fix separate from the linked-project resolver so it does not mask the primary capability-ordering issue.

Acceptance criteria:

- Real Expo "does not exist" lookup errors become `null` from `findExpoProjectByFullNameAsync()`.
- Non-not-found GraphQL errors still throw.

### 5. Finalization evidence is too generic for commit/push/deploy tasks

Root cause:

- Local `write_file` and `file_edit` are operational evidence, but they are not repository side effects.
- Current evidence utilities can recognize tool-like sources and generic operational progress, but a commit/push/deploy task needs domain-specific evidence.
- The correct success evidence should include:
  - GitHub commit SHA or pushed ref
  - branch
  - file paths committed
  - Expo project id/fullName
  - workflow run id/url
  - terminal workflow status/conclusion or explicit blocker

Relevant code:

- `src/services/agents/approvalSignals.ts:7` treats local file writes as artifact mutations.
- `src/services/agents/approvalSignals.ts:120` infers artifact/external-run evidence from previews.
- `src/services/agents/agentWorkflowPilot.ts:1195` treats any verified/resolved workflow evidence as structured evidence.
- `__tests__/services/agentRunFinalization.test.ts:697` already covers GitHub commit plus Expo workflow evidence as valid finalization evidence.

Implementation:

- Add an execution objective/evidence classifier for side effects requested in the user prompt:
  - `local_artifact`
  - `github_commit`
  - `github_push`
  - `expo_project_ready`
  - `eas_workflow_triggered`
  - `eas_workflow_terminal`
- Require evidence per requested side effect. Local artifact evidence satisfies only `local_artifact`.
- Treat `skill__github__commit_files` output with commit SHA as satisfying `github_commit` and `github_push` only when the result confirms ref update/push semantics.
- Treat Expo workflow status/wait output as satisfying workflow criteria only when it references the selected project and run id.
- Update Pilot prompts and finalization checks to report missing side effects precisely.

Acceptance criteria:

- A run with only `write_file` cannot satisfy commit/push criteria.
- A run with local `write_file` followed by `skill__github__commit_files` can satisfy commit/push criteria.
- A run with commit evidence but no workflow run evidence cannot claim deployment.

### 6. Heuristic Pilot fallback is masking a live-evaluator failure

Root cause:

- `invokePilotEvaluator()` tries structured output, repair JSON, raw JSON, and tool-call fallback.
- If none returns a schema-complete payload, the code falls back to heuristic evaluation.
- The validation path is boolean: `isCompletePilotEvaluationPayload()` returns false without field-level diagnostics.
- `buildPilotEvaluatorFailure()` collapses parse/validation failures into "returned no schema-complete pilot_report payload".
- The UI can show fallback detail, but the visible run still ended with a confusing terminal sequence: `Pilot blocked finalization` followed by `Final response delivered`.

Relevant code:

- `src/services/agents/agentWorkflowPilot.ts:823` validates complete Pilot payloads.
- `src/services/agents/agentWorkflowPilot.ts:1927` builds fallback failure detail.
- `src/services/agents/agentWorkflowPilot.ts:1958` runs the live Pilot attempts.
- `src/services/agents/agentWorkflowPilot.ts:2456` blocks heuristic approval for execution tasks without structured evidence.
- `src/components/chat/AgentWorkflowWidget.tsx:306` can show `fallbackDetail`.
- `src/screens/ChatScreen.tsx:2921` logs `Final response delivered` for every terminal status.

Implementation:

- Make heuristic fallback explicitly non-approving for execution tasks. It may produce a blocker report, never final approval.
- Add field-level Pilot validation diagnostics:
  - missing top-level fields
  - invalid score values
  - missing/short `criterionEvaluations`
  - malformed tool-call arguments
  - provider response had no candidates
  - provider request/schema error
- For Gemini, prefer the most reliable Pilot path:
  - use forced `pilot_report` tool call as the primary or immediate fallback for Gemini when native `responseJsonSchema` is flaky
  - keep raw JSON fallback, but parse Gemini `providerReplay.geminiParts` and text parts with fixtures
  - include captured invalid response snippets in redacted diagnostics
- Add a retry policy for live Pilot unavailability before terminal block:
  - one immediate alternate-format retry
  - no heuristic approval
  - then terminal blocker with the precise evaluator failure reason
- Add a first-class terminal reason such as `pilot_blocked` or a new status `blocked`. If adding `blocked` is too large for the first patch, use `failed` with `terminalReason: 'pilot_blocked'`; do not represent a Pilot block as user cancellation.

Acceptance criteria:

- Gemini Pilot review returns a provider evaluation or a precise blocker reason; "heuristic fallback used" is not the normal steady-state result.
- Heuristic fallback cannot approve commit/deploy finalization.
- The UI exposes the field-level or provider-level reason the live Pilot failed.
- A Pilot block does not log or display `Final response delivered`.

### 7. Terminal UX makes blocked runs look delivered

Root cause:

- `ensureAgentRunFinalResponse()` always uses `FINAL_RESPONSE_CHECKPOINT_TITLE`.
- Assistant metadata is marked `completionStatus: complete` even for fallback blocker/failure text.
- The workflow card can show `CANCELLED` while logs say `Final response delivered`, producing contradictory UX.

Relevant code:

- `src/screens/ChatScreen.tsx:164` defines `FINAL_RESPONSE_CHECKPOINT_TITLE = 'Final response delivered'`.
- `src/screens/ChatScreen.tsx:2637` returns fallback output for non-completed statuses.
- `src/screens/ChatScreen.tsx:2878` marks fallback messages complete.
- `src/screens/ChatScreen.tsx:2921` appends `Final response delivered` for every terminal status.
- `src/types/index.ts:165` currently limits run status to `running | completed | failed | cancelled`.

Implementation:

- Add terminal presentation titles:
  - completed: `Final response delivered`
  - pilot blocked: `Blocker report delivered`
  - failed: `Failure report delivered`
  - user cancelled: `Cancellation report delivered`
- Add `terminalReason` metadata for assistant messages and run summaries:
  - `pilot_blocked`
  - `tool_failure`
  - `user_cancelled`
  - `missing_required_side_effect`
  - `live_pilot_unavailable`
- Prefer adding `blocked` as a first-class `AgentRunStatus` in a follow-through patch. If that migration is too wide, the minimum acceptable fix is status `failed` plus `terminalReason: 'pilot_blocked'`.

Acceptance criteria:

- Pilot-blocked runs never emit `Final response delivered`.
- The workflow card distinguishes user cancellation from an autonomous blocker.
- Final assistant content clearly states what was done locally, what was not committed/deployed, and what is required next.

## Recommended Fix Plan

### Phase 0: Capability registry and structured tool contracts

Files:

- `src/types/index.ts`
- `src/engine/tools/capabilityRegistry.ts`
- `src/engine/tools/toolManager.ts`
- `src/engine/tools/parity-tool-catalog.ts`
- `src/engine/tools/parity-definitions.ts`
- `src/services/skills/manager.ts`
- `src/services/mcp` integration files
- `__tests__/engine/toolCapabilityRegistry.test.ts`
- `__tests__/engine/parity-executor-new.test.ts`
- `__tests__/engine/toolManager.test.ts`

Work:

- Extend tool metadata with internal capability descriptors, risk annotations, input examples, output schemas, workflow stages, prerequisites, and evidence kinds.
- Keep provider-facing tool definitions compact, but make discovery and orchestration use the richer internal registry.
- Normalize dynamic GitHub/MCP/skill tools into the registry instead of relying on name prefixes alone.
- Update `tool_catalog` search/category responses to include capability, risk, prerequisites, evidence produced, and activation scope.
- Add a structured tool-result envelope:
  - `summary` for model-visible compact text
  - `structuredContent` for typed app/Pilot/finalization evidence
  - `isError`
  - `evidence`
  - optional `artifacts`
- Keep the existing string result path as a compatibility layer while migrating core tools.

Acceptance criteria:

- `tool_catalog query="commit local files to GitHub"` returns the GitHub commit tool with capability `commit`, resource kind `github_repo`, side effect `remote_mutation`, and evidence kind `github_commit`.
- Expo status/wait tools declare `expo_project_ready`, `eas_workflow_triggered`, and/or `eas_workflow_terminal` evidence.
- The active Gemini tool set stays small, but required capabilities can be pinned independent of LLM planner output.

### Phase 0b: Hybrid capability workflow runtime

Files:

- `src/engine/routes/agentRoutes.ts`
- `src/engine/tools/capabilityRegistry.ts`
- `src/engine/orchestrator.ts`
- `src/store/useChatStore.ts`
- `src/types/index.ts`
- `src/services/agents/agentRunFinalization.ts`
- `__tests__/engine/capabilityWorkflow.test.ts`
- `__tests__/engine/orchestrator.test.ts`

Work:

- Introduce a generic capability workflow runtime state on `AgentRun`.
- Use the semantic tool planner to emit structured `requiredCapabilities` and `requiredToolCategories`.
- For each generic workflow stage, derive allowed and required capabilities from the capability registry.
- Use exact/required tool choice only when a stage has one safe mandatory next tool; otherwise expose the bounded capability-matched tool set.
- Enforce workflow transitions after each tool result:
  - validate required structured evidence
  - update workflow state
  - continue, retry, replan, block, or finalize
- Add workflow-level blockers and terminal reasons.

Acceptance criteria:

- The capability workflow cannot treat local-only artifacts as evidence of remote mutation or external execution.
- Workflow state survives app restarts/resumes and is visible in logs/debug details.
- A blocker is produced before a model can invent success for missing required capabilities.

### Phase 1: Generic capability workflow and tool loading

Files:

- `src/engine/orchestrator.ts`
- `src/engine/tools/toolManager.ts`
- `src/utils/executionLanePolicy.ts`
- `__tests__/engine/toolManager.test.ts`
- `__tests__/engine/orchestrator.test.ts`

Work:

- Add the generic `capability-workflow` resolver.
- Force required tools by capability contracts after LLM planning.
- Add dynamic category fallback in tool selection from the capability registry, without relying on user-text keyword matching.
- Keep local artifact tools available, and ensure downstream remote-mutation tools receive references to the concrete artifacts they must persist.

### Phase 2: Linked Expo project resolver

Files:

- `src/services/expo/eas.ts`
- `src/engine/tools/parity-expo.ts`
- `src/engine/tools/parity-definitions.ts`
- `__tests__/services/expo-eas.test.ts`
- `__tests__/engine/parity-executor-expo.test.ts`

Work:

- Implement `resolveExpoProjectForExecutionTask`.
- Use it in capability-workflow preflight and guard `expo_eas_create_project`.
- Prefer `expo_eas_list_projects`/`expo_eas_status` before create.
- Consider adding a composite `expo_eas_resolve_project` or `expo_eas_preflight` tool that performs list/status/probe in one typed step. This follows the best-practice rule to combine functions that are always called in sequence, and it removes avoidable burden from the model.
- Normalize Expo "Experience with name ... does not exist" as a secondary hardening fix.

### Phase 3: Side-effect-aware evidence

Files:

- `src/services/agents/approvalSignals.ts`
- `src/services/agents/agentRunFinalization.ts`
- `src/services/agents/agentWorkflowPilot.ts`
- `__tests__/services/agentRunFinalization.test.ts`
- `__tests__/services/agentWorkflowPilot.test.ts`

Work:

- Classify requested side effects and required evidence.
- Make local file writes count as local artifact evidence only.
- Make GitHub commit result evidence satisfy commit/push criteria only with commit SHA/ref evidence.
- Make Expo workflow evidence satisfy deploy/monitor criteria only with project/run terminal evidence.
- Prefer structured tool-result evidence over transcript prose. Keep regex/prose extraction only as a backward-compatible fallback.

### Phase 4: Fix live Pilot reliability and fallback semantics

Files:

- `src/services/agents/agentWorkflowPilot.ts`
- `src/services/llm/LlmService.ts`
- `src/components/chat/AgentWorkflowWidget.tsx`
- `__tests__/services/agentWorkflowPilot.test.ts`
- `__tests__/services/LlmService.test.ts`

Work:

- Add field-level Pilot payload validation diagnostics.
- Add Gemini fixtures for structured output, raw JSON, and forced tool-call Pilot responses.
- Prefer forced Pilot tool-call path for Gemini if native structured output is unreliable.
- Use structured outputs for planner/classifier/Pilot where supported; when unsupported, validate with a schema library and retry with an alternate format. JSON validity alone is not enough.
- Treat heuristic fallback as a blocker-only emergency path for execution tasks.
- Surface the exact live Pilot failure reason in the widget/log details.

### Phase 5: Blocked terminal UX

Files:

- `src/screens/ChatScreen.tsx`
- `src/types/index.ts`
- `src/services/agents/agentRunPresentation.ts`
- `src/components/chat/AgentWorkflowWidget.tsx`
- `__tests__/screens/ChatScreen.test.tsx`

Work:

- Add blocked/pilot-block terminal presentation.
- Stop logging `Final response delivered` for non-completed outcomes.
- Add `terminalReason` metadata or a first-class `blocked` status.
- Ensure final fallback text is a blocker report, not a completed answer.

### Phase 6: Golden capability-workflow evals and replay

Files:

- `__tests__/engine/capabilityWorkflow.test.ts`
- `__tests__/engine/orchestrator-golden-workflows.test.ts`
- `__tests__/services/agentWorkflowPilot.test.ts`
- `__tests__/services/agentRunFinalization.test.ts`
- new eval fixtures under `__tests__/fixtures/capability-workflows/`

Work:

- Add golden trajectories:
  - existing linked project, successful local artifact commit, workflow success
  - linked project missing workflow file, blocker
  - multiple Expo projects, ambiguity blocker
  - GitHub token missing permission, blocker
  - live Pilot structured output succeeds
  - live Pilot structured output fails, heuristic blocks with diagnostics
- Add replay tests for Gemini planner/Pilot responses captured from the emulator run.
- Track pass/fail/flaky counts for workflow transitions, tool selection, and final evidence gates.

Acceptance criteria:

- A change to planner prompts alone cannot silently regress mandatory capability behavior.
- Capability evals fail if a creation tool is used before an existing resource resolver for the linked-resource scenario.
- Capability evals fail if a final success message lacks the required remote-mutation and external-execution evidence for the task.

## Validation Scenario After Fixes

Use the same Android emulator setup with Gemini selected, Expo configured, and GitHub token access configured. The app does not maintain a GitHub "linked repo" setting for the agent; the agent must discover accessible repositories from GitHub and select the repository from user-supplied evidence such as a repo name clue.

1. Ask the agent to create a small Expo web app in the GitHub repo named `Expo`, commit/push to the deployment branch, add the needed EAS workflow file, and monitor EAS workflow.
2. Expected tool sequence:
   - `skill__github__repos` or equivalent GitHub repository discovery when the exact repo full name is not already verified
   - `expo_eas_list_projects` before `expo_eas_status`
   - `expo_eas_probe`
   - local `write_file`/`file_edit` for app and workflow files as needed
   - `skill__github__commit_files` using `changes[].filePath` for local artifacts
   - `expo_eas_workflow_runs`
   - `expo_eas_workflow_wait` or `expo_eas_workflow_status`
3. Expected blocker behavior:
   - If GitHub permissions, Expo repo linkage, workflow config, or live Pilot evaluation are missing, the agent stops with a blocker report and does not claim deployment.
4. Expected success behavior:
   - The final answer includes commit SHA, branch, committed files, Expo project id/fullName, workflow run id/url, workflow terminal state, and deployed URL or explicit no-url reason.

## Test Matrix

- Tool selection: Gemini execution planning loads tools covering local artifact, remote mutation, external execution monitoring, and verification capabilities together.
- Local-to-GitHub commit: `write_file` creates files, then `skill__github__commit_files` commits those files with `changes[].filePath`.
- Existing configured Expo project: one synced configured project causes `expo_eas_status`/`probe` reuse; `expo_eas_create_project` is not called.
- Multiple configured Expo projects: ambiguous project selection returns a blocker instead of guessing or creating.
- Unknown GitHub repo: repository discovery runs before repo mutation; a name clue is matched against discovered repositories and ambiguity produces clarification, not a fabricated repo id.
- Expo create hardening: `Experience with name ... does not exist. (path: app.byFullName)` proceeds to create only when existing resource resolution cannot identify a suitable linked project or the user explicitly asks for a new project.
- Evidence gate: local-only artifacts cannot satisfy commit/push/deploy criteria.
- Pilot Gemini reliability: structured output, raw JSON, and forced tool-call fixtures all parse; invalid payloads report field-level diagnostics.
- Pilot fallback: live Pilot unavailability is reported as `unavailable`, not as a heuristic assessment. It may continue incomplete workflows or block finalization, but it must not approve execution tasks or present heuristic scoring as a real Pilot review.
- Premature finalization: an active capability workflow with pending phases withholds no-tool draft answers and forces the next turn back to phase-appropriate tools before Pilot review can run.
- Terminal UX: Pilot block displays `Blocker report delivered`, not `Final response delivered`.

## Implementation Progress

Completed in the current implementation pass:

- Added `src/engine/tools/capabilityRegistry.ts` with normalized tool capabilities, resources, side effects, evidence kinds, workflow stages, and selection helpers.
- Extended `tool_catalog` results with structured capability summaries and dynamic GitHub category browsing from skill/MCP tool contracts.
- Replaced the bespoke Expo/GitHub route attempt with a generic `capability-workflow` engine in `src/engine/routes/agentRoutes.ts`.
- Updated the orchestrator semantic planner to emit `requiredCapabilities`, run for actionable tool work beyond only narrow providers, and pin capability-required tools without depending on hardcoded user-language patterns.
- Added `AgentRun.routeState` and `terminalReason`, wired route-state updates to the chat store and Chat screen.
- Guarded `expo_eas_create_project` through `resolveExpoProjectForExecutionTask`, redirecting to existing linked projects unless creation is explicitly confirmed.
- Changed Pilot block outcomes from pseudo-cancelled to failed/blocker semantics with explicit `terminalReason`.
- Updated final report presentation so blocker/failure/cancellation reports are not logged as `Final response delivered`.
- Added phase-ordered prerequisite discovery so execution workflows cannot call downstream status/mutation tools before resource ids and file context are discovered.
- Changed route error handling so validation/lookup/tool-argument errors remain active recoverable feedback rather than triggering immediate review/final synthesis.
- Replaced hardcoded monitor/review tool-name checks in the chat runtime with capability-descriptor classification.
- Hardened Gemini Pilot structured output handling with property ordering, stronger schema constraints, larger response budgets, wrapped-payload parsing, and partial provider-payload salvage.
- Removed the provider-specific Expo/GitHub workflow prompt from the orchestrator; the runtime now uses generic external-workflow contracts and adapter tool contracts.
- Fixed the second emulator regression by preventing discovered tool catalogs from wholesale promoting unrelated tools into restricted execution phases. Discovery output now informs planning; only current phase/capability-selected tools become callable.
- Scoped planner-declared capabilities to planner-declared tool families when families are present, preventing broad capabilities such as `verify` from pulling unrelated verifier tools into a workflow.
- Added a workflow finalization hold in the orchestrator so no-tool draft answers cannot reach final review while the generic capability workflow route still has active or pending phases.
- Expanded GitHub capability descriptors for issue read/write tools so issue tools are honest remote-mutation contracts rather than generic discovery tools.
- Hardened Pilot parsing for schema-equivalent provider payloads: snake_case keys, string scores/booleans, wrapped reports, and criterion alias fields now normalize before validation.
- Fixed the third emulator regression where GitHub repo discovery succeeded but a missing local `package.json` caused a user-clarification/final-review path. Capability phases now track per-requirement completion, so one GitHub discovery result cannot complete workspace artifact prep, Expo discovery, remote mutation, or deployment monitoring.
- Generic `wait` is no longer force-loaded in execution SuperAgent lanes and no longer advertises workflow evidence. Concrete waits such as `sessions_wait`, `expo_eas_workflow_wait`, browser waits, and SSH job waits keep their typed contracts.
- Added an app-level finalization guard before Pilot review: if an `AgentRun.routeState` is still active, ChatScreen resumes the run with workflow-hold guidance instead of starting Pilot/final delivery.
- Changed live Pilot unavailability from heuristic fallback scoring to explicit `source: "unavailable"` decisions. Incomplete workflows continue; finalization attempts block with `live_pilot_unavailable` unless a real structured Pilot report is returned.

Verified so far:

- `npm run typecheck`
- `npm run lint`
- `npm run check:public-hygiene`
- `npm run check:i18n`
- `npm test -- --runInBand`
- `jest __tests__/services/agentWorkflowPilot.test.ts --runInBand`
- `jest __tests__/engine/capabilityWorkflow.test.ts --runInBand`
- `jest __tests__/engine/toolManager.test.ts --runInBand`
- `jest __tests__/engine/orchestrator.test.ts --runInBand`
- `jest __tests__/services/agentWorkflowPilot.test.ts __tests__/services/agentRunFinalization.test.ts --runInBand`
- `jest __tests__/engine/parity-executor-expo.test.ts --runInBand`
- `jest __tests__/services/expo-eas.test.ts --runInBand`
- `jest __tests__/engine/orchestrator.test.ts __tests__/engine/capabilityWorkflow.test.ts __tests__/engine/toolManager.test.ts __tests__/services/agentWorkflowPilot.test.ts --runInBand`
