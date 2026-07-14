import { act, renderHook } from '@testing-library/react-native';
import { useForegroundConversationActions } from '../../src/engine/graph/foregroundRun/useForegroundConversationActions';
import { getComposerDraftKey } from '../../src/screens/chatComposerDrafts';
import { waitForPersistedAgentRecoveryReadiness } from '../../src/services/startupRecovery';
import { waitForModelProjectionAvailability } from '../../src/store/modelProjectionOwnership';
import {
  hasModelProjectionIntent,
  resetModelProjectionIntentCoordinatorForTests,
} from '../../src/store/modelProjectionIntentCoordinator';
import { useChatStore } from '../../src/store/useChatStore';

jest.mock('../../src/services/startupRecovery', () => ({
  waitForPersistedAgentRecoveryReadiness: jest.fn(),
}));

jest.mock('../../src/store/modelProjectionOwnership', () => ({
  waitForModelProjectionAvailability: jest.fn(),
}));

const mockedWaitForRecovery = waitForPersistedAgentRecoveryReadiness as jest.MockedFunction<
  typeof waitForPersistedAgentRecoveryReadiness
>;
const mockedWaitForProjection = waitForModelProjectionAvailability as jest.MockedFunction<
  typeof waitForModelProjectionAvailability
>;

type ActionsParams = Parameters<typeof useForegroundConversationActions>[0];

function createParams(
  activeConversationId: string,
  overrides: Partial<ActionsParams> = {},
): ActionsParams {
  return {
    activeConversation: useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === activeConversationId),
    activeConversationId,
    addMessage: jest.fn(),
    appendConversationLog: jest.fn(),
    attachmentWorkspaceImportFailedMessage: 'attachment failed',
    abortForegroundRequestForConversation: jest.fn(),
    clearComposerDraft: jest.fn(),
    clearForegroundRequestForConversation: jest.fn(),
    completeAgentRun: jest.fn(),
    defaultConversationMode: 'agentic',
    rewindUserMessageForResend: jest.fn(() => ({
      status: 'rejected',
      reason: 'message_unavailable',
    })),
    editingMessageId: null,
    ensureAgentRunFinalResponse: jest.fn(),
    ensureCanonicalConversation: jest.fn(),
    forceNextScrollRef: { current: false },
    generateId: () => 'message-1',
    isAgenticMode: true,
    pendingAgentRunAsyncResumesRef: { current: new Map() },
    pendingAgentRunFinalizationsRef: { current: new Map() },
    pendingAgentRunTerminalReviewsRef: { current: new Map() },
    requestChatStorePersistenceCheckpoint: jest.fn(),
    runChat: jest.fn().mockResolvedValue(undefined),
    setChatError: jest.fn(),
    setEditingContent: jest.fn(),
    setEditingMessageId: jest.fn(),
    updateAgentRunControlGraph: jest.fn(),
    ...overrides,
  };
}

describe('useForegroundConversationActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetModelProjectionIntentCoordinatorForTests();
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
    mockedWaitForRecovery.mockResolvedValue(undefined);
    mockedWaitForProjection.mockResolvedValue(undefined);
  });

  it('targets the live active side thread when send runs before the screen rerenders', async () => {
    const parentId = useChatStore.getState().createConversation('openai', 'system');
    const sideId = useChatStore.getState().createSideThread(parentId)!;

    const addMessage = jest.fn();
    const clearComposerDraft = jest.fn();
    const runChat = jest.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useForegroundConversationActions(
        createParams(parentId, {
          addMessage,
          clearComposerDraft,
          runChat,
        }),
      ),
    );

    await act(async () => {
      await result.current.handleSend('hello from side thread');
    });

    expect(addMessage).toHaveBeenCalledWith(
      sideId,
      expect.objectContaining({
        content: 'hello from side thread',
        id: 'message-1',
        role: 'user',
      }),
    );
    expect(clearComposerDraft).toHaveBeenCalledWith(getComposerDraftKey(sideId));
    expect(runChat).toHaveBeenCalledWith(sideId);
  });

  it('does not append the user turn until recovery and the current projection owner release', async () => {
    const conversationId = useChatStore.getState().createConversation('openai', 'system');
    let releaseProjection = () => {};
    mockedWaitForProjection.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseProjection = resolve;
        }),
    );
    const addMessage = jest.fn();
    const runChat = jest.fn().mockResolvedValue(undefined);
    const abortForegroundRequestForConversation = jest.fn();
    const { result } = renderHook(() =>
      useForegroundConversationActions(
        createParams(conversationId, {
          abortForegroundRequestForConversation,
          addMessage,
          runChat,
        }),
      ),
    );

    let send!: Promise<void>;
    await act(async () => {
      send = result.current.handleSend('wait for the owner');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(abortForegroundRequestForConversation).toHaveBeenCalledWith(
      conversationId,
      'Superseded by a new user turn.',
    );
    expect(addMessage).not.toHaveBeenCalled();
    expect(runChat).not.toHaveBeenCalled();

    await act(async () => {
      releaseProjection();
      await send;
    });

    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(runChat).toHaveBeenCalledWith(conversationId);
  });

  it('coalesces concurrent writes to one conversation before either can append', async () => {
    const conversationId = useChatStore.getState().createConversation('openai', 'system');
    let releaseProjection = () => {};
    mockedWaitForProjection.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseProjection = resolve;
        }),
    );
    const addMessage = jest.fn();
    const runChat = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useForegroundConversationActions(createParams(conversationId, { addMessage, runChat })),
    );

    let firstSend!: Promise<void>;
    await act(async () => {
      firstSend = result.current.handleSend('send once');
      await Promise.resolve();
      await result.current.handleSend('duplicate tap');
    });
    expect(addMessage).not.toHaveBeenCalled();
    expect(mockedWaitForProjection).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseProjection();
      await firstSend;
    });

    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ content: 'send once' }),
    );
    expect(runChat).toHaveBeenCalledTimes(1);
  });

  it('holds foreground intent across the user mutation and synchronous run handoff', async () => {
    const conversationId = useChatStore.getState().createConversation('openai', 'system');
    const addMessage = jest.fn(() => {
      expect(hasModelProjectionIntent(conversationId)).toBe(true);
    });
    const runChat = jest.fn(() => {
      expect(hasModelProjectionIntent(conversationId)).toBe(true);
      return Promise.resolve();
    });
    const { result } = renderHook(() =>
      useForegroundConversationActions(createParams(conversationId, { addMessage, runChat })),
    );

    await act(async () => {
      await result.current.handleSend('protected handoff');
    });

    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(runChat).toHaveBeenCalledTimes(1);
    expect(hasModelProjectionIntent(conversationId)).toBe(false);
  });

  it('starts an assistant retry from a freshly identified user turn', async () => {
    const conversationId = useChatStore.getState().createConversation('openai', 'system');
    useChatStore.getState().addMessage(conversationId, {
      id: 'original-user',
      role: 'user',
      content: 'Retry this request',
      timestamp: 1,
    });
    useChatStore.getState().addMessage(conversationId, {
      id: 'original-assistant',
      role: 'assistant',
      content: 'Original response',
      timestamp: 2,
    });
    let retriedUserMessageId: string | undefined;
    const runChat = jest.fn(async () => {
      retriedUserMessageId = useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)
        ?.messages.find((message) => message.role === 'user')?.id;
    });
    const { result } = renderHook(() =>
      useForegroundConversationActions(
        createParams(conversationId, {
          rewindUserMessageForResend: useChatStore.getState().rewindUserMessageForResend,
          runChat,
        }),
      ),
    );

    await act(async () => {
      await result.current.handleRetry('original-assistant');
    });

    expect(runChat).toHaveBeenCalledWith(conversationId);
    expect(retriedUserMessageId).toBeDefined();
    expect(retriedUserMessageId).not.toBe('original-user');
    expect(
      useChatStore
        .getState()
        .conversations.find((conversation) => conversation.id === conversationId)?.messages,
    ).toEqual([
      expect.objectContaining({
        id: retriedUserMessageId,
        role: 'user',
        content: 'Retry this request',
      }),
    ]);
  });

  it('leaves send, edit, and retry state untouched when projection availability fails', async () => {
    const conversationId = useChatStore.getState().createConversation('openai', 'system');
    const addMessage = jest.fn();
    const rewindUserMessageForResend = jest.fn();
    const runChat = jest.fn();
    const setChatError = jest.fn();
    const { result } = renderHook(() =>
      useForegroundConversationActions(
        createParams(conversationId, {
          addMessage,
          rewindUserMessageForResend,
          editingMessageId: 'user-1',
          runChat,
          setChatError,
        }),
      ),
    );

    mockedWaitForProjection.mockRejectedValue(new Error('projection wait failed'));
    await act(async () => {
      await result.current.handleSend('do not append');
      await result.current.handleEditSend('do not edit');
      await result.current.handleRetry('assistant-1');
    });

    expect(addMessage).not.toHaveBeenCalled();
    expect(rewindUserMessageForResend).not.toHaveBeenCalled();
    expect(runChat).not.toHaveBeenCalled();
    expect(setChatError).toHaveBeenCalledWith('projection wait failed');
  });
});
