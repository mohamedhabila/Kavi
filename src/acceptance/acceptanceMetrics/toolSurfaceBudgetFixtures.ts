// ---------------------------------------------------------------------------
// Kavi — Tool surface token budget fixtures (structural)
// ---------------------------------------------------------------------------

import type { AgentGoal } from '../../types/agentRun';

export interface ToolSurfaceBudgetFixture {
  id: string;
  goals: ReadonlyArray<AgentGoal>;
  includeToolCatalog?: boolean;
}

export const TOOL_SURFACE_BUDGET_FIXTURES: ReadonlyArray<ToolSurfaceBudgetFixture> = [
  {
    id: 'workspace-goal-grounded',
    goals: [
      {
        id: 'workspace-read',
        title: 'workspace-read',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
        requiredCapabilities: ['discover', 'read'],
        requiredResourceKinds: ['conversation_workspace'],
        successCriteria: ['evidence.kind:verification'],
      },
    ],
  },
  {
    id: 'goal-capability-web',
    goals: [
      {
        id: 'web-research',
        title: 'research-topic',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
        requiredCapabilities: ['discover', 'read', 'verify'],
        requiredResourceKinds: ['unknown'],
        successCriteria: ['evidence.kind:verification'],
      },
    ],
  },
  {
    id: 'bootstrap-turn',
    goals: [],
    includeToolCatalog: true,
  },
];
