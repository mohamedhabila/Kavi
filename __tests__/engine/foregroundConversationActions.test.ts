import { act, renderHook } from '@testing-library/react-native';
import { useForegroundConversationActions } from '../../src/engine/graph/foregroundRun/useForegroundConversationActions';
import { getComposerDraftKey } from '../../src/screens/chatComposerDrafts';
import { useChatStore } from '../../src/store/useChatStore';

describe('useForegroundConversationActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  it('targets the live active side thread when send runs before the screen rerenders', async () => {
    const parentId = useChatStore.getState().createConversation('openai', 'system');
    const sideId = useChatStore.getState().createSideThread(parentId)!;

    const addMessage = jest.fn();
    const clearComposerDraft = jest.fn();
    const runChat = jest.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useForegroundConversationActions({
        activeComposerDraftKey: getComposerDraftKey(parentId),
        activeConversation: useChatStore
          .getState()
          .conversations.find((conversation) => conversation.id === parentId),
        activeConversationId: parentId,
        addMessage,
        appendConversationLog: jest.fn(),
        attachmentWorkspaceImportFailedMessage: 'attachment failed',
        abortForegroundRequestForConversation: jest.fn(),
        clearComposerDraft,
        clearForegroundRequestForConversation: jest.fn(),
        completeAgentRun: jest.fn(),
        defaultConversationMode: 'agentic',
        editMessage: jest.fn(),
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
        runChat,
        setChatError: jest.fn(),
        setEditingContent: jest.fn(),
        setEditingMessageId: jest.fn(),
        updateAgentRunControlGraph: jest.fn(),
      }),
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
});
