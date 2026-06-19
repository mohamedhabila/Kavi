// ---------------------------------------------------------------------------
// Tests — Enhanced Sub-Agent Spawn (systemPrompt, name, tools)
// ---------------------------------------------------------------------------

let mockAsyncStorageData: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncStorageData[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncStorageData[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockAsyncStorageData[key];
  }),
}));

let capturedOrchestratorOptions: any = null;
jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(async (options: any, callbacks: any) => {
    capturedOrchestratorOptions = options;
    callbacks.onDone();
  }),
}));

let mockIdCounter = 0;
jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => `mock-id-${++mockIdCounter}`),
}));

import {
  spawnSubAgent,
  getSubAgent,
} from '../../src/services/agents/subAgent';

const mockProvider = {
  id: 'test',
  name: 'Test',
  provider: 'openai' as const,
  apiKey: 'test-key',
  model: 'gpt-4',
  enabled: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAsyncStorageData = {};
  capturedOrchestratorOptions = null;
  mockIdCounter = 0;
});

describe('spawnSubAgent with custom systemPrompt', () => {
  it('passes custom systemPrompt to orchestrator', async () => {
    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Implement the API endpoint',
        systemPrompt: 'You are a Backend Architect specializing in REST APIs.',
      },
      mockProvider,
    );

    expect(result.status).toBe('completed');
    expect(capturedOrchestratorOptions).not.toBeNull();
    expect(capturedOrchestratorOptions.systemPrompt).toContain(
      'You are a Backend Architect specializing in REST APIs.',
    );
    expect(capturedOrchestratorOptions.systemPrompt).toContain('## Worker Contract');
    expect(capturedOrchestratorOptions.systemPrompt).toContain('capability-extension tool');
    expect(capturedOrchestratorOptions.enableCompaction).toBe(true);
  });

  it('falls back to default sub-agent prompt when no systemPrompt provided', async () => {
    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Do something',
        inheritMemory: true,
      },
      mockProvider,
    );

    expect(capturedOrchestratorOptions.systemPrompt).toContain('sub-agent');
    expect(capturedOrchestratorOptions.systemPrompt).toContain('depth');
  });

  it('uses non-memory fallback when inheritMemory is false and no systemPrompt', async () => {
    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Do something',
        inheritMemory: false,
      },
      mockProvider,
    );

    expect(capturedOrchestratorOptions.systemPrompt).toContain('Complete the task');
  });
});

describe('spawnSubAgent with name', () => {
  it('stores name in the active sub-agent record', async () => {
    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Review code',
        name: 'QA Reviewer',
      },
      mockProvider,
    );

    const agent = getSubAgent(result.sessionId);
    expect(agent).toBeDefined();
    expect(agent?.name).toBe('QA Reviewer');
  });

  it('name is undefined when not provided', async () => {
    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Do work',
      },
      mockProvider,
    );

    const agent = getSubAgent(result.sessionId);
    expect(agent?.name).toBeUndefined();
  });
});

describe('spawnSubAgent with tools whitelist', () => {
  it('creates a toolFilter that allows only whitelisted tools', async () => {
    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Research task',
        tools: ['web_search', 'read_file', 'web_fetch'],
      },
      mockProvider,
    );

    expect(capturedOrchestratorOptions.toolFilter).toBeDefined();
    const filter = capturedOrchestratorOptions.toolFilter!;
    expect(filter('web_search')).toBe(true);
    expect(filter('read_file')).toBe(true);
    expect(filter('web_fetch')).toBe(true);
    expect(filter('ssh_exec')).toBe(false);
    expect(filter('canvas_create')).toBe(false);
  });

  it('treats an explicit empty tools array as a no-tools whitelist', async () => {
    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Do work',
        tools: [],
      },
      mockProvider,
    );

    expect(capturedOrchestratorOptions.toolFilter).toBeDefined();
    const filter = capturedOrchestratorOptions.toolFilter!;
    expect(filter('web_search')).toBe(false);
    expect(filter('read_file')).toBe(false);
    expect(filter('record_workflow_evidence')).toBe(false);
  });

  it('has no toolFilter when tools is not provided', async () => {
    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Do work',
      },
      mockProvider,
    );

    expect(capturedOrchestratorOptions.toolFilter).toBeUndefined();
  });

  it('combines tools whitelist with safe-only sandbox', async () => {
    await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Research only',
        tools: ['web_search', 'read_file', 'ssh_exec'],
        sandboxPolicy: 'safe-only',
      },
      mockProvider,
    );

    const filter = capturedOrchestratorOptions.toolFilter!;
    expect(filter).toBeDefined();
    // web_search is in both whitelist and safe-only set
    expect(filter('web_search')).toBe(true);
    // read_file is in both
    expect(filter('read_file')).toBe(true);
    // ssh_exec is in whitelist but NOT in safe-only set
    expect(filter('ssh_exec')).toBe(false);
    // canvas_create is NOT in whitelist
    expect(filter('canvas_create')).toBe(false);
  });
});
