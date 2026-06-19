// ---------------------------------------------------------------------------
// Kavi — Goal capability discovery fixtures (structural)
// ---------------------------------------------------------------------------

import type { AgentGoal } from '../../types/agentRun';
import type { ToolDefinition } from '../../types/tool';

export interface GoalCapabilityDiscoveryFixture {
  id: string;
  goals: ReadonlyArray<AgentGoal>;
  catalog: ReadonlyArray<ToolDefinition>;
  expectedToolNames: ReadonlyArray<string>;
}

const FIXTURE_CATALOG: ReadonlyArray<ToolDefinition> = [
  {
    name: 'read_file',
    description: 'Read workspace file.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'workspace_files',
      capabilities: ['read', 'verify'],
      resourceKinds: ['conversation_workspace'],
    },
  },
  {
    name: 'write_file',
    description: 'Write workspace file.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'workspace_files',
      capabilities: ['write', 'verify'],
      resourceKinds: ['conversation_workspace'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'web',
      capabilities: ['discover'],
      resourceKinds: ['unknown'],
    },
  },
  {
    name: 'tool_catalog',
    description: 'Browse tools.',
    input_schema: { type: 'object', properties: {} },
    contract: {
      category: 'tools',
      capabilities: ['discover'],
      resourceKinds: ['unknown'],
    },
  },
];

export const GOAL_CAPABILITY_DISCOVERY_FIXTURES: ReadonlyArray<GoalCapabilityDiscoveryFixture> = [
  {
    id: 'workspace-write-goal',
    goals: [
      {
        id: 'artifact-goal',
        title: 'persist-artifact',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
        requiredCapabilities: ['write'],
        successCriteria: ['evidence.min:1'],
      },
    ],
    catalog: FIXTURE_CATALOG,
    expectedToolNames: ['write_file'],
  },
  {
    id: 'multi-capability-research',
    goals: [
      {
        id: 'research-goal',
        title: 'research-topic',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
        requiredCapabilities: ['discover', 'read'],
        successCriteria: ['evidence.min:1'],
      },
    ],
    catalog: FIXTURE_CATALOG,
    expectedToolNames: ['read_file', 'web_search'],
  },
];
