import {
  partializeChatPersistState,
  sanitizeConversationForPersistence,
} from '../../src/store/chatPersistence';
import type { AgentRun, Conversation, Message } from '../../src/types';

function makeMessage(index: number, overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${index}`,
    role: 'assistant',
    content: `message-${index}`,
    timestamp: index,
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'Conversation',
    messages: [],
    agentRuns: [],
    providerId: 'provider-1',
    systemPrompt: 'System prompt',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeAgentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    userMessageId: 'msg-user',
    goal: 'Ship a production-ready fix.',
    status: 'running',
    awaitingBackgroundWorkers: true,
    createdAt: 1,
    updatedAt: 1,
    currentPhase: 'pilot',
    phases: [],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 1,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
    ...overrides,
  };
}

describe('chatPersistence', () => {
  it('strips attachment base64 blobs from persisted conversations', () => {
    const conversation = makeConversation({
      messages: [
        makeMessage(1, {
          role: 'user',
          attachments: [
            {
              id: 'att-1',
              type: 'image',
              uri: 'file:///photo.jpg',
              name: 'photo.jpg',
              mimeType: 'image/jpeg',
              size: 2048,
              base64: 'should-not-persist',
            },
          ],
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);
    expect(persisted.messages[0].attachments).toEqual([
      expect.objectContaining({
        id: 'att-1',
        uri: 'file:///photo.jpg',
      }),
    ]);
    expect(persisted.messages[0].attachments?.[0]).not.toHaveProperty('base64');
  });

  it('preserves voice-note playback metadata across persistence', () => {
    const conversation = makeConversation({
      messages: [
        makeMessage(1, {
          role: 'user',
          attachments: [
            {
              id: 'voice-1',
              type: 'audio',
              uri: 'file:///voice-note.m4a',
              name: 'voice-note.m4a',
              mimeType: 'audio/mp4',
              size: 4096,
              durationMs: 4123.7,
              transcript: 'Ship the production voice-note flow.',
              waveformLevels: [0, 0.5, 2, Number.NaN],
            },
          ],
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);

    expect(persisted.messages[0].attachments).toEqual([
      {
        id: 'voice-1',
        type: 'audio',
        uri: 'file:///voice-note.m4a',
        name: 'voice-note.m4a',
        mimeType: 'audio/mp4',
        size: 4096,
        durationMs: 4124,
        transcript: 'Ship the production voice-note flow.',
        waveformLevels: [0.08, 0.5, 1, 0.18],
      },
    ]);
  });

  it('drops exact replay metadata for older messages while keeping the recent tail', () => {
    const messages = Array.from({ length: 10 }, (_, index) =>
      makeMessage(index, {
        providerReplay: { openaiResponseId: `resp-${index}` },
        toolCalls: [
          {
            id: `tool-${index}`,
            name: 'read_file',
            arguments: '{}',
            raw: { raw: `tool-${index}` },
            status: 'completed',
          },
        ],
      }),
    );

    const persisted = partializeChatPersistState({
      conversations: [makeConversation({ messages })],
      activeConversationId: 'conv-1',
      isLoading: false,
    });

    const persistedMessages = persisted.conversations[0].messages;
    expect(persistedMessages[0].providerReplay).toBeUndefined();
    expect(persistedMessages[1].toolCalls?.[0]?.raw).toBeUndefined();
    expect(persistedMessages[2].providerReplay).toEqual({ openaiResponseId: 'resp-2' });
    expect(persistedMessages[9].toolCalls?.[0]?.raw).toEqual({ raw: 'tool-9' });
    expect(persisted.activeConversationId).toBe('conv-1');
  });

  it('preserves assistant content across persistence even without final metadata', () => {
    const longFinalResponse = 'A'.repeat(40_000);
    const conversation = makeConversation({
      messages: [
        makeMessage(1, {
          role: 'assistant',
          content: longFinalResponse,
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);

    expect(persisted.messages[0].content).toBe(longFinalResponse);
    expect(persisted.messages[0].content.endsWith('…')).toBe(false);
  });

  it('preserves pilot state signatures exactly across persistence', () => {
    const stateSignature = 'pilot-state-v1:1234abcd5678ef90';
    const progressSignature = 'pilot-progress-v1:90ef5678abcd1234';
    const conversation = makeConversation({
      agentRuns: [
        makeAgentRun({
          latestPilotEvaluation: {
            evaluatorVersion: 'pilot-v2',
            evaluatedAt: 10,
            objective: 'Ship a production-ready fix.',
            completionScore: 3,
            adherenceScore: 3,
            evidenceScore: 2,
            processScore: 3,
            overallScore: 11,
            maxOverallScore: 20,
            approvalThreshold: 16,
            approved: false,
            recommendedAction: 'continue',
            controlAction: 'continue',
            confidence: 'medium',
            summary: 'Pilot found remaining gaps.',
            rationale: 'More verification is still required.',
            source: 'provider',
            stateSignature,
            progressSignature,
            strengths: [],
            gaps: ['Verification is incomplete.'],
            nextActions: ['Run targeted verification before final delivery.'],
            criterionEvaluations: [
              {
                criterion: 'Verify the result before finalizing.',
                score: 3,
                maxScore: 5,
                status: 'partial',
                rationale: 'Verification is incomplete.',
              },
            ],
          },
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);

    expect(persisted.agentRuns?.[0]?.latestPilotEvaluation?.stateSignature).toBe(stateSignature);
    expect(persisted.agentRuns?.[0]?.latestPilotEvaluation?.progressSignature).toBe(
      progressSignature,
    );
  });

  it('keeps only valid provider replay fields in persisted assistant messages', () => {
    const conversation = makeConversation({
      messages: [
        makeMessage(1, {
          providerReplay: {
            openaiResponseId: '  resp_123  ',
            openaiResponseOutput: [
              { id: 'fc_1', type: 'function_call', call_id: 'call_1' },
              'invalid-item',
            ] as any,
            geminiParts: [{ text: 'reasoning' }, null] as any,
            anthropicBlocks: [{ type: 'text', text: 'anthropic reply' }, 'invalid-block'] as any,
            extra: 'drop-me',
          } as any,
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);

    expect(persisted.messages[0].providerReplay).toEqual({
      openaiResponseId: 'resp_123',
      openaiResponseOutput: [{ id: 'fc_1', type: 'function_call', call_id: 'call_1' }],
      geminiParts: [{ text: 'reasoning' }],
      anthropicBlocks: [{ type: 'text', text: 'anthropic reply' }],
    });
  });
});
