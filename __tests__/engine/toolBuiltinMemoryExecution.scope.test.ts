const mockExecuteMemoryRecall = jest.fn();
const mockExecuteMemorySearch = jest.fn();
const mockExecuteMemoryPin = jest.fn();
const mockExecuteMemoryUnpin = jest.fn();
const mockExecuteMemoryInvalidate = jest.fn();

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ disableLongTermMemory: false }),
  },
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => ({
      conversations: [{ id: 'child-thread', personaId: 'coder' }],
    }),
  },
}));

jest.mock('../../src/engine/goals/graphTaskScope', () => ({
  resolveGraphTaskId: () => 'active-task',
}));

jest.mock('../../src/engine/tools/builtin-memory', () => ({
  executeMemoryRecall: (...args: unknown[]) => mockExecuteMemoryRecall(...args),
  executeMemorySearch: (...args: unknown[]) => mockExecuteMemorySearch(...args),
  executeMemoryRemember: jest.fn(),
  executeMemoryPin: (...args: unknown[]) => mockExecuteMemoryPin(...args),
  executeMemoryUnpin: (...args: unknown[]) => mockExecuteMemoryUnpin(...args),
  executeMemoryForget: jest.fn(),
  executeMemoryInvalidate: (...args: unknown[]) => mockExecuteMemoryInvalidate(...args),
  executeMemoryBlockRead: jest.fn(),
  executeMemoryBlockEdit: jest.fn(),
}));

import { executeBuiltinMemoryTool } from '../../src/engine/tools/toolBuiltinMemoryExecution';

const BASE_PARAMS = {
  conversationId: 'child-thread',
  workspaceConversationId: 'workspace-root',
  conversationFileContext: {} as never,
  context: { controlGraphGoals: [], memoryConversationId: 'delegated-memory-scope' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockExecuteMemoryRecall.mockReturnValue('{"ok":true}');
  mockExecuteMemorySearch.mockResolvedValue('{"ok":true}');
});

describe('builtin memory execution scope', () => {
  it.each([
    ['memory_recall', mockExecuteMemoryRecall, { subject: 'project' }],
    ['memory_search', mockExecuteMemorySearch, { query: 'project state' }],
  ] as const)('passes exact code-owned scope to %s', async (name, executor, args) => {
    await executeBuiltinMemoryTool({ ...BASE_PARAMS, name, args });

    expect(executor).toHaveBeenCalledWith(args, {
      memoryConversationId: 'delegated-memory-scope',
      sourceThreadId: 'child-thread',
      personaId: 'coder',
      taskId: 'active-task',
    });
  });

  it.each([
    ['memory_pin', mockExecuteMemoryPin, { factId: 'fact-pin' }],
    ['memory_unpin', mockExecuteMemoryUnpin, { factId: 'fact-unpin' }],
  ] as const)('passes exact code-owned scope to %s mutation', async (name, executor, args) => {
    await executeBuiltinMemoryTool({ ...BASE_PARAMS, name, args });

    expect(executor).toHaveBeenCalledWith(args, {
      memoryConversationId: 'delegated-memory-scope',
      sourceThreadId: 'child-thread',
      personaId: 'coder',
      taskId: 'active-task',
    });
  });

  it('passes exact code-owned scope to memory_manage invalidation', async () => {
    await executeBuiltinMemoryTool({
      ...BASE_PARAMS,
      name: 'memory_manage',
      args: { action: 'invalidate', factId: 'fact-invalidate' },
    });

    expect(mockExecuteMemoryInvalidate).toHaveBeenCalledWith(
      { factId: 'fact-invalidate' },
      {
        memoryConversationId: 'delegated-memory-scope',
        sourceThreadId: 'child-thread',
        personaId: 'coder',
        taskId: 'active-task',
      },
    );
  });

  it('defaults memory to the executing conversation instead of the file workspace', async () => {
    await executeBuiltinMemoryTool({
      ...BASE_PARAMS,
      context: { controlGraphGoals: [] },
      name: 'memory_search',
      args: { query: 'private parent context' },
    });

    expect(mockExecuteMemorySearch).toHaveBeenCalledWith(
      { query: 'private parent context' },
      {
        memoryConversationId: 'child-thread',
        sourceThreadId: 'child-thread',
        personaId: 'coder',
        taskId: 'active-task',
      },
    );
  });
});
