import type { Conversation } from '../../../types/conversation';
import type { SubAgentActivityEntry, SubAgentSnapshot } from '../../../types/subAgent';
import { cloneAttachments } from '../../../utils/messageAttachments';
import {
  decodeSubAgentTerminationCause,
  hydrateSubAgentTerminationCause,
} from '../../../utils/subAgentTermination';
import { normalizeFinalizationOutputText } from '../finalizationText';
import { cloneSubAgentSnapshot, isTerminalSubAgentStatus } from './stateMachine';

export function buildRecoveredTerminalSnapshotMap(
  conversations?: Conversation[],
): Map<string, SubAgentSnapshot> {
  const recoveredSnapshots = new Map<string, SubAgentSnapshot>();

  for (const conversation of conversations ?? []) {
    for (const message of conversation.messages ?? []) {
      const snapshot = message.subAgentEvent?.snapshot;
      if (!snapshot || !isTerminalSubAgentStatus(snapshot.status)) {
        continue;
      }

      const existing = recoveredSnapshots.get(snapshot.sessionId);
      if (!existing || snapshot.updatedAt >= existing.updatedAt) {
        recoveredSnapshots.set(
          snapshot.sessionId,
          hydrateSubAgentTerminationCause(cloneSubAgentSnapshot(snapshot)),
        );
      }
    }
  }

  return recoveredSnapshots;
}

export function applyRecoveredTerminalSnapshot<TAgent extends SubAgentSnapshot>(
  agent: TAgent,
  snapshot: SubAgentSnapshot,
): void {
  agent.parentConversationId = snapshot.parentConversationId;
  agent.parentSessionId = snapshot.parentSessionId;
  agent.agentRunId = snapshot.agentRunId;
  agent.name = snapshot.name;
  agent.depth = snapshot.depth;
  agent.startedAt = snapshot.startedAt;
  agent.updatedAt = Math.max(agent.updatedAt, snapshot.updatedAt);
  agent.deadlineAt = snapshot.deadlineAt;
  agent.status = snapshot.status;
  agent.terminationCause = decodeSubAgentTerminationCause(snapshot.terminationCause);
  agent.sandboxPolicy = snapshot.sandboxPolicy;
  agent.launchState = snapshot.launchState ?? agent.launchState;
  agent.output = snapshot.output ?? agent.output;
  agent.completionState = snapshot.completionState ?? agent.completionState;
  agent.outcomeReconciliation = snapshot.outcomeReconciliation
    ? {
        ...snapshot.outcomeReconciliation,
        ...(snapshot.outcomeReconciliation.factIds
          ? { factIds: [...snapshot.outcomeReconciliation.factIds] }
          : {}),
      }
    : agent.outcomeReconciliation;
  agent.toolsUsed = snapshot.toolsUsed ? [...snapshot.toolsUsed] : agent.toolsUsed;
  agent.artifacts = snapshot.artifacts ? cloneAttachments(snapshot.artifacts) : agent.artifacts;
  agent.iterations = snapshot.iterations ?? agent.iterations;
  agent.lastProgressAt = snapshot.lastProgressAt ?? agent.lastProgressAt;
  agent.modelResponsePendingSince =
    snapshot.modelResponsePendingSince ?? agent.modelResponsePendingSince;
  agent.currentActivity = snapshot.currentActivity;
  agent.activeToolName = snapshot.activeToolName;
  agent.activeToolStartedAt = snapshot.activeToolStartedAt;
  agent.lastToolResultPreview = snapshot.lastToolResultPreview ?? agent.lastToolResultPreview;
  agent.activityLog = snapshot.activityLog
    ? snapshot.activityLog.map((entry) => ({ ...entry }))
    : agent.activityLog;

  // A terminal conversation event is authoritative even if an already-issued tool callback
  // published a newer-looking active-phase field during cancellation. Never resurrect transient
  // execution ownership from that race when rebuilding the worker registry after a restart.
  if (isTerminalSubAgentStatus(agent.status)) {
    agent.launchState = 'terminal';
    agent.deadlineAt = undefined;
    agent.modelResponsePendingSince = undefined;
    agent.activeToolName = undefined;
    agent.activeToolStartedAt = undefined;
    if (agent.status === 'cancelled') {
      agent.currentActivity =
        normalizeFinalizationOutputText(agent.output) || agent.currentActivity;
    }
  }
}

export function interruptRecoveredRunningAgent<TAgent extends SubAgentSnapshot>(
  agent: TAgent,
  now: number,
  appendActivity: (
    agent: TAgent,
    kind: SubAgentActivityEntry['kind'],
    text: string | undefined,
  ) => void,
): void {
  const interruptionMessage = 'Worker was interrupted because the app restarted before completion.';
  const existingOutput = normalizeFinalizationOutputText(agent.output);

  agent.status = 'error';
  agent.terminationCause = 'app_restart';
  agent.launchState = 'terminal';
  agent.output = existingOutput
    ? `${existingOutput}\n\n[${interruptionMessage}]`
    : interruptionMessage;
  agent.modelResponsePendingSince = undefined;
  agent.currentActivity = interruptionMessage;
  agent.activeToolName = undefined;
  agent.activeToolStartedAt = undefined;
  agent.deadlineAt = undefined;
  agent.updatedAt = now;
  appendActivity(agent, 'status', interruptionMessage);
}
