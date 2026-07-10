import { resolveRegisteredToolName } from '../../engine/tools/toolNameNormalization';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { ToolCall } from '../../types/message';
import type { TokenUsage } from '../../types/usage';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';
import type {
  ForegroundScenarioDriverResult,
  ForegroundScenarioTurnSnapshot,
} from './foregroundScenarioDriver';
import { aggregateE2ETokenUsage } from './tokenUsage';
import type {
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
        Boolean(toolCall?.error?.trim()) ||
        isToolResultErrorLike(message.content),
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
  return {
    turnIndex: turn.turnIndex,
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
    toolCalls: collectToolCalls(turn.messages),
    toolResults: collectToolResults(turn.messages),
    graphSnapshots,
    usage: aggregateE2ETokenUsage(buildUsageEvents(turn)),
    completed: turn.completion.executionCompleted,
  };
}

export function mapForegroundScenarioResult(params: {
  driverResult: ForegroundScenarioDriverResult;
  durationMs: number;
  fixtureId: string;
  requestedUserTurnCount: number;
}): E2EScenarioResult {
  const turnTraces = params.driverResult.turns.map(buildTurnTrace);
  const usageEvents = params.driverResult.turns.flatMap(buildUsageEvents);
  const errors = params.driverResult.turns.flatMap((turn) => (turn.error ? [turn.error] : []));

  return {
    fixtureId: params.fixtureId,
    conversationId: params.driverResult.conversationId,
    toolCalls: turnTraces.flatMap((turn) => turn.toolCalls),
    toolResults: turnTraces.flatMap((turn) => turn.toolResults),
    graphSnapshots: turnTraces.flatMap((turn) => turn.graphSnapshots),
    turnTraces,
    usage: aggregateE2ETokenUsage(usageEvents),
    errors,
    completed:
      turnTraces.length === params.requestedUserTurnCount &&
      turnTraces.every((turn) => turn.completed),
    durationMs: params.durationMs,
    userTurnCount: params.requestedUserTurnCount,
  };
}
