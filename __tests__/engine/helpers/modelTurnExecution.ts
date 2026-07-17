import type { PreparedAgentTurn } from '../../../src/engine/graph/agentTurnPreparation';
import type { Message } from '../../../src/types/message';
import type { ToolDefinition } from '../../../src/types/tool';

export async function* createStream(events: any[]) {
  for (const event of events) {
    yield event;
  }
}

export const toolDefinition: ToolDefinition = {
  name: 'write_file',
  description: 'Write a file to the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
    },
  },
} as ToolDefinition;

export const memoryRememberToolDefinition: ToolDefinition = {
  name: 'memory_remember',
  description: 'Record a durable memory.',
  input_schema: { type: 'object', properties: {} },
  contract: {
    category: 'memory',
    capabilities: ['write'],
    resourceKinds: ['memory'],
    sideEffects: ['local_artifact'],
  },
};

export const coordinateToolDefinition: ToolDefinition = {
  name: 'update_goals',
  description: 'Mutate graph goals.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  contract: {
    category: 'tools',
    capabilities: ['coordinate'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['none'],
    riskHints: ['read_only'],
    providesEvidence: ['verification'],
    workflowStages: [],
  },
} as ToolDefinition;

export function createPreparedTurn(overrides: Partial<PreparedAgentTurn> = {}): PreparedAgentTurn {
  return {
    enrichedSystemPrompt: 'Enriched prompt',
    enrichedSystemPromptSections: [],
    pinnedToolNames: [],
    selectedToolTokenEstimate: 0,
    selectedTools: [toolDefinition],
    toolsForIteration: [toolDefinition],
    ...overrides,
  };
}

export function createWorkingMessages(): Message[] {
  return [
    {
      id: 'msg-1',
      role: 'user',
      content: 'Create a file',
      timestamp: 1,
    },
  ];
}

export function createBudgetResult(
  workingMessages: Message[],
  tool: ToolDefinition = toolDefinition,
) {
  return {
    budgetResult: {
      systemPrompt: 'Enriched prompt',
      messages: workingMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      tools: [tool],
      result: {
        totalTokens: 128,
        adjustments: [],
      },
    },
    contextWindow: 200000,
    workingMessages,
  };
}

export function createCallbacks() {
  return {
    onAssistantStreamReset: jest.fn(),
    onReasoning: jest.fn(),
    onStateChange: jest.fn(),
    onToken: jest.fn(),
    onToolCallQueued: jest.fn(),
  };
}
