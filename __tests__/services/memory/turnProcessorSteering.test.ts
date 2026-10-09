const mockExtractStructuralMemory = jest.fn();
const mockExtractProviderEnrichment = jest.fn();
const mockApplyConsolidatorResult = jest.fn();
const mockHasSameSourceExplicitMemoryAuthority = jest.fn();

jest.mock('../../../src/services/memory/deterministicExtractor', () => ({
  extractStructuralMemory: (...args: unknown[]) => mockExtractStructuralMemory(...args),
}));

jest.mock('../../../src/services/memory/providerExtractor', () => ({
  extractProviderEnrichment: (...args: unknown[]) => mockExtractProviderEnrichment(...args),
}));

jest.mock('../../../src/services/memory/consolidator', () => ({
  applyConsolidatorResult: (...args: unknown[]) => mockApplyConsolidatorResult(...args),
}));

jest.mock('../../../src/services/memory/access/transaction', () => ({
  runMemoryTransaction: (callback: () => unknown) => callback(),
}));

jest.mock('../../../src/services/memory/consolidation/schedulerState', () => ({
  getConsolidationState: () => null,
  upsertState: () => undefined,
}));

jest.mock('../../../src/services/memory/schema', () => ({
  ensureFactSchema: () => undefined,
}));

jest.mock('../../../src/services/memory/policy', () => ({
  canWriteLongTermMemory: jest.fn(() => true),
}));

jest.mock('../../../src/services/memory/entities', () => ({
  findEntityByName: () => null,
}));

jest.mock('../../../src/services/memory/facts/queries', () => ({
  hasCurrentFactForSubjectPredicate: () => false,
}));

jest.mock('../../../src/services/memory/facts/exactReplacementQueries', () => ({
  listCurrentFactsForReplacement: () => [],
}));

jest.mock('../../../src/services/memory/sameSourceFactAuthority', () => ({
  hasSameSourceExplicitMemoryAuthority: (...args: unknown[]) =>
    mockHasSameSourceExplicitMemoryAuthority(...args),
}));

import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import type { Message } from '../../../src/types/message';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

// A user who adds a fact while the assistant is still working ("steering") said it as
// plainly as in the request; the provider fact quoting that message must be admitted.

const FINAL = { kind: 'final', completionStatus: 'complete', finishReason: 'stop' } as const;

const MESSAGES: Message[] = [
  { id: 'request', role: 'user', content: 'Plan a dinner for my team.', timestamp: 1 },
  {
    id: 'steer',
    role: 'user',
    content: 'My sister Amira is vegetarian.',
    timestamp: 2,
    steerOfRunId: 'run-1',
  },
  {
    id: 'final',
    role: 'assistant',
    content: 'Here is the plan.',
    timestamp: 3,
    assistantMetadata: FINAL,
  },
];

function proposal(sourceMessageId: string, quote: string, value: string) {
  return {
    version: 1,
    subjectRef: { kind: 'named', label: 'Amira' },
    predicate: 'diet',
    value,
    scope: 'global',
    importance: 0.7,
    confidence: 0.9,
    sourceMessageId,
    operation: 'record',
    assertionClass: 'current_direct',
    evidenceQuote: quote,
    sensitivity: 'personal',
  };
}

async function ingest(proposals: ReturnType<typeof proposal>[]) {
  mockExtractProviderEnrichment.mockResolvedValue({
    status: 'valid',
    result: {
      episodeSummary: 'Dinner planning',
      episodeSensitivity: 'personal',
      newFacts: proposals,
      activeFocus: null,
      openThreads: [],
      notable: [],
    },
  });
  await processIngestionTurn({
    episodeAccess: { personaId: 'default', shareability: 'thread_only' },
    threadId: 'conv-1',
    messages: MESSAGES,
    sourceEndMessageId: 'final',
    extractor: jest.fn(),
  });
  // Call 0 persists the structural checkpoint; call 1 the provider's facts.
  return mockApplyConsolidatorResult.mock.calls[1]?.[0]?.newFacts;
}

beforeEach(() => {
  jest.clearAllMocks();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  mockExtractStructuralMemory.mockReturnValue({ episodeSummary: 'S', facts: [] });
  mockHasSameSourceExplicitMemoryAuthority.mockReturnValue(false);
  mockApplyConsolidatorResult.mockReturnValue({
    recordedFacts: [],
    resolvedFacts: [],
    invalidatedFactIds: [],
    activeFocusUpdated: false,
    openThreadsUpdated: false,
    episodeId: null,
  });
});

describe('provider facts from a steered turn', () => {
  it('admits a fact quoted from the steer, with the steer as its evidence', async () => {
    const facts = await ingest([proposal('steer', 'My sister Amira is vegetarian.', 'vegetarian')]);

    expect(facts).toEqual([
      expect.objectContaining({
        subject: 'Amira',
        value: 'vegetarian',
        evidenceMessageIds: ['steer'],
        admittedWrite: expect.objectContaining({ evidenceMessageId: 'steer' }),
      }),
    ]);
  });

  it('still rejects a quote the cited message does not contain', async () => {
    const facts = await ingest([
      proposal('request', 'My sister Amira is vegetarian.', 'vegetarian'),
    ]);

    expect(facts).toEqual([]);
  });

  it('leaves a steer to its explicit memory write, but not the request', async () => {
    mockHasSameSourceExplicitMemoryAuthority.mockImplementation(
      ({ sourceMessageId }: { sourceMessageId: string }) => sourceMessageId === 'steer',
    );
    const facts = await ingest([
      proposal('steer', 'My sister Amira is vegetarian.', 'vegetarian'),
      { ...proposal('request', 'my team', 'my team'), subjectRef: { kind: 'self' } },
    ]);

    expect(facts).toEqual([expect.objectContaining({ evidenceMessageIds: ['request'] })]);
  });
});
