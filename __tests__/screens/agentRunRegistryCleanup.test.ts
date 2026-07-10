import { act, renderHook } from '@testing-library/react-native';
import { useRecoveredAsyncRunResume } from '../../src/screens/useRecoveredAsyncRunResume';
import { useTerminalBackgroundReviewQueue } from '../../src/screens/useTerminalBackgroundReviewQueue';
import { useChatStore } from '../../src/store/useChatStore';

describe('agent run registry cleanup', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
  });

  it('removes an async-resume entry after an early missing-run exit', async () => {
    const pending = new Map<string, Promise<void>>();
    const { result } = renderHook(() =>
      useRecoveredAsyncRunResume({
        activeForegroundConversationIds: new Set(),
        appendConversationLog: jest.fn(),
        conversations: [],
        pendingAgentRunAsyncResumesRef: { current: pending },
        resumeAgentRunRef: { current: null },
        setAgentRunPhase: jest.fn(),
        updateAgentRunSummary: jest.fn(),
      }),
    );

    let resume: Promise<void> | undefined;
    act(() => {
      resume = result.current({
        conversationId: 'missing-conversation',
        runId: 'run-1',
        pendingOperations: [],
      });
    });

    expect(pending.size).toBe(1);
    await act(async () => {
      await resume;
    });
    expect(pending.size).toBe(0);
  });

  it('removes a terminal-review entry after an early missing-run exit', async () => {
    const pending = new Map<string, Promise<void>>();
    const { result } = renderHook(() =>
      useTerminalBackgroundReviewQueue({
        appendConversationLog: jest.fn(),
        completeAgentRun: jest.fn(),
        ensureAgentRunFinalResponseRef: { current: null },
        pendingAgentRunTerminalReviewsRef: { current: pending },
        recordConversationTurnMemory: jest.fn(),
        resolveConversationFinalizationContextRef: { current: null },
        resumeAgentRunRef: { current: null },
        setAgentRunPhase: jest.fn(),
        updateAgentRunAsyncWork: jest.fn(),
        updateAgentRunControlGraph: jest.fn(),
        updateAgentRunSummary: jest.fn(),
        updateMessageAssistantMetadata: jest.fn(),
      }),
    );

    let review: Promise<void> | undefined;
    act(() => {
      review = result.current({
        conversationId: 'missing-conversation',
        runId: 'run-1',
      });
    });

    expect(pending.size).toBe(1);
    await act(async () => {
      await review;
    });
    expect(pending.size).toBe(0);
  });
});
