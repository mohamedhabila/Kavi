import { executeForegroundConversationSend } from '../../engine/graph/foregroundRun/sendExecution';
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
} from './foregroundScenarioDriverRuntime';
import {
  settleForegroundScenarioMemory,
  shouldExpectForegroundMemoryCloseout,
} from './foregroundScenarioMemorySettlement';
import { sealForegroundScenarioMemoryEvidenceAfterProviderWait } from './foregroundScenarioMemoryEvidence';
import { validateForegroundScenarioInput } from './foregroundScenarioInputValidation';
import { scheduleForegroundScenarioSteer } from './foregroundScenarioSteering';
import {
  cloneAndFreeze,
  resolveForegroundScenarioAllowedToolNames,
  type ForegroundScenarioDriverInput,
  type ForegroundScenarioDriverResult,
  type ForegroundScenarioLifecycleSnapshot,
  type ForegroundScenarioMemoryRecord,
  type ForegroundScenarioTurnSnapshot,
} from './foregroundScenarioDriverTypes';
import { E2E_DEFAULT_MEMORY_TIMEOUT_MS } from './thresholds';

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

let scenarioRunTail: Promise<void> = Promise.resolve();

export class ForegroundScenarioIsolationError extends Error {
  constructor() {
    super('Timed-out foreground execution did not settle before cleanup.');
    this.name = 'ForegroundScenarioIsolationError';
  }
}

function remainingScenarioTimeMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function waitForEvaluatorDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
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

async function runScenarioIsolated(
  input: ForegroundScenarioDriverInput,
): Promise<ForegroundScenarioDriverResult> {
  validateForegroundScenarioInput(input);
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
      if (remainingScenarioTimeMs(scenarioDeadline) <= 0) {
        throw new Error(SCENARIO_WALL_CLOCK_TIMEOUT_ERROR);
      }
      if (turn.delayBeforeMs !== undefined) {
        await awaitBeforeScenarioDeadline(
          waitForEvaluatorDelay(turn.delayBeforeMs),
          scenarioDeadline,
        );
      }
      const startedAt = Date.now();
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
      const awaitingUserRunIdBeforeTurn =
        before.agentRuns?.find(
          (run) =>
            run.id === before.activeAgentRunId &&
            run.status === 'running' &&
            run.controlGraph?.status === 'awaiting_user' &&
            run.controlGraph.pendingUserInput !== undefined,
        )?.id ?? null;
      const messageStartIndex = before.messages.length;
      const usageBefore = before.usage;
      const memoryRecordStart = memoryRecords.length;
      const userMessageId = generateId();
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
      const allowedToolNames = resolveForegroundScenarioAllowedToolNames(
        input.allowedToolNames,
        turn.allowedToolNames,
      );
      const runOptions = {
        maxTokens: turn.maxTokens ?? input.maxTokens,
        disableTools: input.disableTools,
        ...(allowedToolNames ? { allowedToolNames } : {}),
        memoryRetrievalStrategy: input.memoryRetrievalStrategy,
        memoryContextStrategy: input.memoryContextStrategy,
        enableCompaction: input.enableCompaction,
      };
      // A mid-run message goes through the same composer path, so it steers the run.
      const steer = turn.steer
        ? scheduleForegroundScenarioSteer({
            conversationId: currentConversationId,
            messageStartIndex,
            steer: turn.steer,
            send: (text) =>
              executeForegroundConversationSend({
                text,
                context: runtime.buildSendContext(currentConversationId),
                runOptions,
              }),
          })
        : null;
      // Enter through the chat screen's composer path so the scenario exercises
      // conversation resolution, write reservation, attachment import, and the
      // user-message append exactly as the app does.
      const execution = executeForegroundConversationSend({
        text: turn.content.trim(),
        ...(turn.attachments?.length
          ? { attachments: turn.attachments.map((attachment) => ({ ...attachment })) }
          : {}),
        context: runtime.buildSendContext(currentConversationId, {
          generateId: () => userMessageId,
          addMessage: (conversationId, message) =>
            useChatStore
              .getState()
              .addMessage(conversationId, { ...message, timestamp: turn.timestamp }),
        }),
        runOptions,
      })
        .then(() => steer?.settle())
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
      const run = resolveForegroundScenarioTurnRun(
        conversation,
        userMessageId,
        priorRunIds,
        awaitingUserRunIdBeforeTurn,
      );
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
      const expectedMemoryCloseouts = shouldExpectForegroundMemoryCloseout({
        disableLongTermMemory: input.disableLongTermMemory === true,
        finalAssistantCompleted: finalAssistant?.completionStatus === 'complete',
        graphStatus: run?.controlGraph?.status,
        isSideThread: conversation.isSideThread === true,
        timedOut,
      })
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
