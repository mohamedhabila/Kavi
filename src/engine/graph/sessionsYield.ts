import { normalizeToolName } from '../tools/toolNameNormalization';

export interface AgentControlGraphSessionsYieldResult {
  yielded: boolean;
  message?: string;
  forceFinalText?: boolean;
}

function isPlainRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseAgentControlGraphSessionsYieldResult(
  toolName: string,
  result: string,
): AgentControlGraphSessionsYieldResult {
  if (normalizeToolName(toolName) !== 'sessions_yield') {
    return { yielded: false };
  }

  try {
    const parsed = JSON.parse(result) as unknown;
    if (!isPlainRecordValue(parsed)) {
      return { yielded: false };
    }

    const status = typeof parsed.status === 'string' ? parsed.status.trim().toLowerCase() : '';
    const message =
      typeof parsed.message === 'string' && parsed.message.trim() ? parsed.message.trim() : undefined;

    if (status === 'completed' && parsed.finalizeSupervisor === true) {
      return {
        yielded: false,
        message,
        forceFinalText: true,
      };
    }
  } catch {
    return { yielded: false };
  }

  return { yielded: false };
}

export function buildAgentControlGraphSessionsYieldCompletionNote(message?: string): string {
  return [
    '[SYSTEM FINAL DELIVERY]',
    'Background sessions are terminal.',
    message ? `Supervisor note: ${message}` : undefined,
    'Deliver the final user-facing answer now.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function trimAgentControlGraphPendingToolCallsAfterYield<
  T extends {
    name: string;
  },
>(
  pendingToolCalls: ReadonlyArray<T>,
): T[] {
  const firstYieldIndex = pendingToolCalls.findIndex(
    (toolCall) => normalizeToolName(toolCall.name) === 'sessions_yield',
  );
  if (firstYieldIndex < 0) {
    return [...pendingToolCalls];
  }

  return pendingToolCalls.slice(0, firstYieldIndex + 1);
}
