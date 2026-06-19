import {
  getSubAgentsByParent,
  startSubAgent,
  waitForSubAgentResultPromise,
} from '../../services/agents/subAgent';

type StartedSubAgent = Awaited<ReturnType<typeof startSubAgent>>;
type StartedSubAgentResult = Awaited<StartedSubAgent['resultPromise']>;

export const DEFAULT_SESSIONS_WAIT_TIMEOUT_MS = 3 * 60 * 1000;

function normalizeWaitTimeoutMs(value?: number): number | undefined {
  if (!Number.isFinite(value) || Number(value) <= 0) {
    return undefined;
  }

  return Math.max(1000, Math.floor(Number(value)));
}

export function resolveBlockingWaitTimeoutMs(
  value?: number,
  defaultWaitTimeoutMs: number = DEFAULT_SESSIONS_WAIT_TIMEOUT_MS,
): { waitTimeoutMs: number; usedDefault: boolean } {
  const normalized = normalizeWaitTimeoutMs(value);
  if (normalized != null) {
    return {
      waitTimeoutMs: normalized,
      usedDefault: false,
    };
  }

  return {
    waitTimeoutMs: defaultWaitTimeoutMs,
    usedDefault: true,
  };
}

export async function waitForStartedSubAgentResult(
  started: StartedSubAgent,
  waitTimeoutMs?: number,
): Promise<StartedSubAgentResult | null> {
  return waitForSubAgentResultPromise(started.resultPromise, waitTimeoutMs);
}

export function collectRequestedSessionIds(
  args: { sessionId?: unknown; sessionIds?: unknown },
  conversationId: string,
): { sessionIds: string[]; waitsForConversationSessions: boolean; error?: string } {
  const explicitIds = new Set<string>();

  if (typeof args.sessionId === 'string' && args.sessionId.trim()) {
    explicitIds.add(args.sessionId.trim());
  }

  if (Array.isArray(args.sessionIds)) {
    for (const value of args.sessionIds) {
      if (typeof value === 'string' && value.trim()) {
        explicitIds.add(value.trim());
      }
    }

    if (args.sessionIds.length > 0 && explicitIds.size === 0) {
      return {
        sessionIds: [],
        waitsForConversationSessions: false,
        error: 'sessionIds must include at least one non-empty session id.',
      };
    }
  }

  if (explicitIds.size > 0) {
    return { sessionIds: [...explicitIds], waitsForConversationSessions: false };
  }

  return {
    sessionIds: getSubAgentsByParent(conversationId)
      .filter((agent) => agent.status === 'running')
      .map((agent) => agent.sessionId),
    waitsForConversationSessions: true,
  };
}
