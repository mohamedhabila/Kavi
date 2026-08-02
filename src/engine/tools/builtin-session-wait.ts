import { getSubAgent, waitForSubAgentCompletion } from '../../services/agents/subAgent';
import {
  pruneStaleCommandPolls,
  resetCommandPollCount,
} from '../../services/agents/commandPollBackoff';
import {
  collectRequestedSessionIds,
  DEFAULT_SESSIONS_WAIT_TIMEOUT_MS,
  resolveBlockingWaitTimeoutMs,
} from './builtin-session-waitSupport';
import {
  COMPLETED_SESSIONS_WAIT_GUIDANCE,
  serializeRunningSessionWaitEntry,
  serializeTerminalSessionResult,
} from './builtin-session-resultSupport';
import { sessionStatusFingerprints, sessionStatusPollState } from './builtin-session-statusSupport';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

export async function executeSessionWait(
  args: {
    sessionId?: string;
    sessionIds?: string[];
    waitTimeoutMs?: number;
  },
  conversationId: string,
  executionSignal?: AbortSignal,
  pendingSessionIds?: ReadonlyArray<string>,
): Promise<ToolRuntimeOutcome> {
  pruneStaleCommandPolls(sessionStatusPollState);

  const selection = collectRequestedSessionIds(args, conversationId, pendingSessionIds);
  if (selection.error) {
    return failedToolOutcome(JSON.stringify({ status: 'error', error: selection.error }));
  }

  if (selection.sessionIds.length === 0) {
    return completedToolOutcome(
      JSON.stringify({
        status: 'completed',
        sessionIds: [],
        sessionCount: 0,
        completedCount: 0,
        pendingCount: 0,
        waitedForConversationSessions: selection.waitsForConversationSessions,
        sessions: [],
        guidance: selection.waitsForConversationSessions
          ? 'No running sub-agent sessions remain for this conversation.'
          : 'No target sub-agent sessions were provided.',
      }),
    );
  }

  const requestedSessionIds = selection.sessionIds;
  let resolvedSessionIds = requestedSessionIds;
  let identityResolution:
    | {
        kind: 'single_pending_session';
        requestedSessionId: string;
        resolvedSessionId: string;
      }
    | undefined;
  let missingSessionIds = resolvedSessionIds.filter((sessionId) => !getSubAgent(sessionId));

  if (
    !selection.waitsForConversationSessions &&
    resolvedSessionIds.length === 1 &&
    missingSessionIds.length === 1
  ) {
    const exactPendingSessionIds = Array.from(
      new Set(
        (pendingSessionIds ?? [])
          .map((sessionId) => (typeof sessionId === 'string' ? sessionId.trim() : ''))
          .filter((sessionId) => Boolean(sessionId) && Boolean(getSubAgent(sessionId))),
      ),
    );
    if (exactPendingSessionIds.length === 1) {
      identityResolution = {
        kind: 'single_pending_session',
        requestedSessionId: resolvedSessionIds[0],
        resolvedSessionId: exactPendingSessionIds[0],
      };
      resolvedSessionIds = exactPendingSessionIds;
      missingSessionIds = [];
    }
  }

  if (missingSessionIds.length > 0) {
    const availablePendingSessionIds = Array.from(
      new Set(
        (pendingSessionIds ?? [])
          .map((sessionId) => (typeof sessionId === 'string' ? sessionId.trim() : ''))
          .filter(Boolean),
      ),
    );
    return failedToolOutcome(
      JSON.stringify({
        status: 'error',
        code: 'session_not_found',
        error:
          missingSessionIds.length === 1
            ? `session not found: ${missingSessionIds[0]}`
            : `sessions not found: ${missingSessionIds.join(', ')}`,
        missingSessionIds,
        ...(availablePendingSessionIds.length > 0 ? { availablePendingSessionIds } : {}),
        guidance:
          availablePendingSessionIds.length > 0
            ? 'Use an availablePendingSessionIds value exactly as returned, or omit sessionId/sessionIds to wait for every joined worker in this request.'
            : 'Use a session id exactly as returned by sessions_spawn or sessions_list.',
      }),
    );
  }

  const waitWindow = resolveBlockingWaitTimeoutMs(
    args.waitTimeoutMs,
    DEFAULT_SESSIONS_WAIT_TIMEOUT_MS,
  );
  const waitTimeoutMs = waitWindow.waitTimeoutMs;
  const waitedResults = await Promise.all(
    resolvedSessionIds.map((sessionId) =>
      executionSignal
        ? waitForSubAgentCompletion(sessionId, waitTimeoutMs, executionSignal)
        : waitForSubAgentCompletion(sessionId, waitTimeoutMs),
    ),
  );

  const sessions: Record<string, unknown>[] = [];
  const pendingSessions: Record<string, unknown>[] = [];
  let completedCount = 0;

  for (let index = 0; index < resolvedSessionIds.length; index += 1) {
    const sessionId = resolvedSessionIds[index];
    const waitResult = waitedResults[index];

    if (waitResult) {
      resetCommandPollCount(sessionStatusPollState, sessionId);
      sessionStatusFingerprints.delete(sessionId);
      sessions.push(serializeTerminalSessionResult(waitResult, { includeGuidance: false }));
      completedCount += 1;
      continue;
    }

    const latestAgent = getSubAgent(sessionId);
    if (latestAgent && latestAgent.status !== 'running') {
      const terminalResult = await waitForSubAgentCompletion(sessionId, 1);
      if (terminalResult) {
        resetCommandPollCount(sessionStatusPollState, sessionId);
        sessionStatusFingerprints.delete(sessionId);
        sessions.push(serializeTerminalSessionResult(terminalResult, { includeGuidance: false }));
        completedCount += 1;
        continue;
      }
    }

    if (latestAgent) {
      const runningSnapshot = serializeRunningSessionWaitEntry(latestAgent);
      sessions.push(runningSnapshot);
      pendingSessions.push(runningSnapshot);
      continue;
    }

    pendingSessions.push({
      sessionId,
      status: 'error',
      error: 'Session disappeared while waiting.',
    });
  }

  const pendingCount = pendingSessions.length;
  const completedAll = pendingCount === 0;

  return completedToolOutcome(
    JSON.stringify({
      status: completedAll ? 'completed' : 'running',
      sessionIds: resolvedSessionIds,
      sessionCount: resolvedSessionIds.length,
      completedCount,
      pendingCount,
      waitedForConversationSessions: selection.waitsForConversationSessions,
      ...(selection.selectedTrackedSessions ? { selectedTrackedSessions: true } : {}),
      ...(identityResolution
        ? {
            requestedSessionIds,
            identityResolution,
          }
        : {}),
      ...(!completedAll ? { waitTimeoutMs } : {}),
      ...(!completedAll ? { waitTimedOut: true } : {}),
      ...(!completedAll && waitWindow.usedDefault ? { usedDefaultWaitTimeout: true } : {}),
      sessions,
      ...(pendingSessions.length > 0 ? { pendingSessions } : {}),
      guidance: completedAll
        ? `All requested sub-agent sessions reached terminal states. ${COMPLETED_SESSIONS_WAIT_GUIDANCE}`
        : completedCount > 0
          ? 'The wait window ended while some requested sub-agent sessions are still running. Continue from any completed outputs that are already sufficient, call sessions_wait again to keep blocking, or keep working on non-overlapping tasks until they finish.'
          : 'The wait window ended while some requested sub-agent sessions are still running. Call sessions_wait again to keep blocking, or keep working on non-overlapping tasks until they finish.',
    }),
  );
}
