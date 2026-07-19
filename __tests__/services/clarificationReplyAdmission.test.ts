import {
  admitPendingClarificationReply,
  buildPendingClarificationReplyContext,
} from '../../src/services/agents/clarificationReplyAdmission';
import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';
import type { LlmProviderConfig } from '../../src/types/provider';

const provider: LlmProviderConfig = {
  id: 'provider-1',
  name: 'Provider',
  enabled: true,
  kind: 'openai-compatible',
  apiKey: 'test-key',
  baseUrl: 'https://example.test',
  model: 'test-model',
  local: false,
};

function conversationWithReply(reply = 'ليلى، وقل لها صباح الخير'): Conversation {
  const run: AgentRun = {
    id: 'run-1',
    userMessageId: 'user-1',
    workflowTaskAnchor: {
      sourceMessageId: 'user-1',
      content: 'メッセージを送って',
      attachments: [],
    },
    goal: 'メッセージを送って',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    currentPhase: 'work',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 1,
      completedTools: 1,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    controlGraph: createInitialAgentRunControlGraphState({
      status: 'awaiting_user',
      pendingUserInput: {
        requestedAfterUserMessageId: 'user-1',
        requiredInformation: [
          {
            key: 'message.recipient',
            requiredFor: 'execution',
            semanticRole: 'recipient',
            resolution: 'unresolved',
          },
          {
            key: 'message.content',
            requiredFor: 'execution',
            semanticRole: 'content',
            resolution: 'unresolved',
          },
        ],
        updatedAt: 2,
      },
    }),
  };
  return {
    id: 'conversation-1',
    title: 'Test',
    mode: 'agentic',
    providerId: provider.id,
    createdAt: 1,
    updatedAt: 3,
    activeAgentRunId: run.id,
    agentRuns: [run],
    messages: [
      { id: 'user-1', role: 'user', content: run.goal, timestamp: 1 } as Message,
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '¿A quién y qué mensaje?',
        timestamp: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'request_clarification',
        },
      } as Message,
      { id: 'user-2', role: 'user', content: reply, timestamp: 3 } as Message,
    ],
    usage: {
      entries: [],
      totalInput: 0,
      totalOutput: 0,
      totalCost: 0,
    },
  };
}

describe('clarification reply admission', () => {
  it('builds a language-independent admission context from the exact paused run', () => {
    expect(buildPendingClarificationReplyContext(conversationWithReply())).toEqual({
      runId: 'run-1',
      originalRequest: 'メッセージを送って',
      clarificationQuestion: '¿A quién y qué mensaje?',
      requiredInformation: [
        {
          key: 'message.recipient',
          requiredFor: 'execution',
          semanticRole: 'recipient',
          resolution: 'unresolved',
        },
        {
          key: 'message.content',
          requiredFor: 'execution',
          semanticRole: 'content',
          resolution: 'unresolved',
        },
      ],
      reply: {
        text: 'ليلى، وقل لها صباح الخير',
        attachments: [],
      },
    });
  });

  it('admits only the exact registered keys selected by structured model output', async () => {
    const context = buildPendingClarificationReplyContext(conversationWithReply());
    if (!context) throw new Error('Expected pending clarification context');
    const sendMessage = jest.fn().mockResolvedValue({
      output_parsed: {
        disposition: 'answer',
        resolvedInformationKeys: ['message.recipient', 'message.content'],
      },
      usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
    });

    await expect(
      admitPendingClarificationReply({
        context,
        provider,
        model: 'test-model',
        sendMessage,
      }),
    ).resolves.toEqual({
      runId: 'run-1',
      disposition: 'answer',
      resolvedInformationKeys: ['message.recipient', 'message.content'],
      usage: expect.objectContaining({ model: 'test-model', totalTokens: 50 }),
    });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.stringContaining('ليلى') }),
      ]),
      expect.objectContaining({
        temperature: 0,
        reasoning_effort: 'none',
        structuredOutput: expect.objectContaining({ name: 'clarification_reply_admission' }),
      }),
    );
    const structuredOutput = sendMessage.mock.calls[0]?.[1]?.structuredOutput;
    expect(structuredOutput?.schema.properties.resolvedInformationKeys).not.toHaveProperty(
      'uniqueItems',
    );
  });

  it('accepts a separate request only with no resolved clarification keys', async () => {
    const context = buildPendingClarificationReplyContext(
      conversationWithReply('Recover my interrupted planning file instead.'),
    );
    if (!context) throw new Error('Expected pending clarification context');

    await expect(
      admitPendingClarificationReply({
        context,
        provider,
        model: 'test-model',
        sendMessage: jest.fn().mockResolvedValue({
          output_parsed: {
            disposition: 'new_request',
            resolvedInformationKeys: [],
          },
        }),
      }),
    ).resolves.toEqual({
      runId: 'run-1',
      disposition: 'new_request',
      resolvedInformationKeys: [],
    });
  });

  it('rejects inconsistent or unregistered structured decisions', async () => {
    const context = buildPendingClarificationReplyContext(conversationWithReply());
    if (!context) throw new Error('Expected pending clarification context');

    await expect(
      admitPendingClarificationReply({
        context,
        provider,
        model: 'test-model',
        sendMessage: jest.fn().mockResolvedValue({
          output_parsed: {
            disposition: 'answer',
            resolvedInformationKeys: ['unregistered.key'],
          },
        }),
      }),
    ).rejects.toThrow('clarification_reply_admission_output_invalid');
  });
});
