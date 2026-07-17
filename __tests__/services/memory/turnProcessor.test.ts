const mockExtractStructuralMemory = jest.fn();
const mockExtractProviderEnrichment = jest.fn();
const mockApplyConsolidatorResult = jest.fn();
const mockGetConsolidationState = jest.fn();
const mockUpsertState = jest.fn();
const mockEnsureFactSchema = jest.fn();
const mockFindEntityByName = jest.fn();
const mockListFacts = jest.fn();
const mockHasSameSourceExplicitMemoryAuthority = jest.fn();

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

jest.mock('../../../src/services/memory/policy', () => ({
  canWriteLongTermMemory: jest.fn(() => true),
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

jest.mock('../../../src/services/memory/sameSourceFactAuthority', () => ({
  hasSameSourceExplicitMemoryAuthority: (...args: any[]) =>
    mockHasSameSourceExplicitMemoryAuthority(...args),
}));

import {
  processIngestionTurn,
  validateMemoryTurnPublication,
} from '../../../src/services/memory/turnProcessor';
import type { Message } from '../../../src/types/message';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const CODE_OWNED_NORMAL_SENSITIVITY = {
  version: 1,
  source: 'code_owned',
  sensitivity: 'normal',
} as const;

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  } as Message;
}

function providerProposal(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    subjectRef: { kind: 'self' },
    predicate: 'preference',
    value: 'value',
    scope: 'conversation',
    importance: 0.7,
    confidence: 0.9,
    sourceMessageId: 'user-current',
    operation: 'record',
    assertionClass: 'current_direct',
    evidenceQuote: 'value',
    sensitivity: 'normal',
    ...overrides,
  };
}

describe('validateMemoryTurnPublication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ disableLongTermMemory: false } as never);
    mockEnsureFactSchema.mockImplementation(() => undefined);
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'tool-only turn',
      facts: [],
    });
  });

  it('rejects a tool handoff until a final assistant response closes the turn', () => {
    const result = validateMemoryTurnPublication({
      threadId: 'conv-tool-only',
      messages: [
        makeMsg({ role: 'user', content: 'plan-weekend-trip-42' }),
        makeMsg({
          id: 'assistant-tool-only-sync',
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'calendar_list', arguments: '{}' }],
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      sourceEndMessageId: 'assistant-tool-only-sync',
      threadTitle: 'weekend-planning-thread',
    });

    expect(result.processed).toBe(false);
    expect(result.skipped).toBe('no_closed_turn');
    expect(mockExtractStructuralMemory).not.toHaveBeenCalled();
  });
});

describe('processIngestionTurn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ disableLongTermMemory: false } as never);
    mockEnsureFactSchema.mockImplementation(() => undefined);
    mockFindEntityByName.mockReturnValue(null);
    mockListFacts.mockReturnValue([]);
    mockHasSameSourceExplicitMemoryAuthority.mockReturnValue(false);
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'User asked about API',
      facts: [],
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
    const result = await processIngestionTurn({
      threadId: 'conv-1',
      messages: [],
      sourceEndMessageId: 'missing-final',
    });
    expect(result.processed).toBe(false);
    expect(result.skipped).toBe('source_identity_invalid');
  });

  it('returns processed=false when the only assistant message is a placeholder', async () => {
    const messages: Message[] = [
      makeMsg({ role: 'user', content: 'Hello' }),
      makeMsg({
        id: 'assistant-placeholder',
        role: 'assistant',
        content: '',
        assistantMetadata: {
          finishReason: 'yielded',
          kind: 'intermediate',
          completionStatus: 'streaming',
        },
      }),
    ];
    const result = await processIngestionTurn({
      threadId: 'conv-1',
      messages,
      sourceEndMessageId: 'assistant-placeholder',
    });
    expect(result.processed).toBe(false);
    expect(result.skipped).toBe('no_closed_turn');
  });

  it('rejects an exact closed turn followed by a later assistant', async () => {
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
    const result = await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-1',
      messages,
      sourceEndMessageId: closedAssistant.id,
    });
    expect(result).toMatchObject({ processed: false, skipped: 'source_identity_invalid' });
    expect(mockExtractStructuralMemory).not.toHaveBeenCalled();
  });

  it('calls structural extraction with the turn input', async () => {
    const user = makeMsg({ role: 'user', content: 'Deploy' });
    const assistant = makeMsg({
      role: 'assistant',
      content: 'Deployed.',
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });
    await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-1',
      messages: [user, assistant],
      sourceEndMessageId: assistant.id,
      sourceRunId: 'run-structural',
    });

    expect(mockExtractStructuralMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'Deploy',
        assistantMessage: 'Deployed.',
        sourceUserMessageId: user.id,
        sourceAssistantMessageId: assistant.id,
      }),
    );
  });

  it('persists the structural result when no provider is given', async () => {
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'Deploy turn',
      facts: [
        {
          subject: 'system',
          predicate: 'deployed',
          value: 'yes',
          sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        },
      ],
    });
    mockApplyConsolidatorResult.mockReturnValue({
      recordedFacts: [{ inputIndex: 0, factId: 'f1' }],
      resolvedFacts: [{ inputIndex: 0, factId: 'f1' }],
      invalidatedFactIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      episodeId: 'ep1',
    });

    const result = await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Deploy' }),
        makeMsg({
          id: 'assistant-persisted',
          role: 'assistant',
          content: 'Done',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      sourceEndMessageId: 'assistant-persisted',
      sourceRunId: 'run-persisted',
    });

    expect(result.processed).toBe(true);
    expect(result.episodeId).toBe('ep1');
    expect(result.deterministicFactIds).toEqual(['f1']);
    expect(result.enriched).toBe(false);
    expect(result.activeFocusUpdated).toBe(false);
    expect(result.openThreadsUpdated).toBe(false);
    expect(mockApplyConsolidatorResult).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeSummary: 'Deploy turn',
        episodeSensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        newFacts: [
          {
            subject: 'system',
            predicate: 'deployed',
            value: 'yes',
            sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
          },
        ],
        activeFocus: null,
        openThreads: [],
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
      facts: [
        {
          subject: 'user',
          predicate: 'name',
          value: 'Mo',
          sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        },
      ],
    });
    mockExtractProviderEnrichment.mockResolvedValue({
      status: 'provider_error',
      code: 'provider_request_failed',
    });

    const result = await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Hey' }),
        makeMsg({
          id: 'assistant-provider-failure',
          role: 'assistant',
          content: 'Hi',
          assistantMetadata: {
            finishReason: 'stop',
            kind: 'final',
            completionStatus: 'complete',
          },
        }),
      ],
      sourceEndMessageId: 'assistant-provider-failure',
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

  it('keeps structural memory and skips provider finalization when enrichment is preempted', async () => {
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'Structural before preemption',
      facts: [
        {
          subject: 'user',
          predicate: 'name',
          value: 'Mo',
          sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        },
      ],
    });
    const controller = new AbortController();
    mockExtractProviderEnrichment.mockImplementationOnce(async () => {
      controller.abort();
      return { status: 'provider_error', code: 'provider_request_failed' };
    });

    const result = await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-preempted',
      messages: [
        makeMsg({ role: 'user', content: 'Hey' }),
        makeMsg({
          id: 'assistant-preempted',
          role: 'assistant',
          content: 'Hi',
          assistantMetadata: {
            finishReason: 'stop',
            kind: 'final',
            completionStatus: 'complete',
          },
        }),
      ],
      sourceEndMessageId: 'assistant-preempted',
      extractor: jest.fn(),
      providerSignal: controller.signal,
    });

    expect(result).toEqual(
      expect.objectContaining({ processed: false, skipped: 'provider_preempted' }),
    );
    expect(mockApplyConsolidatorResult).toHaveBeenCalledWith(
      expect.objectContaining({ episodeSummary: 'Structural before preemption' }),
      expect.any(Object),
    );
    expect(mockUpsertState).not.toHaveBeenCalled();
  });

  it('rejects provider facts that are absent from the exact user evidence', async () => {
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'S',
      facts: [
        {
          subject: 'user',
          predicate: 'name',
          value: 'Mo',
          sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        },
      ],
    });
    mockExtractProviderEnrichment.mockResolvedValue({
      status: 'valid',
      result: {
        episodeSummary: 'P',
        episodeSensitivity: 'normal',
        newFacts: [
          providerProposal({ predicate: 'name', value: 'Mo', evidenceQuote: 'Mo' }),
          providerProposal({ predicate: 'age', value: '30', evidenceQuote: '30' }),
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
    });

    await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-1',
      messages: [
        makeMsg({ id: 'user-current', role: 'user', content: 'Hey' }),
        makeMsg({
          id: 'assistant-evidence-absent',
          role: 'assistant',
          content: 'Hi',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      sourceEndMessageId: 'assistant-evidence-absent',
      extractor: jest.fn(),
    });

    const persisted = mockApplyConsolidatorResult.mock.calls[1][0];
    expect(persisted.newFacts).toEqual([]);
  });

  it('preserves structural subject/predicate facts over provider variants in the same turn', async () => {
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'S',
      facts: [
        {
          subject: 'knowu-user',
          predicate: 'preferred_message_contact',
          value: 'Avery',
          sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
        },
      ],
    });
    mockExtractProviderEnrichment.mockResolvedValue({
      status: 'valid',
      result: {
        episodeSummary: 'P',
        episodeSensitivity: 'normal',
        newFacts: [
          {
            ...providerProposal(),
            subjectRef: { kind: 'named', label: 'knowu-user' },
            predicate: 'preferred_message_contact',
            value: 'e2e-contact-avery',
            evidenceQuote: 'knowu-user e2e-contact-avery',
          },
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
    });

    await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-1',
      messages: [
        makeMsg({
          id: 'user-current',
          role: 'user',
          content: 'Remember knowu-user e2e-contact-avery as a structured preference.',
        }),
        makeMsg({
          id: 'assistant-structural-precedence',
          role: 'assistant',
          content: 'Done',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      sourceEndMessageId: 'assistant-structural-precedence',
      extractor: jest.fn(),
    });

    const persisted = mockApplyConsolidatorResult.mock.calls[0][0];
    expect(persisted.newFacts).toEqual([
      {
        subject: 'knowu-user',
        predicate: 'preferred_message_contact',
        value: 'Avery',
        sensitivityDeclaration: CODE_OWNED_NORMAL_SENSITIVITY,
      },
    ]);
  });

  it('does not let provider enrichment supersede or invent facts without user evidence', async () => {
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
    });
    mockExtractProviderEnrichment.mockResolvedValue({
      status: 'valid',
      result: {
        episodeSummary: 'P',
        episodeSensitivity: 'normal',
        newFacts: [
          {
            ...providerProposal(),
            subjectRef: { kind: 'named', label: 'direct-longmem-user' },
            predicate: 'preferred_message_contact',
            value: 'Avery from the action request',
            evidenceQuote: 'direct-longmem-user Avery from the action request',
          },
          providerProposal({
            subjectRef: { kind: 'named', label: 'direct-longmem-user' },
            predicate: 'last_sms_message',
            value: 'drafted',
            evidenceQuote: 'direct-longmem-user drafted',
          }),
        ],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
    });

    await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-1',
      messages: [
        makeMsg({
          id: 'user-current',
          role: 'user',
          content: 'Use the current preference to complete the task.',
        }),
        makeMsg({
          id: 'assistant-no-provider-invention',
          role: 'assistant',
          content: 'Done',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      sourceEndMessageId: 'assistant-no-provider-invention',
      extractor: jest.fn(),
    });

    const persisted = mockApplyConsolidatorResult.mock.calls[1][0];
    expect(persisted.newFacts).toEqual([]);
    expect(mockListFacts).not.toHaveBeenCalled();
  });

  it('updates the consolidation cursor after processing', async () => {
    const assistant = makeMsg({
      role: 'assistant',
      content: 'Done',
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });
    await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-1',
      messages: [makeMsg({ role: 'user', content: 'Hey' }), assistant],
      sourceEndMessageId: assistant.id,
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
        episodeAccess: { personaId: 'default', shareability: 'thread_only' },
        threadId: 'conv-1',
        messages: [
          makeMsg({ role: 'user', content: 'Hey' }),
          makeMsg({
            id: 'assistant-cursor-failure',
            role: 'assistant',
            content: 'Hi',
            assistantMetadata: {
              finishReason: 'stop',
              kind: 'final',
              completionStatus: 'complete',
            },
          }),
        ],
        sourceEndMessageId: 'assistant-cursor-failure',
      }),
    ).rejects.toThrow('Cursor write failed');
  });

  it('passes threadTitle and personaSummary through to extraction', async () => {
    await processIngestionTurn({
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Hey' }),
        makeMsg({
          id: 'assistant-extraction-context',
          role: 'assistant',
          content: 'Hi',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      sourceEndMessageId: 'assistant-extraction-context',
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
      episodeAccess: { personaId: 'default', shareability: 'thread_only' },
      threadId: 'conv-1',
      messages: [
        makeMsg({ role: 'user', content: 'Hey' }),
        makeMsg({
          id: 'assistant-custom-now',
          role: 'assistant',
          content: 'Hi',
          assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
        }),
      ],
      sourceEndMessageId: 'assistant-custom-now',
      now,
    });

    expect(mockApplyConsolidatorResult).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ now }),
    );
    expect(mockUpsertState).toHaveBeenCalledWith(expect.objectContaining({ now }));
  });
});
