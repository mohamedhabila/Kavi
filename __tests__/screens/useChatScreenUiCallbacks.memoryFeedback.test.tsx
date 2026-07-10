import { renderHook } from '@testing-library/react-native';
import { useChatScreenUiCallbacks } from '../../src/screens/chatScreen/useChatScreenUiCallbacks';
import { makeTestConversation, makeTestMessage } from '../helpers/factories';

const mockReadExplicitMemoryRetrievalFeedback = jest.fn();
const mockRecordExplicitMemoryRetrievalFeedback = jest.fn();

jest.mock('../../src/services/memory/retrievalOutcomeStore', () => ({
  readExplicitMemoryRetrievalFeedback: (...args: unknown[]) =>
    mockReadExplicitMemoryRetrievalFeedback(...args),
  recordExplicitMemoryRetrievalFeedback: (...args: unknown[]) =>
    mockRecordExplicitMemoryRetrievalFeedback(...args),
}));

const EVENT_ID = 'retrieval_event_m123_1_abc';

function renderCallbacks(params?: { completionStatus?: 'complete' | 'incomplete' }) {
  const assistantMessage = makeTestMessage(1, {
    id: 'assistant-exact',
    role: 'assistant',
    content: 'Remembered answer',
    assistantMetadata: {
      kind: 'final',
      completionStatus: params?.completionStatus ?? 'complete',
      memoryRetrievalEventId: EVENT_ID,
    },
  });
  const root = makeTestConversation({ id: 'root-conversation' });
  const side = makeTestConversation({
    id: 'side-conversation',
    isSideThread: true,
    parentConversationId: root.id,
    messages: [assistantMessage],
  });
  return renderHook(() =>
    useChatScreenUiCallbacks({
      activeConversation: side,
      activeConversationId: side.id,
      conversations: [root, side],
      navigation: { navigate: jest.fn() },
      setChatError: jest.fn(),
      setEditingContent: jest.fn(),
      setEditingMessageId: jest.fn(),
      setSelectedSubAgentSnapshot: jest.fn(),
      setVisibleSourceMessageLimit: jest.fn(),
      shareFileFailedMessage: 'share failed',
      t: (key) => key,
      workspaceFallbackConversationIds: [],
    }),
  );
}

describe('useChatScreenUiCallbacks memory feedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadExplicitMemoryRetrievalFeedback.mockResolvedValue({
      status: 'found',
      outcome: 'helpful',
      updatedAt: 100,
    });
    mockRecordExplicitMemoryRetrievalFeedback.mockResolvedValue({
      status: 'recorded',
      outcome: 'wrong',
      createdAt: 200,
      updatedAt: 200,
    });
  });

  it('binds reads and explicit writes to the root, side thread, event, and persisted message', async () => {
    const { result } = renderCallbacks();

    await expect(
      result.current.handleLoadMemoryFeedback('assistant-exact', EVENT_ID),
    ).resolves.toBe('helpful');
    await expect(
      result.current.handleMemoryFeedback('assistant-exact', EVENT_ID, 'wrong'),
    ).resolves.toBe('wrong');

    const expectedTarget = {
      retrievalEventId: EVENT_ID,
      memoryConversationId: 'root-conversation',
      sourceThreadId: 'side-conversation',
      assistantMessageId: 'assistant-exact',
    };
    expect(mockReadExplicitMemoryRetrievalFeedback).toHaveBeenCalledWith(expectedTarget);
    expect(mockRecordExplicitMemoryRetrievalFeedback).toHaveBeenCalledWith({
      target: expectedTarget,
      outcome: 'wrong',
    });
  });

  it.each([
    ['assistant-projection', EVENT_ID],
    ['assistant-exact', 'retrieval_event_other_1_abc'],
  ])(
    'rejects a mismatched persisted message or event before storage',
    async (messageId, eventId) => {
      const { result } = renderCallbacks();

      await expect(
        result.current.handleMemoryFeedback(messageId, eventId, 'irrelevant'),
      ).rejects.toThrow('memory_retrieval_feedback_target_invalid');
      expect(mockRecordExplicitMemoryRetrievalFeedback).not.toHaveBeenCalled();
    },
  );

  it('rejects feedback while the attributed final response remains incomplete', async () => {
    const { result } = renderCallbacks({ completionStatus: 'incomplete' });

    await expect(
      result.current.handleMemoryFeedback('assistant-exact', EVENT_ID, 'helpful'),
    ).rejects.toThrow('memory_retrieval_feedback_target_invalid');
    expect(mockRecordExplicitMemoryRetrievalFeedback).not.toHaveBeenCalled();
  });
});
