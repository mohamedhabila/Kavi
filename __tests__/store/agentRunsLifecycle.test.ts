import {
  completeAgentRunInConversation,
  startAgentRunInConversation,
} from '../../src/store/agentRuns/lifecycle';
import {
  createAgentRunControlGraphState,
  createDefaultConversations,
  createRunningAgentRun,
} from '../../testSupport/chatScreen/fixtures';

describe('agentRuns lifecycle', () => {
  it('marks still-running tool calls as failed when a run is cancelled', () => {
    const conversation = {
      ...createDefaultConversations()[0],
      messages: [
        {
          id: 'msg-user-tool',
          role: 'user',
          content: 'Research the issue',
          timestamp: 1000,
        },
        {
          id: 'msg-assistant-tool',
          role: 'assistant',
          content: 'Searching…',
          timestamp: 1001,
          toolCalls: [
            {
              id: 'tc-web-search',
              name: 'web_search',
              arguments: '{"query":"issue"}',
              status: 'running',
              startedAt: 1001,
            },
          ],
        },
      ],
      activeAgentRunId: 'run-1',
      agentRuns: [
        createRunningAgentRun({
          id: 'run-1',
          userMessageId: 'msg-user-tool',
          createdAt: 1000,
          updatedAt: 1002,
          controlGraph: createAgentRunControlGraphState(),
        }),
      ],
    } as any;

    const nextConversation = completeAgentRunInConversation(
      conversation,
      {
        status: 'cancelled',
        latestSummary: 'The current run was cancelled.',
        terminalReason: 'user_cancelled',
        timestamp: 2000,
      },
      'run-1',
    );

    expect(nextConversation.agentRuns[0].status).toBe('cancelled');
    expect(nextConversation.messages[1].toolCalls?.[0]).toEqual(
      expect.objectContaining({
        id: 'tc-web-search',
        status: 'failed',
        error: 'Tool call was interrupted because the run was cancelled before completion.',
        completedAt: 2000,
      }),
    );
  });

  it('marks still-running tool calls as failed when a run is superseded by a new turn', () => {
    const conversation = {
      ...createDefaultConversations()[0],
      messages: [
        {
          id: 'msg-user-tool',
          role: 'user',
          content: 'Research the issue',
          timestamp: 1000,
        },
        {
          id: 'msg-assistant-tool',
          role: 'assistant',
          content: 'Searching…',
          timestamp: 1001,
          toolCalls: [
            {
              id: 'tc-web-search',
              name: 'web_search',
              arguments: '{"query":"issue"}',
              status: 'running',
              startedAt: 1001,
            },
          ],
        },
      ],
      activeAgentRunId: 'run-1',
      agentRuns: [
        createRunningAgentRun({
          id: 'run-1',
          userMessageId: 'msg-user-tool',
          createdAt: 1000,
          updatedAt: 1002,
          controlGraph: createAgentRunControlGraphState(),
        }),
      ],
    } as any;

    const nextConversation = startAgentRunInConversation(conversation, {
      goal: 'Handle the next user turn.',
      runId: 'run-2',
      timestamp: 3000,
      userMessageId: 'msg-user-next',
    });

    expect(nextConversation.agentRuns[0].status).toBe('cancelled');
    expect(nextConversation.messages[1].toolCalls?.[0]).toEqual(
      expect.objectContaining({
        id: 'tc-web-search',
        status: 'failed',
        error:
          'Tool call was interrupted because the run was superseded by a newer user turn.',
        completedAt: 3000,
      }),
    );
    expect(nextConversation.activeAgentRunId).toBe('run-2');
  });
});
