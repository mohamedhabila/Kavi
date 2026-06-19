import {
  partializeChatPersistState,
  sanitizeConversationForPersistence,
} from '../../src/store/chatPersistence';
import {
  makeTestAgentRun as makeAgentRun,
  makeTestConversation as makeConversation,
  makeTestMessage as makeMessage,
} from '../helpers/factories';

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

  it('persists oversized structured tool content as valid compact JSON instead of truncating mid-object', () => {
    const largeToolContent = JSON.stringify({
      provider: 'gemini',
      searches: [
        {
          query: '"OpenAI" "Responses" API official documentation '.repeat(40).trim(),
          results: Array.from({ length: 20 }, (_, index) => ({
            title: `result ${index} `.repeat(60).trim(),
            url: `https://docs.example.com/path/${index}`,
          })),
        },
        {
          query: '"Gemini" "generateContent" API official documentation '.repeat(40).trim(),
          results: Array.from({ length: 20 }, (_, index) => ({
            title: `gemini ${index} `.repeat(60).trim(),
            url: `https://ai.example.com/path/${index}`,
          })),
        },
      ],
    });
    expect(largeToolContent.length).toBeGreaterThan(12_000);

    const conversation = makeConversation({
      messages: [
        makeMessage(1, {
          role: 'tool',
          toolCallId: 'web_search',
          content: largeToolContent,
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);
    const persistedContent = persisted.messages[0].content;

    expect(persistedContent.length).toBeLessThanOrEqual(12_000);
    expect(() => JSON.parse(persistedContent)).not.toThrow();

    const parsed = JSON.parse(persistedContent);
    expect(parsed.provider).toBe('gemini');
    expect(Array.isArray(parsed.searches)).toBe(true);
  });

  it('preserves tail context when compacting oversized structured tool content', () => {
    const tailMarker = 'TAIL_CONTEXT_MARKER_98765';
    const largeToolContent = JSON.stringify({
      fetches: [
        {
          url: 'https://example.com/docs',
          content: `${'intro paragraph '.repeat(1200)}${tailMarker}`,
          charCount: 20000,
          truncated: true,
        },
      ],
    });
    expect(largeToolContent.length).toBeGreaterThan(12_000);

    const conversation = makeConversation({
      messages: [
        makeMessage(1, {
          role: 'tool',
          toolCallId: 'web_fetch',
          content: largeToolContent,
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);
    const persistedContent = persisted.messages[0].content;
    expect(persistedContent.length).toBeLessThanOrEqual(12_000);
    expect(persistedContent).toContain(tailMarker);
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

  it('persists compact durable control graph state on agent runs', () => {
    const audit = Array.from({ length: 120 }, (_, index) => ({
      type: 'MODEL_TURN_COMPLETED',
      timestamp: index,
      iteration: index,
      detail: `graph event ${index}`,
    }));
    const conversation = makeConversation({
      agentRuns: [
        makeAgentRun({
          controlGraph: {
            version: 1,
            status: 'awaiting_tool_results',
            iteration: 9,
            expectedToolCalls: [
              { id: 'call-1', name: 'skill__generic__mutate' },
              { id: 'call-1', name: 'duplicate_should_drop' },
            ],
            observedToolResults: [{ id: 'call-0', name: 'browser_click', failed: true }],
            pendingAsyncCount: 2,
            asyncWork: {
              awaitingBackgroundWorkers: true,
              pendingOperations: [
                {
                  key: 'session:sub-persist',
                  kind: 'session',
                  resourceId: 'sub-persist',
                  displayName: 'Session sub-persist',
                  status: 'running',
                  lastUpdatedByTool: 'sessions_spawn',
                  updatedAt: 8700,
                  monitorToolNames: ['sessions_status', 'sessions_wait'],
                  waitToolName: 'sessions_wait',
                  waitArgs: { sessionId: 'sub-persist' },
                },
              ],
              updatedAt: 8700,
            },
            lastModelToolNames: ['skill__generic__mutate', 'mcp__generic__read'],
            finalizationHoldReason: 'goals_incomplete',
            activeTaskId: 'goal-persist',
            performance: {
              modelTurnCount: 2,
              modelDurationMs: 240,
              timeToFirstTokenMs: 18,
              toolExecutionCount: 4,
              toolExecutionDurationMs: 320,
              lastCandidateToolCount: 64,
              lastActiveToolCount: 12,
              maxActiveToolCount: 16,
              lastActiveToolTokenEstimate: 1400,
              maxActiveToolTokenEstimate: 1800,
              updatedAt: 8998,
            },
            turnDirectives: {
              forceFinalText: true,
              forcedTextReason: 'incomplete_delivery_continuation',
              requireWorkflowTool: true,
              maxTokensOverride: 8192,
              incompleteFinalTextRecoveryCount: 1,
              incompleteFinalTextContinuationPrefix: 'partial final answer',
            },
            audit,
            updatedAt: 9000,
          },
        }),
      ],
    });

    const persisted = sanitizeConversationForPersistence(conversation);
    const graph = persisted.agentRuns?.[0]?.controlGraph;

    expect(graph).toEqual(
      expect.objectContaining({
        status: 'awaiting_tool_results',
        iteration: 9,
        expectedToolCalls: [{ id: 'call-1', name: 'skill__generic__mutate' }],
        observedToolResults: [{ id: 'call-0', name: 'browser_click', failed: true }],
        pendingAsyncCount: 2,
        asyncWork: expect.objectContaining({
          awaitingBackgroundWorkers: true,
          pendingOperations: [
            expect.objectContaining({
              key: 'session:sub-persist',
              resourceId: 'sub-persist',
              waitToolName: 'sessions_wait',
            }),
          ],
        }),
        lastModelToolNames: ['skill__generic__mutate', 'mcp__generic__read'],
        finalizationHoldReason: 'goals_incomplete',
        activeTaskId: 'goal-persist',
        performance: expect.objectContaining({
          modelTurnCount: 2,
          modelDurationMs: 240,
          timeToFirstTokenMs: 18,
          lastActiveToolCount: 12,
          maxActiveToolCount: 16,
          maxActiveToolTokenEstimate: 1800,
        }),
        turnDirectives: expect.objectContaining({
          forceFinalText: true,
          forcedTextReason: 'incomplete_delivery_continuation',
          requireWorkflowTool: true,
          maxTokensOverride: 8192,
          incompleteFinalTextRecoveryCount: 1,
          incompleteFinalTextContinuationPrefix: 'partial final answer',
        }),
      }),
    );
    expect(graph?.audit).toHaveLength(96);
    expect(graph?.audit[0].iteration).toBe(24);
  });

  it('caps very large persisted conversations while preserving the anchored replay tail', () => {
    const messages = Array.from({ length: 650 }, (_, index) =>
      makeMessage(index, {
        role: index === 0 ? 'user' : 'assistant',
        content: `message-${index}`,
        providerReplay: { openaiResponseId: `resp-${index}` },
      }),
    );

    const persisted = sanitizeConversationForPersistence(makeConversation({ messages }));

    expect(persisted.messages).toHaveLength(500);
    expect(persisted.messages[0].id).toBe('msg-0');
    expect(persisted.messages[1].id).toBe('msg-151');
    expect(persisted.messages[491].providerReplay).toBeUndefined();
    expect(persisted.messages[492].providerReplay).toEqual({ openaiResponseId: 'resp-642' });
    expect(persisted.messages[499].providerReplay).toEqual({ openaiResponseId: 'resp-649' });
  });
});
