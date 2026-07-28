import { createHash } from 'crypto';

import { getSessionContext } from '../../src/services/agents/subAgent';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

function parseArguments(argumentsText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function measureWorkerDurationMs(
  worker: SubAgentSnapshot,
  measuredAt: number = Date.now(),
): number {
  const measuredThrough = worker.status === 'running' ? measuredAt : worker.updatedAt;
  return Math.max(0, measuredThrough - worker.startedAt);
}

export function summarizeWorker(
  worker: SubAgentSnapshot | null,
  measuredAt: number = Date.now(),
): Record<string, unknown> | null {
  if (!worker) return null;
  return {
    sessionId: worker.sessionId,
    parentSessionId: worker.parentSessionId ?? null,
    name: worker.name ?? null,
    status: worker.status,
    completionState: worker.completionState ?? null,
    terminationCause: worker.terminationCause ?? null,
    startedAt: new Date(worker.startedAt).toISOString(),
    updatedAt: new Date(worker.updatedAt).toISOString(),
    durationMs: measureWorkerDurationMs(worker, measuredAt),
    iterations: worker.iterations ?? null,
    toolsUsed: worker.toolsUsed ?? [],
    output: worker.output ?? null,
  };
}

export function summarizeWorkerToolTranscript(
  worker: SubAgentSnapshot | null,
): Array<Record<string, unknown>> {
  if (!worker) return [];
  const messages = getSessionContext(worker.sessionId)?.messages ?? [];
  const summaries = new Map<string, Record<string, unknown>>();

  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      const prior = summaries.get(toolCall.id) ?? {};
      summaries.set(toolCall.id, {
        ...prior,
        id: toolCall.id,
        name: toolCall.name,
        arguments: parseArguments(toolCall.arguments),
        argumentsSha256: createHash('sha256').update(toolCall.arguments).digest('hex'),
        status: toolCall.status,
        resultChars: toolCall.result?.length ?? null,
        resultSha256: toolCall.result
          ? createHash('sha256').update(toolCall.result).digest('hex')
          : null,
        error: toolCall.error ?? null,
      });
    }
  }

  return [...summaries.values()];
}
