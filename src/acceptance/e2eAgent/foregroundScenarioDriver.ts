import { executeForegroundConversationSend } from '../../engine/graph/foregroundRun/sendExecution';
import { resolveConversationWorkspaceTarget } from '../../services/conversationWorkspace/ownership';
import {
  cancelMemoryExtraction,
  waitForMemoryExtractionIdle,
} from '../../services/memory/core/memoryExtractionWorker';
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
  resetForegroundScenarioContext,
} from './foregroundScenarioLifecycle';
import {
  beginForegroundScenarioMemoryPromptCapture,
  captureForegroundScenarioMemoryItems,
  completeForegroundScenarioMemoryPromptCapture,
} from './foregroundScenarioMemoryItemsEvidence';
import {
  buildForegroundScenarioCompletionSnapshot,
  buildForegroundScenarioUsageDelta,
  createForegroundScenarioRuntime,
  createSeedConversation,
  ensureForegroundScenarioStoresHydrated,
  resolveForegroundScenarioFinalAssistant,
  resolveForegroundScenarioTurnRun,
  selectForegroundScenarioTurnMessages,
} from './foregroundScenarioDriverRuntime';
import { validateForegroundScenarioInput } from './foregroundScenarioInputValidation';
import { scheduleForegroundScenarioSteer } from './foregroundScenarioSteering';
import {
  cloneAndFreeze,
  resolveForegroundScenarioAllowedToolNames,
  type ForegroundScenarioDriverInput,
  type ForegroundScenarioDriverResult,
  type ForegroundScenarioLifecycleSnapshot,
  type ForegroundScenarioMemoryScope,
  type ForegroundScenarioTurnSnapshot,
} from './foregroundScenarioDriverTypes';
import { E2E_DEFAULT_MEMORY_TIMEOUT_MS } from './thresholds';

export type {
  ForegroundScenarioCompletionSnapshot,
  ForegroundScenarioDriverInput,
  ForegroundScenarioDriverResult,
  ForegroundScenarioFinalAssistantSnapshot,
  ForegroundScenarioLifecycleBoundary,
  ForegroundScenarioLifecycleSnapshot,
  ForegroundScenarioNativeEvidenceSnapshot,
  ForegroundScenarioTurnInput,
  ForegroundScenarioTurnSnapshot,
  ForegroundScenarioUserSnapshot,
} from './foregroundScenarioDriverTypes';

const DEFAULT_TURN_TIMEOUT_MS = 120_000;
const SCENARIO_WALL_CLOCK_TIMEOUT_ERROR = 'Foreground scenario wall-clock deadline exceeded.';

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

  try {
    useSettingsStore.setState({
      providers: [{ ...input.provider }],
      activeProviderId: input.provider.id,
      activeModel: input.provider.model,
      systemPrompt: input.systemPrompt,
      // The app's default: each model thinks at its own default level.
      thinkingLevel: undefined,
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
    let memoryScope: ForegroundScenarioMemoryScope = {
      memoryConversationId: resolveConversationWorkspaceTarget({
        conversationId: input.conversationId,
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
    let runtime = createForegroundScenarioRuntime(input);
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
          relaunchForegroundScenarioApp({ conversationId: currentConversationId }),
          scenarioDeadline,
        );
        lifecycleBefore = transition.lifecycle;
      } else if (turn.lifecycleBefore === 'context_reset') {
        lifecycleBefore = resetForegroundScenarioContext({
          conversationId: currentConversationId,
        }).lifecycle;
      }
      if (lifecycleBefore) runtime = createForegroundScenarioRuntime(input);
      const memoryPromptCapture = beginForegroundScenarioMemoryPromptCapture({
        memoryOptOut: input.disableLongTermMemory === true,
      });
      const nativeStateBefore = getE2ENativeMobileFixtureStateSnapshot();
      const nativeInvocationStart = getE2ENativeMobileInvocationSnapshots().length;
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
      const usageBefore = before.usage;
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
        enableCompaction: input.enableCompaction,
      };
      // A mid-run message goes through the same composer path, so it steers the run.
      const steer = turn.steer
        ? scheduleForegroundScenarioSteer({
            conversationId: currentConversationId,
            userMessageId,
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
      // Let background extraction finish, as the time before a user's next message would.
      let memoryExtractionSettled = false;
      const memoryWaitStartedAt = Date.now();
      if (!scenarioDeadlineExceeded) {
        memoryExtractionSettled = await waitForMemoryExtractionIdle(
          Math.min(
            input.memoryTimeoutMs ?? E2E_DEFAULT_MEMORY_TIMEOUT_MS,
            remainingScenarioTimeMs(scenarioDeadline),
          ),
        );
      }
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
      const turnMessages = selectForegroundScenarioTurnMessages(
        conversation.messages,
        userMessageId,
      );
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
      const turnError = scenarioDeadlineExceeded
        ? SCENARIO_WALL_CLOCK_TIMEOUT_ERROR
        : timedOut
          ? `Foreground scenario turn timed out after ${timeoutMs}ms.`
          : chatError;
      const completion = buildForegroundScenarioCompletionSnapshot({
        error: turnError,
        finalAssistant,
        run,
        timedOut,
        userMessage: persistedUserMessage,
      });
      turnSnapshots.push(
        cloneAndFreeze({
          completion,
          durationMs: Date.now() - startedAt,
          error: turnError,
          finalAssistant,
          finalAssistantCandidateCount: finalAssistantResolution.candidateCount,
          lifecycleBefore,
          memoryExtractionSettled,
          memoryExtractionWaitMs: Date.now() - memoryWaitStartedAt,
          messages: turnMessages,
          native: {
            stateBefore: nativeStateBefore,
            stateAfter: getE2ENativeMobileFixtureStateSnapshot(),
            invocations: nativeInvocations,
          },
          memoryPrompt: completeForegroundScenarioMemoryPromptCapture({
            capture: memoryPromptCapture,
            memoryConversationId: memoryScope.memoryConversationId,
          }),
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
      if (turnError) break;
    }

    const finalConversation = useChatStore
      .getState()
      .conversations.find((candidate) => candidate.id === currentConversationId);
    if (!finalConversation)
      throw new Error(`Conversation ${currentConversationId} is unavailable.`);
    return cloneAndFreeze({
      conversationId: input.conversationId,
      finalConversation,
      memoryItems: captureForegroundScenarioMemoryItems(),
      turns: turnSnapshots,
    }) as ForegroundScenarioDriverResult;
  } finally {
    useChatStore.setState(chatSnapshot, true);
    useSettingsStore.setState(settingsSnapshot, true);
    requestChatStorePersistenceCheckpoint(0);
    cancelMemoryExtraction();
    const cleanup = flushChatStorePersistenceNow().catch(() => undefined);
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
