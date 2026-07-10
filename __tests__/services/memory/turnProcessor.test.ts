// ---------------------------------------------------------------------------
// Tests — Turn Processor (Always-On Ingestion)
// ---------------------------------------------------------------------------
// The single entry point for memory creation after every completed turn.
// Tests verify: turn detection, structural extraction, optional provider
// enrichment, persistence, and cursor update — all without English heuristics.
// ---------------------------------------------------------------------------

const mockExtractStructuralMemory = jest.fn();
const mockExtractProviderEnrichment = jest.fn();
const mockApplyConsolidatorResult = jest.fn();
const mockGetConsolidationState = jest.fn();
const mockUpsertState = jest.fn();
const mockEnsureFactSchema = jest.fn();
const mockFindEntityByName = jest.fn();
const mockListFacts = jest.fn();

jest.mock('../../../src/services/memory/deterministicExtractor', () => ({
  extractStructuralMemory: (...args: any[]) => mockExtractStructuralMemory(...args),
}));

jest.mock('../../../src/services/memory/providerExtractor', () => ({
  extractProviderEnrichment: (...args: any[]) => mockExtractProviderEnrichment(...args),
}));

jest.mock('../../../src/services/memory/consolidator', () => ({
  applyConsolidatorResult: (...args: any[]) => mockApplyConsolidatorResult(...args),
}));

jest.mock('../../../src/services/memory/access/transaction', () => ({
  runMemoryTransaction: (callback: () => unknown) => callback(),
}));

jest.mock('../../../src/services/memory/consolidation/schedulerState', () => ({
  getConsolidationState: (...args: any[]) => mockGetConsolidationState(...args),
  upsertState: (...args: any[]) => mockUpsertState(...args),
}));

jest.mock('../../../src/services/memory/schema', () => ({
  ensureFactSchema: (...args: any[]) => mockEnsureFactSchema(...args),
}));

jest.mock('../../../src/services/memory/entities', () => ({
  findEntityByName: (...args: any[]) => mockFindEntityByName(...args),
}));

jest.mock('../../../src/services/memory/facts/queries', () => ({
  hasCurrentFactForSubjectPredicate: () => false,
}));

jest.mock('../../../src/services/memory/facts/exactReplacementQueries', () => ({
  listCurrentFactsForReplacement: (...args: any[]) => mockListFacts(...args),
}));

import {
  findLastClosedTurn,
  normalizeTerminalClosedTurnMessages,
  processIngestionTurn,
  syncWorkingMemoryFromTurn,
} from '../../../src/services/memory/turnProcessor';
import type { Message } from '../../../src/types/message';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  } as Message;
}

describe('findLastClosedTurn', () => {
  it('closes tool-only terminal assistants with final metadata', () => {
    const user = makeMsg({ role: 'user', content: 'List calendars' });
    const assistant = makeMsg({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'calendar_list', arguments: '{}' }],
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });
    const closed = findLastClosedTurn([user, assistant]);
    expect(closed.user?.id).toBe(user.id);
    expect(closed.assistant?.id).toBe(assistant.id);
  });

  it('promotes tool-only assistants in the latest user slice before closure', () => {
    const user = makeMsg({ role: 'user', content: 'Run tools only' });
    const assistant = makeMsg({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'calendar_list', arguments: '{}' }],
      assistantMetadata: {
        finishReason: 'stop',
        kind: 'intermediate',
        completionStatus: 'complete',
      },
    });
    const closed = findLastClosedTurn([user, assistant]);
    expect(closed.assistant?.assistantMetadata).toMatchObject({
      kind: 'final',
      completionStatus: 'complete',
    });
  });

  it('closes empty final assistants with terminal metadata', () => {
    const user = makeMsg({ role: 'user', content: 'weekend-planning-thread' });
    const assistant = makeMsg({
      role: 'assistant',
      content: '',
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });
    const closed = findLastClosedTurn([user, assistant]);
    expect(closed.user?.id).toBe(user.id);
    expect(closed.assistant?.id).toBe(assistant.id);
  });

  it('skips intermediate tool batches that are not terminal', () => {
    const user = makeMsg({ role: 'user', content: 'Hello' });
    const messages: Message[] = [
      user,
      makeMsg({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'tool_catalog', arguments: '{}' }],
        assistantMetadata: {
          finishReason: 'stop',
          kind: 'intermediate',
          completionStatus: 'complete',
        },
      }),
      makeMsg({ role: 'tool', content: 'ok', toolCallId: 'tc-1' }),
      makeMsg({
        role: 'assistant',
        content: 'Done.',
        assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
      }),
    ];
    const closed = findLastClosedTurn(messages);
    expect(closed.assistant?.content).toBe('Done.');
  });
});

describe('syncWorkingMemoryFromTurn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ disableLongTermMemory: false } as never);
    mockEnsureFactSchema.mockImplementation(() => undefined);
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'tool-only turn',
      facts: [],
      activeFocus: 'calendar planning',
      openThreads: [],
    });
  });

  it('returns processed=true for tool-only closed turns', () => {
    const result = syncWorkingMemoryFromTurn({
      threadId: 'conv-tool-only',
      messages: [
        makeMsg({ role: 'user', content: 'plan-weekend-trip-42' }),
        makeMsg({
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'calendar_list', arguments: '{}' }],
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      threadTitle: 'weekend-planning-thread',
    });

    expect(result.processed).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(mockExtractStructuralMemory).toHaveBeenCalled();
  });
});

describe('normalizeTerminalClosedTurnMessages', () => {
  it('does not mutate messages when the latest assistant already has text', () => {
    const messages = [
      makeMsg({ role: 'user', content: 'Hi' }),
      makeMsg({ role: 'assistant', content: 'Hello' }),
    ];
    expect(normalizeTerminalClosedTurnMessages(messages)).toBe(messages);
  });

  it('promotes empty no-tool assistants in the latest user turn slice', () => {
    const user = makeMsg({ role: 'user', content: 'plan-weekend-trip-42' });
    const assistant = makeMsg({ role: 'assistant', content: '' });
    const normalized = normalizeTerminalClosedTurnMessages([user, assistant]);
    expect(normalized).not.toBe([user, assistant]);
    expect(normalized[1]?.assistantMetadata).toMatchObject({
      kind: 'final',
      completionStatus: 'complete',
    });
    expect(findLastClosedTurn(normalized).assistant?.id).toBe(assistant.id);
  });
});

describe('processIngestionTurn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ disableLongTermMemory: false } as never);
    mockEnsureFactSchema.mockImplementation(() => undefined);
    mockFindEntityByName.mockReturnValue(null);
    mockListFacts.mockReturnValue([]);
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'User asked about API',
      facts: [],
      activeFocus: null,
      openThreads: [],
    });
    mockApplyConsolidatorResult.mockReturnValue({
      recordedFacts: [],
      resolvedFacts: [],
      invalidatedFactIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      episodeId: null,
    });
    mockUpsertState.mockImplementation(() => undefined);
    mockGetConsolidationState.mockReturnValue({
      threadId: 'conv-1',
      lastConsolidatedMessageId: null,
      lastConsolidatedAt: 0,
      turnsSinceLast: 0,
    });
  });

  it('returns processed=false when there are no messages', async () => {
    const result = await processIngestionTurn({ threadId: 'conv-1', messages: [] });
    expect(result.processed).toBe(false);
    expect(result.skipped).toBe('no_closed_turn');
  });

  it('returns processed=false when the only assistant message is a placeholder', async () => {
    const messages: Message[] = [
      makeMsg({ role: 'user', content: 'Hello' }),
      makeMsg({
        role: 'assistant',
        content: '',
        assistantMetadata: {
          finishReason: 'yielded',
          kind: 'intermediate',
          completionStatus: 'streaming',
        },
      }),
    ];
    const result = await processIngestionTurn({ threadId: 'conv-1', messages });
    expect(result.processed).toBe(false);
    expect(result.skipped).toBe('no_closed_turn');
  });

  it('skips intermediate placeholders and finds the last closed turn', async () => {
    const closedAssistant = makeMsg({
      role: 'assistant',
      content: 'All done.',
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });
    const messages: Message[] = [
      makeMsg({ role: 'user', content: 'Do it' }),
      closedAssistant,
      makeMsg({
        role: 'assistant',
        content: '',
        assistantMetadata: {
          finishReason: 'yielded',
          kind: 'intermediate',
          completionStatus: 'streaming',
        },
      }),
    ];
    await processIngestionTurn({ threadId: 'conv-1', messages });
    expect(mockExtractStructuralMemory).toHaveBeenCalled();
  });

  it('calls structural extraction with the turn input', async () => {
    const user = makeMsg({ role: 'user', content: 'Deploy' });
    const assistant = makeMsg({
      role: 'assistant',
      content: 'Deployed.',
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });
    await processIngestionTurn({
      threadId: 'conv-1',
      messages: [user, assistant],
      sourceRunId: 'run-structural',
    });

    expect(mockExtractStructuralMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'Deploy',
        assistantMessage: 'Deployed.',
        conversationId: 'conv-1',
        threadId: 'conv-1',
        sourceRunId: 'run-structural',
        sourceUserMessageId: user.id,
        sourceAssistantMessageId: assistant.id,
      }),
    );
  });

  it('persists the structural result when no provider is given', async () => {
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'Deploy turn',
      facts: [{ subject: 'system', predicate: 'deployed', value: 'yes' }],
      activeFocus: 'Deployment',
      openThreads: ['Verify staging'],
    });
    mockApplyConsolidatorResult.mockReturnValue({
      recordedFacts: [{ inputIndex: 0, factId: 'f1' }],
      resolvedFacts: [{ inputIndex: 0, factId: 'f1' }],
      invalidatedFactIds: [],
      activeFocusUpdated: true,
      openThreadsUpdated: true,
      episodeId: 'ep1',
    });

    const result = await processIngestionTurn({
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Deploy' }),
        makeMsg({
          role: 'assistant',
          content: 'Done',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      sourceRunId: 'run-persisted',
    });

    expect(result.processed).toBe(true);
    expect(result.episodeId).toBe('ep1');
    expect(result.deterministicFactIds).toEqual(['f1']);
    expect(result.enriched).toBe(false);
    expect(result.activeFocusUpdated).toBe(true);
    expect(result.openThreadsUpdated).toBe(true);
    expect(mockApplyConsolidatorResult).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeSummary: 'Deploy turn',
        newFacts: [{ subject: 'system', predicate: 'deployed', value: 'yes' }],
        activeFocus: 'Deployment',
        openThreads: ['Verify staging'],
      }),
      expect.objectContaining({ skipWorkingMemoryWrites: true }),
    );
    expect(mockApplyConsolidatorResult).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ sourceRunId: 'run-persisted' }),
    );
  });

  it('persists structural memory but leaves the cursor retryable on provider failure', async () => {
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'Structural',
      facts: [{ subject: 'user', predicate: 'name', value: 'Mo' }],
      activeFocus: null,
      openThreads: [],
    });
    mockExtractProviderEnrichment.mockResolvedValue({
      status: 'provider_error',
      code: 'provider_request_failed',
    });

    const result = await processIngestionTurn({
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Hey' }),
        makeMsg({
          role: 'assistant',
          content: 'Hi',
          assistantMetadata: {
            finishReason: 'stop',
            kind: 'final',
            completionStatus: 'complete',
          },
        }),
      ],
      extractor: jest.fn(),
    });

    expect(result.providerOutcome).toEqual({
      status: 'provider_error',
      code: 'provider_request_failed',
    });
    expect(mockApplyConsolidatorResult).toHaveBeenCalledWith(
      expect.objectContaining({ episodeSummary: 'Structural' }),
      expect.any(Object),
    );
    expect(mockUpsertState).not.toHaveBeenCalled();
  });

  it('deduplicates provider facts against structural facts by key', async () => {
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'S',
      facts: [{ subject: 'user', predicate: 'name', value: 'Mo' }],
      activeFocus: null,
      openThreads: [],
    });
    mockExtractProviderEnrichment.mockResolvedValue({
      status: 'valid',
      result: {
        episodeSummary: 'P',
        newFacts: [
          { subject: 'user', predicate: 'name', value: 'Mo' }, // duplicate
          { subject: 'user', predicate: 'age', value: '30' },
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
    });

    await processIngestionTurn({
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Hey' }),
        makeMsg({
          role: 'assistant',
          content: 'Hi',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      extractor: jest.fn(),
    });

    const persisted = mockApplyConsolidatorResult.mock.calls[1][0];
    expect(persisted.newFacts).toEqual([{ subject: 'user', predicate: 'age', value: '30' }]);
  });

  it('preserves structural subject/predicate facts over provider variants in the same turn', async () => {
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'S',
      facts: [{ subject: 'knowu-user', predicate: 'preferred_message_contact', value: 'Avery' }],
      activeFocus: null,
      openThreads: [],
    });
    mockExtractProviderEnrichment.mockResolvedValue({
      status: 'valid',
      result: {
        episodeSummary: 'P',
        newFacts: [
          {
            subject: 'knowu-user',
            predicate: 'preferred_message_contact',
            value: 'e2e-contact-avery',
          },
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
    });

    await processIngestionTurn({
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Remember a structured preference.' }),
        makeMsg({
          role: 'assistant',
          content: 'Done',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      extractor: jest.fn(),
    });

    const persisted = mockApplyConsolidatorResult.mock.calls[0][0];
    expect(persisted.newFacts).toEqual([
      { subject: 'knowu-user', predicate: 'preferred_message_contact', value: 'Avery' },
    ]);
  });

  it('does not let provider enrichment supersede existing facts without structural memory evidence', async () => {
    mockFindEntityByName.mockImplementation((name: string) =>
      name === 'direct-longmem-user' ? { id: 'entity-direct-longmem-user' } : null,
    );
    mockListFacts.mockImplementation((options: { predicate?: string }) =>
      options.predicate === 'preferred_message_contact'
        ? [
            {
              id: 'fact-current',
              subjectId: 'entity-direct-longmem-user',
              predicate: 'preferred_message_contact',
              objectText: 'Avery',
              invalidAt: null,
              deletedAt: null,
            },
          ]
        : [],
    );
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'S',
      facts: [],
      activeFocus: null,
      openThreads: [],
    });
    mockExtractProviderEnrichment.mockResolvedValue({
      status: 'valid',
      result: {
        episodeSummary: 'P',
        newFacts: [
          {
            subject: 'direct-longmem-user',
            predicate: 'preferred_message_contact',
            value: 'Avery from the action request',
          },
          { subject: 'direct-longmem-user', predicate: 'last_sms_message', value: 'drafted' },
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
    });

    await processIngestionTurn({
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Use the current preference to complete the task.' }),
        makeMsg({
          role: 'assistant',
          content: 'Done',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      extractor: jest.fn(),
    });

    const persisted = mockApplyConsolidatorResult.mock.calls[1][0];
    expect(persisted.newFacts).toEqual([
      { subject: 'direct-longmem-user', predicate: 'last_sms_message', value: 'drafted' },
    ]);
    expect(mockListFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: 'entity-direct-longmem-user',
        predicate: 'preferred_message_contact',
      }),
    );
  });

  it('updates the consolidation cursor after processing', async () => {
    const assistant = makeMsg({
      role: 'assistant',
      content: 'Done',
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });
    await processIngestionTurn({
      threadId: 'conv-1',
      messages: [makeMsg({ role: 'user', content: 'Hey' }), assistant],
    });

    expect(mockUpsertState).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'conv-1',
        lastConsolidatedMessageId: assistant.id,
        turnsSinceLast: 0,
      }),
    );
  });

  it('does not complete the durable turn when its cursor update fails', async () => {
    mockUpsertState.mockImplementation(() => {
      throw new Error('Cursor write failed');
    });

    await expect(
      processIngestionTurn({
        threadId: 'conv-1',
        messages: [
          makeMsg({ role: 'user', content: 'Hey' }),
          makeMsg({
            role: 'assistant',
            content: 'Hi',
            assistantMetadata: {
              finishReason: 'stop',
              kind: 'final',
              completionStatus: 'complete',
            },
          }),
        ],
      }),
    ).rejects.toThrow('Cursor write failed');
  });

  it('passes threadTitle and personaSummary through to extraction', async () => {
    await processIngestionTurn({
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Hey' }),
        makeMsg({
          role: 'assistant',
          content: 'Hi',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      threadTitle: 'API Work',
      personaSummary: 'You are a coding assistant',
    });

    expect(mockExtractStructuralMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTitle: 'API Work',
        personaSummary: 'You are a coding assistant',
      }),
    );
  });

  it('uses the custom now timestamp when provided', async () => {
    const now = 1_000_000;
    await processIngestionTurn({
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Hey' }),
        makeMsg({
          role: 'assistant',
          content: 'Hi',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      now,
    });

    expect(mockApplyConsolidatorResult).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ now }),
    );
    expect(mockUpsertState).toHaveBeenCalledWith(expect.objectContaining({ now }));
  });
});
