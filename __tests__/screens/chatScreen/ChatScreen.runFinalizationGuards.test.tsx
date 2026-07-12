import {
  act,
  fireEvent,
  render,
  waitFor,
  ChatScreen,
} from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetInFlightChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockChatScreenState, updateMockConversation } from '../../../testSupport/chatScreen/state';
import {
  createAgentRunControlGraphState,
  createRunningAgentRun,
} from '../../../testSupport/chatScreen/fixtures';
import {
  mockUpdateMessage,
  mockStartAgentRun,
  mockCompleteAgentRun,
} from '../../../testSupport/chatScreen/storeMocks';
import {
  mockCollectAgentRunFinalizationEvidence,
  mockBuildAgentRunToolResultFallback,
  mockHasCompletedExecutionRecoveryEvidence,
  mockRunOrchestrator,
} from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen run finalization guards', () => {
  beforeEach(resetInFlightChatScreenTestEnvironment);

  afterEach(cleanupChatScreenTestEnvironment);

  it('does not finalize the run multiple times when onDone is emitted twice', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
            currentPhase: 'work',
          }),
        ],
      }));
      return 'run-1';
    });

    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onAssistantMessage('The task completed successfully.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'task_complete',
      });
      callbacks.onAgentControlGraphStateChange(
        createAgentRunControlGraphState({ status: 'awaiting_review' }),
      );
      callbacks.onDone();
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Finalization duplicate callback test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledTimes(1);
    });
    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'completed',
      }),
      'run-1',
    );
  });

  it('does not finalize a run multiple times when onError is emitted twice', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
            currentPhase: 'work',
          }),
        ],
      }));
      return 'run-1';
    });

    mockHasCompletedExecutionRecoveryEvidence.mockReturnValueOnce(false);
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Error duplicate callback test',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: '',
      lastSubstantiveResult: '',
      resultPreviews: [],
      toolsUsed: [],
      iterations: 0,
      hasIncompleteToolCalls: false,
    }));
    mockBuildAgentRunToolResultFallback.mockReturnValueOnce(undefined);

    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onError(new Error('Streaming interruption'));
      callbacks.onError(new Error('Streaming interruption'));
      return { terminalDisposition: 'failed' };
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Error duplicate callback test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      expect.stringContaining('Error: Streaming interruption'),
    );
  });

  it('does not promote the streamed draft when the API fails mid-stream', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Investigate the stream failure',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'Interrupted draft answer',
      lastSubstantiveResult: '',
      resultPreviews: [],
      toolsUsed: [],
      iterations: 0,
      hasIncompleteToolCalls: false,
    }));
    mockBuildAgentRunToolResultFallback.mockImplementation(({ evidence }: any) =>
      (evidence?.resultPreviews?.length ?? 0) > 0 ? 'Fallback final response (failed)' : undefined,
    );

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Investigate the stream failure');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    await act(async () => {
      callbacks.onToken('Interrupted draft answer');
      callbacks.onError(new Error('OpenAI streaming error'));
      callbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      const latestAssistantMessage = [...mockChatScreenState.conversations[0].messages]
        .reverse()
        .find((message: any) => message.role === 'assistant');

      expect(latestAssistantMessage).toEqual(
        expect.objectContaining({
          content: 'Missing final response (failed)',
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'fallback_from_evidence',
          }),
        }),
      );
    });
  });

  it('does not promote the streamed draft when the transport throws after tokens', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Investigate the stream failure',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'Interrupted draft answer',
      lastSubstantiveResult: '',
      resultPreviews: [],
      toolsUsed: [],
      iterations: 0,
      hasIncompleteToolCalls: false,
    }));
    mockBuildAgentRunToolResultFallback.mockImplementation(({ evidence }: any) =>
      (evidence?.resultPreviews?.length ?? 0) > 0 ? 'Fallback final response (failed)' : undefined,
    );
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onToken('Interrupted draft answer');
      throw new Error('Transport failed after streaming');
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Investigate the stream failure');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      const latestAssistantMessage = [...mockChatScreenState.conversations[0].messages]
        .reverse()
        .find((message: any) => message.role === 'assistant');

      expect(latestAssistantMessage).toEqual(
        expect.objectContaining({
          content: 'Missing final response (failed)',
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'fallback_from_evidence',
          }),
        }),
      );
    });
  });
});
