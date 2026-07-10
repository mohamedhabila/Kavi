import { executeForegroundConversationRun } from '../../engine/graph/foregroundRun/execution';
import { TOOL_DEFINITIONS } from '../../engine/tools/definitions';
import { resolveConversationWorkspaceTarget } from '../../services/conversationWorkspace/ownership';
import { cancelScheduledIngestionDrain } from '../../services/memory/ingestionQueue';
import {
  buildScopedMemoryEvidenceDelta,
  captureCompleteMemoryEvidenceForIsolatedEvaluation,
} from '../../services/memory/evidenceSnapshot';
import {
  flushChatStorePersistenceNow,
  requestChatStorePersistenceCheckpoint,
} from '../../store/chatStorePersistence';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { generateId } from '../../utils/id';
import {
  getE2ENativeMobileFixtureStateSnapshot,
  getE2ENativeMobileInvocationSnapshots,
} from './e2eNativeMobileFixtures';
import { relaunchForegroundScenarioApp } from './foregroundScenarioLifecycle';
import {
  beginForegroundScenarioRetrievalCapture,
  completeForegroundScenarioRetrievalCapture,
} from './foregroundScenarioRetrievalEvidence';
import {
  applyForegroundScenarioRoute,
  buildForegroundScenarioCompletionSnapshot,
  buildForegroundScenarioUsageDelta,
  createForegroundScenarioRuntime,
  createSeedConversation,
  ensureForegroundScenarioStoresHydrated,
  resolveForegroundScenarioFinalAssistant,
  resolveForegroundScenarioTurnRun,
  settleForegroundScenarioMemory,
} from './foregroundScenarioDriverRuntime';
import {
  cloneAndFreeze,
  type ForegroundScenarioDriverInput,
  type ForegroundScenarioDriverResult,
  type ForegroundScenarioMemoryRecord,
  type ForegroundScenarioTurnSnapshot,
} from './foregroundScenarioDriverTypes';

export type {
  ForegroundScenarioCompletionSnapshot,
  ForegroundScenarioDriverInput,
  ForegroundScenarioDriverResult,
  ForegroundScenarioExecutionContextSnapshot,
  ForegroundScenarioFinalAssistantSnapshot,
  ForegroundScenarioLifecycleBoundary,
  ForegroundScenarioLifecycleSnapshot,
  ForegroundScenarioMemorySnapshot,
  ForegroundScenarioMemoryTurnEvidence,
  ForegroundScenarioNativeEvidenceSnapshot,
  ForegroundScenarioRouteDirective,
  ForegroundScenarioTurnInput,
  ForegroundScenarioTurnSnapshot,
  ForegroundScenarioUserSnapshot,
} from './foregroundScenarioDriverTypes';

const DEFAULT_TURN_TIMEOUT_MS = 120_000;
// Provider enrichment owns a 30-second request deadline; keep settlement
// independently bounded while allowing persistence and polling to finish.
const DEFAULT_MEMORY_TIMEOUT_MS = 45_000;
const FOREGROUND_PRODUCT_TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));

let scenarioRunTail: Promise<void> = Promise.resolve();

function requireTrimmed(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must not be empty.`);
  return trimmed;
}

function validatePositiveNumber(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function validateInput(input: ForegroundScenarioDriverInput): void {
  const conversationId = requireTrimmed(input.conversationId, 'conversationId');
  if (conversationId !== input.conversationId) {
    throw new Error('conversationId must not contain surrounding whitespace.');
  }
  requireTrimmed(input.conversationTitle, 'conversationTitle');
  const providerId = requireTrimmed(input.provider.id, 'provider.id');
  if (providerId !== input.provider.id) {
    throw new Error('provider.id must not contain surrounding whitespace.');
  }
  requireTrimmed(input.provider.model, 'provider.model');
  if (!input.provider.enabled) throw new Error('provider must be enabled.');
  if (input.turns.length === 0) throw new Error('turns must contain at least one turn.');
  validatePositiveNumber(input.maxTokens, 'maxTokens');
  validatePositiveNumber(input.timeoutMs, 'timeoutMs');
  validatePositiveNumber(input.memoryTimeoutMs, 'memoryTimeoutMs');
  if (
    input.allowedToolNames !== undefined &&
    (input.allowedToolNames.length === 0 ||
      new Set(input.allowedToolNames).size !== input.allowedToolNames.length ||
      input.allowedToolNames.some(
        (name) =>
          typeof name !== 'string' ||
          !name.trim() ||
          name !== name.trim() ||
          !FOREGROUND_PRODUCT_TOOL_NAMES.has(name),
      ))
  ) {
    throw new Error('allowedToolNames must contain unique canonical tool names.');
  }
  for (const [index, turn] of input.turns.entries()) {
    requireTrimmed(turn.content, `turns[${index}].content`);
    if (turn.lifecycleBefore !== undefined && turn.lifecycleBefore !== 'app_relaunch') {
      throw new Error(`turns[${index}].lifecycleBefore must be app_relaunch.`);
    }
    validatePositiveNumber(turn.maxTokens, `turns[${index}].maxTokens`);
    validatePositiveNumber(turn.timeoutMs, `turns[${index}].timeoutMs`);
  }
}

async function runScenarioIsolated(
  input: ForegroundScenarioDriverInput,
): Promise<ForegroundScenarioDriverResult> {
  validateInput(input);
  await ensureForegroundScenarioStoresHydrated();
  const chatSnapshot = useChatStore.getState();
  const settingsSnapshot = useSettingsStore.getState();
  const memoryRecords: ForegroundScenarioMemoryRecord[] = [];

  try {
    useSettingsStore.setState({
      providers: [{ ...input.provider }],
      activeProviderId: input.provider.id,
      activeModel: input.provider.model,
      systemPrompt: input.systemPrompt,
      defaultConversationMode: input.defaultMode,
      thinkingLevel: 'minimal',
      disableLongTermMemory: input.disableLongTermMemory ?? false,
      memoryConsolidationMode: 'active_provider',
      consolidationProvider: null,
    });
    useChatStore.setState({
      conversations: [createSeedConversation(input)],
      activeConversationId: input.conversationId,
      isLoading: false,
    });
    requestChatStorePersistenceCheckpoint(0);
    await flushChatStorePersistenceNow();

    const memoryScope = {
      memoryConversationId: resolveConversationWorkspaceTarget({
        conversationId: input.conversationId,
        conversations: useChatStore.getState().conversations,
      }).workspaceConversationId,
      sourceThreadId: input.conversationId,
    };
    await input.beforeTurns?.({
      conversationId: input.conversationId,
      workspaceConversationId: memoryScope.memoryConversationId,
    });
    let previousMemoryState = captureCompleteMemoryEvidenceForIsolatedEvaluation(memoryScope);
    let runtime = createForegroundScenarioRuntime(input, memoryRecords);
    const turnSnapshots: ForegroundScenarioTurnSnapshot[] = [];
    for (const [turnIndex, turn] of input.turns.entries()) {
      const startedAt = Date.now();
      const lifecycleBefore = turn.lifecycleBefore
        ? await relaunchForegroundScenarioApp({
            conversationId: input.conversationId,
            memoryScope,
            memoryStateBefore: previousMemoryState,
          })
        : null;
      if (lifecycleBefore) runtime = createForegroundScenarioRuntime(input, memoryRecords);
      const retrievalCapture = await beginForegroundScenarioRetrievalCapture({
        sourceThreadId: input.conversationId,
        memoryOptOut: input.disableLongTermMemory === true,
      });
      const nativeStateBefore = getE2ENativeMobileFixtureStateSnapshot();
      const nativeInvocationStart = getE2ENativeMobileInvocationSnapshots().length;
      const route = applyForegroundScenarioRoute(
        input.conversationId,
        turn.route,
        input.defaultMode,
      );
      const before = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === input.conversationId);
      if (!before) throw new Error(`Conversation ${input.conversationId} is unavailable.`);
      const priorRunIds = new Set((before.agentRuns ?? []).map((run) => run.id));
      const messageStartIndex = before.messages.length;
      const usageBefore = before.usage;
      const memoryRecordStart = memoryRecords.length;
      const userMessageId = generateId();
      useChatStore.getState().addMessage(input.conversationId, {
        id: userMessageId,
        role: 'user',
        content: turn.content.trim(),
        timestamp: turn.timestamp,
      });

      runtime.resetChatError();
      runtime.setActiveTurnMaxTokens(turn.maxTokens ?? input.maxTokens);
      let timedOut = false;
      const timeoutMs = turn.timeoutMs ?? input.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        timedOut = true;
        runtime.requests.abortCurrentOrNextForegroundRequest(
          input.conversationId,
          `Foreground scenario turn timed out after ${timeoutMs}ms.`,
        );
      }, timeoutMs);
      try {
        await executeForegroundConversationRun({
          conversationId: input.conversationId,
          context: runtime.context,
          options: {
            maxTokens: turn.maxTokens ?? input.maxTokens,
            ...(input.allowedToolNames ? { allowedToolNames: input.allowedToolNames } : {}),
            memoryRetrievalStrategy: input.memoryRetrievalStrategy,
            memoryContextStrategy: input.memoryContextStrategy,
            enableCompaction: input.enableCompaction,
          },
        });
      } finally {
        clearTimeout(timeout);
      }

      requestChatStorePersistenceCheckpoint(0);
      await flushChatStorePersistenceNow();
      const memory = await settleForegroundScenarioMemory(
        memoryRecords.slice(memoryRecordStart),
        input.memoryTimeoutMs ?? DEFAULT_MEMORY_TIMEOUT_MS,
      );
      const memoryStateAfter = captureCompleteMemoryEvidenceForIsolatedEvaluation(memoryScope);
      const conversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === input.conversationId);
      if (!conversation) throw new Error(`Conversation ${input.conversationId} is unavailable.`);
      const run = resolveForegroundScenarioTurnRun(conversation, userMessageId, priorRunIds);
      const turnMessages = conversation.messages.slice(messageStartIndex);
      const persistedUserMessage = turnMessages.find(
        (message) => message.id === userMessageId && message.role === 'user',
      );
      if (!persistedUserMessage) {
        throw new Error(`Foreground turn user message ${userMessageId} was not persisted.`);
      }
      const finalAssistantResolution = resolveForegroundScenarioFinalAssistant(turnMessages);
      const finalAssistant = finalAssistantResolution.selected;
      const nativeInvocations =
        getE2ENativeMobileInvocationSnapshots().slice(nativeInvocationStart);
      const chatError = runtime.getChatError();
      const memoryInvariantError =
        !timedOut && !chatError && memory.length !== 1
          ? `Foreground turn recorded ${memory.length} memory closeouts; expected exactly one.`
          : null;
      const turnError = timedOut
        ? `Foreground scenario turn timed out after ${timeoutMs}ms.`
        : (chatError ?? memoryInvariantError);
      const completion = buildForegroundScenarioCompletionSnapshot({
        error: turnError,
        finalAssistant,
        route,
        run,
        timedOut,
      });
      turnSnapshots.push(
        cloneAndFreeze({
          completion,
          durationMs: Date.now() - startedAt,
          error: turnError,
          finalAssistant,
          finalAssistantCandidateCount: finalAssistantResolution.candidateCount,
          lifecycleBefore,
          memory,
          memoryEvidence: {
            delta: buildScopedMemoryEvidenceDelta(previousMemoryState, memoryStateAfter),
          },
          messages: turnMessages,
          native: {
            stateBefore: nativeStateBefore,
            stateAfter: getE2ENativeMobileFixtureStateSnapshot(),
            invocations: nativeInvocations,
          },
          retrieval: completeForegroundScenarioRetrievalCapture({ capture: retrievalCapture }),
          route: { directive: turn.route, ...route },
          run,
          timedOut,
          turnIndex,
          usage: buildForegroundScenarioUsageDelta(usageBefore, conversation.usage),
          user: {
            messageId: persistedUserMessage.id,
            text: persistedUserMessage.content,
            timestamp: persistedUserMessage.timestamp,
          },
          userMessageId,
        }) as ForegroundScenarioTurnSnapshot,
      );
      previousMemoryState = memoryStateAfter;
      if (turnError) break;
    }

    const finalConversation = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === input.conversationId);
    if (!finalConversation) throw new Error(`Conversation ${input.conversationId} is unavailable.`);
    return cloneAndFreeze({
      conversationId: input.conversationId,
      finalConversation,
      memoryFinalState: previousMemoryState,
      turns: turnSnapshots,
    }) as ForegroundScenarioDriverResult;
  } finally {
    cancelScheduledIngestionDrain();
    useChatStore.setState(chatSnapshot, true);
    useSettingsStore.setState(settingsSnapshot, true);
    requestChatStorePersistenceCheckpoint(0);
    await flushChatStorePersistenceNow();
  }
}

export async function runForegroundScenario(
  input: ForegroundScenarioDriverInput,
): Promise<ForegroundScenarioDriverResult> {
  const previousRun = scenarioRunTail;
  let release: () => void = () => undefined;
  scenarioRunTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previousRun;
  try {
    return await runScenarioIsolated(input);
  } finally {
    release();
  }
}
