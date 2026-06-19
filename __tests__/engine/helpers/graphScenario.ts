import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../../src/engine/graph/agentControlGraph';
import { assertLeanGraphSnapshot } from '../../../src/engine/graph/graphContract';
import type { AgentControlGraphEvent, AgentControlGraphSnapshot } from '../../../src/engine/graph/agentControlGraphTypes';
import type { AgentGoal } from '../../../src/engine/goals/types';

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

export function seedGraphGoals(goals: ReadonlyArray<AgentGoal>): Partial<AgentControlGraphSnapshot> {
  return { goals: goals.map((goal) => ({ ...goal })) };
}