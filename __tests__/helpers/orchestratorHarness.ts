// ---------------------------------------------------------------------------
// Tests — Orchestrator
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  OrchestratorCallbacks,
  OrchestratorOptions,
  MAX_TOOL_ITERATIONS,
  MAX_IDENTICAL_TOOL_CALLS,
} from '../../src/engine/orchestrator';
import { finalizeProviderConfig } from '../../src/constants/api';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import {
  collectScopedToolResults,
  selectWorkflowScopedMessagesForRun,
} from '../../src/engine/graph/workflowMessages';
import { AssistantMessageMetadata, Message } from '../../src/types/message';
import { LlmProviderConfig } from '../../src/types/provider';
import { makeOrchestratorProviderConfig } from '../fixtures/providers';

// Mock the LlmService
jest.mock('../../src/services/llm/LlmService', () => {
  return {
    LlmService: jest.fn().mockImplementation(() => ({
      streamMessage: jest.fn(),
    })),
  };
});

jest.mock('../../src/engine/tools/index', () => ({
  executeTool: jest.fn().mockResolvedValue('tool result'),
  loadMemory: jest.fn().mockResolvedValue(null),
  normalizeToolName: jest.fn((name: string) => name.trim()),
}));

// Mock new dependencies added by the orchestrator rewrite
jest.mock('../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
  emitAgentEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/usage/tracker', () => ({
  recordUsage: jest.fn(),
  normalizeUsage: jest.fn().mockReturnValue({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  }),
}));
jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: {
    getAllToolDefinitions: jest.fn().mockReturnValue([]),
    getAllStatuses: jest.fn().mockReturnValue([]),
    getClients: jest.fn().mockReturnValue(new Map()),
  },
}));
jest.mock('../../src/services/skills/manager', () => ({
  getAllLoadedSkills: jest.fn().mockReturnValue([]),
  getSkillToolDefinitions: jest.fn().mockReturnValue([]),
  getSkillSystemPrompts: jest.fn().mockResolvedValue(''),
  filterToolsByInvocationPolicy: jest.fn().mockImplementation((tools: any[]) => tools),
}));
jest.mock('../../src/services/memory/store', () => ({
  getConversationMemoryForSystemPrompt: jest.fn().mockReturnValue(null),
  getMemoryForSystemPrompt: jest.fn().mockReturnValue(null),
  appendGlobalMemory: jest.fn(),
}));
jest.mock('../../src/services/memory/livingMemoryBridge', () => ({
  buildLivingMemorySections: jest.fn().mockResolvedValue({
    sections: [],
    cacheableSignature: '00000000',
    focusBlockText: '',
    openThreadLabels: [],
    recalledFactCount: 0,
  }),
}));
jest.mock('../../src/services/memory/policy', () => ({
  canReadLongTermMemory: jest.fn().mockReturnValue(true),
}));
jest.mock('../../src/services/commands/parser', () => ({
  isSlashCommand: jest.fn().mockReturnValue(false),
  parseCommand: jest.fn().mockReturnValue(null),
}));
jest.mock('../../src/services/commands/builtins', () => ({
  getCommand: jest.fn().mockReturnValue(null),
}));
jest.mock('../../src/services/agents/personas', () => ({
  SUPER_AGENT_PERSONA_ID: 'super-agent',
  resolvePersonaSystemPrompt: jest.fn((_p: any, prompt: string) => prompt),
  resolvePersonaModel: jest.fn((_p: any, providerId: string, model: string) => ({
    providerId,
    model,
  })),
}));
jest.mock('../../src/services/agents/registry', () => ({
  getPersona: jest.fn().mockReturnValue(undefined),
}));
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('sk-test'),
}));

import { LlmService } from '../../src/services/llm/LlmService';
import { executeTool } from '../../src/engine/tools/index';
import { getSkillSystemPrompts, getSkillToolDefinitions } from '../../src/services/skills/manager';
import { getConversationMemoryForSystemPrompt } from '../../src/services/memory/store';
import { buildLivingMemorySections } from '../../src/services/memory/livingMemoryBridge';
import { getProviderApiKey } from '../../src/services/storage/SecureStorage';
import { getPersona } from '../../src/services/agents/registry';
import * as memoryAccessGateway from '../../src/services/memory/memoryAccessGateway';

const legacyFileSystem = jest.requireMock('expo-file-system/legacy') as {
  readAsStringAsync: jest.Mock;
};

const mockStreamMessage = jest.fn();
const mockSendMessage = jest.fn();
(LlmService as any).mockImplementation(() => ({
  streamMessage: mockStreamMessage,
  sendMessage: mockSendMessage,
}));

const makeProvider = (overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig =>
  finalizeProviderConfig(makeOrchestratorProviderConfig(overrides));

const allowTools =
  (toolNames: ReadonlyArray<string>) =>
  (toolName: string): boolean =>
    toolNames.includes(toolName);

const makeCallbacks = (): OrchestratorCallbacks & {
  calls: Record<string, any[]>;
  getVisibleTokenText: () => string;
} => {
  const calls: Record<string, any[]> = {
    onStateChange: [],
    onToken: [],
    onReasoning: [],
    onAssistantStreamReset: [],
    onToolCallStart: [],
    onToolCallComplete: [],
    onAssistantMessage: [],
    onToolMessage: [],
    onError: [],
    onUsage: [],
    onAgentControlGraphStateChange: [],
    sequence: [],
    onDone: [],
  };
  let visibleTokenText = '';

  return {
    calls,
    getVisibleTokenText: () => visibleTokenText,
    onStateChange: jest.fn((state) => {
      calls.onStateChange.push(state);
      calls.sequence.push({ type: 'state', state });
    }),
    onToken: jest.fn((token) => {
      calls.onToken.push(token);
      visibleTokenText += token;
    }),
    onReasoning: jest.fn((token) => calls.onReasoning.push(token)),
    onAssistantStreamReset: jest.fn(() => {
      calls.onAssistantStreamReset.push(true);
      visibleTokenText = '';
    }),
    onToolCallStart: jest.fn((tc) => calls.onToolCallStart.push(tc)),
    onToolCallComplete: jest.fn((tc) => calls.onToolCallComplete.push(tc)),
    onAssistantMessage: jest.fn((content, tcs, providerReplay, assistantMetadata) => {
      calls.onAssistantMessage.push({ content, toolCalls: tcs, providerReplay, assistantMetadata });
      calls.sequence.push({
        type: 'assistant',
        finishReason: assistantMetadata?.finishReason,
        terminalReason: assistantMetadata?.terminalReason,
        kind: assistantMetadata?.kind,
      });
    }),
    onToolMessage: jest.fn((id, result) => calls.onToolMessage.push({ id, result })),
    onError: jest.fn((err) => {
      calls.onError.push(err);
      calls.sequence.push({ type: 'error', message: err?.message });
    }),
    onUsage: jest.fn((usage) => calls.onUsage.push(usage)),
    onAgentControlGraphStateChange: jest.fn((state) => {
      calls.onAgentControlGraphStateChange.push(state);
      calls.sequence.push({
        type: 'graph',
        status: state.status,
        terminalReason: state.terminalReason,
      });
    }),
    onDone: jest.fn(() => {
      calls.onDone.push(true);
      calls.sequence.push({ type: 'done' });
    }),
  };
};

function expectTerminalGraphBeforeDone(
  callbacks: ReturnType<typeof makeCallbacks>,
  status: 'blocked' | 'finalized' | 'yielded' | 'cancelled' | 'failed',
  finishReason?: string,
) {
  const graphIndex = callbacks.calls.sequence.findIndex(
    (entry) => entry.type === 'graph' && entry.status === status,
  );
  const assistantIndex = callbacks.calls.sequence.findIndex(
    (entry) =>
      entry.type === 'assistant' &&
      entry.kind === 'final' &&
      (finishReason === undefined || entry.finishReason === finishReason),
  );
  const doneIndex = callbacks.calls.sequence.findIndex((entry) => entry.type === 'done');

  expect(graphIndex).toBeGreaterThanOrEqual(0);
  expect(assistantIndex).toBeGreaterThan(graphIndex);
  expect(doneIndex).toBeGreaterThan(assistantIndex);
}

function expectFinalCandidateGraphBeforeDone(
  callbacks: ReturnType<typeof makeCallbacks>,
  finishReason?: string,
) {
  const graphIndex = callbacks.calls.sequence.findIndex(
    (entry) => entry.type === 'graph' && entry.status === 'awaiting_review',
  );
  const assistantIndex = callbacks.calls.sequence.findIndex(
    (entry) =>
      entry.type === 'assistant' &&
      entry.kind === 'final' &&
      (finishReason === undefined || entry.finishReason === finishReason),
  );
  const doneIndex = callbacks.calls.sequence.findIndex((entry) => entry.type === 'done');

  expect(graphIndex).toBeGreaterThanOrEqual(0);
  expect(assistantIndex).toBeGreaterThan(graphIndex);
  expect(doneIndex).toBeGreaterThan(assistantIndex);
}

function expectTerminalGraphBeforeSequenceEntry(
  callbacks: ReturnType<typeof makeCallbacks>,
  status: 'blocked' | 'finalized' | 'yielded' | 'cancelled' | 'failed',
  entryType: 'state' | 'error' | 'done',
) {
  const graphIndex = callbacks.calls.sequence.findIndex(
    (entry) => entry.type === 'graph' && entry.status === status,
  );
  const entryIndex = callbacks.calls.sequence.findIndex(
    (entry, index) => index > graphIndex && entry.type === entryType,
  );
  const doneIndex = callbacks.calls.sequence.findIndex(
    (entry, index) => index > graphIndex && entry.type === 'done',
  );

  expect(graphIndex).toBeGreaterThanOrEqual(0);
  expect(entryIndex).toBeGreaterThan(graphIndex);
  expect(doneIndex).toBeGreaterThanOrEqual(entryIndex);
}

async function* createStreamGenerator(events: any[]) {
  for (const event of events) {
    yield event;
  }
}

function expectAssistantMetadata(
  value: AssistantMessageMetadata | undefined,
  partial: Partial<AssistantMessageMetadata>,
) {
  expect(value).toEqual(expect.objectContaining(partial));
}

beforeEach(() => {
  jest.clearAllMocks();
  const parserModule = jest.requireMock('../../src/services/commands/parser') as {
    isSlashCommand: jest.Mock;
    parseCommand: jest.Mock;
  };
  const builtinsModule = jest.requireMock('../../src/services/commands/builtins') as {
    getCommand: jest.Mock;
  };
  parserModule.isSlashCommand.mockReset();
  parserModule.isSlashCommand.mockReturnValue(false);
  parserModule.parseCommand.mockReset();
  parserModule.parseCommand.mockReturnValue(null);
  builtinsModule.getCommand.mockReset();
  builtinsModule.getCommand.mockReturnValue(null);
  legacyFileSystem.readAsStringAsync.mockReset();
  mockStreamMessage.mockReset();
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue({
    output_parsed: {
      executionUnits: [],
    },
  });
  (LlmService as any).mockImplementation(() => ({
    streamMessage: mockStreamMessage,
    sendMessage: mockSendMessage,
  }));
  (getConversationMemoryForSystemPrompt as jest.Mock).mockReset();
  (getConversationMemoryForSystemPrompt as jest.Mock).mockResolvedValue(null);
  (buildLivingMemorySections as jest.Mock).mockReset();
  (buildLivingMemorySections as jest.Mock).mockResolvedValue({
    sections: [],
    cacheableSignature: '00000000',
    focusBlockText: '',
    openThreadLabels: [],
    recalledFactCount: 0,
  });
  (getSkillSystemPrompts as jest.Mock).mockReset();
  (getSkillSystemPrompts as jest.Mock).mockResolvedValue('');
  (getSkillToolDefinitions as jest.Mock).mockReset();
  (getSkillToolDefinitions as jest.Mock).mockReturnValue([]);
  (executeTool as jest.Mock).mockReset();
  (executeTool as jest.Mock).mockResolvedValue('tool result');
  (getProviderApiKey as jest.Mock).mockReset();
  (getProviderApiKey as jest.Mock).mockResolvedValue('sk-test');
  (getPersona as jest.Mock).mockReset();
  (getPersona as jest.Mock).mockReturnValue(undefined);
});

export {
  runOrchestrator,
  MAX_TOOL_ITERATIONS,
  MAX_IDENTICAL_TOOL_CALLS,
  finalizeProviderConfig,
  createInitialAgentControlGraphSnapshot,
  collectScopedToolResults,
  selectWorkflowScopedMessagesForRun,
  LlmService,
  executeTool,
  getSkillSystemPrompts,
  getSkillToolDefinitions,
  getConversationMemoryForSystemPrompt,
  buildLivingMemorySections,
  getProviderApiKey,
  getPersona,
  memoryAccessGateway,
  legacyFileSystem,
  mockStreamMessage,
  mockSendMessage,
  makeProvider,
  allowTools,
  makeCallbacks,
  expectTerminalGraphBeforeDone,
  expectFinalCandidateGraphBeforeDone,
  expectTerminalGraphBeforeSequenceEntry,
  createStreamGenerator,
  expectAssistantMetadata,
};

export type {
  OrchestratorCallbacks,
  OrchestratorOptions,
  AssistantMessageMetadata,
  Message,
  LlmProviderConfig,
};
