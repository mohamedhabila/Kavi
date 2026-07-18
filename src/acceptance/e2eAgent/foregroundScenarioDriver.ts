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
import {
  relaunchForegroundScenarioApp,
  startNewForegroundScenarioConversation,
} from './foregroundScenarioLifecycle';
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
import { sealForegroundScenarioMemoryEvidenceAfterProviderWait } from './foregroundScenarioMemoryEvidence';
import {
  cloneAndFreeze,
  resolveForegroundScenarioProviderOutcomes,
  type ForegroundScenarioDriverInput,
  type ForegroundScenarioDriverResult,
  type ForegroundScenarioLifecycleSnapshot,
  type ForegroundScenarioMemoryRecord,
  type ForegroundScenarioTurnSnapshot,
} from './foregroundScenarioDriverTypes';
import { E2E_DEFAULT_MEMORY_TIMEOUT_MS } from './thresholds';
import { E2E_PUBLIC_INGESTION_PROVIDER_OUTCOMES } from './e2eTraceMemoryPolicy';

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
const SCENARIO_WALL_CLOCK_TIMEOUT_ERROR = 'Foreground scenario wall-clock deadline exceeded.';
// Provider enrichment owns a 30-second request deadline; keep settlement
// independently bounded while allowing persistence and polling to finish.
const FOREGROUND_PRODUCT_TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
const PROVIDER_OUTCOME_EVIDENCE_VALUES = new Set(E2E_PUBLIC_INGESTION_PROVIDER_OUTCOMES);

let scenarioRunTail: Promise<void> = Promise.resolve();

export class ForegroundScenarioIsolationError extends Error {
  constructor() {
    super('Timed-out foreground execution did not settle before cleanup.');
    this.name = 'ForegroundScenarioIsolationError';
  }
}

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

function validateRequiredPositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function remainingScenarioTimeMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

async function awaitBeforeScenarioDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  onTimeout?: () => void,
): Promise<T> {
  const remainingMs = remainingScenarioTimeMs(deadline);
  if (remainingMs <= 0) {
    onTimeout?.();
    void promise.catch(() => undefined);
    throw new Error(SCENARIO_WALL_CLOCK_TIMEOUT_ERROR);
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          reject(new Error(SCENARIO_WALL_CLOCK_TIMEOUT_ERROR));
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
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
  validateRequiredPositiveNumber(input.scenarioTimeoutMs, 'scenarioTimeoutMs');
  validatePositiveNumber(input.timeoutMs, 'timeoutMs');
  validatePositiveNumber(input.memoryTimeoutMs, 'memoryTimeoutMs');
  if (input.providerOutcomeEvidenceRequirements !== undefined) {
    const requirementKeys = new Set<string>();
    for (const requirement of input.providerOutcomeEvidenceRequirements) {
      const providerOutcomes = resolveForegroundScenarioProviderOutcomes(requirement);
      const hasSingleOutcome = requirement.providerOutcome !== undefined;
      const hasOutcomeSet = requirement.providerOutcomes !== undefined;
      if (
        !Number.isSafeInteger(requirement.turnIndex) ||
        requirement.turnIndex < 0 ||
        requirement.turnIndex >= input.turns.length ||
        hasSingleOutcome === hasOutcomeSet ||
        providerOutcomes.length === 0 ||
        new Set(providerOutcomes).size !== providerOutcomes.length ||
        providerOutcomes.some((outcome) => !PROVIDER_OUTCOME_EVIDENCE_VALUES.has(outcome))
      ) {
        throw new Error('providerOutcomeEvidenceRequirements contains an invalid requirement.');
      }
      const key = `${requirement.turnIndex}:${[...providerOutcomes].sort().join('|')}`;
      if (requirementKeys.has(key)) {
        throw new Error('providerOutcomeEvidenceRequirements must not contain duplicates.');
      }
      requirementKeys.add(key);
    }
  }
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
    if (!turn.content.trim() && !turn.attachments?.length) {
      throw new Error(`turns[${index}] must contain text or an attachment.`);
    }
    if (
      turn.lifecycleBefore !== undefined &&
      !['app_relaunch', 'new_conversation'].includes(turn.lifecycleBefore)
    ) {
      throw new Error(`turns[${index}].lifecycleBefore must be app_relaunch or new_conversation.`);
    }
    validatePositiveNumber(turn.maxTokens, `turns[${index}].maxTokens`);
    validatePositiveNumber(turn.timeoutMs, `turns[${index}].timeoutMs`);
    if (turn.selectedMode !== undefined && !['agentic', 'chitchat'].includes(turn.selectedMode)) {
      throw new Error(`turns[${index}].selectedMode must be agentic or chitchat.`);
    }
  }
}

async function runScenarioIsolated(
  input: ForegroundScenarioDriverInput,
): Promise<ForegroundScenarioDriverResult> {
  validateInput(input);
  const scenarioDeadline = Date.now() + input.scenarioTimeoutMs;
  await awaitBeforeScenarioDeadline(ensureForegroundScenarioStoresHydrated(), scenarioDeadline);
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
    await awaitBeforeScenarioDeadline(flushChatStorePersistenceNow(), scenarioDeadline);

    let currentConversationId = input.conversationId;
    let memoryScope = {
      memoryConversationId: resolveConversationWorkspaceTarget({
        conversationId: input.conversationId,
        conversations: useChatStore.getState().conversations,
      }).workspaceConversationId,
      sourceThreadId: input.conversationId,
    };
    if (input.beforeTurns) {
      await awaitBeforeScenarioDeadline(
        Promise.resolve(
          input.beforeTurns({
            conversationId: input.conversationId,
            workspaceConversationId: memoryScope.memoryConversationId,
          }),
        ),
        scenarioDeadline,
      );
    }
    let previousMemoryState = captureCompleteMemoryEvidenceForIsolatedEvaluation(memoryScope);
    let runtime = createForegroundScenarioRuntime(input, memoryRecords);
    const turnSnapshots: ForegroundScenarioTurnSnapshot[] = [];
    for (const [turnIndex, turn] of input.turns.entries()) {
      const startedAt = Date.now();
      if (remainingScenarioTimeMs(scenarioDeadline) <= 0) {
        throw new Error(SCENARIO_WALL_CLOCK_TIMEOUT_ERROR);
      }
      let lifecycleBefore: ForegroundScenarioLifecycleSnapshot | null = null;
      if (turn.lifecycleBefore === 'app_relaunch') {
        const transition = await awaitBeforeScenarioDeadline(
          relaunchForegroundScenarioApp({
            conversationId: currentConversationId,
            memoryScope,
          }),
          scenarioDeadline,
        );
        previousMemoryState = transition.memoryState;
        lifecycleBefore = transition.lifecycle;
      } else if (turn.lifecycleBefore === 'new_conversation') {
        const transition = startNewForegroundScenarioConversation({
          currentConversationId,
          providerId: input.provider.id,
          model: input.provider.model,
          systemPrompt: input.systemPrompt,
          mode: turn.selectedMode ?? input.defaultMode,
          memoryStateBefore: previousMemoryState,
        });
        currentConversationId = transition.conversationId;
        memoryScope = transition.memoryScope;
        previousMemoryState = transition.memoryState;
        lifecycleBefore = transition.lifecycle;
      }
      if (lifecycleBefore) runtime = createForegroundScenarioRuntime(input, memoryRecords);
      const retrievalCapture = await awaitBeforeScenarioDeadline(
        beginForegroundScenarioRetrievalCapture({
          sourceThreadId: currentConversationId,
          memoryOptOut: input.disableLongTermMemory === true,
        }),
        scenarioDeadline,
      );
      const nativeStateBefore = getE2ENativeMobileFixtureStateSnapshot();
      const nativeInvocationStart = getE2ENativeMobileInvocationSnapshots().length;
      const route = applyForegroundScenarioRoute(
        currentConversationId,
        turn.route,
        input.defaultMode,
        turn.selectedMode,
      );
      const before = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === currentConversationId);
      if (!before) throw new Error(`Conversation ${currentConversationId} is unavailable.`);
      const priorRunIds = new Set((before.agentRuns ?? []).map((run) => run.id));
      const messageStartIndex = before.messages.length;
      const usageBefore = before.usage;
      const memoryRecordStart = memoryRecords.length;
      const userMessageId = generateId();
      useChatStore.getState().addMessage(currentConversationId, {
        id: userMessageId,
        role: 'user',
        content: turn.content.trim(),
        ...(turn.attachments?.length
          ? { attachments: turn.attachments.map((attachment) => ({ ...attachment })) }
          : {}),
        timestamp: turn.timestamp,
      });

      runtime.resetChatError();
      runtime.setActiveTurnMaxTokens(turn.maxTokens ?? input.maxTokens);
      let timedOut = false;
      let scenarioDeadlineExceeded = false;
      const configuredTurnTimeoutMs = turn.timeoutMs ?? input.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
      const scenarioRemainingBeforeExecution = remainingScenarioTimeMs(scenarioDeadline);
      const timeoutMs = Math.min(configuredTurnTimeoutMs, scenarioRemainingBeforeExecution);
      const scenarioDeadlineLimitsExecution =
        scenarioRemainingBeforeExecution <= configuredTurnTimeoutMs;
      const executionTimeoutMessage = scenarioDeadlineLimitsExecution
        ? SCENARIO_WALL_CLOCK_TIMEOUT_ERROR
        : `Foreground scenario turn timed out after ${timeoutMs}ms.`;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let executionSettled = false;
      const execution = executeForegroundConversationRun({
        conversationId: currentConversationId,
        context: runtime.context,
        options: {
          maxTokens: turn.maxTokens ?? input.maxTokens,
          ...(input.allowedToolNames ? { allowedToolNames: input.allowedToolNames } : {}),
          memoryRetrievalStrategy: input.memoryRetrievalStrategy,
          memoryContextStrategy: input.memoryContextStrategy,
          enableCompaction: input.enableCompaction,
        },
      })
        .catch((error) => {
          if (!timedOut) throw error;
        })
        .finally(() => {
          executionSettled = true;
        });
      try {
        await Promise.race([
          execution,
          new Promise<void>((_resolve, reject) => {
            timeout = setTimeout(() => {
              timedOut = true;
              scenarioDeadlineExceeded = scenarioDeadlineLimitsExecution;
              runtime.requests.abortCurrentOrNextForegroundRequest(
                currentConversationId,
                executionTimeoutMessage,
              );
              reject(new Error(executionTimeoutMessage));
            }, timeoutMs);
          }),
        ]);
      } catch (error) {
        if (!timedOut) throw error;
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
      if (timedOut) {
        try {
          await awaitBeforeScenarioDeadline(execution, scenarioDeadline, () => {
            scenarioDeadlineExceeded = true;
          });
        } catch {
          if (remainingScenarioTimeMs(scenarioDeadline) <= 0) {
            scenarioDeadlineExceeded = true;
          }
          // The timeout already owns the turn outcome. The important isolation
          // boundary is that the aborted foreground execution has settled.
        }
        if (!executionSettled) {
          throw new ForegroundScenarioIsolationError();
        }
      }

      requestChatStorePersistenceCheckpoint(0);
      try {
        await awaitBeforeScenarioDeadline(flushChatStorePersistenceNow(), scenarioDeadline, () => {
          scenarioDeadlineExceeded = true;
          timedOut = true;
          runtime.requests.abortCurrentOrNextForegroundRequest(
            currentConversationId,
            SCENARIO_WALL_CLOCK_TIMEOUT_ERROR,
          );
        });
      } catch (error) {
        if (!scenarioDeadlineExceeded) throw error;
      }
      let memory: Awaited<ReturnType<typeof settleForegroundScenarioMemory>> = [];
      let memorySettlementError: string | null = null;
      if (!scenarioDeadlineExceeded) {
        const remainingBeforeMemory = remainingScenarioTimeMs(scenarioDeadline);
        if (remainingBeforeMemory <= 0) {
          scenarioDeadlineExceeded = true;
          timedOut = true;
        } else {
          const configuredMemoryTimeoutMs = input.memoryTimeoutMs ?? E2E_DEFAULT_MEMORY_TIMEOUT_MS;
          const memoryTimeoutMs = Math.min(configuredMemoryTimeoutMs, remainingBeforeMemory);
          try {
            memory = await settleForegroundScenarioMemory(
              memoryRecords.slice(memoryRecordStart),
              memoryTimeoutMs,
            );
          } catch (error) {
            if (remainingScenarioTimeMs(scenarioDeadline) <= 0) {
              scenarioDeadlineExceeded = true;
              timedOut = true;
            } else {
              memorySettlementError =
                error instanceof Error ? error.message : 'Foreground memory settlement failed.';
            }
          }
        }
      }
      const memoryStateAfter = captureCompleteMemoryEvidenceForIsolatedEvaluation(memoryScope);
      const conversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === currentConversationId);
      if (!conversation) throw new Error(`Conversation ${currentConversationId} is unavailable.`);
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
      const expectedMemoryCloseouts =
        input.disableLongTermMemory !== true &&
        !conversation.isSideThread &&
        finalAssistant?.completionStatus === 'complete' &&
        !timedOut
          ? 1
          : 0;
      const memoryInvariantError =
        !timedOut &&
        !chatError &&
        !memorySettlementError &&
        memory.length !== expectedMemoryCloseouts
          ? `Foreground turn recorded ${memory.length} memory closeouts; expected ${expectedMemoryCloseouts}.`
          : null;
      const turnError = scenarioDeadlineExceeded
        ? SCENARIO_WALL_CLOCK_TIMEOUT_ERROR
        : timedOut
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
            ...(memorySettlementError ? { settlementError: memorySettlementError } : {}),
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
      .conversations.find((candidate) => candidate.id === currentConversationId);
    if (!finalConversation)
      throw new Error(`Conversation ${currentConversationId} is unavailable.`);
    const providerEvidenceTimeoutMs = Math.min(
      input.memoryTimeoutMs ?? E2E_DEFAULT_MEMORY_TIMEOUT_MS,
      remainingScenarioTimeMs(scenarioDeadline),
    );
    const sealedMemory = await sealForegroundScenarioMemoryEvidenceAfterProviderWait({
      memoryScope,
      turns: turnSnapshots,
      requirements: input.providerOutcomeEvidenceRequirements ?? [],
      timeoutMs: providerEvidenceTimeoutMs,
    });
    return cloneAndFreeze({
      conversationId: input.conversationId,
      finalConversation,
      memoryFinalState: sealedMemory.memoryFinalState,
      turns: sealedMemory.turns,
    }) as ForegroundScenarioDriverResult;
  } finally {
    useChatStore.setState(chatSnapshot, true);
    useSettingsStore.setState(settingsSnapshot, true);
    requestChatStorePersistenceCheckpoint(0);
    const cleanup = Promise.allSettled([
      cancelScheduledIngestionDrain(),
      flushChatStorePersistenceNow(),
    ]).then(() => undefined);
    try {
      await awaitBeforeScenarioDeadline(cleanup, scenarioDeadline);
    } catch {
      // Cleanup is best-effort once the hard scenario deadline has elapsed.
    }
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
