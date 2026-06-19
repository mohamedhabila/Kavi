import { createActor } from 'xstate';
import {
  normalizeAgentRunControlGraphTurnDirectives,
} from '../../services/agents/agentControlGraphState';
import { createAgentControlMachine, projectAgentControlGraphSnapshot } from './agentControlMachine';
import {
  buildInitialContext,
  getMissingToolResultIds,
  isTerminalAgentControlGraphStatus,
} from './agentControlGraphInternals';
import type {
  AgentControlGraphEvent,
  AgentControlGraphRuntimeCommand,
  AgentControlGraphSnapshot,
  AgentControlTurnDirectives,
} from './agentControlGraphTypes';

export type {
  AgentControlAuditEvent,
  AgentControlGraphEvent,
  AgentControlGraphRuntimeCommand,
  AgentControlGraphSnapshot,
  AgentControlGraphStatus,
  AgentControlPerformance,
  AgentControlToolCallRef,
  AgentControlToolResultRef,
  AgentControlTurnDirectives,
} from './agentControlGraphTypes';

export function createInitialAgentControlGraphSnapshot(
  params: Partial<AgentControlGraphSnapshot> = {},
): AgentControlGraphSnapshot {
  return buildInitialContext(params);
}

export function reduceAgentControlGraph(
  snapshot: AgentControlGraphSnapshot | undefined,
  events: ReadonlyArray<AgentControlGraphEvent>,
): AgentControlGraphSnapshot {
  const actor = createActor(createAgentControlMachine(snapshot)).start();
  for (const event of events) {
    actor.send(event);
  }
  const nextSnapshot = projectAgentControlGraphSnapshot(actor.getSnapshot() as never);
  actor.stop();
  return nextSnapshot;
}

export function getAgentControlGraphMissingToolResultIds(
  snapshot: Pick<AgentControlGraphSnapshot, 'expectedToolCalls' | 'observedToolResults'>,
): string[] {
  return getMissingToolResultIds(snapshot);
}

export function getAgentControlGraphModelTurnBlocker(
  snapshot: AgentControlGraphSnapshot | undefined,
): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  if (snapshot.status === 'blocked') {
    return `Agent control graph is blocked: ${snapshot.terminalReason || 'unknown blocker'}.`;
  }
  if (
    snapshot.status === 'finalized' ||
    snapshot.status === 'yielded' ||
    snapshot.status === 'cancelled' ||
    snapshot.status === 'failed'
  ) {
    return `Agent control graph is already terminal (${snapshot.status}).`;
  }
  if (snapshot.status === 'model_turn') {
    return 'Agent control graph is already inside a model turn.';
  }
  if (snapshot.status === 'awaiting_review') {
    return 'Agent control graph is waiting for final review of the current candidate.';
  }

  const missingToolResultIds = getMissingToolResultIds(snapshot);
  if (snapshot.status === 'awaiting_tool_results' || missingToolResultIds.length > 0) {
    return `Agent control graph is waiting for tool result(s): ${missingToolResultIds.join(', ')}.`;
  }

  return undefined;
}

export function getAgentControlGraphTurnDirectives(
  snapshot: AgentControlGraphSnapshot | undefined,
): AgentControlTurnDirectives {
  return normalizeAgentRunControlGraphTurnDirectives(snapshot?.turnDirectives);
}

export function getAgentControlGraphFinalizationBlocker(
  snapshot: AgentControlGraphSnapshot | undefined,
): string | undefined {
  return getAgentControlGraphModelTurnBlocker(snapshot);
}

export function selectAgentControlGraphRuntimeCommand(
  snapshot: AgentControlGraphSnapshot | undefined,
): AgentControlGraphRuntimeCommand {
  const status = snapshot?.status;
  if (status && isTerminalAgentControlGraphStatus(status)) {
    return {
      type: 'terminal',
      status,
      reason: snapshot.terminalReason || status,
    };
  }

  const modelTurnBlocker = getAgentControlGraphModelTurnBlocker(snapshot);
  if (modelTurnBlocker) {
    return {
      type: 'blocked',
      reason: modelTurnBlocker,
    };
  }

  const directives = getAgentControlGraphTurnDirectives(snapshot);
  return {
    type: 'start_model_turn',
    directives,
  };
}
