import {
  getSubAgent,
  waitForSubAgentCompletion,
} from '../../services/agents/subAgent';
import {
  pruneStaleCommandPolls,
  resetCommandPollCount,
} from '../../services/agents/commandPollBackoff';
import { collectRequestedSessionIds, DEFAULT_SESSIONS_WAIT_TIMEOUT_MS, resolveBlockingWaitTimeoutMs } from './builtin-session-waitSupport';
import { COMPLETED_SESSIONS_WAIT_GUIDANCE, serializeRunningSessionWaitEntry, serializeTerminalSessionResult } from './builtin-session-resultSupport';
import { sessionStatusFingerprints, sessionStatusPollState } from './builtin-session-statusSupport';

export async function executeSessionWait(
  args: {
    sessionId?: string;
    sessionIds?: string[];
    waitTimeoutMs?: number;
  },
  conversationId: string,
): Promise<string> {
  pruneStaleCommandPolls(sessionStatusPollState);

  const selection = collectRequestedSessionIds(args, conversationId);
  if (selection.error) {
    return JSON.stringify({ status: 'error', error: selection.error });
  }

  if (selection.sessionIds.length === 0) {
    return JSON.stringify({
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
    });
  }

  const missingSessionIds = selection.sessionIds.filter((sessionId) => !getSubAgent(sessionId));
  if (missingSessionIds.length > 0) {
    return JSON.stringify({
      status: 'error',
      error:
        missingSessionIds.length === 1
          ? `session not found: ${missingSessionIds[0]}`
          : `sessions not found: ${missingSessionIds.join(', ')}`,
      missingSessionIds,
    });
  }

  const waitWindow = resolveBlockingWaitTimeoutMs(
    args.waitTimeoutMs,
    DEFAULT_SESSIONS_WAIT_TIMEOUT_MS,
  );
  const waitTimeoutMs = waitWindow.waitTimeoutMs;
  const waitedResults = await Promise.all(
    selection.sessionIds.map((sessionId) => waitForSubAgentCompletion(sessionId, waitTimeoutMs)),
  );

  const sessions: Record<string, unknown>[] = [];
  const pendingSessions: Record<string, unknown>[] = [];
  let completedCount = 0;

  for (let index = 0; index < selection.sessionIds.length; index += 1) {
    const sessionId = selection.sessionIds[index];
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

  return JSON.stringify({
    status: completedAll ? 'completed' : 'running',
    sessionIds: selection.sessionIds,
    sessionCount: selection.sessionIds.length,
    completedCount,
    pendingCount,
    waitedForConversationSessions: selection.waitsForConversationSessions,
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
  });
}
