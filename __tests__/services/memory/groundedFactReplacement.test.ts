import type { ConsolidatorFact } from '../../../src/services/memory/consolidator';
import type { MemoryFact } from '../../../src/services/memory/facts/types';
import { evaluateGroundedReplacement } from '../../../src/services/memory/groundedFactReplacement';

function currentFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-current',
    subjectId: 'entity-user',
    predicate: 'lives_in',
    objectText: 'Amsterdam',
    scope: 'global',
    personaId: null,
    originConversationId: null,
    originThreadId: null,
    originTaskId: null,
    invalidAt: null,
    deletedAt: null,
    ...overrides,
  } as MemoryFact;
}

function proposal(overrides: Partial<ConsolidatorFact> = {}): ConsolidatorFact {
  return {
    subject: 'user',
    predicate: 'lives_in',
    value: 'Utrecht',
    scope: 'global',
    operation: 'replace_current',
    assertionClass: 'current_direct',
    evidenceMessageIds: ['user-current'],
    evidenceQuote: 'I moved to Utrecht last week.',
    ...overrides,
  };
}

function decide(
  fact: ConsolidatorFact,
  overrides: Partial<Parameters<typeof evaluateGroundedReplacement>[1]> = {},
) {
  const currentFacts = overrides.currentFacts ?? [currentFact()];
  return evaluateGroundedReplacement(fact, {
    currentUserMessageId: 'user-current',
    currentUserMessage: 'I moved to Utrecht last week.',
    memoryConversationId: 'conversation-1',
    threadId: 'thread-1',
    ...overrides,
    currentFacts,
    hasAnyCurrentFact: overrides.hasAnyCurrentFact ?? currentFacts.length > 0,
  });
}

describe('evaluateGroundedReplacement', () => {
  it.each([
    ['English', 'I moved to Utrecht last week.', 'Utrecht'],
    ['Dutch', 'Noem me voortaan Sam', 'Sam'],
    ['Arabic', 'أفضل التواصل عبر سيجنال الآن', 'سيجنال'],
  ])('admits a grounded direct-current replacement in %s', (_language, message, value) => {
    const decision = decide(proposal({ value, evidenceQuote: message }), {
      currentUserMessage: message,
    });

    expect(decision).toMatchObject({
      accepted: true,
      operation: 'replace_current',
      target: { id: 'fact-current' },
      fact: {
        admittedWrite: {
          operation: 'replace_current',
          authority: 'grounded_user_statement',
          evidenceMessageId: 'user-current',
          expectedCurrentFactId: 'fact-current',
        },
      },
    });
  });

  it('uses Unicode and whitespace normalization without language rules', () => {
    const decision = decide(proposal({ value: 'Café', evidenceQuote: 'Call me  Café' }), {
      currentUserMessage: 'Call me\tCafe\u0301',
    });
    expect(decision.accepted).toBe(true);
  });

  it.each(['historical', 'hypothetical', 'quoted', 'third_party', 'uncertain'] as const)(
    'rejects a %s assertion',
    (assertionClass) => {
      expect(decide(proposal({ assertionClass }))).toEqual({
        accepted: false,
        reason: 'not_current_direct',
      });
    },
  );

  it('rejects an ordinary insert when a current key already exists', () => {
    expect(decide(proposal({ operation: 'insert' }))).toEqual({
      accepted: false,
      reason: 'not_replace_operation',
    });
  });

  it('requires exactly the current user message as evidence', () => {
    expect(decide(proposal({ evidenceMessageIds: ['user-older'] }))).toEqual({
      accepted: false,
      reason: 'wrong_evidence_message',
    });
    expect(decide(proposal({ evidenceMessageIds: ['user-current', 'assistant-current'] }))).toEqual(
      { accepted: false, reason: 'wrong_evidence_message' },
    );
    expect(
      decide(proposal({ evidenceMessageIds: [' user-current '] }), {
        currentUserMessageId: ' user-current ',
      }),
    ).toEqual({ accepted: false, reason: 'missing_current_user_message' });
  });

  it('rejects missing or ungrounded quotes', () => {
    expect(decide(proposal({ evidenceQuote: undefined }))).toEqual({
      accepted: false,
      reason: 'missing_evidence_quote',
    });
    expect(decide(proposal({ evidenceQuote: 'I moved to Paris.' }))).toEqual({
      accepted: false,
      reason: 'quote_not_in_current_user_message',
    });
  });

  it('requires the replacement value inside the validated user quote', () => {
    expect(decide(proposal({ value: 'Paris' }))).toEqual({
      accepted: false,
      reason: 'value_not_in_current_user_message',
    });
  });

  it('preserves opaque value casing while grounding corrections', () => {
    expect(
      decide(proposal({ value: 'abc', evidenceQuote: 'The token is AbC.' }), {
        currentUserMessage: 'The token is AbC.',
      }),
    ).toEqual({ accepted: false, reason: 'value_not_in_current_user_message' });
    expect(
      decide(proposal({ value: 'AbC', evidenceQuote: 'The token is AbC.' }), {
        currentUserMessage: 'The token is AbC.',
      }).accepted,
    ).toBe(true);
  });

  it('never grounds against assistant, tool, or enriched content', () => {
    expect(
      decide(proposal(), {
        currentUserMessage: 'Please continue.',
      }),
    ).toEqual({ accepted: false, reason: 'quote_not_in_current_user_message' });
  });

  it('accepts a global target without promoting another scope', () => {
    const decision = decide(proposal(), {
      currentFacts: [
        currentFact({ id: 'global' }),
        currentFact({
          id: 'other-scope',
          scope: 'conversation',
          originConversationId: 'conversation-1',
          originThreadId: 'thread-1',
        }),
      ],
    });
    expect(decision).toMatchObject({ accepted: true, target: { id: 'global' } });
  });

  it('shares conversation facts across threads but keeps session provenance exact', () => {
    expect(
      decide(proposal({ scope: 'conversation' }), {
        currentFacts: [
          currentFact({
            scope: 'conversation',
            originConversationId: 'conversation-1',
            originThreadId: 'older-thread',
            originTaskId: null,
          }),
        ],
      }).accepted,
    ).toBe(true);

    expect(
      decide(proposal({ scope: 'conversation' }), {
        currentFacts: [
          currentFact({
            scope: 'conversation',
            originConversationId: 'other-conversation',
            originThreadId: 'thread-1',
          }),
        ],
      }),
    ).toEqual({ accepted: false, reason: 'no_compatible_current_fact' });

    const sessionDecision = decide(proposal({ scope: 'session' }), {
      taskId: 'task-1',
      currentFacts: [
        currentFact({
          scope: 'session',
          originConversationId: 'conversation-1',
          originThreadId: 'thread-1',
          originTaskId: 'task-1',
        }),
      ],
    });
    expect(sessionDecision.accepted).toBe(true);
  });

  it('admits project and persona replacements only with exact code-owned identities', () => {
    expect(
      decide(proposal({ scope: 'project' }), {
        currentFacts: [
          currentFact({
            scope: 'project',
            originConversationId: 'conversation-1',
            originThreadId: 'older-thread',
          }),
        ],
      }).accepted,
    ).toBe(true);
    expect(decide(proposal({ scope: 'persona' }))).toEqual({
      accepted: false,
      reason: 'persona_identity_unavailable',
    });
    expect(
      decide(proposal({ scope: 'persona' }), {
        personaId: 'persona-1',
        currentFacts: [
          currentFact({
            scope: 'persona',
            personaId: 'persona-1',
            originConversationId: null,
            originThreadId: null,
          }),
        ],
      }).accepted,
    ).toBe(true);
  });

  it('rejects missing exact conversation and session identities before insertion', () => {
    expect(
      decide(proposal({ scope: 'conversation' }), {
        memoryConversationId: ' conversation-1 ',
        currentFacts: [],
        hasAnyCurrentFact: false,
      }),
    ).toEqual({ accepted: false, reason: 'conversation_identity_unavailable' });
    expect(
      decide(proposal({ scope: 'session' }), {
        taskId: null,
        currentFacts: [],
        hasAnyCurrentFact: false,
      }),
    ).toEqual({ accepted: false, reason: 'session_identity_unavailable' });
  });

  it('downgrades only a grounded direct no-target replacement to insert', () => {
    expect(decide(proposal(), { currentFacts: [] })).toMatchObject({
      accepted: true,
      operation: 'insert',
      fact: { operation: 'insert' },
    });
  });

  it('never downgrades when the key exists in an incompatible namespace', () => {
    expect(
      decide(proposal({ scope: 'conversation' }), {
        currentFacts: [],
        hasAnyCurrentFact: true,
      }),
    ).toEqual({ accepted: false, reason: 'no_compatible_current_fact' });
  });

  it('abstains when the compatible current target is ambiguous', () => {
    expect(
      decide(proposal(), { currentFacts: [currentFact(), currentFact({ id: 'fact-second' })] }),
    ).toEqual({ accepted: false, reason: 'ambiguous_current_fact' });
  });

  it.each(['historical', 'hypothetical', 'quoted', 'third_party', 'uncertain'] as const)(
    'rejects a no-target %s proposal before it can downgrade to insert',
    (assertionClass) => {
      expect(decide(proposal({ assertionClass }), { currentFacts: [] })).toEqual({
        accepted: false,
        reason: 'not_current_direct',
      });
    },
  );

  it('rejects ungrounded no-target replacement proposals', () => {
    expect(
      decide(proposal({ evidenceMessageIds: ['assistant-current'] }), { currentFacts: [] }),
    ).toEqual({ accepted: false, reason: 'wrong_evidence_message' });
    expect(decide(proposal({ evidenceQuote: 'I moved to Paris.' }), { currentFacts: [] })).toEqual({
      accepted: false,
      reason: 'quote_not_in_current_user_message',
    });
    expect(decide(proposal({ value: 'Paris' }), { currentFacts: [] })).toEqual({
      accepted: false,
      reason: 'value_not_in_current_user_message',
    });
  });
});
