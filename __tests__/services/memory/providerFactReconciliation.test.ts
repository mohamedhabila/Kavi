const mockResolveCurrentFactsForReplacement = jest.fn();

jest.mock('../../../src/services/memory/facts/currentReplacementResolution', () => ({
  resolveCurrentFactsForReplacement: (...args: unknown[]) =>
    mockResolveCurrentFactsForReplacement(...args),
}));

import type { ProviderConsolidatorResult } from '../../../src/services/memory/consolidator';
import { mergeProviderIntoStructural } from '../../../src/services/memory/providerFactReconciliation';
import type { SemanticFactProposalV1 } from '../../../src/services/memory/semanticFactProposal';

const EMPTY_PROVIDER_RESULT: Omit<ProviderConsolidatorResult, 'newFacts'> = {
  episodeSummary: null,
  activeFocus: null,
  openThreads: [],
  notable: [],
};

function proposal(overrides: Partial<SemanticFactProposalV1> = {}): SemanticFactProposalV1 {
  return {
    version: 1,
    subjectRef: { kind: 'self' },
    predicate: 'preferred_city',
    value: 'Rotterdam',
    scope: 'global',
    importance: 0.8,
    confidence: 0.95,
    sourceMessageId: 'user-current',
    operation: 'record',
    assertionClass: 'current_direct',
    evidenceQuote: 'My city is Rotterdam',
    sensitivity: 'personal',
    ...overrides,
  };
}

function merge(currentUserMessage: string, proposals: SemanticFactProposalV1[]) {
  return mergeProviderIntoStructural(
    { episodeSummary: 'structural', facts: [] },
    { ...EMPTY_PROVIDER_RESULT, newFacts: proposals },
    {
      currentUserMessageId: 'user-current',
      currentUserMessage,
      memoryConversationId: 'conversation-current',
      threadId: 'thread-current',
    },
  );
}

beforeEach(() => {
  mockResolveCurrentFactsForReplacement.mockReset();
  mockResolveCurrentFactsForReplacement.mockReturnValue({
    currentFacts: [],
    hasAnyCurrentFact: false,
  });
});

describe('passive provider fact reconciliation', () => {
  it.each([
    {
      label: 'Arabic',
      message: 'مدينتي الحالية هي عمّان',
      value: 'عمّان',
      quote: 'مدينتي الحالية هي عمّان',
    },
    {
      label: 'CJK',
      message: '我的常住城市是京都',
      value: '京都',
      quote: '我的常住城市是京都',
    },
    {
      label: 'Devanagari',
      message: 'मेरा वर्तमान शहर पुणे है',
      value: 'पुणे',
      quote: 'मेरा वर्तमान शहर पुणे है',
    },
    {
      label: 'Latin',
      message: 'Mi ciudad actual es Bogotá',
      value: 'Bogotá',
      quote: 'Mi ciudad actual es Bogotá',
    },
    {
      label: 'code switch',
      message: 'مدينتي الحالية is Rotterdam',
      value: 'Rotterdam',
      quote: 'مدينتي الحالية is Rotterdam',
    },
  ])('admits an exact current-user record in $label script', ({ message, value, quote }) => {
    const result = merge(message, [proposal({ value, evidenceQuote: quote })]);

    expect(result.newFacts).toEqual([
      expect.objectContaining({
        subject: 'user',
        predicate: 'preferred_city',
        value,
        operation: 'insert',
        proposedSensitivity: 'personal',
        evidenceMessageIds: ['user-current'],
        admittedWrite: {
          operation: 'insert',
          authority: 'grounded_user_statement',
          evidenceMessageId: 'user-current',
        },
      }),
    ]);
  });

  it('keeps case- and normalization-distinct opaque values separate', () => {
    const composed = 'TOKEN-é';
    const decomposed = 'TOKEN-e\u0301';
    const message = `${composed} ${decomposed} Token-É`;
    const result = merge(message, [
      proposal({ value: composed, evidenceQuote: composed }),
      proposal({ value: decomposed, evidenceQuote: decomposed }),
      proposal({ value: 'Token-É', evidenceQuote: 'Token-É' }),
    ]);

    expect(result.newFacts.map((fact) => fact.value)).toEqual([composed, decomposed, 'Token-É']);
  });

  it('admits a named subject only when the exact label is in the quote', () => {
    const result = merge('小林の常住都市は京都です', [
      proposal({
        subjectRef: { kind: 'named', label: '小林' },
        value: '京都',
        evidenceQuote: '小林の常住都市は京都です',
      }),
    ]);

    expect(result.newFacts[0]).toEqual(expect.objectContaining({ subject: '小林', value: '京都' }));
  });

  it.each([
    ['quoted', 'quoted'],
    ['hypothetical', 'hypothetical'],
    ['uncertain', 'uncertain'],
    ['third-party', 'third_party'],
  ] as const)('rejects %s semantics even with exact text evidence', (_label, assertionClass) => {
    expect(merge('My city is Rotterdam', [proposal({ assertionClass })]).newFacts).toEqual([]);
  });

  it.each([
    ['wrong source', proposal({ sourceMessageId: 'user-other' })],
    ['assistant-only claim', proposal({ evidenceQuote: 'Assistant says Rotterdam' })],
    ['tool-only claim', proposal({ evidenceQuote: 'tool_result=Rotterdam' })],
    ['value outside quote', proposal({ evidenceQuote: 'My city changed' })],
    ['named label outside quote', proposal({ subjectRef: { kind: 'named', label: 'Amina' } })],
  ])('rejects %s evidence', (_label, candidate) => {
    expect(merge('My city is Rotterdam', [candidate]).newFacts).toEqual([]);
  });

  it('binds an exact replacement target in code', () => {
    mockResolveCurrentFactsForReplacement.mockReturnValue({
      hasAnyCurrentFact: true,
      currentFacts: [
        {
          id: 'fact-current',
          scope: 'global',
          personaId: null,
          originConversationId: null,
          originThreadId: null,
          originTaskId: null,
        },
      ],
    });

    const result = merge('My city is now Rotterdam', [
      proposal({ operation: 'replace_current', evidenceQuote: 'My city is now Rotterdam' }),
    ]);

    expect(result.newFacts[0]).toEqual(
      expect.objectContaining({
        operation: 'replace_current',
        admittedWrite: {
          operation: 'replace_current',
          authority: 'grounded_user_statement',
          evidenceMessageId: 'user-current',
          expectedCurrentFactId: 'fact-current',
        },
      }),
    );
  });

  it('rejects replacement unless exactly one compatible current fact exists', () => {
    mockResolveCurrentFactsForReplacement.mockReturnValue({
      hasAnyCurrentFact: true,
      currentFacts: [],
    });
    expect(
      merge('My city is now Rotterdam', [
        proposal({ operation: 'replace_current', evidenceQuote: 'My city is now Rotterdam' }),
      ]).newFacts,
    ).toEqual([]);

    mockResolveCurrentFactsForReplacement.mockReturnValue({
      hasAnyCurrentFact: true,
      currentFacts: [
        {
          id: 'fact-a',
          scope: 'global',
          personaId: null,
          originConversationId: null,
          originThreadId: null,
          originTaskId: null,
        },
        {
          id: 'fact-b',
          scope: 'global',
          personaId: null,
          originConversationId: null,
          originThreadId: null,
          originTaskId: null,
        },
      ],
    });
    expect(
      merge('My city is now Rotterdam', [
        proposal({ operation: 'replace_current', evidenceQuote: 'My city is now Rotterdam' }),
      ]).newFacts,
    ).toEqual([]);
  });

  it('rejects competing replacement proposals as an ambiguous group', () => {
    mockResolveCurrentFactsForReplacement.mockReturnValue({
      hasAnyCurrentFact: true,
      currentFacts: [
        {
          id: 'fact-current',
          scope: 'global',
          personaId: null,
          originConversationId: null,
          originThreadId: null,
          originTaskId: null,
        },
      ],
    });

    const message = 'My city is either Rotterdam or Utrecht';
    const result = merge(message, [
      proposal({
        value: 'Rotterdam',
        operation: 'replace_current',
        evidenceQuote: message,
      }),
      proposal({ value: 'Utrecht', operation: 'replace_current', evidenceQuote: message }),
    ]);

    expect(result.newFacts).toEqual([]);
  });

  it('preserves structural tool-observed facts while rejecting provider semantics', () => {
    const structuralFact = {
      subject: 'device',
      predicate: 'tool_result',
      value: 'completed',
      sealedApplicability: {
        factClass: 'workflow' as const,
        sourceAuthority: 'tool_observed' as const,
      },
    };
    const result = mergeProviderIntoStructural(
      { episodeSummary: 'tool completed', facts: [structuralFact] },
      { ...EMPTY_PROVIDER_RESULT, newFacts: [proposal({ assertionClass: 'quoted' })] },
      {
        currentUserMessageId: 'user-current',
        currentUserMessage: 'My city is Rotterdam',
        memoryConversationId: 'conversation-current',
        threadId: 'thread-current',
      },
    );

    expect(result.newFacts).toEqual([structuralFact]);
  });
});
