import {
  buildConsolidatorPrompt,
  parseConsolidatorOutput,
} from '../../../src/services/memory/consolidator';

describe('consolidator fact proposal contract', () => {
  it('asks providers for grounded replacement proposals without invalidation authority', () => {
    const prompt = buildConsolidatorPrompt({
      userMessage: 'I moved to Utrecht.',
      assistantMessage: 'Understood.',
      sourceUserMessageId: 'user-current',
    });

    expect(prompt).toContain('"operation": "insert" | "replace_current"');
    expect(prompt).toContain('"assertion_class"');
    expect(prompt).toContain('"evidence_quote"');
    expect(prompt).toContain('latest user message id');
    expect(prompt).not.toContain('"invalidated_facts"');
  });

  it('normalizes bounded proposal fields but never parses internal write authority', () => {
    const result = parseConsolidatorOutput(
      JSON.stringify({
        invalidated_facts: [{ fact_id: 'provider-selected' }],
        new_facts: [
          {
            subject: 'user',
            predicate: 'lives_in',
            value: 'Utrecht',
            scope: 'global',
            operation: 'replace_current',
            assertion_class: 'current_direct',
            evidence_message_ids: ['user-current'],
            evidence_quote: 'I moved to Utrecht.',
            admittedWrite: {
              operation: 'replace_current',
              authority: 'grounded_user_statement',
              expectedCurrentFactId: 'attacker-selected',
            },
          },
        ],
      }),
    );

    expect(result.newFacts).toEqual([
      {
        subject: 'user',
        predicate: 'lives_in',
        value: 'Utrecht',
        scope: 'global',
        operation: 'replace_current',
        assertionClass: 'current_direct',
        evidenceMessageIds: ['user-current'],
        evidenceQuote: 'I moved to Utrecht.',
      },
    ]);
    expect(result.newFacts[0].admittedWrite).toBeUndefined();
    expect(result).not.toHaveProperty('invalidatedFacts');
  });

  it('drops unknown operation and assertion values', () => {
    const result = parseConsolidatorOutput(
      JSON.stringify({
        new_facts: [
          {
            subject: 'user',
            predicate: 'lives_in',
            value: 'Utrecht',
            operation: 'invalidate_anything',
            assertion_class: 'definitely_true',
          },
        ],
      }),
    );

    expect(result.newFacts[0]).toEqual({
      subject: 'user',
      predicate: 'lives_in',
      value: 'Utrecht',
    });
  });
});
