# Kavi Architecture

Kavi is a mobile-first AI assistant application built on Expo and React Native. The app combines conversation UX, provider routing, on-device inference, remote execution surfaces, and tool-driven workflows inside a single mobile runtime.

## System Map

- `src/screens`: top-level mobile screens such as chat, settings, remote work, skills, terminal, scheduler, browser supervision, and memory editing.
- `src/components`: reusable UI building blocks used across screens.
- `src/store`: persisted Zustand state for conversations, settings, throttled storage, and hydration.
- `src/engine`: orchestration loop, loop detection, failover logic, tool budgets, and tool execution plumbing.
- `src/services`: feature services for providers, local models, MCP, SSH, browser jobs, workspace control, voice, media, security, scheduling, and persistence.
- `android/` and `ios/`: native shells plus custom Android modules for local LLM and terminal support.
- `assets/editor` and `android/app/src/main/assets/editor`: generated editor runtime assets used by the in-app code editor.

## Runtime Flow

The main request lifecycle is:

1. The user submits text, attachments, or voice input from the chat UI.
2. Screen state flows into `useChatStore`, which owns persisted conversations, drafts, and message metadata.
3. The orchestration layer in `src/engine/orchestrator.ts` decides whether the request should be direct, tool-assisted, or agentic.
4. Provider execution routes through `src/services/llm/LlmService.ts` or the on-device runtime in `src/services/localLlm`.
5. Tool calls are normalized and executed through `src/engine/tools/*` plus the relevant service modules.
6. Results are compacted, guarded, paired, and persisted back into the conversation store.
7. The UI renders the updated transcript, attachments, approvals, and workflow state.

## Core State Boundaries

### Conversation State

- `src/store/useChatStore.ts` owns conversations, messages, active drafts, attachments, workflow state, and persistence integration.
- `src/store/chatPersistence.ts` and related helpers handle durable storage and hydration.

### Settings And Secure Configuration

- `src/store/useSettingsStore.ts` owns providers, SSH targets, workspace targets, browser providers, MCP servers, Expo/EAS accounts, and feature toggles.
- Sensitive values such as provider secrets and remote credentials are stored through secure-storage abstractions instead of plain persisted state.

### Remote Execution State

- `src/services/ssh/sessionStore.ts` manages active SSH shell sessions.
- `src/services/remote/store.ts` tracks remote browser jobs and sessions.
- Remote Work UI selectors in `src/screens/remoteWorkStoreSelectors.ts` keep Zustand access stable for large screens.

## Major Subsystems

### LLM And Model Routing

- `src/services/llm/LlmService.ts` handles provider-specific request shaping, streaming, tool-schema normalization, and compatibility fixes.
- `src/services/localLlm` owns on-device model catalog, lifecycle, warmup, and inference for supported local runtimes.
- `src/constants/api.ts` centralizes provider defaults and capability inference.

### Tooling And Orchestration

- `src/engine/orchestrator.ts` is the top-level coordinator for chat execution.
- `src/engine/tools` contains tool definitions, dispatching, parity execution, native executors, and web/browser helpers.
- Tool-execution seams now live in domain files such as `src/engine/tools/browserToolExecutor.ts`, `src/engine/tools/workspaceToolExecutor.ts`, `src/engine/tools/parity-ssh.ts`, and `src/engine/tools/parity-expo.ts` so contributors can change one execution surface without paging through the entire dispatcher.
- `src/engine/toolResultGuard.ts`, `src/engine/toolResultPairingGuard.ts`, and `src/engine/loopDetection.ts` protect the conversation context and workflow from runaway tool behavior.

### Remote Work Surfaces

- `src/services/ssh`: SSH connectivity, fingerprints, command execution, shell sessions, and file operations.
- `src/services/browser`: browser-provider config, action execution, trace capture, and live session jobs.
- `src/services/workspaces`: remote IDE launch, control, delegation, and routing.
- `src/services/mcp`: MCP transport, OAuth, tool bridging, and status management.
- `src/services/expo`: Expo and EAS workflows for builds, updates, submit flows, and project orchestration.

### Media And Voice

- `src/services/voice`: transcription, recording flows, and talk-mode support.
- `src/services/media`: attachment interpretation, image description, audio transcription, and media formatting.
- `src/components/chat` renders model output, attachments, approvals, thinking blocks, and tool-call details.

### Scheduling And Background Work

- `src/services/scheduler` and `src/screens/SchedulerScreen.tsx` manage scheduled runs and background workflows.
- `src/services/notifications` handles local notification delivery and scheduling.

## Native And WebView Runtimes

Kavi includes non-trivial runtime surfaces beyond standard React Native UI:

- Code editor WebView powered by generated CodeMirror assets.
- Terminal WebView used for JS REPL, local shell, and SSH shell interactions.
- Hidden Pyodide WebView for Python execution.
- Android native modules for local model execution and terminal integration.

These layers are powerful but also increase maintenance cost, especially when Expo, React Native, or mobile OS versions change.

## Current Refactor Hotspots

The largest contribution barriers are the monoliths already called out in the audit.

Highest-value decomposition targets:

1. `src/screens/SettingsScreen.tsx`
2. `src/screens/RemoteWorkScreen.tsx`
3. `src/screens/ChatScreen.tsx`
4. `src/services/llm/LlmService.ts`
5. `src/store/useChatStore.ts`
6. `src/engine/orchestrator.ts`
7. `src/services/agents/agentWorkflowPilot.ts`

## Boundary Map For Remaining Large Modules

The tool-executor split removes one of the highest-churn monolith clusters. The remaining large non-screen files should be treated with the following boundaries when contributors continue modularization work.

### `src/services/llm/LlmService.ts`

- Keep provider adapters isolated by family: OpenAI-compatible, Anthropic, Gemini, and local/on-device routing.
- Keep streaming protocol parsing and replay/history conversion in transport-focused helpers instead of provider policy branches.
- Keep usage accounting, request budgeting, and model capability normalization in shared utilities rather than inline provider branches.

### `src/store/useChatStore.ts`

- Keep conversation and message CRUD separate from workflow and pilot run state.
- Keep attachment and import/export behavior separate from persistence and hydration logic.
- Keep UI-derived selectors and presentation helpers outside the core persisted store whenever possible.

### `src/engine/orchestrator.ts` And `src/services/agents/agentWorkflowPilot.ts`

- Keep stage evaluation and continuation policy separate from provider execution and final response assembly.
- Keep resume and recovery state persistence separate from planner heuristics and tool-result handling.
- Keep telemetry, evidence recording, and debug logging in helpers so behavior changes do not require editing the whole run loop.

### `src/services/localLlm/runtime.ts`

- Keep engine and session lifecycle management separate from request shaping and conversation-cache policy.
- Keep platform capability detection and backend selection separate from inference request execution.

## Design Constraints

- Mobile UX is the primary product surface, even when the feature itself controls remote or desktop-class systems.
- Default verification must stay local and contributor-safe; paid or remote-provider tests should remain opt-in.
- Sensitive data should not flow into plain persisted stores.
- Tooling and workflow systems must assume interrupted, resumed, or partially failed runs are normal.

## Reading Order For New Contributors

If you are new to the codebase, start here:

1. `README.md`
2. `docs/setup/development.md`
3. `docs/testing.md`
4. `src/store/useChatStore.ts` and `src/store/useSettingsStore.ts`
5. `src/engine/orchestrator.ts`
6. `src/services/llm/LlmService.ts`
7. `src/screens/ChatScreen.tsx` and `src/screens/RemoteWorkScreen.tsx`
