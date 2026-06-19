import {
  getSubAgent,
} from '../../services/agents/subAgent';
import {
  pruneStaleCommandPolls,
  recordCommandPoll,
  resetCommandPollCount,
} from '../../services/agents/commandPollBackoff';
import { buildSessionPollingGuidance, buildSessionStatusPayload, sessionStatusFingerprints, sessionStatusPollState } from './builtin-session-statusSupport';
import { TERMINAL_SESSION_OUTPUT_GUIDANCE } from './builtin-session-resultSupport';

export async function executeSessionStatus(args: { sessionId: string }): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) return `Error: session not found: ${args.sessionId}`;

  pruneStaleCommandPolls(sessionStatusPollState);

  const statusPayload = buildSessionStatusPayload(agent, args.sessionId);
  let recommendedWaitMs: number | undefined;

  if (agent.status === 'running') {
    recommendedWaitMs = recordCommandPoll(
      sessionStatusPollState,
      args.sessionId,
      statusPayload.hasNewActivity,
    );
    if (statusPayload.liveness === 'stalled') {
      recommendedWaitMs = Math.max(recommendedWaitMs, 5000);
    }
    sessionStatusFingerprints.set(args.sessionId, statusPayload.fingerprint);
  } else {
    resetCommandPollCount(sessionStatusPollState, args.sessionId);
    sessionStatusFingerprints.delete(args.sessionId);
  }

  return JSON.stringify({
    sessionId: args.sessionId,
    status: agent.status,
    startedAt: agent.startedAt,
    updatedAt: agent.updatedAt,
    deadlineAt: statusPayload.deadlineAt,
    depth: agent.depth,
    sandboxPolicy: agent.sandboxPolicy,
    elapsedMs: statusPayload.now - agent.startedAt,
    idleMs: statusPayload.idleMs,
    launchState: agent.launchState,
    lastProgressAt: statusPayload.lastProgressAt,
    awaitingModelResponse: statusPayload.awaitingModelResponse,
    modelResponsePendingSince: agent.modelResponsePendingSince,
    modelResponseWaitMs: statusPayload.modelResponseWaitMs,
    liveness: statusPayload.liveness,
    hasDeadline: statusPayload.deadlineAt != null,
    remainingDeadlineMs: statusPayload.remainingDeadlineMs,
    hasOutput: !!agent.output,
    outputPreview: agent.output?.slice(0, 320),
    hasNewActivity: statusPayload.hasNewActivity,
    currentActivity: agent.currentActivity,
    activeToolName: agent.activeToolName,
    activeToolElapsedMs: agent.activeToolStartedAt
      ? Math.max(0, statusPayload.now - agent.activeToolStartedAt)
      : undefined,
    lastToolResultPreview: agent.lastToolResultPreview,
    recentActivity: agent.activityLog?.slice(-5) || [],
    canCancel: agent.status === 'running',
    artifactCount: agent.artifacts?.length || 0,
    artifacts: agent.artifacts,
    recommendedWaitMs,
    guidance:
      agent.status === 'running'
        ? buildSessionPollingGuidance({
            status: agent.status,
            recommendedWaitMs,
            hasNewActivity: statusPayload.hasNewActivity,
            launchState: agent.launchState,
            currentActivity: agent.currentActivity,
            idleMs: statusPayload.idleMs,
            liveness: statusPayload.liveness,
            awaitingModelResponse: statusPayload.awaitingModelResponse,
            modelResponseWaitMs: statusPayload.modelResponseWaitMs,
          })
        : TERMINAL_SESSION_OUTPUT_GUIDANCE,
    toolsUsed: agent.toolsUsed,
    iterations: agent.iterations,
  });
}
