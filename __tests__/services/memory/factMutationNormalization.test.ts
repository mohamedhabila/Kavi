import {
  normalizeExactReplacementFactMutation,
  normalizeRecordFactMutation,
} from '../../../src/services/memory/facts/mutationNormalization';

const grounded = { factClass: 'subjective_user', sourceAuthority: 'grounded_user' } as const;
const input = {
  subjectId: 'entity-user',
  predicate: 'favorite_color',
  objectText: 'blue',
  scope: 'global' as const,
  now: 100,
};

describe('fact mutation normalization', () => {
  it('seals generic record writes as record operations', () => {
    expect(normalizeRecordFactMutation(input, grounded).operation).toEqual({ kind: 'record' });
  });

  it('seals the exact opaque predecessor for replacement writes', () => {
    expect(
      normalizeExactReplacementFactMutation(input, 'fact-predecessor', grounded).operation,
    ).toEqual({
      kind: 'exact_replacement',
      expectedCurrentFactId: 'fact-predecessor',
    });
    expect(() =>
      normalizeExactReplacementFactMutation(input, ' fact-predecessor', grounded),
    ).toThrow('memory_fact_exact_replacement_target_invalid');
  });
});
