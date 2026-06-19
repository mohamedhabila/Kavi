import type { Attachment } from '../../types/attachment';
import { getSubAgent, startSubAgent } from '../../services/agents/subAgent';
import { selectRecentSubAgentEvidenceActivity } from '../../services/agents/subAgentEvidence';

function serializeSessionArtifacts(
  artifacts?: Attachment[],
):
  | Array<Pick<Attachment, 'id' | 'type' | 'name' | 'mimeType' | 'size' | 'workspacePath'>>
  | undefined {
  if (!artifacts?.length) {
    return undefined;
  }

  return artifacts.map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    name: artifact.name,
    mimeType: artifact.mimeType,
    size: artifact.size,
    workspacePath: artifact.workspacePath,
  }));
}

type StartedSubAgent = Awaited<ReturnType<typeof startSubAgent>>;
type StartedSubAgentResult = Awaited<StartedSubAgent['resultPromise']>;
type SessionSnapshot = NonNullable<ReturnType<typeof getSubAgent>>;

export const TERMINAL_SESSION_OUTPUT_GUIDANCE =
  'This session is complete. Use sessions_output to recall its final output later, or sessions_history if you need the transcript.';
const TERMINAL_SESSION_WAIT_RESULT_GUIDANCE =
  'This result already includes the final worker output. Continue from it or finalize now.';
export const COMPLETED_SESSIONS_WAIT_GUIDANCE =
  'Completed session entries already include the final worker outputs. Continue from them or finalize now.';

const INLINE_BLOCKING_SESSION_OUTPUT_PREVIEW_CHARS = 600;
const RUNNING_SESSION_OUTPUT_PREVIEW_CHARS = 320;

function serializeBlockingSessionOutput(output: string | undefined): Record<string, unknown> {
  const normalizedOutput = typeof output === 'string' ? output : '';
  if (!normalizedOutput) {
    return { hasOutput: false };
  }

  return {
    hasOutput: true,
    output: normalizedOutput,
    outputChars: normalizedOutput.length,
    ...(normalizedOutput.length > INLINE_BLOCKING_SESSION_OUTPUT_PREVIEW_CHARS
      ? {
          outputPreview: normalizedOutput.slice(0, INLINE_BLOCKING_SESSION_OUTPUT_PREVIEW_CHARS),
        }
      : {}),
  };
}

export function serializeTerminalSessionResult(
  result: StartedSubAgentResult,
  options?: { includeGuidance?: boolean },
): Record<string, unknown> {
  const outputPayload = serializeBlockingSessionOutput(result.output);
  const includeGuidance = options?.includeGuidance !== false;
  const terminalSnapshot = getSubAgent(result.sessionId);
  const recentActivity = selectRecentSubAgentEvidenceActivity(terminalSnapshot);

  return {
    sessionId: result.sessionId,
    status: result.status,
    ...outputPayload,
    ...(includeGuidance && outputPayload.hasOutput === true
      ? { guidance: TERMINAL_SESSION_WAIT_RESULT_GUIDANCE }
      : {}),
    toolsUsed: result.toolsUsed,
    iterations: result.iterations,
    error: result.error,
    depth: result.depth,
    ...(terminalSnapshot?.workstreamId ? { workstreamId: terminalSnapshot.workstreamId } : {}),
    ...(terminalSnapshot?.lastToolResultPreview
      ? { lastToolResultPreview: terminalSnapshot.lastToolResultPreview }
      : {}),
    ...(recentActivity.length > 0 ? { recentActivity } : {}),
    artifactCount: result.artifacts?.length || 0,
    artifacts: serializeSessionArtifacts(result.artifacts),
  };
}

export function serializeRunningSessionWaitEntry(agent: SessionSnapshot): Record<string, unknown> {
  const now = Date.now();
  const lastProgressAt = agent.lastProgressAt || agent.updatedAt || agent.startedAt;
  const idleMs = Math.max(0, now - lastProgressAt);
  const modelResponseWaitMs =
    typeof agent.modelResponsePendingSince === 'number'
      ? Math.max(0, now - agent.modelResponsePendingSince)
      : undefined;

  return {
    sessionId: agent.sessionId,
    status: agent.status,
    ...(agent.workstreamId ? { workstreamId: agent.workstreamId } : {}),
    depth: agent.depth,
    elapsedMs: now - agent.startedAt,
    launchState: agent.launchState,
    idleMs,
    lastProgressAt,
    awaitingModelResponse: typeof modelResponseWaitMs === 'number',
    modelResponsePendingSince: agent.modelResponsePendingSince,
    modelResponseWaitMs,
    liveness:
      typeof modelResponseWaitMs === 'number'
        ? modelResponseWaitMs >= 120_000
          ? 'stalled'
          : modelResponseWaitMs >= 30_000
            ? 'quiet'
            : 'active'
        : idleMs >= 45_000
          ? 'stalled'
          : idleMs >= 10_000
            ? 'quiet'
            : 'active',
    currentActivity: agent.currentActivity,
    activeToolName: agent.activeToolName,
    outputPreview: agent.output?.slice(0, RUNNING_SESSION_OUTPUT_PREVIEW_CHARS),
    lastToolResultPreview: agent.lastToolResultPreview,
    artifactCount: agent.artifacts?.length || 0,
    artifacts: serializeSessionArtifacts(agent.artifacts),
    toolsUsed: agent.toolsUsed,
    iterations: agent.iterations,
  };
}
