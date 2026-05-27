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

## Regression Observed After Fourth APK Test (Configured Live Run)

The next emulator run used the fully configured real environment rather than a partially prepared scenario:

- Emulator/device: `Pixel_9_Pro_XL`, package `com.kavi.mobile`
- Active model: `gemini-3.5-flash`
- Synced Expo account owner: `mohamed.habila`
- Selected Expo project id: `edd7aa60-60c7-4127-b981-d660690f08c2`
- Selected Expo project slug: `mobile-app`
- Selected Expo project mode: `eas-workflow`
- Linked repo: `mohamedhabila/expo`
- Linked default branch: `master`
- Selected workflow file: `deploy.yml`

Prompt used:

> create a simple web app in the linked GitHub repo named expo use tools to do the work not just give instructions reuse the configured expo eas workflow project and workflow file create the app files commit and push the changes monitor the workflow or deployment fix issues if needed and finish only after you verify the final status with tools

Observed outcome:

- The run did discover the correct GitHub repo and the configured Expo project.
- It still failed to create a real app implementation.
- It committed only a trivial README mutation to `master` with commit `bd0ed01aa6d05327c42922e82550aa66e1a2ef25` and message `initial readme test`.
- GitHub workflow monitoring failed immediately with `GitHub API 403: Resource not accessible by personal access token. Required permission: Actions: read.`
- Instead of correlating a new deployment run to the just-created commit, the runtime latched onto a stale Expo workflow run `019e655a-9779-749a-b91d-0a0e8792c39b` that predated the task and surfaced an old failure: `Unable to resolve module expo-router/node/render.js from /home/expo/workingdir/build/.`
- After that, the agent fell into repeated missing-file reads against nonexistent local artifacts such as `package.json`, `README.md`, `deploy.yml`, `app.json`, and `App.js`.
- The run consumed `1,063,247` total tokens across `36` calls and `120` logs before manual cancellation.
- No final human-readable assistant conclusion was persisted. After cancellation, the last persisted messages were still tool-call/tool-result messages.
- Manual cancellation surfaced an uncaught runtime error toast: `AbortError: Request cancelled`.

Persisted route-state evidence shows the workflow advanced incorrectly while doing the wrong work:

- `lastAgentRun.routeState.status` remained `active`
- `currentPhaseId` remained `await_external_execution`
- `lastAdvancedByTool` was `expo_eas_workflow_wait`
- `recoverableErrorCount` reached `26`
- `lastRecoverableToolError` ended as `Error: file not found: app.json`
- `completedWorkflowRequirementKeys` incorrectly included unrelated stages such as `persist_artifact`, `mutate_remote_state`, `monitor_external_execution`, and `verify_evidence`

Root causes identified:

1. Monitor/wait tools can still advance unrelated capability phases. `expo_eas_workflow_wait` was allowed to satisfy or help satisfy `persist_artifact`, `mutate_remote_state`, and `verify_evidence` even though it had not observed a run started by the current task.
2. External execution is not causally anchored to the current mutation. After the README commit, the workflow did not require a new run correlated by repo, branch, workflow file, commit SHA, or run creation time. "Latest run" was treated as sufficient.
3. Missing local artifacts do not deterministically switch the workflow into creation/bootstrap mode. Repeated `read_file` misses were treated as recoverable, but there was no forced transition to `prepare_artifact` with concrete file creation.
4. Recoverable-error loop handling is too local. The runtime counted `26` recoverable errors, but because the errors rotated across a small set of missing files, the loop breaker never converted the pattern into a workflow-level blocker or forced tool change.
5. Objective-quality checks on remote mutation are still too weak. A README-only commit was treated as enough progress to continue into deployment monitoring for a task that explicitly required a web app implementation.
6. Permission errors are surfaced but not converted into capability-specific blockers. The GitHub Actions `403` should have produced either a precise blocker or a strict reroute to Expo-only monitoring tied to a newly created run, not broad monitor-phase advancement.
7. Cancellation is not a first-class terminal path. Manual stop raised an uncaught promise rejection and did not persist a clean cancellation report with the work completed so far.
8. Final persistence is still fragile under cancellation/abort. The user could not review a concise terminal explanation because the run ended without a final assistant summary message.

Implementation-ready implications:

- Monitor and wait tools must only advance `monitor_external_execution`, `await_external_execution`, or `verify_evidence` when their typed evidence is correlated to the current task's remote mutation facts.
- The workflow must store and validate a provenance chain for external runs:
  - selected repo full name
  - branch/ref
  - workflow file
  - commit SHA or equivalent mutation evidence
  - run id
  - run creation timestamp
- A missing required local artifact must trigger a deterministic bootstrap branch:
  - mark the artifact requirement unresolved
  - select creation/write-capable tools
  - stop repeated read attempts for the same requirement set
- Remote mutation evidence must be scored against the declared objective. For app-creation tasks, trivial README-only commits must not satisfy `persist_artifact` or `mutate_remote_state`.
- Capability-specific permission failures such as GitHub Actions `403` must set a precise blocker fact and either pause monitoring or switch to an allowed, still-correlated monitor path.
- User cancellation must resolve through a dedicated terminal path that persists a cancellation report and never throws an uncaught `AbortError` into the UI.

## Regression Observed After Fifth APK Test (Post-Correlation Fixes)

The next emulator run showed that the route-level correlation fixes prevented some stale-run advancement, but two structural tool-decision failures remained:

- The agent successfully discovered the GitHub repository and Expo project and performed a real remote mutation, creating commit `df1305a2ed976649b3b00809b85aab5c77832ec5`.
- After the mutation, it repeatedly called `expo_eas_workflow_runs` and observed the same stale workflow run `019e655a-9779-749a-b91d-0a0e8792c39b` rather than recognizing that the result was not correlated to the current commit.
- The planner included `skill__github__workflow_runs` and `skill__github__checks_status` as monitoring tools in the same mixed workflow, even though GitHub Actions was not the configured external execution substrate and had already produced permission/noise failures in prior runs.
- The route configuration-protection logic was initially too broad. It learned repository identifiers such as `mohamedhabila/expo`, Expo project names such as `@mohamed.habila/mobile-app`, and ISO timestamps as if they were protected workflow configuration file paths.

Root causes identified:

1. Planned passive monitors were trusted too much. If the LLM planner nominated a passive monitor from a mutating tool family, the route treated it as workflow-relevant even when a different tool family provided the actual external execution producer/monitor pair.
2. Repeated uncorrelated monitor observations were counted only as generic stale evidence. The route did not detect that the exact same uncorrelated evidence signature had repeated and therefore did not convert repeated polling into a non-progress blocker quickly enough.
3. The external workflow configuration detector extracted every path-like or slash-containing resource string from provider metadata. That incorrectly treated owner/repo names, project names, and timestamps as protected configuration files.
4. The first monitor-disambiguation fix still depended on the LLM-declared required tool categories. The live planner selected Expo workflow tools but declared only the GitHub category, so the route still treated GitHub Actions as the selected monitor substrate.
5. A blocked route updated UI/review state but did not terminate the orchestrator's tool loop. The next LLM turns still received tools, so the model continued improvising with browser, GitHub checks, workflow-status, and follow-up commit attempts after the route had already found a blocker.
6. Expo workflow-run results contained actionable trigger guidance, but the controller treated `note`/`guidance` as prose rather than state. The result said runs should appear after pushing to the branch that owns the workflow config; the route only counted "uncorrelated monitor observation" and did not convert that evidence into trigger-prerequisite diagnostics.

Implementation updates now applied:

- Passive monitor requirements are selected by generic capability structure rather than by planner preference alone. In a mixed workflow, a planned passive monitor from a mutating family is not trusted when another family provides a dedicated external-run producer/observer path and the mutating family has no matching producer evidence.
- Monitor disambiguation now uses effective capability categories, which include both LLM-declared categories and categories inferred from planned tool descriptors. This prevents a planner from selecting one substrate while declaring a narrower category set that reintroduces unrelated monitors.
- Uncorrelated external monitor evidence now records a normalized result signature. If the same uncorrelated monitor result repeats, the route blocks as non-progress after a small repeated-evidence budget instead of allowing another identical status call.
- External workflow configuration protection now extracts only file-resource-like paths. Repository names, Expo project names, package-like identifiers, and timestamps are excluded; workflow files such as `.github/workflows/deploy.yml`, `deploy.yml`, and `build.yml` remain protected.
- Failed terminal external execution results can satisfy the await phase but cannot satisfy verification. They reopen corrective artifact/mutation/external-run capabilities instead of allowing final success.
- Exact-run monitor/status tools are suppressed until the route has a correlated run handle, so "latest run" polling cannot masquerade as task-specific verification.
- A route-level blocker is now terminal for the current orchestrator tool loop. The orchestrator emits an incomplete final blocker message with `terminalReason=route_blocked` and stops loading tools instead of asking the model to continue from an already-blocked state.
- Completed workflow phase details are preserved instead of being overwritten by later observer tools, so route-state diagnostics show which tool actually satisfied each phase.
- Expo workflow-run payloads now expose generic trigger metadata derived from adapter state: source mutation, expected post-push trigger, recommended branch, and workflow config paths.
- Guided uncorrelated external monitor results now open a diagnostic branch instead of another poll. The route suppresses passive monitors and loads read-only trigger-prerequisite inspection tools so the model can inspect branch/config/project state before deciding on a corrective mutation or blocker.
- A new regression test covers this exact failure mode: a stale workflow run plus trigger guidance must select diagnostic tools such as repository file inspection and Expo status, not another workflow-run poll.

Implementation-ready implications:

- Monitoring tools should be treated as observers of a selected substrate, not interchangeable "status" tools. The selected substrate must be inferred from producer/observer capability relationships and correlated evidence, not from provider names.
- Repeated identical uncorrelated evidence is itself evidence of orchestration failure. It should trigger a blocker or corrective tool change, not further polling.
- Resource extraction must distinguish artifact addresses from provider identifiers. Slash-containing strings are not automatically file paths.
- The workflow route must preserve genericity: the fix is not "prefer Expo over GitHub"; the fix is "prefer the monitor that is causally connected to the external run producer and current mutation evidence."
- Blocked workflow state must be a control boundary, not only a UI phase. Once a route is blocked, the runtime should produce a blocker report or escalate, never keep broad tool use enabled.
- Tool guidance must be typed at the adapter boundary whenever it represents workflow control information. The supervisor should not be expected to infer trigger diagnostics from prose buried in a JSON blob.

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

## Generic Implementation Review

The latest implementation pass deliberately avoids teaching the runtime a special Expo/EAS/GitHub success script. The intended invariant is:

> Provider adapters may expose provider-shaped metadata, but workflow advancement must depend on generic tool capability descriptors, structured evidence, provenance, and phase requirements.

Review outcome:

- `src/engine/routes/agentRoutes.ts` no longer contains Expo/GitHub-specific route gates, README shortcuts, "latest run" assumptions, or workflow-name special cases.
- External monitoring is now gated by generic producer/observer correlation. A passive monitor/wait result can advance monitor, wait, or verify phases only when it is causally tied to the current mutation by run id, source mutation id, or creation time after the producer mutation.
- Remote mutation facts now store generic provenance: producer tool name, timestamp, mutation id, and changed resources. This prevents unrelated monitor evidence from satisfying mutation or artifact requirements.
- Missing local artifacts now create generic bootstrap facts and reselect local write-capable tools. The runtime does not special-case `package.json`, `README`, or Expo workflow files.
- Permission and access blockers are handled through generic status/text signals such as HTTP `401`/`403`, unauthorized, forbidden, permission denied, and requires approval. The route does not check for provider-specific phrases like GitHub Actions.
- Objective-quality enforcement is still intentionally generic. Remote mutation evidence is separated from unresolved local artifact requirements; a mutation result alone cannot satisfy missing prepare/persist artifact stages unless the corresponding artifact evidence exists.
- Passive monitor selection now requires compatible producer/observer capability structure. A monitor from a mutating family is not accepted merely because the planner listed it when another family owns the external-run substrate for the current workflow.
- Repeated identical uncorrelated monitor evidence is tracked as non-progress and blocks before the model can burn turns repeating the same status call.
- External workflow configuration guards now protect only artifact-like file paths, not provider identifiers or timestamps.
- The Expo adapter now returns additional run timestamps (`createdAt`, `updatedAt`) as typed metadata. This is adapter-level evidence exposure, not orchestration branching.
- The orchestrator no longer relies on the removed broad `shouldRequireToolUse()` keyword list. It separates semantic-planner eligibility from concrete tool-forcing and uses contract-matched tool descriptors plus structured resource references to force tools only for non-direct tasks.
- Anthropic thinking mode remains protected: tool choice stays optional when forced tool choice would disable replayable thinking, matching provider constraints without weakening the generic workflow hold logic for other providers.
- Cancellation now follows a first-class terminal path that completes the run once and attempts to persist a cancellation final response, instead of surfacing an uncaught abort as the user-visible outcome.
- Duplicate finalization callbacks are guarded in the chat screen so `onDone`, `onError`, and cancellation races cannot complete the same agent run multiple times.

Residual design boundary:

- Tool category labels and adapter descriptors still contain provider names because they describe real tools. That is acceptable. What is not acceptable is using those provider names as hidden route rules or success criteria.
- Legacy string-result parsing remains only as a compatibility shim. The target state is structured result envelopes for every consequential tool.
- The current structured-resource detector recognizes path-like references such as `src/App.tsx`; this is a generic artifact-address signal, not a task-specific keyword list. It should eventually be replaced by richer request-intent structure from the planner or classifier.

Verification completed after the generic review:

- `rtk npm run typecheck`
- `rtk npx jest __tests__/engine/capabilityWorkflow.test.ts --runInBand`
- `rtk npx jest __tests__/engine/capabilityWorkflow.test.ts __tests__/engine/orchestrator.test.ts __tests__/engine/toolManager.test.ts __tests__/engine/agentic-bugs-fixes.test.ts __tests__/utils/toolResultErrors.test.ts __tests__/services/expo-eas.test.ts __tests__/screens/ChatScreen.test.tsx --runInBand`
- `rtk npx jest --runInBand`
- Latest focused regression result: 7 passed suites, 406 passed tests.
- Latest full-suite result: 277 passed suites, 4,797 passed tests, 2 skipped suites, 3 skipped tests.

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
- Bind external execution stages to typed provenance facts from earlier stages. A monitor/wait result is only workflow-advancing when it is causally downstream of the current repo/branch/workflow/commit facts.
- Use exact/required tool choice only when a stage has one safe mandatory next tool; otherwise expose the bounded capability-matched tool set.
- Enforce workflow transitions after each tool result:
  - validate required structured evidence
  - update workflow state
  - continue, retry, replan, block, or finalize
- Add workflow-level blockers and terminal reasons.

Acceptance criteria:

- The capability workflow cannot treat local-only artifacts as evidence of remote mutation or external execution.
- The capability workflow cannot treat a stale or unrelated workflow run as evidence for the current task's external execution stages.
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
- When required local artifacts are absent, transition from inspection to deterministic artifact bootstrap instead of allowing repeated missing-file reads to dominate the loop budget.

Acceptance criteria:

- After `read_file` or equivalent inspection confirms a required artifact is missing, the next active tool set includes creation/persistence tools for that artifact class.
- Repeated missing-file errors across the same artifact requirement set trigger either a forced bootstrap transition or a blocker; they do not spin indefinitely across adjacent filenames.

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
- Make GitHub commit result evidence satisfy commit/push criteria only with commit SHA/ref evidence and an objective-quality check against the declared task.
- Make Expo workflow evidence satisfy deploy/monitor criteria only with project/run terminal evidence that is correlated to the current repo, branch, workflow file, and commit or mutation fact.
- Prefer structured tool-result evidence over transcript prose. Keep regex/prose extraction only as a backward-compatible fallback.
- Convert capability-specific permission failures into typed blocker facts rather than generic recoverable monitor noise.

Acceptance criteria:

- A README-only commit cannot satisfy remote-mutation success for an app-creation task.
- A workflow run discovered only because it is "latest" cannot satisfy deploy evidence unless it is correlated to the current task's mutation facts.
- A GitHub Actions `403` on workflow reads produces an explicit blocker or an allowed alternate monitoring path; it does not leave monitor/verify phases marked complete.

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
- Add a dedicated user-cancelled terminal path that persists a concise cancellation report and suppresses uncaught abort toasts.

Acceptance criteria:

- Manual stop produces a persisted cancellation report with work completed, unfinished requirements, and last active phase.
- User cancellation never emits `Final response delivered`.
- User cancellation never surfaces an uncaught `AbortError` toast.

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
  - stale workflow run present in account history, but ignored until a new run correlated to the current commit appears
  - local artifact bootstrap from an empty repo or missing required files
  - trivial README-only mutation rejected as insufficient for app-creation success
  - live Pilot structured output succeeds
  - live Pilot structured output fails, heuristic blocks with diagnostics
- Add replay tests for Gemini planner/Pilot responses captured from the emulator run.
- Track pass/fail/flaky counts for workflow transitions, tool selection, and final evidence gates.

Acceptance criteria:

- A change to planner prompts alone cannot silently regress mandatory capability behavior.
- Capability evals fail if a creation tool is used before an existing resource resolver for the linked-resource scenario.
- Capability evals fail if a final success message lacks the required remote-mutation and external-execution evidence for the task.

## Validation Scenario After Fixes

Use the same Android emulator setup and the same configured environment observed in the failing live run:

- Model: `gemini-3.5-flash`
- Expo account owner: `mohamed.habila`
- Expo project id: `edd7aa60-60c7-4127-b981-d660690f08c2`
- Expo project slug: `mobile-app`
- Mode: `eas-workflow`
- Linked repo: `mohamedhabila/expo`
- Linked default branch: `master`
- Selected workflow file: `deploy.yml`

The app does not maintain a separate GitHub "linked repo" setting for the agent; the agent must discover accessible repositories from GitHub and select the repository from user-supplied evidence such as the repo name clue `Expo`.

1. Ask the agent to create a small Expo web app in the GitHub repo named `Expo`, commit/push to the deployment branch, add the needed EAS workflow file, and monitor EAS workflow.
2. Expected tool sequence:
   - `skill__github__repos` or equivalent GitHub repository discovery when the exact repo full name is not already verified
   - `expo_eas_list_projects` before `expo_eas_status`
   - `expo_eas_probe`
   - local `write_file`/`file_edit` for app and workflow files as needed
   - `skill__github__commit_files` using `changes[].filePath` for local artifacts
   - workflow-run discovery scoped to the just-created mutation, not the account-global latest run
   - `expo_eas_workflow_runs`
   - `expo_eas_workflow_wait` or `expo_eas_workflow_status`
3. Expected blocker behavior:
   - If GitHub permissions, Expo repo linkage, workflow config, run correlation, or live Pilot evaluation are missing, the agent stops with a blocker report and does not claim deployment.
4. Expected success behavior:
   - The final answer includes commit SHA, branch, committed files, Expo project id/fullName, workflow run id/url, workflow terminal state, and deployed URL or explicit no-url reason.
   - The workflow run id/url must be created after the reported commit and match the selected repo/workflow context.

## Test Matrix

- Tool selection: Gemini execution planning loads tools covering local artifact, remote mutation, external execution monitoring, and verification capabilities together.
- Local-to-GitHub commit: `write_file` creates files, then `skill__github__commit_files` commits those files with `changes[].filePath`.
- Empty-repo bootstrap: after required artifact reads return missing, the workflow transitions into artifact creation instead of repeating `read_file` on adjacent filenames.
- Existing configured Expo project: one synced configured project causes `expo_eas_status`/`probe` reuse; `expo_eas_create_project` is not called.
- Multiple configured Expo projects: ambiguous project selection returns a blocker instead of guessing or creating.
- Unknown GitHub repo: repository discovery runs before repo mutation; a name clue is matched against discovered repositories and ambiguity produces clarification, not a fabricated repo id.
- Stale workflow isolation: an older failing Expo workflow run in account history cannot satisfy monitor/verify phases for a new commit created during the current task.
- Expo create hardening: `Experience with name ... does not exist. (path: app.byFullName)` proceeds to create only when existing resource resolution cannot identify a suitable linked project or the user explicitly asks for a new project.
- Evidence gate: local-only artifacts cannot satisfy commit/push/deploy criteria.
- Objective-quality gate: README-only or similarly trivial mutations do not satisfy app-creation success criteria.
- Permission blocker: GitHub Actions `403` on workflow reads is surfaced as a precise blocker or alternate-monitor-path decision, not as silent monitor-phase progress.
- Pilot Gemini reliability: structured output, raw JSON, and forced tool-call fixtures all parse; invalid payloads report field-level diagnostics.
- Pilot fallback: live Pilot unavailability is reported as `unavailable`, not as a heuristic assessment. It may continue incomplete workflows or block finalization, but it must not approve execution tasks or present heuristic scoring as a real Pilot review.
- Premature finalization: an active capability workflow with pending phases withholds no-tool draft answers and forces the next turn back to phase-appropriate tools before Pilot review can run.
- Terminal UX: Pilot block displays `Blocker report delivered`, not `Final response delivered`.
- Cancellation UX: manual stop persists a cancellation report and does not surface `AbortError: Request cancelled`.

## Implementation Progress

The configured live run above shows that the implementation is not yet end-to-end correct. Treat the list below as work already landed or partially landed in code, but not sufficient to claim the scenario is fixed.

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

## Live Root-Cause Update: Tool Result Sequencing

The latest debug-APK emulator run did not confirm the hypothesis that the next LLM call is started before the prior tool result is available.

Observed persisted ordering from run `mpn5487x_77jgqi_4`:

- `skill__github__commit_files` completed at `2026-05-26T21:21:54.333Z`.
- The corresponding `role: "tool"` result message was persisted at `2026-05-26T21:21:54.494Z`.
- The next assistant turn, which selected `expo_eas_workflow_runs`, started at `2026-05-26T21:21:56.440Z`.

Code inspection matches the persisted ordering:

- `runOrchestrator` awaits `executeTool(...)` before constructing the tool result message.
- The tool result message is pushed into `workingMessages`.
- `callbacks.onToolMessage(...)` is awaited before the next orchestrator iteration can call the model.
- The UI callback `onToolCallComplete(...)` does run before `onToolMessage(...)`, so the visible run log can briefly show "tool completed" before the separate tool message exists. That is a presentation ordering issue, not the model-visible context root cause.

Actual root causes observed in the latest run:

- The workflow route correctly detected the GitHub Actions `403` as blocked, but blocked route state is not terminal control for the orchestrator. The run continued to offer planned monitor tools after the blocker checkpoint.
- A later successful-but-uncorrelated monitor result can reactivate a blocked route because `advancePhasesFromCompletedRequirements` recalculates `status: "active"` from incomplete phases and does not preserve existing blocked status unless an explicit unblock condition exists.
- Passive wait tools remain selectable before the runtime has a correlated external run id. In this run, `expo_eas_workflow_wait` was called with only `projectId`, so the adapter fell back to the latest account/project run and latched onto an old failed run.
- The EAS workflow tools returned a syntactically valid `status: "ok"` response for the old run. Existing route correlation prevented that stale run from completing monitor requirements, but selection/guidance did not stop repeated polling or waiting on the stale run.
- Tool errors returned as plain `Error: ...` strings are still logged as successful tool completions in UI/run summaries unless the orchestration layer marks error-like results as failed/blocked. The route classifier sees the error text, but the higher-level run summary and loop controls get mixed signals.

Implementation-ready generic fix direction:

- Preserve blocked route state as monotonic until a deliberate unblock/reroute transition is recorded; successful unrelated tools must not silently reactivate a blocked route.
- Track blocked tool names or blocked requirement keys generically, then suppress those tools from phase selection while alternate tools for the same capability remain available.
- Suppress passive `wait`/`await_external_execution` tools when an external execution must be correlated and no current external run id is known yet, unless the producer tool itself started an external run and returned that run id.
- Add uncorrelated-monitor accounting and guidance: stale/unrelated external runs are negative evidence, not progress; after bounded retries, report "no correlated run found" or switch to a materially different monitor/source.
- Promote error-like tool result strings into structured failed/blocked tool outcomes at the orchestration boundary so UI summaries, loop detection, route state, and model-visible guidance agree.

## Implementation Update: Generic Workflow Guards and Device Verification

The current implementation pass fixes the latest failure mode without adding an Expo/GitHub script, provider-specific route rule, or keyword-driven babysitting path. The generic invariant is:

> A capability workflow may advance only from tool evidence that satisfies the current requirement's capability contract and provenance constraints. Stale, unrelated, missing, or permission-blocked observations are feedback or blockers, not progress.

Root causes fixed:

- Prior-run evidence could be replayed into a new workflow because route replay collected completed tools from the whole conversation. The orchestrator now scopes fresh workflow evidence to the active user turn through `workflowScopeUserMessageId`; older context remains visible, but it cannot satisfy the current run's required tools or requirements.
- Always-loaded utility tools could leak into a narrowed phase even when the route had selected a smaller contract-matched tool set. Tool selection now supports `strictPreferredTools`, which excludes always-loaded base tools unless they are explicitly phase-preferred or essential for the active SuperAgent lane.
- Plain string tool failures such as `Error executing ...` could be persisted as successful tool completions. The tool-result error classifier now promotes error-like strings into failed tool outcomes so UI summaries, route state, loop detection, and model-visible evidence agree.
- Passive wait and monitor tools could run before the workflow had a causally known external run or session id. The route now suppresses passive waits and conversation-scoped monitors until a producer returns a current run handle, source mutation id, or equivalent correlation fact.
- Stale monitor observations could continue indefinitely. The route now records uncorrelated monitor observations, treats them as negative evidence, suppresses blocked monitor tools, and blocks the workflow after a bounded non-progress threshold.
- Blocked route state could be reactivated by a later unrelated successful observation. Blocked workflow state is now monotonic until a deliberate unblock/reroute transition is recorded.
- Chat finalization could still report a blocked route as a completed run when Pilot approved or synthesized a final response. Chat finalization now forces blocked capability routes to `status: "failed"` with `terminalReason: "missing_required_side_effect"` and a `Workflow blocked` checkpoint.

Implementation details:

- `src/engine/orchestrator.ts` scopes route evidence with `selectWorkflowScopedMessagesForRun(...)`, passes `workflowScopeUserMessageId` from the chat runtime, marks error-like tool results as failed, and uses strict phase-preferred tool selection when route-required tools are present.
- `src/engine/tools/toolManager.ts` adds strict preferred-tool selection so base utility tools do not dilute execution phases.
- `src/engine/routes/agentRoutes.ts` records generic external-producer and external-monitor facts, preserves blocked state, suppresses passive uncorrelated monitor/wait tools, tracks blocked tool names and requirement keys, and adds runtime guidance for stale or unrelated external evidence.
- `src/services/expo/eas.ts` and the Expo parity definitions require an explicit workflow run id for workflow waits instead of silently falling back to "latest".
- `src/utils/toolResultErrors.ts` classifies `Error executing ...`, `Error: ...`, and `Blocked: ...` style results consistently.
- `src/screens/ChatScreen.tsx` treats blocked route state as terminal failure presentation, preventing false "Final response delivered" success signals.

Latest device verification after these fixes:

- The Gemini run created a real remote mutation with `skill__github__commit_files`, commit `3c6d2e55c131162c09ddc2a8f490214226b249fa`.
- The GitHub workflow monitor returned a `403` permission error and was marked failed/blocked instead of successful.
- Expo workflow monitoring observed stale run `019e655a-9779-749a-b91d-0a0e8792c39b`; the route counted it as uncorrelated and did not let it satisfy monitor or verification requirements.
- The workflow blocked after three uncorrelated monitor observations with `blockedWorkflowToolNames` containing the unavailable or stale monitor paths.
- The earlier `read_file`/missing-local-artifact loop did not recur in the observed run.
- A remaining presentation leak was found in that run: route state was blocked, but the agent run status still closed as `completed`. The chat finalization guard above fixes that leak and is covered by regression test.

## Implementation Update: External Execution Substrate Selection

The next retest identified a more subtle semantic issue: the agent still called `skill__github__workflow_runs` during an Expo/EAS deployment task. The call was correctly marked failed when GitHub returned `403`, but the tool choice itself was wrong. A GitHub repository mutation and a GitHub Actions workflow are not the same execution substrate as an Expo EAS workflow triggered by a repo commit.

Root cause:

- The capability graph treated passive monitor tools as interchangeable if they shared `monitor_external_execution`.
- Because `github` was a required family for committing, the route auto-generated GitHub passive monitor requirements too.
- Broad `monitor`, `wait`, and `verify` planner capabilities were broadcast to every required family. In a mixed `github + expo` workflow, that made "monitor GitHub Actions" appear as valid deployment-monitor work even when Expo was the selected deployment substrate.

Generic fix:

- Passive `monitor`, `wait`, and `verify` requirements are no longer broadcast to every required category.
- Remote mutation requirements now carry specific evidence kinds such as `github_commit` / `github_push`, so commit evidence is not satisfied by unrelated workflow-monitor tools.
- Passive external monitor requirements now carry specific evidence kinds such as `eas_workflow_triggered`, `eas_workflow_terminal`, or `github_workflow`.
- Passive external monitors are auto-required only when their category is the selected execution substrate, explicitly planned, has a same-category external-run producer, or is the only relevant family. In mixed workflows, a mutating family's passive monitors must be selected deliberately; committing to a repo no longer implies monitoring repo-hosted CI.
- Conversation-scoped passive monitors keep the stricter rule: they require a matching producer such as a spawned session before they become workflow evidence.

Regression coverage:

- Mixed `workspace_files + github + expo` execution selects `expo_eas_workflow_runs` and excludes `skill__github__workflow_runs`.
- GitHub-only CI workflows still select `skill__github__workflow_runs` when GitHub is the selected execution substrate.
- Focused route/orchestrator/tool/finalization tests now cover 382 cases, and the full suite passes with 4,790 tests.

Regression coverage added:

- `__tests__/screens/ChatScreen.test.tsx` verifies that a blocked generic capability workflow is completed as a failed blocker even if Pilot would approve finalization.
- `__tests__/engine/capabilityWorkflow.test.ts` covers blocked-route monotonicity, stale/unrelated external evidence, passive monitor suppression, uncorrelated monitor bounding, and scoped external run correlation.
- `__tests__/engine/orchestrator.test.ts` covers workflow-scoped replay and failed tool-result classification.
- `__tests__/engine/toolManager.test.ts` covers strict preferred-tool selection.
- `__tests__/utils/toolResultErrors.test.ts` covers the expanded error-like result classifier.
- `__tests__/services/expo-eas.test.ts` covers explicit workflow-run-id requirements for waits.

Production readiness assessment:

- The fixes are generic because they operate on capability descriptors, workflow requirement keys, side-effect/evidence descriptors, and structured provenance facts.
- The Expo/EAS adapter remains provider-specific only at the boundary where real Expo resources are described or validated.
- There is no hidden success shortcut for repo `Expo`, workflow file `deploy.yml`, README changes, GitHub Actions, or any single provider phrase.
- Legacy string parsing still exists as compatibility protection, but consequential route advancement now depends on generic evidence and correlation checks rather than raw provider prose.
- The remaining external blocker in the configured environment is operational: GitHub Actions read returned `403`, and no correlated Expo run was visible after the commit. The app should now surface that as a precise blocker instead of looping or falsely completing.

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

## Implementation Update: Pilot 400 and Failure-Aware Recovery

The latest configured run isolated two remaining structural failures:

- The Pilot final review failed with Gemini `400 Bad Request`: `Unknown name "responseFormat" at 'generation_config': Cannot find field.` The subsequent raw JSON/tool-call fallback was unparseable, so the run reported `fallbackReason: response_unparseable` instead of a useful evaluation.
- After an Expo/EAS workflow failure, the agent kept attempting GitHub workflow-run inspection and workflow-file mutations. This was poor tool reasoning: the task's execution substrate was Expo EAS, while GitHub was only the repository mutation substrate.

Observed latest run facts:

- The agent correctly discovered GitHub and Expo state, including linked repo `mohamedhabila/expo`, workflow file `deploy.yml`, and available workflow files.
- It first attempted to commit `.github/workflows/deploy.yml` and received the expected GitHub workflow-file permission error.
- It then successfully committed app files only with commit `28ca61ab7f85db6b2e3f0e48f313d71f6b611d02`.
- Expo workflow status returned a real terminal failure: `Unable to resolve module expo-router/node/render.js`.
- Instead of treating that failure as feedback about app dependencies/artifacts, the loop attempted to modify `.eas/workflows/deploy.yml` and used `skill__github__workflow_runs`, which was the wrong execution monitor for this task.

Root causes:

- Gemini structured-output compatibility was optimistic. Current Gemini docs document `generationConfig.responseFormat`, but the configured endpoint/model rejected that field in the live app path. The runtime needed a narrow compatibility retry rather than treating the Pilot failure as an agent-quality signal.
- Blocked capability workflows still invoked Pilot before checking deterministic route blockers. That wasted a provider call and exposed the 400 even when the route already had enough evidence to fail precisely.
- A failed terminal external run was treated too much like verification evidence. It must complete the wait phase, but it must not satisfy final verification.
- The recovery selector remained too monitor-heavy after failed external execution. It needed to re-open corrective artifact/persist/mutation tools, not only continue polling.
- The runtime did not protect discovered external workflow configuration from implicit mutation. A deployment failure should not make the agent edit workflow automation unless the user requested workflow changes or a tool specifically proved the workflow config is missing/broken.

Generic fixes now applied:

- Gemini structured-output calls use the documented `responseFormat` shape first. On the specific `400`/unknown-`responseFormat` compatibility failure, the runtime retries once with the legacy `responseMimeType` + `responseSchema` shape. Other provider errors are not masked.
- Blocked capability routes now finalize as `Workflow blocked` before Pilot review. This prevents deterministic route blockers from becoming noisy LLM-evaluation failures.
- Terminal state handling is shared across success, failure, and wait-completion checks. Failed terminal states such as `FAILURE`, `failed`, `error`, `cancelled`, and timeout variants can advance `await_external_execution`, but cannot satisfy `verify_evidence`.
- Passive terminal monitor/status tools are suppressed until the workflow has a correlated external run handle. A status/wait tool that requires an exact run id is no longer selected as a fallback when only stale or unrelated runs are visible.
- Failed external execution facts are stored as recovery evidence. In `verify_evidence`, the route now reselects corrective artifact, persist, remote mutation, and external-run tools so the agent can fix the app/dependency problem and push a new revision.
- The route records external workflow config paths discovered from tool results. Remote mutation calls that target those discovered config paths are blocked unless the workflow state explicitly requires external workflow config mutation. The guard compares resource paths generically and does not hardcode `.eas`, `.github`, `deploy.yml`, or Expo.
- Orchestrator execution now applies the workflow guard before dispatching remote mutation tools. A blocked mutation is returned to the model as a failed tool result with actionable guidance instead of silently executing a risky or irrelevant edit.
- External workflow prompt guidance was generalized: deployment failure is feedback for correcting the requested artifact/prerequisite first; automation config should change only when explicitly requested or proven broken.

Retest refinement:

- The first rebuilt-device retest found a false positive in the config guard: slash-containing identifiers such as `mohamedhabila/expo` and `@owner/mobile-app` were recorded as workflow config paths. That blocked a normal app-file commit because the commit arguments included the repository full name.
- The guard now records only file-like resource paths whose basename has an extension. This still protects discovered config files such as `deploy.yml`, `build.yml`, or nested workflow YAML paths, while excluding repository/project identifiers. The rule is generic and does not special-case Expo, GitHub, or any specific filename.

Best-practice alignment confirmed on 2026-05-26:

- Gemini's current structured-output docs list `responseFormat` and emphasize schema validation, strong typing, and application-side semantic validation. The compatibility retry preserves the documented primary path while handling deployed endpoint drift.
- Expo's current EAS Workflows docs state that linked GitHub projects can trigger workflows from GitHub events and that workflow YAML files live under `.eas/workflows`. The fix preserves that automation boundary: commit app changes, monitor EAS, and do not edit workflow automation just because a build failed.
- MCP client best practices warn that loading broad tool surfaces and passing large intermediate results through the model degrades performance. The fix narrows active tools by phase, evidence kind, and correlated run state.
- OpenAI tool guidance continues to emphasize explicit schemas and strict function parameters. The implementation leans into descriptor-driven tool contracts, structured failure results, and deterministic host-side validation before consequential tool execution.

Regression coverage added in this update:

- `__tests__/engine/agentic-bugs-fixes.test.ts` verifies Gemini retries structured output with legacy `responseSchema` only when `responseFormat` is rejected.
- `__tests__/engine/capabilityWorkflow.test.ts` verifies failed terminal external runs do not satisfy final verification, terminal monitors require correlated run handles, stale monitor observations block instead of polling forever, and discovered workflow config paths are protected from implicit remote mutation.
- `__tests__/engine/capabilityWorkflow.test.ts` also verifies repository/project identifiers returned next to workflow metadata are not treated as protected config paths.
- `__tests__/screens/ChatScreen.test.tsx` verifies blocked capability routes fail without Pilot review and that the new test does not leak unused Pilot mocks into later cancellation tests.

Verification after this update:

- `rtk npx jest __tests__/engine/capabilityWorkflow.test.ts --runInBand`
- `rtk npx jest __tests__/engine/agentic-bugs-fixes.test.ts --runInBand`
- `rtk npx jest __tests__/screens/ChatScreen.test.tsx --runInBand`
- `rtk npx jest __tests__/engine/capabilityWorkflow.test.ts __tests__/engine/orchestrator.test.ts __tests__/engine/toolManager.test.ts __tests__/engine/agentic-bugs-fixes.test.ts __tests__/utils/toolResultErrors.test.ts __tests__/services/expo-eas.test.ts __tests__/screens/ChatScreen.test.tsx --runInBand` passed with `401` tests.
- `rtk npm run typecheck`
- `rtk npx jest --runInBand` passed with `277` suites, `4,793` tests, and the existing `2` skipped suites / `3` skipped tests.

## Baseline Snapshot Before Graph-Framework Experiment

Recorded on `2026-05-27 02:47:28 CEST` before creating a separate experiment branch.

This baseline preserves the current incremental architecture fixes exactly as a reviewable checkpoint. It is not a declaration that the current route/orchestrator design is SOTA or complete; the latest live retest still shows the deeper concern that the host control plane may be too prompt-and-route driven for robust long-horizon tool use.

Current baseline scope:

- Capability descriptors, workflow phases, evidence gates, and route state are now first-class enough to prevent several false-positive progress paths.
- Tool results are persisted before the next model turn; the earlier suspected tool-result ordering issue was not the root cause.
- Error-like tool results, blocked routes, stale monitors, uncorrelated external runs, and failed terminal execution are now treated as control-plane evidence instead of ordinary model-visible prose.
- Mixed execution substrates are partially disambiguated by capability/evidence contracts so a repository mutation substrate is not automatically treated as the external execution monitor substrate.
- Provider-specific adapter knowledge is constrained to the adapter boundary. The workflow route still operates on generic descriptors, evidence kinds, side effects, resource kinds, typed trigger metadata, and path/resource overlap.

Known unresolved risks:

- The current design still asks the model to make too many recovery decisions from prompt guidance and a changing active tool set. Even with guards, it can drift into repeated diagnostics or unrelated mutation attempts after ambiguous remote failures.
- Typed trigger/provenance facts need to become stronger control inputs throughout the workflow, not just after stale monitor observations.
- Objective-quality scoring remains weak. A remote mutation can still be structurally valid while not satisfying the user-visible implementation objective unless the controller extracts and validates objective evidence more explicitly.
- Diagnostic tool selection is improved but still mostly descriptor-derived rather than graph-planned around prerequisite/resource dependencies.
- The route engine is custom and has grown organically; a graph runtime with explicit state transitions, durable checkpoints, typed reducers, and replayable edges may be a better architectural foundation.

Experiment goal:

- Create an isolated branch that evaluates an established graph/agent orchestration framework or the closest production-suitable option.
- Redesign the agentic flow as an explicit graph from request understanding through tool planning, execution, provenance validation, recovery, final evidence gating, and Pilot/finalization.
- Keep the experiment generic. It must improve long-horizon tool use generally, not optimize for the Expo/GitHub test prompt or any Expo-specific tool behavior.
- Treat Expo/GitHub only as a high-friction eval scenario for the general controller because it combines discovery, artifact creation, remote mutation, asynchronous external execution, monitoring, recovery, and final evidence gating.
- Compare the graph-based approach against this baseline using unit tests, full suite results, APK installation, emulator traces, and a written adoption recommendation.
