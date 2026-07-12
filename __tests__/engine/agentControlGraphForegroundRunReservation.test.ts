import { runOrchestrator } from '../../src/engine/orchestrator';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import {
  createConversation,
  createExecutionContext,
  createProvider,
} from '../helpers/foregroundRunExecutionContextHarness';

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/preflight', () => ({
  resolveForegroundRunPreflight: jest.fn(),
}));

const mockedRunOrchestrator = runOrchestrator as jest.MockedFunction<typeof runOrchestrator>;
const mockedResolveForegroundRunPreflight = resolveForegroundRunPreflight as jest.MockedFunction<
  typeof resolveForegroundRunPreflight
>;

describe('foreground run projection reservation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('durably terminalizes and releases the reserved placeholder when preflight rejects', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue({ kind: 'missing_provider' });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
    expect(context.durability.flushChatState).toHaveBeenCalledTimes(3);
    const persistedConversation = context.getCurrentConversation();
    expect(persistedConversation.modelProjectionOwner).toBeUndefined();
    expect(persistedConversation.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'assistant',
        isError: true,
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'interrupted_before_start',
        }),
      }),
    );
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
  });

  it('repairs and releases an owned reservation after its first persistence flush fails', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    context.durability.flushChatState.mockRejectedValueOnce(new Error('first flush failed'));

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(mockedResolveForegroundRunPreflight).not.toHaveBeenCalled();
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
    expect(context.durability.flushChatState).toHaveBeenCalledTimes(3);
    expect(context.getCurrentConversation().modelProjectionOwner).toBeUndefined();
    expect(context.getCurrentConversation().messages.at(-1)?.assistantMetadata).toMatchObject({
      kind: 'final',
      completionStatus: 'incomplete',
      finishReason: 'interrupted_before_start',
    });
  });

  it('retains ownership when terminal placeholder persistence cannot be proven', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue({ kind: 'missing_provider' });
    context.durability.flushChatState
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('terminal flush failed'));

    await expect(
      executeForegroundConversationRun({ context, conversationId: conversation.id }),
    ).rejects.toThrow('terminal flush failed');

    expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
    expect(context.getCurrentConversation().modelProjectionOwner).toEqual(
      context.durability.claimModelProjection.mock.calls[0][0].owner,
    );
  });
});
