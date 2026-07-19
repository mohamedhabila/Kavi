import { resolveRegisteredToolName } from '../../engine/tools/toolNameNormalization';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { ToolCall } from '../../types/message';
import type { TokenUsage } from '../../types/usage';
import type {
  ForegroundScenarioDriverResult,
  ForegroundScenarioTurnSnapshot,
} from './foregroundScenarioDriver';
import { cloneAndFreeze } from './foregroundScenarioDriverTypes';
import { aggregateE2ETokenUsage } from './tokenUsage';
import { aggregateE2EEstimatedCost } from './e2eEstimatedCost';
import type {
  E2EScenarioContentClass,
  E2EScenarioResult,
  E2EScenarioTurnTrace,
  E2EToolCallRecord,
  E2EToolResultRecord,
} from './types';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function collectToolCalls(
  messages: ForegroundScenarioTurnSnapshot['messages'],
): E2EToolCallRecord[] {
  const calls: E2EToolCallRecord[] = [];
  const seenIds = new Set<string>();

  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      if (seenIds.has(toolCall.id)) continue;
      seenIds.add(toolCall.id);
      calls.push({
        id: toolCall.id,
        name: resolveRegisteredToolName(toolCall.name),
        arguments: toolCall.arguments,
      });
    }
  }

  return calls;
}

function indexToolCalls(
  messages: ForegroundScenarioTurnSnapshot['messages'],
): ReadonlyMap<string, ToolCall> {
  const calls = new Map<string, ToolCall>();
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      calls.set(toolCall.id, cloneJson(toolCall) as ToolCall);
    }
  }
  return calls;
}

function collectToolResults(
  messages: ForegroundScenarioTurnSnapshot['messages'],
): E2EToolResultRecord[] {
  const calls = indexToolCalls(messages);
  const results: E2EToolResultRecord[] = [];

  for (const message of messages) {
    if (message.role !== 'tool' || !message.toolCallId) continue;
    const toolCall = calls.get(message.toolCallId);
    results.push({
      toolCallId: message.toolCallId,
      name: resolveRegisteredToolName(toolCall?.name ?? message.toolCallId),
      content: message.content,
      isError:
        message.isError === true ||
        toolCall?.status === 'failed' ||
        Boolean(toolCall?.error?.trim()),
    });
  }

  return results;
}

function buildUsageEvents(turn: ForegroundScenarioTurnSnapshot): TokenUsage[] {
  return (turn.usage?.entries ?? []).map((entry) => ({
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheWriteTokens: entry.cacheWriteTokens,
    totalTokens: entry.totalTokens,
    model: entry.model,
    ...(entry.tokenDetails ? { tokenDetails: { ...entry.tokenDetails } } : {}),
    ...(entry.tokenBuckets ? { tokenBuckets: { ...entry.tokenBuckets } } : {}),
    ...(entry.promptCache ? { promptCache: { ...entry.promptCache } } : {}),
  }));
}

function buildTurnTrace(turn: ForegroundScenarioTurnSnapshot): E2EScenarioTurnTrace {
  const graphSnapshots: AgentRunControlGraphState[] = turn.run?.controlGraph
    ? [cloneJson(turn.run.controlGraph) as AgentRunControlGraphState]
    : [];
  return cloneAndFreeze({
    turnIndex: turn.turnIndex,
    lifecycleBefore: cloneJson(turn.lifecycleBefore),
    user: cloneJson(turn.user),
    route: cloneJson(turn.route),
    finalAssistant: turn.finalAssistant ? cloneJson(turn.finalAssistant) : null,
    finalAssistantCandidateCount: turn.finalAssistantCandidateCount,
    completion: cloneJson(turn.completion),
    agentRun: turn.run
      ? {
          runId: turn.run.id,
          userMessageId: turn.run.userMessageId,
          status: turn.run.status,
          currentPhase: turn.run.currentPhase,
          createdAt: turn.run.createdAt,
          updatedAt: turn.run.updatedAt,
          completedAt: turn.run.completedAt ?? null,
          terminalReason: turn.run.terminalReason ?? null,
          summary: cloneJson(turn.run.summary),
        }
      : null,
    memory: cloneJson(turn.memory),
    memoryEvidence: cloneJson(turn.memoryEvidence),
    native: cloneJson(turn.native),
    retrieval: cloneJson(turn.retrieval),
    toolCalls: collectToolCalls(turn.messages),
    toolResults: collectToolResults(turn.messages),
    graphSnapshots,
    usage: aggregateE2ETokenUsage(buildUsageEvents(turn)),
    completed: turn.completion.executionCompleted,
  }) as E2EScenarioTurnTrace;
}

function scenarioTurnSequenceCompleted(turns: ReadonlyArray<E2EScenarioTurnTrace>): boolean {
  const finalTurnIndex = turns.length - 1;
  return turns.every((turn, index) => {
    if (!turn.completion.finalResponseCompleted) return false;
    if (turn.completion.executionCompleted) return true;
    return index < finalTurnIndex && turn.completion.graphStatus === 'awaiting_user';
  });
}

export function mapForegroundScenarioResult(params: {
  contentClass: E2EScenarioContentClass;
  driverResult: ForegroundScenarioDriverResult;
  durationMs: number;
  fixtureId: string;
  requestedUserTurnCount: number;
}): E2EScenarioResult {
  const turnTraces = params.driverResult.turns.map(buildTurnTrace);
  const usageEvents = params.driverResult.turns.flatMap(buildUsageEvents);
  const usageEntries = params.driverResult.turns.flatMap((turn) => turn.usage?.entries ?? []);
  const errors = params.driverResult.turns.flatMap((turn) => (turn.error ? [turn.error] : []));

  return cloneAndFreeze({
    contentClass: params.contentClass,
    fixtureId: params.fixtureId,
    conversationId: params.driverResult.conversationId,
    toolCalls: turnTraces.flatMap((turn) => turn.toolCalls),
    toolResults: turnTraces.flatMap((turn) => turn.toolResults),
    graphSnapshots: turnTraces.flatMap((turn) => turn.graphSnapshots),
    memoryFinalState: cloneJson(params.driverResult.memoryFinalState),
    turnTraces,
    usage: aggregateE2ETokenUsage(usageEvents),
    estimatedCost: aggregateE2EEstimatedCost(usageEntries),
    errors,
    completed:
      turnTraces.length === params.requestedUserTurnCount &&
      scenarioTurnSequenceCompleted(turnTraces),
    durationMs: params.durationMs,
    userTurnCount: params.requestedUserTurnCount,
  }) as E2EScenarioResult;
}
