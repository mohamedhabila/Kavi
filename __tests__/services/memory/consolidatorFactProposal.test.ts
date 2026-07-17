import {
  buildConsolidatorPrompt,
  parseConsolidatorOutput,
} from '../../../src/services/memory/consolidator';
import { MEMORY_CONSOLIDATION_OUTPUT_SCHEMA } from '../../../src/services/memory/consolidation/outputSchema';

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    subject_ref: { kind: 'self' },
    predicate: 'lives_in',
    value: 'Utrecht',
    scope: 'global',
    importance: 0.8,
    confidence: 0.95,
    source_message_id: 'user-current',
    operation: 'replace_current',
    assertion_class: 'current_direct',
    evidence_quote: 'I moved to Utrecht.',
    sensitivity: 'personal',
    ...overrides,
  };
}

function payload(newFacts: unknown[]): Record<string, unknown> {
  return {
    episode_sensitivity: 'normal',
    episode_summary: null,
    new_facts: newFacts,
    active_focus: null,
    open_threads: [],
    notable: [],
  };
}

describe('SemanticFactProposalV1 provider contract', () => {
  it('requests the strict, language-neutral proposal schema without write authority', () => {
    const prompt = buildConsolidatorPrompt({
      userMessage: 'I moved to Utrecht.',
      assistantMessage: 'Understood.',
      sourceUserMessageId: 'user-current',
    });

    expect(prompt).toContain('"version": 1');
    expect(prompt).toContain('"subject_ref"');
    expect(prompt).toContain('"source_message_id"');
    expect(prompt).toContain('"operation": "record" | "replace_current"');
    expect(prompt).toContain('Every field in every new_facts item is required');
    expect(prompt).toContain('any language');
    expect(prompt).not.toContain('"evidence_message_ids"');
    expect(prompt).not.toContain('"invalidated_facts"');
  });

  it('uses a strict structured-output schema with every proposal field required', () => {
    expect(MEMORY_CONSOLIDATION_OUTPUT_SCHEMA.strict).toBe(true);
    const schema = MEMORY_CONSOLIDATION_OUTPUT_SCHEMA.schema as any;
    const factSchema = schema.properties.new_facts.items;
    expect(schema.required).toContain('episode_sensitivity');
    expect(factSchema.additionalProperties).toBe(false);
    expect(factSchema.required).toEqual([
      'version',
      'subject_ref',
      'predicate',
      'value',
      'scope',
      'importance',
      'confidence',
      'source_message_id',
      'operation',
      'assertion_class',
      'evidence_quote',
      'sensitivity',
    ]);
  });

  it('decodes canonical provider JSON into a typed proposal without authority', () => {
    const outcome = parseConsolidatorOutput(JSON.stringify(payload([proposal()])));

    expect(outcome.status).toBe('valid');
    if (outcome.status !== 'valid') throw new Error('expected valid outcome');
    expect(outcome.result.newFacts).toEqual([
      {
        version: 1,
        subjectRef: { kind: 'self' },
        predicate: 'lives_in',
        value: 'Utrecht',
        scope: 'global',
        importance: 0.8,
        confidence: 0.95,
        sourceMessageId: 'user-current',
        operation: 'replace_current',
        assertionClass: 'current_direct',
        evidenceQuote: 'I moved to Utrecht.',
        sensitivity: 'personal',
      },
    ]);
    expect(outcome.result.newFacts[0]).not.toHaveProperty('admittedWrite');
  });

  it.each([
    [proposal({ version: undefined }), 'missing_required_field'],
    [proposal({ version: 2 }), 'invalid_field_value'],
    [proposal({ subject_ref: { kind: 'named' } }), 'missing_required_field'],
    [proposal({ subject_ref: { kind: 'self', label: 'user' } }), 'unexpected_field'],
    [proposal({ operation: 'insert' }), 'invalid_field_value'],
    [proposal({ assertion_class: 'definitely_true' }), 'invalid_field_value'],
    [proposal({ sensitivity: 'public' }), 'invalid_field_value'],
    [proposal({ confidence: 2 }), 'invalid_field_value'],
    [proposal({ evidence_quote: ' padded ' }), 'invalid_field_value'],
    [{ ...proposal(), reason: 'legacy field' }, 'unexpected_field'],
    [
      {
        subject: 'user',
        predicate: 'lives_in',
        value: 'Utrecht',
      },
      'unexpected_field',
    ],
  ])('rejects malformed or compatibility proposal %p', (fact, code) => {
    expect(parseConsolidatorOutput(JSON.stringify(payload([fact])))).toEqual({
      status: 'schema_invalid',
      code,
    });
  });

  it('rejects every omitted required field without defaults', () => {
    for (const field of Object.keys(proposal())) {
      const fact = proposal();
      delete fact[field];
      expect(parseConsolidatorOutput(JSON.stringify(payload([fact])))).toEqual({
        status: 'schema_invalid',
        code: 'missing_required_field',
      });
    }
  });

  it('rejects provider-selected write authority outside the schema', () => {
    expect(
      parseConsolidatorOutput(
        JSON.stringify(payload([{ ...proposal(), expected_current_fact_id: 'attacker' }])),
      ),
    ).toEqual({ status: 'schema_invalid', code: 'unexpected_field' });
  });
});
