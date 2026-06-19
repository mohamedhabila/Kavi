import type { OrchestratorCallbacks } from '../../../src/engine/orchestrator';
import {
  fireEvent,
  render,
  waitFor,
  ChatScreen,
} from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockChatScreenState, updateMockConversation } from '../../../testSupport/chatScreen/state';
import { createRunningAgentRun } from '../../../testSupport/chatScreen/fixtures';
import {
  mockAddMessage,
  mockUpdateMessage,
  mockUpdateMessageEnrichedContent,
  mockSetLoading,
  mockUpdateMessageReasoning,
  mockUpdateMessageProviderReplay,
  mockAddToolCall,
  mockUpdateToolCallStatus,
  mockRecordConversationUsage,
  mockAddConversationLog,
  mockStartAgentRun,
  mockSetAgentRunPhase,
  mockAppendAgentRunCheckpoint,
  mockCompleteAgentRun,
} from '../../../testSupport/chatScreen/storeMocks';
import {
  mockEvaluateAgentRunWithPilot,
  mockRunOrchestrator,
} from '../../../testSupport/chatScreen/serviceMocks';

describe('ChatScreen agent callbacks', () => {
  beforeEach(resetChatScreenTestEnvironment);

  afterEach(cleanupChatScreenTestEnvironment);

  it('invokes orchestrator callbacks correctly', async () => {
    jest.useFakeTimers();
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      const { act } = require('@testing-library/react-native');

      callbacks.onStateChange('running');
      act(() => {
        callbacks.onToken('hello');
        jest.advanceTimersByTime(40);
      });

      expect(mockUpdateMessage).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(240);
      });

      expect(mockUpdateMessage).toHaveBeenCalled();

      act(() => {
        callbacks.onReasoning('thinking...');
        jest.advanceTimersByTime(240);
      });
      expect(mockUpdateMessageReasoning).toHaveBeenCalled();

      callbacks.onUserMessageEnriched('msg1', 'Hello\n\n<link_context>Example</link_context>');
      expect(mockUpdateMessageEnrichedContent).toHaveBeenCalledWith(
        'conv1',
        'msg1',
        'Hello\n\n<link_context>Example</link_context>',
      );

      act(() => {
        callbacks.onToolCallQueued({
          id: 'tc0',
          name: 'inspect',
          arguments: '{}',
          status: 'pending',
        });
      });

      expect(mockAddToolCall).not.toHaveBeenCalled();

      act(() => {
        callbacks.onAssistantMessage(
          [
            'Objective: Hello',
            'Success Criteria:',
            '- Deliver the requested result.',
            'Stop Conditions:',
            '- Stop when verified.',
            'Workstreams:',
            '1. Inspect | Goal: Review the request',
          ].join('\n'),
          [{ id: 'tc1', name: 'test', arguments: '{}', status: 'pending' }],
        );
      });

      act(() => {
        callbacks.onToolCallStart({ id: 'tc1', name: 'test', arguments: '{}', status: 'running' });
      });
      expect(mockAddToolCall).toHaveBeenCalled();

      act(() => {
        callbacks.onToolCallComplete({
          id: 'tc1',
          name: 'test',
          arguments: '{}',
          status: 'completed',
          result: 'ok',
        });
      });
      expect(mockUpdateToolCallStatus).toHaveBeenCalled();

      mockChatScreenState.activeSubAgents = [
        {
          sessionId: 'sub-callback-1',
          parentConversationId: 'conv1',
          agentRunId: 'run-1',
          workstreamId: 'workstream-1',
          startedAt: 1_700_000_000_200,
          updatedAt: 1_700_000_000_240,
          status: 'completed',
          sandboxPolicy: 'inherit',
          output: 'Reviewed the request and captured the result.',
        },
      ];

      await act(async () => {
        callbacks.onAssistantMessage('final content', [], {
          openaiResponseOutput: [
            { id: 'msg_prev', type: 'message', role: 'assistant', content: [] },
          ],
        });
        callbacks.onToolMessage('tc1', JSON.stringify({ status: 'error', error: 'Tool failed' }));
        callbacks.onUsage({
          inputTokens: 40,
          outputTokens: 20,
          cacheReadTokens: 15,
          cacheWriteTokens: 5,
          totalTokens: 65,
        });
        callbacks.onDone();
        await Promise.resolve();
      });
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Callback test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    expect(mockStartAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        goal: 'Callback test',
        userMessageId: expect.any(String),
        summary: expect.objectContaining({ assistantTurns: 1 }),
      }),
    );

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'completed',
          checkpointTitle: 'Final response delivered',
          summary: expect.objectContaining({
            assistantTurns: 2,
            startedTools: 1,
            completedTools: 1,
          }),
        }),
        'run-1',
      );
    });

    expect(mockEvaluateAgentRunWithPilot).not.toHaveBeenCalled();

    expect(mockUpdateMessageProviderReplay).toHaveBeenCalledWith('conv1', expect.any(String), {
      openaiResponseOutput: [{ id: 'msg_prev', type: 'message', role: 'assistant', content: [] }],
    });

    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        role: 'tool',
        toolCallId: 'tc1',
        content: JSON.stringify({ status: 'error', error: 'Tool failed' }),
        isError: true,
      }),
    );
    expect(mockRecordConversationUsage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        inputTokens: 40,
        outputTokens: 20,
        cacheReadTokens: 15,
        cacheWriteTokens: 5,
        totalTokens: 65,
        model: 'gpt-5.4',
        providerId: 'openai',
      }),
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        kind: 'usage',
        title: 'Usage recorded',
        detail: expect.stringContaining('cache 15 / 40 · write 5'),
      }),
    );
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        status: 'active',
      }),
      'run-1',
    );
    expect(mockAppendAgentRunCheckpoint).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Tool started: test',
      }),
      'run-1',
    );
    expect(mockAppendAgentRunCheckpoint).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Tool completed: test',
      }),
      'run-1',
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        kind: 'state',
        level: 'success',
        title: 'Final response delivered',
        detail:
          'The workflow produced a visible final answer and completed without a separate review pass.',
      }),
    );
    expect(mockSetLoading).toHaveBeenCalledWith(false);
    jest.useRealTimers();
  });

  it('does not start a tracked agent run for low-signal agentic requests', async () => {
    mockRunOrchestrator.mockImplementationOnce(
      async (_options: any, callbacks: OrchestratorCallbacks) => {
        callbacks.onAssistantMessage('What concrete outcome do you want me to accomplish?', []);
        callbacks.onDone();
      },
    );

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), '---');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    expect(mockStartAgentRun).not.toHaveBeenCalled();
    expect(mockCompleteAgentRun).not.toHaveBeenCalled();
  });
});
