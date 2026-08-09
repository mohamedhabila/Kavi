// Shared fixtures for the tool-turn batch execution suites. Extracted when the goal
// mutation boundary tests pushed the original file past the repository's 700-line
// maintainability limit; duplicating this setup per file would have been the worse answer.
//
// jest.mock stays in each test file — it is hoisted per module and does not carry across
// an import.

import type { Message } from '../../../src/types/message';
import type { ToolDefinition } from '../../../src/types/tool';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../../src/engine/authority/modelTurnMemoryPolicyBinding';

export const tools: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Search the web.',
    input_schema: {
      type: 'object',
      properties: { queries: { type: 'array', items: { type: 'string' } } },
      required: ['queries'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch a page.',
    input_schema: {
      type: 'object',
      properties: { urls: { type: 'array', items: { type: 'string' } } },
      required: ['urls'],
    },
  },
];

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Write a workspace file.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
  },
};

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a workspace file.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

export function createParams(overrides: Record<string, unknown> = {}) {
  return {
    executableToolCalls: [
      {
        id: 'tc-search',
        name: 'web_search',
        arguments: '{"queries":["OpenAI structured outputs developer guide"]}',
      },
    ],
    memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    iteration: 2,
    conversationId: 'conv-1',
    activeProvider: {
      id: 'provider-1',
      name: 'Gemini',
      apiKey: 'test-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      enabled: true,
    } as any,
    allProviders: undefined,
    activeModel: 'gemini-2.5-pro',
    workspaceConversationId: undefined,
    workspaceReadFallbackConversationId: undefined,
    availableToolNames: new Set(['web_search', 'web_fetch']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: false,
    },
    toolCallHistory: [],
    trackedAsyncOperations: new Map(),
    signal: undefined,
    callbacks: {
      onToolCallStart: jest.fn(),
      onToolCallComplete: jest.fn(),
    },
    toolFilter: undefined,
    pendingAsyncMonitorToolNames: new Set<string>(),
    groundedRequestScopedTools: tools,
    completedWorkflowToolNames: new Set<string>(),
    emitPendingAsyncOperationsChange: jest.fn(),
    recordPerformanceMetrics: jest.fn(),
    onBatchCommitted: jest.fn(),
    publishWorkflowToolResultProgress: jest.fn(({ toolMessage }: { toolMessage: Message }) => ({
      observedToolName: toolMessage.toolCalls?.[0]?.name,
      nextCompletedToolNames: [],
    })),
    ...overrides,
  } as any;
}
