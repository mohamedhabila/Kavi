import { executeForegroundConversationRun } from '../../engine/graph/foregroundRun/execution';
import { cancelScheduledIngestionDrain } from '../../services/memory/ingestionQueue';
import {
  flushChatStorePersistenceNow,
  requestChatStorePersistenceCheckpoint,
} from '../../store/chatStorePersistence';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { generateId } from '../../utils/id';
import {
  applyForegroundScenarioRoute,
  buildForegroundScenarioUsageDelta,
  createForegroundScenarioRuntime,
  createSeedConversation,
  ensureForegroundScenarioStoresHydrated,
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
  ForegroundScenarioDriverInput,
  ForegroundScenarioDriverResult,
  ForegroundScenarioMemorySnapshot,
  ForegroundScenarioRouteDirective,
  ForegroundScenarioTurnInput,
  ForegroundScenarioTurnSnapshot,
} from './foregroundScenarioDriverTypes';

const DEFAULT_TURN_TIMEOUT_MS = 120_000;
const DEFAULT_MEMORY_TIMEOUT_MS = 120_000;

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
  for (const [index, turn] of input.turns.entries()) {
    requireTrimmed(turn.content, `turns[${index}].content`);
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
      disableLongTermMemory: false,
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

    const runtime = createForegroundScenarioRuntime(input, memoryRecords);
    const turnSnapshots: ForegroundScenarioTurnSnapshot[] = [];
    for (const [turnIndex, turn] of input.turns.entries()) {
      const startedAt = Date.now();
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
          options: { maxTokens: turn.maxTokens ?? input.maxTokens },
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
      const conversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === input.conversationId);
      if (!conversation) throw new Error(`Conversation ${input.conversationId} is unavailable.`);
      const run = resolveForegroundScenarioTurnRun(conversation, userMessageId, priorRunIds);
      const chatError = runtime.getChatError();
      const memoryInvariantError =
        !timedOut && !chatError && memory.length !== 1
          ? `Foreground turn recorded ${memory.length} memory closeouts; expected exactly one.`
          : null;
      turnSnapshots.push(
        cloneAndFreeze({
          durationMs: Date.now() - startedAt,
          error:
            (timedOut ? `Foreground scenario turn timed out after ${timeoutMs}ms.` : chatError) ??
            memoryInvariantError,
          memory,
          messages: conversation.messages.slice(messageStartIndex),
          route: { directive: turn.route, ...route },
          run,
          timedOut,
          turnIndex,
          usage: buildForegroundScenarioUsageDelta(usageBefore, conversation.usage),
          userMessageId,
        }) as ForegroundScenarioTurnSnapshot,
      );
      if (timedOut) break;
    }

    const finalConversation = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === input.conversationId);
    if (!finalConversation) throw new Error(`Conversation ${input.conversationId} is unavailable.`);
    return cloneAndFreeze({
      conversationId: input.conversationId,
      finalConversation,
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
