const mockExecuteMemoryRecall = jest.fn();
const mockExecuteMemorySearch = jest.fn();
const mockExecuteMemoryRemember = jest.fn();
const mockExecuteMemoryPin = jest.fn();
const mockExecuteMemoryUnpin = jest.fn();
const mockExecuteMemoryInvalidate = jest.fn();
const mockExecuteMemoryForget = jest.fn();

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

jest.mock('../../src/services/memory/memoryScopeStore', () => ({
  resolveLocalMemoryAccessScope: (scope: Record<string, unknown>) => ({
    memoryOwnerId: 'owner-local',
    ...scope,
  }),
}));

jest.mock('../../src/engine/tools/builtin-memory', () => ({
  executeMemoryRecall: (...args: unknown[]) => mockExecuteMemoryRecall(...args),
  executeMemorySearch: (...args: unknown[]) => mockExecuteMemorySearch(...args),
  executeMemoryRemember: (...args: unknown[]) => mockExecuteMemoryRemember(...args),
  executeMemoryPin: (...args: unknown[]) => mockExecuteMemoryPin(...args),
  executeMemoryUnpin: (...args: unknown[]) => mockExecuteMemoryUnpin(...args),
  executeMemoryForget: (...args: unknown[]) => mockExecuteMemoryForget(...args),
  executeMemoryInvalidate: (...args: unknown[]) => mockExecuteMemoryInvalidate(...args),
}));

import { executeBuiltinMemoryTool } from '../../src/engine/tools/toolBuiltinMemoryExecution';
import {
  consumeExplicitMemoryRecallGrant,
  resetExplicitMemoryRecallGrantStateForTests,
} from '../../src/services/memory/explicitMemoryRecallGrant';

const BASE_PARAMS = {
  conversationId: 'child-thread',
  workspaceConversationId: 'workspace-root',
  conversationFileContext: {} as never,
  context: { controlGraphGoals: [], memoryConversationId: 'delegated-memory-scope' },
};

beforeEach(() => {
  jest.clearAllMocks();
  resetExplicitMemoryRecallGrantStateForTests();
  const completedOutcome = { status: 'completed', content: '{"ok":true}' };
  mockExecuteMemoryRecall.mockReturnValue(completedOutcome);
  mockExecuteMemorySearch.mockResolvedValue(completedOutcome);
  mockExecuteMemoryRemember.mockReturnValue(completedOutcome);
  mockExecuteMemoryPin.mockReturnValue(completedOutcome);
  mockExecuteMemoryUnpin.mockReturnValue(completedOutcome);
  mockExecuteMemoryInvalidate.mockReturnValue(completedOutcome);
  mockExecuteMemoryForget.mockReturnValue(completedOutcome);
});

describe('builtin memory execution scope', () => {
  it('routes persisted execution authority only through the code-owned remember context', async () => {
    const executionClaim = Object.freeze({
      executionRunId: 'execution-remember',
      toolCallId: 'tool-call-remember',
      claimedAt: 2_000_000_000_000,
    });
    const providerArgs = {
      semanticEvidence: {
        version: 2,
        subject_ref: { kind: 'self' },
        subject_type: 'self',
        predicate: 'timezone',
        value: 'UTC+1',
        scope: 'global',
        importance: 0.8,
        confidence: 0.95,
        operation: 'record',
        assertion_class: 'current_direct',
        evidence_quote: 'My timezone is UTC+1.',
        sensitivity: 'personal',
      },
    };

    await executeBuiltinMemoryTool({
      ...BASE_PARAMS,
      authorizedEffectExecutionClaim: executionClaim,
      context: {
        ...BASE_PARAMS.context,
        currentUserMessage: {
          id: 'user-message-remember',
          text: 'My timezone is UTC+1.',
        },
        agentRunId: 'agent-run-remember',
      },
      name: 'memory_remember',
      args: providerArgs,
    });

    expect(mockExecuteMemoryRemember).toHaveBeenCalledWith(providerArgs, {
      personaId: 'coder',
      sourceRunId: 'agent-run-remember',
      executionClaim,
      requestEvidence: {
        memoryConversationId: 'delegated-memory-scope',
        sourceThreadId: 'child-thread',
        taskId: 'active-task',
        userMessageId: 'user-message-remember',
        userMessageText: 'My timezone is UTC+1.',
      },
    });
    expect(mockExecuteMemoryRemember.mock.calls[0]?.[0]).not.toHaveProperty('executionClaim');
    expect(providerArgs).not.toHaveProperty('sourceRunId');
  });

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

  it('passes exact code-owned scope to memory_forget', async () => {
    await executeBuiltinMemoryTool({
      ...BASE_PARAMS,
      name: 'memory_forget',
      args: { factId: 'fact-forget' },
    });

    expect(mockExecuteMemoryForget).toHaveBeenCalledWith(
      { factId: 'fact-forget' },
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

  it('creates exact sensitive-recall authority only from code-owned request identity', async () => {
    const explicitRequestEvidence = {
      version: 1,
      source_message_id: 'user-message-sensitive',
      evidence_quote: '请显示我保存的健康资料',
      subject_ref: { kind: 'self' },
      subject_quote: '我',
      predicate: 'medical_status',
      relation_quote: '健康资料',
    };
    const args = { subject: 'user', predicate: 'medical_status', explicitRequestEvidence };
    const currentUserMessage = {
      id: 'user-message-sensitive',
      text: '请显示我保存的健康资料',
    };
    await executeBuiltinMemoryTool({
      ...BASE_PARAMS,
      context: {
        ...BASE_PARAMS.context,
        currentUserMessage,
        executionRunId: 'execution-sensitive',
        toolCallId: 'tool-call-sensitive',
        agentRunId: 'agent-sensitive',
      },
      name: 'memory_recall',
      args,
    });

    const execution = mockExecuteMemoryRecall.mock.calls[0]?.[1];
    expect(execution).toMatchObject({
      requestIdentity: {
        currentUserMessageId: currentUserMessage.id,
        currentUserMessageText: currentUserMessage.text,
        executionRunId: 'execution-sensitive',
        toolCallId: 'tool-call-sensitive',
        agentRunId: 'agent-sensitive',
      },
      explicitUserRequestGrant: { kind: 'explicit_memory_recall_grant' },
    });
    const validation = {
      grant: execution.explicitUserRequestGrant,
      ...execution.requestIdentity,
      scope: {
        memoryOwnerId: 'owner-local',
        memoryConversationId: 'delegated-memory-scope',
        sourceThreadId: 'child-thread',
        personaId: 'coder',
        taskId: 'active-task',
      },
      subject: args.subject,
      predicate: args.predicate,
      all: undefined,
    };
    expect(consumeExplicitMemoryRecallGrant(validation)).toBe(true);
    expect(consumeExplicitMemoryRecallGrant(validation)).toBe(false);
  });

  it('does not create recall authority for a broad user message', async () => {
    await executeBuiltinMemoryTool({
      ...BASE_PARAMS,
      context: {
        ...BASE_PARAMS.context,
        currentUserMessage: {
          id: 'user-message-broad',
          text: 'Tell me everything you remember about me.',
        },
        executionRunId: 'execution-broad',
        toolCallId: 'tool-call-broad',
        agentRunId: 'agent-broad',
      },
      name: 'memory_recall',
      args: { all: true },
    });

    expect(mockExecuteMemoryRecall.mock.calls[0]?.[1]).not.toHaveProperty(
      'explicitUserRequestGrant',
    );
  });
});
