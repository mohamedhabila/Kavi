import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../../src/engine/graph/agentControlGraph';
import type {
  AgentControlGraphEvent,
  AgentControlGraphSnapshot,
} from '../../../src/engine/graph/agentControlGraphTypes';

export function buildGraphScenarioSnapshot(
  seed: Partial<AgentControlGraphSnapshot> = {},
): AgentControlGraphSnapshot {
  return createInitialAgentControlGraphSnapshot(seed);
}

export function applyGraphScenarioEvents(
  snapshot: AgentControlGraphSnapshot,
  events: ReadonlyArray<AgentControlGraphEvent>,
): AgentControlGraphSnapshot {
  return reduceAgentControlGraph(snapshot, events);
}
