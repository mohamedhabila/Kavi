import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../../src/engine/graph/agentControlGraph';
import { assertLeanGraphSnapshot } from '../../../src/engine/graph/graphContract';
import type {
  AgentControlGraphEvent,
  AgentControlGraphSnapshot,
} from '../../../src/engine/graph/agentControlGraphTypes';

export function buildGraphScenarioSnapshot(
  seed: Partial<AgentControlGraphSnapshot> = {},
): AgentControlGraphSnapshot {
  return assertLeanGraphSnapshot(createInitialAgentControlGraphSnapshot(seed));
}

export function applyGraphScenarioEvents(
  snapshot: AgentControlGraphSnapshot,
  events: ReadonlyArray<AgentControlGraphEvent>,
): AgentControlGraphSnapshot {
  return assertLeanGraphSnapshot(reduceAgentControlGraph(snapshot, events));
}
