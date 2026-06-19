import type { Attachment } from '../../types/attachment';
import type { CommandPollState } from '../../services/agents/commandPollBackoff';

export const sessionStatusPollState: CommandPollState = {};
export const sessionStatusFingerprints = new Map<string, string>();

function buildSessionStatusFingerprint(agent: {
  status: string;
  updatedAt?: number;
  lastProgressAt?: number;
  modelResponsePendingSince?: number;
  launchState?: string;
  output?: string;
  currentActivity?: string;
  activeToolName?: string;
  lastToolResultPreview?: string;
  artifacts?: Attachment[];
}): string {
  return JSON.stringify({
    status: agent.status,
    updatedAt: agent.updatedAt,
    lastProgressAt: agent.lastProgressAt,
    modelResponsePendingSince: agent.modelResponsePendingSince,
    launchState: agent.launchState || '',
    outputPreview: agent.output?.slice(0, 1000) || '',
    currentActivity: agent.currentActivity || '',
    activeToolName: agent.activeToolName || '',
    lastToolResultPreview: agent.lastToolResultPreview || '',
    artifactCount: agent.artifacts?.length || 0,
  });
}

function formatSessionDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

type SessionLiveness = 'active' | 'quiet' | 'stalled';

const SESSION_QUIET_IDLE_MS = 10_000;
const SESSION_STALLED_IDLE_MS = 45_000;
const MODEL_RESPONSE_PENDING_QUIET_MS = 30_000;
const MODEL_RESPONSE_PENDING_STALLED_MS = 120_000;

function getSessionLiveness(params: {
  idleMs: number;
  modelResponseWaitMs?: number;
}): SessionLiveness {
  if (typeof params.modelResponseWaitMs === 'number') {
    if (params.modelResponseWaitMs >= MODEL_RESPONSE_PENDING_STALLED_MS) {
      return 'stalled';
    }
    if (params.modelResponseWaitMs >= MODEL_RESPONSE_PENDING_QUIET_MS) {
      return 'quiet';
    }
    return 'active';
  }

  if (params.idleMs >= SESSION_STALLED_IDLE_MS) {
    return 'stalled';
  }
  if (params.idleMs >= SESSION_QUIET_IDLE_MS) {
    return 'quiet';
  }
  return 'active';
}

function getModelResponseWaitMs(params: {
  now: number;
  modelResponsePendingSince?: number;
}): number | undefined {
  if (typeof params.modelResponsePendingSince !== 'number') {
    return undefined;
  }

  return Math.max(0, params.now - params.modelResponsePendingSince);
}

function isAwaitingModelResponse(modelResponseWaitMs?: number): boolean {
  return typeof modelResponseWaitMs === 'number';
}

function getSessionLivenessLabel(params: {
  idleMs: number;
  modelResponseWaitMs?: number;
}): SessionLiveness {
  return getSessionLiveness(params);
}

export function buildSessionPollingGuidance(params: {
  status: string;
  recommendedWaitMs?: number;
  hasNewActivity?: boolean;
  launchState?: string;
  currentActivity?: string;
  idleMs?: number;
  liveness?: SessionLiveness;
  awaitingModelResponse?: boolean;
  modelResponseWaitMs?: number;
}): string | undefined {
  if (params.status !== 'running' || !params.recommendedWaitMs) {
    return undefined;
  }

  const currentActivitySuffix = params.currentActivity
    ? ` Current activity: ${params.currentActivity}.`
    : '';
  const blockingWaitSuffix = ' Use sessions_wait if you need to block for completion.';

  if (params.launchState === 'queued') {
    return `The worker is still bootstrapping.${currentActivitySuffix} Wait about ${params.recommendedWaitMs}ms before polling again.${blockingWaitSuffix}`;
  }

  if (params.awaitingModelResponse && typeof params.modelResponseWaitMs === 'number') {
    return `The worker is still waiting for the model's response after ${formatSessionDuration(params.modelResponseWaitMs)}.${currentActivitySuffix} Wait about ${params.recommendedWaitMs}ms before polling again.${blockingWaitSuffix}`;
  }

  if (params.liveness === 'stalled' && typeof params.idleMs === 'number') {
    return `The worker has been idle for ${formatSessionDuration(params.idleMs)}.${currentActivitySuffix} Wait about ${params.recommendedWaitMs}ms before polling again.${blockingWaitSuffix}`;
  }

  if (params.hasNewActivity) {
    return `New worker activity was observed.${currentActivitySuffix} Wait about ${params.recommendedWaitMs}ms before polling again.${blockingWaitSuffix}`;
  }

  return `No new worker activity was observed.${currentActivitySuffix} Wait about ${params.recommendedWaitMs}ms before polling again.${blockingWaitSuffix}`;
}

export function buildSessionStatusPayload(
  agent: {
    status: string;
    updatedAt?: number;
    startedAt: number;
    lastProgressAt?: number;
    modelResponsePendingSince?: number;
    launchState?: string;
    output?: string;
    currentActivity?: string;
    activeToolName?: string;
    lastToolResultPreview?: string;
    artifacts?: Attachment[];
    deadlineAt?: number;
  },
  sessionId: string,
): {
  now: number;
  lastProgressAt: number;
  idleMs: number;
  modelResponseWaitMs?: number;
  awaitingModelResponse: boolean;
  liveness?: SessionLiveness;
  fingerprint: string;
  hasNewActivity: boolean;
  deadlineAt?: number;
  remainingDeadlineMs?: number;
} {
  const now = Date.now();
  const lastProgressAt = agent.lastProgressAt || agent.updatedAt || agent.startedAt;
  const idleMs = Math.max(0, now - lastProgressAt);
  const modelResponseWaitMs = getModelResponseWaitMs({
    now,
    modelResponsePendingSince: agent.modelResponsePendingSince,
  });
  const awaitingModelResponse = isAwaitingModelResponse(modelResponseWaitMs);
  const liveness =
    agent.status === 'running'
      ? getSessionLivenessLabel({ idleMs, modelResponseWaitMs })
      : undefined;

  const fingerprint = buildSessionStatusFingerprint(agent);
  const previousFingerprint = sessionStatusFingerprints.get(sessionId);
  const hasNewActivity =
    previousFingerprint == null
      ? Boolean(agent.output || agent.currentActivity || agent.lastToolResultPreview)
      : previousFingerprint !== fingerprint;

  const deadlineAt = typeof agent.deadlineAt === 'number' ? agent.deadlineAt : undefined;
  const remainingDeadlineMs = deadlineAt != null ? Math.max(0, deadlineAt - now) : undefined;

  return {
    now,
    lastProgressAt,
    idleMs,
    modelResponseWaitMs,
    awaitingModelResponse,
    liveness,
    fingerprint,
    hasNewActivity,
    deadlineAt,
    remainingDeadlineMs,
  };
}
