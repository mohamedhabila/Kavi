const mockExecuteMemoryRecall = jest.fn();
const mockExecuteMemorySearch = jest.fn();

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
  executeMemoryPin: jest.fn(),
  executeMemoryUnpin: jest.fn(),
  executeMemoryForget: jest.fn(),
  executeMemoryInvalidate: jest.fn(),
  executeMemoryBlockRead: jest.fn(),
  executeMemoryBlockEdit: jest.fn(),
}));

import { executeBuiltinMemoryTool } from '../../src/engine/tools/toolBuiltinMemoryExecution';

const BASE_PARAMS = {
  conversationId: 'child-thread',
  workspaceConversationId: 'workspace-root',
  conversationFileContext: {} as never,
  context: { controlGraphGoals: [] },
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
      memoryConversationId: 'workspace-root',
      sourceThreadId: 'child-thread',
      personaId: 'coder',
      taskId: 'active-task',
    });
  });
});
