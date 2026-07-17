import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
  type AgentControlTurnDirectives,
} from '../../../src/engine/graph/agentControlGraph';
import type { TrackedAsyncOperation } from '../../../src/engine/pendingAsyncOperations';
import type { AgentGoal } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';
import type { ToolDefinition } from '../../../src/types/tool';

export const baseTurnDirectives: AgentControlTurnDirectives = {
  forceFinalText: false,
  requireWorkflowTool: false,
  incompleteFinalTextRecoveryCount: 0,
};

const tools: ToolDefinition[] = [
  {
    name: 'write_file',
    description: 'Create or update files in the active workspace.',
    input_schema: { type: 'object', properties: {} },
  },
];

export function createControlGraphWithGoals(goals: AgentGoal[]) {
  return reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
    { type: 'GOALS_UPDATED', goals, timestamp: Date.now() },
  ]);
}

export function createPendingOperation(
  overrides: Partial<TrackedAsyncOperation> = {},
): TrackedAsyncOperation {
  return {
    key: 'session:worker-1',
    kind: 'session',
    resourceId: 'worker-1',
    displayName: 'Worker 1',
    status: 'running',
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 1000,
    monitorToolNames: ['sessions_wait'],
    waitToolName: 'sessions_wait',
    waitArgs: { sessionId: 'worker-1' },
    ...overrides,
  };
}

export function buildBaseParams() {
  const workingMessages: Message[] = [];
  return {
    iteration: 3,
    trackedAsyncOperations: new Map<string, TrackedAsyncOperation>(),
    consecutivePendingAsyncNoToolTurns: 0,
    turnAssistantContent: 'final answer',
    modelTurnAssistantContent: 'final answer',
    reasoning: '',
    providerReplay: undefined,
    completion: {
      completionStatus: 'complete' as const,
      finishReason: 'stop',
    },
    controlGraph: createInitialAgentControlGraphSnapshot(),
    toolingEnabledForProvider: true,
    selectedToolCount: tools.length,
    selectedToolNames: new Set(tools.map((tool) => tool.name)),
    effectiveForceTextThisTurn: false,
    recoveryDirectives: baseTurnDirectives,
    nextFinalizationMaxTokens: 4096,
    workingMessages,
    commitModelTurn: jest.fn(),
    applyGraphEvents: jest.fn(),
    resetIncompleteFinalTextRecovery: jest.fn(),
    recordTurnDirectives: jest.fn(),
    finishWithGraphFinalCandidateEvent: jest.fn().mockResolvedValue(undefined),
    finishWithGraphTerminalEvent: jest.fn().mockResolvedValue(undefined),
    onContinueThinking: jest.fn().mockResolvedValue(undefined),
    onFinalizationHeld: jest.fn(),
  };
}
