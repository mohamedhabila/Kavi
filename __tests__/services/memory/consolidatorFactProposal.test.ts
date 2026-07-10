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

  it('parses canonical proposal fields without creating internal write authority', () => {
    const outcome = parseConsolidatorOutput(
      JSON.stringify({
        episode_summary: null,
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
          },
        ],
        active_focus: null,
        open_threads: [],
        notable: [],
      }),
    );

    expect(outcome.status).toBe('valid');
    if (outcome.status !== 'valid') throw new Error('expected valid outcome');
    expect(outcome.result.newFacts).toEqual([
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
    expect(outcome.result.newFacts[0].admittedWrite).toBeUndefined();
  });

  it.each([
    {
      invalidated_facts: [{ fact_id: 'provider-selected' }],
      episode_summary: null,
      new_facts: [],
      active_focus: null,
      open_threads: [],
      notable: [],
    },
    {
      episode_summary: null,
      new_facts: [
        {
          subject: 'user',
          predicate: 'lives_in',
          value: 'Utrecht',
          admittedWrite: {
            operation: 'replace_current',
            authority: 'grounded_user_statement',
            expectedCurrentFactId: 'attacker-selected',
          },
        },
      ],
      active_focus: null,
      open_threads: [],
      notable: [],
    },
  ])('rejects provider-selected write authority outside the schema', (payload) => {
    expect(parseConsolidatorOutput(JSON.stringify(payload))).toEqual({
      status: 'schema_invalid',
      code: 'unexpected_field',
    });
  });

  it('rejects unknown operation and assertion values', () => {
    expect(
      parseConsolidatorOutput(
        JSON.stringify({
          episode_summary: null,
          new_facts: [
            {
              subject: 'user',
              predicate: 'lives_in',
              value: 'Utrecht',
              operation: 'invalidate_anything',
              assertion_class: 'definitely_true',
            },
          ],
          active_focus: null,
          open_threads: [],
          notable: [],
        }),
      ),
    ).toEqual({ status: 'schema_invalid', code: 'invalid_field_value' });
  });
});
