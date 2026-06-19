import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';
import type { AgentControlGraphEvent } from '../../src/engine/graph/agentControlGraph';
import type { ToolCallRecord } from '../../src/engine/loopDetection';
import type { ToolExecutionOutcome } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { addGoalEvidence } from '../../src/engine/goals/graphState';
import type { AgentGoal } from '../../src/engine/goals/types';

export const tools: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file from the workspace',
    inputSchema: { type: 'object', properties: {} },
  },
];

export function tool(params: Pick<ToolDefinition, 'name' | 'contract'>): ToolDefinition {
  return {
    name: params.name,
    description: params.name,
    input_schema: { type: 'object', properties: {} },
    ...(params.contract ? { contract: params.contract } : {}),
  };
}

export function createGoal(overrides: Partial<AgentGoal> & Pick<AgentGoal, 'id'>): AgentGoal {
  return {
    title: overrides.id,
    status: 'active',
    dependencies: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

export function extractGoalEvidenceEvents(params: ReturnType<typeof buildBaseParams>) {
  return params.applyGraphEvents.mock.calls
    .flatMap(([events]) => events)
    .filter((event) => event.type === 'GOAL_EVIDENCE_ADDED');
}

export function applyGoalGraphEvents(
  graph: { goals: AgentGoal[] },
  events: ReadonlyArray<AgentControlGraphEvent>,
): { goals: AgentGoal[] } {
  let next = graph;
  for (const event of events) {
    if (event.type === 'GOALS_UPDATED') {
      next = { goals: event.goals };
      continue;
    }
    if (event.type === 'GOAL_EVIDENCE_ADDED') {
      next = {
        goals: addGoalEvidence(next.goals, event.goalId, event.evidence, event.timestamp),
      };
    }
  }
  return next;
}

export function createToolMessage(params: {
  id: string;
  name: string;
  arguments?: string;
  content: string;
  isError?: boolean;
  toolCallOverrides?: Partial<NonNullable<Message['toolCalls']>[number]>;
}): Message {
  return {
    id: `msg_${params.id}`,
    role: 'tool',
    content: params.content,
    toolCallId: params.id,
    toolCalls: [
      {
        id: params.id,
        name: params.name,
        arguments: params.arguments ?? '{}',
        status: params.isError ? 'failed' : 'completed',
        ...(params.isError ? { error: params.content } : {}),
        ...params.toolCallOverrides,
      },
    ],
    timestamp: 1000,
    ...(params.isError ? { isError: true } : {}),
  };
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
    iteration: 2,
    executableToolCalls: [{ name: 'read_file' }],
    toolExecutionOutcomes: [] as ToolExecutionOutcome[],
    groundedRequestScopedTools: tools,
    activation: undefined,
    completedWorkflowToolNames: new Set<string>(),
    trackedAsyncOperations: new Map<string, TrackedAsyncOperation>(),
    toolCallHistory: [] as ToolCallRecord[],
    pendingAsyncMonitorToolNames: new Set<string>(['sessions_wait']),
    lastPendingAsyncSignature: '',
    contextWindow: 20000,
    conversationId: 'conv-test',
    compactionEngine: null,
    livingMemory: null,
    onCompaction: undefined,
    warn: jest.fn(),
    onToolMessage: jest.fn().mockResolvedValue(undefined),
    onStateChange: jest.fn(),
    yieldToUiFrame: jest.fn().mockResolvedValue(undefined),
    applyGraphEvents: jest.fn(),
    publishWorkflowToolResultProgress: jest.fn(({ toolMessage }) => ({
      observedToolName: toolMessage.toolCalls?.[0]?.name,
      newlyCompletedToolNames: ['read_file'],
      nextCompletedToolNames: ['read_file'],
    })),
    syncPendingAsyncOperationsToGraph: jest.fn(),
    recordTurnDirectives: jest.fn(),
    recordPostToolFinalTextDirective: jest.fn(() => false),
    getModelTurnBlocker: jest.fn(() => undefined),
    finishWithGraphTerminalEvent: jest.fn().mockResolvedValue(undefined),
    getGraphSnapshot: jest.fn().mockReturnValue({ goals: [] }),
    workingMessages,
  };
}
