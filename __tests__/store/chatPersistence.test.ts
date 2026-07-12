import {
  partializeChatPersistState,
  sanitizeConversationForPersistence,
} from '../../src/store/chatPersistence';
import { normalizePersistedChatState } from '../../src/store/chatStoreNormalization';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import { decodeToolEffectReceipt } from '../../src/utils/toolEffectReceipt';
import {
  makeTestAgentRun as makeAgentRun,
  makeTestConversation as makeConversation,
  makeTestMessage as makeMessage,
} from '../helpers/factories';

function makePersistedEffectReceipt(overrides: Partial<ToolEffectReceipt> = {}): ToolEffectReceipt {
  const toolName = overrides.toolName ?? 'calendar_create_event';
  const receipt = decodeToolEffectReceipt({
    version: 2,
    receiptId: `ter_${'a'.repeat(32)}`,
    toolCallId: 'tool-receipt-1',
    toolName,
    contractIdentity: overrides.contractIdentity ?? {
      kind: 'code_owned',
      version: 1,
      toolName,
      schemaDigest: `sha256:${'1'.repeat(64)}`,
      capabilityContractDigest: `sha256:${'2'.repeat(64)}`,
      workflowContractDigest: `sha256:${'3'.repeat(64)}`,
      effectContractDigest: `sha256:${'4'.repeat(64)}`,
      executionPolicyDigest: `sha256:${'5'.repeat(64)}`,
    },
    executionRunId: 'execution-run-restart-1',
    dispatchRunId: 'effect-run-restart-1',
    transportState: 'returned',
    effectKind: 'calendar.create',
    effectState: 'applied',
    verificationState: 'acknowledged',
    requestDigest: `sha256:${'b'.repeat(64)}`,
    resultDigest: `sha256:${'c'.repeat(64)}`,
    resource: { kind: 'calendar_event', id: 'event-restart-1' },
    recordedAt: 1_700_000_000_100,
    ...overrides,
  });
  if (!receipt) {
    throw new Error('Invalid persisted receipt fixture.');
  }
  return receipt;
}

describe('chatPersistence', () => {
  it('persists only bounded code-owned memory retrieval attribution', () => {
    const valid = makeConversation({
      messages: [
        makeMessage(1, {
          role: 'assistant',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            memoryRetrievalEventId: 'retrieval_event_m123_1_abc',
          },
        }),
      ],
    });
    const invalid = makeConversation({
      id: 'invalid-conversation',
      messages: [
        makeMessage(2, {
          role: 'assistant',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            memoryRetrievalEventId: '../private-query',
          },
        }),
      ],
    });

    expect(
      sanitizeConversationForPersistence(valid).messages[0].assistantMetadata
        ?.memoryRetrievalEventId,
    ).toBe('retrieval_event_m123_1_abc');
    expect(
      sanitizeConversationForPersistence(invalid).messages[0].assistantMetadata,
    ).not.toHaveProperty('memoryRetrievalEventId');
  });

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

  it('round-trips effect receipts through restart serialization without raw payload duplication', () => {
    const receipt = makePersistedEffectReceipt();
    const persisted = partializeChatPersistState({
      conversations: [
        makeConversation({
          messages: [
            makeMessage(1, {
              role: 'assistant',
              toolCalls: [
                {
                  id: 'tool-receipt-1',
                  name: 'calendar_create_event',
                  arguments: JSON.stringify({ title: 'Private restart meeting' }),
                  status: 'completed',
                  result: JSON.stringify({ status: 'created', id: 'event-restart-1' }),
                  effectReceipts: [receipt],
                },
              ],
            }),
          ],
        }),
      ],
      activeConversationId: 'conv-1',
      isLoading: false,
    });

    const serializedReceipt = JSON.stringify(
      persisted.conversations[0].messages[0].toolCalls?.[0]?.effectReceipts?.[0],
    );
    expect(serializedReceipt).not.toContain('Private restart meeting');

    const restarted = normalizePersistedChatState(
      JSON.parse(JSON.stringify(persisted)) as typeof persisted,
    );
    const restartedReceipts = restarted.conversations[0].messages[0].toolCalls?.[0]?.effectReceipts;
    expect(restartedReceipts).toEqual([receipt]);
    expect(Object.isFrozen(restartedReceipts)).toBe(true);
    expect(Object.isFrozen(restartedReceipts?.[0])).toBe(true);
  });

  it('round-trips only content-free runtime-external receipt evidence', () => {
    const toolName = 'mcp__calendar__create_event';
    const receipt = makePersistedEffectReceipt({
      toolName,
      contractIdentity: {
        kind: 'runtime_external',
        version: 1,
        toolName,
        source: 'mcp',
        namespace: 'calendar',
        declarationDigest: `sha256:${'6'.repeat(64)}`,
        executionBindingDigest: `sha256:${'7'.repeat(64)}`,
      },
      effectKind: 'unknown',
      effectState: 'unknown',
      verificationState: 'unverified',
      resource: undefined,
    });
    const persisted = partializeChatPersistState({
      conversations: [
        makeConversation({
          messages: [
            makeMessage(1, {
              role: 'assistant',
              toolCalls: [
                {
                  id: receipt.toolCallId,
                  name: toolName,
                  arguments: '{"token":"private-argument"}',
                  status: 'completed',
                  result: '{"secret":"private-result"}',
                  effectReceipts: [receipt],
                },
              ],
            }),
          ],
        }),
      ],
      activeConversationId: 'conv-1',
      isLoading: false,
    });

    const restarted = normalizePersistedChatState(
      JSON.parse(JSON.stringify(persisted)) as typeof persisted,
    );
    expect(restarted.conversations[0].messages[0].toolCalls?.[0]?.effectReceipts).toEqual([
      receipt,
    ]);
    const serializedReceipt = JSON.stringify(receipt);
    expect(serializedReceipt).not.toContain('calendar.example');
    expect(serializedReceipt).not.toContain('private-argument');
    expect(serializedReceipt).not.toContain('private-result');
    expect(serializedReceipt).not.toContain('token');
  });

  it('invalidates corrupt, conflicting, out-of-order, and cross-parent receipt histories on restart', () => {
    const malformedParent = {
      toolCallId: 'tool-malformed-history',
      toolName: 'calendar_create_event',
    };
    const validAfterMalformed = makePersistedEffectReceipt({
      receiptId: `ter_${'d'.repeat(32)}`,
      ...malformedParent,
      effectKind: 'calendar.create',
    });
    const conflicting = makePersistedEffectReceipt({
      receiptId: `ter_${'e'.repeat(32)}`,
      toolCallId: 'tool-conflict-history',
      toolName: 'calendar_create_event',
      effectKind: 'calendar.create',
      recordedAt: 500,
    });
    const newestFirst = makePersistedEffectReceipt({
      receiptId: `ter_${'f'.repeat(32)}`,
      toolCallId: 'tool-order-history',
      toolName: 'calendar_create_event',
      effectKind: 'calendar.create',
      recordedAt: 700,
    });
    const olderSecond = makePersistedEffectReceipt({
      receiptId: `ter_${'1'.repeat(32)}`,
      toolCallId: 'tool-order-history',
      toolName: 'calendar_create_event',
      effectKind: 'calendar.create',
      recordedAt: 600,
    });
    const rawPersistedState = {
      conversations: [
        makeConversation({
          messages: [
            makeMessage(1, {
              role: 'assistant',
              toolCalls: [
                {
                  id: malformedParent.toolCallId,
                  name: 'mcp__remote__mutate',
                  arguments: '{}',
                  status: 'completed',
                  effectReceipts: [
                    { ...validAfterMalformed, resultDigest: 'sha256:invalid' } as any,
                    validAfterMalformed,
                  ],
                },
                {
                  id: 'tool-conflict-history',
                  name: 'mcp__remote__mutate',
                  arguments: '{}',
                  status: 'completed',
                  effectReceipts: [
                    conflicting,
                    { ...conflicting, verificationState: 'verified', recordedAt: 600 },
                  ],
                },
                {
                  id: 'tool-order-history',
                  name: 'mcp__remote__mutate',
                  arguments: '{}',
                  status: 'completed',
                  effectReceipts: [newestFirst, olderSecond],
                },
                {
                  id: 'tool-cross-call',
                  name: 'mcp__remote__mutate',
                  arguments: '{}',
                  status: 'completed',
                  effectReceipts: [
                    makePersistedEffectReceipt({
                      receiptId: `ter_${'2'.repeat(32)}`,
                      toolCallId: 'different-tool-call',
                      toolName: 'mcp__remote__mutate',
                      effectKind: 'remote.mutate',
                    }),
                  ],
                },
                {
                  id: 'tool-cross-name',
                  name: 'mcp__remote__mutate',
                  arguments: '{}',
                  status: 'completed',
                  effectReceipts: [
                    makePersistedEffectReceipt({
                      receiptId: `ter_${'3'.repeat(32)}`,
                      toolCallId: 'tool-cross-name',
                      toolName: 'mcp__other__mutate',
                      effectKind: 'remote.mutate',
                    }),
                  ],
                },
                {
                  id: 'tool-missing-receipt',
                  name: 'mcp__remote__mutate',
                  arguments: '{}',
                  status: 'completed',
                },
              ],
            }),
          ],
        }),
      ],
      activeConversationId: 'conv-1',
    };
    const restarted = normalizePersistedChatState(
      JSON.parse(JSON.stringify(rawPersistedState)) as typeof rawPersistedState,
    );
    const toolCalls = restarted.conversations[0].messages[0].toolCalls;

    expect(toolCalls).toHaveLength(6);
    for (const toolCall of toolCalls ?? []) {
      expect(toolCall.effectReceipts).toBeUndefined();
    }
  });
});
