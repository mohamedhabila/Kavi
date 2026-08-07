import {
  buildPredicateIdentityCorrection,
  findUserSuppliedPredicateIdentity,
} from '../../../src/services/memory/predicateIdentityPreservation';

// Traced live on `direct-bfcl-v4-parallel-relevance`, 1 run in 14. Asked to "remember
// subject `bfcl-direct` has checksum_token `BFCL-DIRECT-CHECK-42`", the caller filed the
// fact under `has_checksum_token`, folding the English verb into the identifier. The
// write succeeded, the run finalized reporting success, and the fact was unreachable by
// the name the user had used. Seven other runs of the same request used `checksum_token`
// and recalled correctly. `memory_remember` already instructs callers to preserve a
// user-supplied identifier exactly; nothing enforced it.
const TRACED_MESSAGE =
  'Read `sources/bfcl-a.txt`, write the output, and remember subject `bfcl-direct` has ' +
  'checksum_token `BFCL-DIRECT-CHECK-42`.';

describe('a user-supplied identifier is not renamed on the way into memory', () => {
  it('catches a grammatical prefix folded onto the identifier', () => {
    expect(
      findUserSuppliedPredicateIdentity({
        predicate: 'has_checksum_token',
        userMessageText: TRACED_MESSAGE,
      }),
    ).toBe('checksum_token');
  });

  it('catches decoration on either side, without naming any particular word', () => {
    // The rule is structural: nothing here looks for "has", "is", or "was".
    for (const predicate of [
      'is_checksum_token',
      'checksum_token_value',
      'the_checksum_token_field',
    ]) {
      expect(
        findUserSuppliedPredicateIdentity({ predicate, userMessageText: TRACED_MESSAGE }),
      ).toBe('checksum_token');
    }
  });

  it('accepts the identifier the user actually wrote', () => {
    expect(
      findUserSuppliedPredicateIdentity({
        predicate: 'checksum_token',
        userMessageText: TRACED_MESSAGE,
      }),
    ).toBeUndefined();
  });
});

describe('a predicate the caller composed itself is left alone', () => {
  it('does not touch a multi-word semantic relation', () => {
    // The tool explicitly permits the caller to name its own relation; a phrase is not a
    // decorated identifier even when a related token appears in the message.
    expect(
      findUserSuppliedPredicateIdentity({
        predicate: 'preferred display name',
        userMessageText: 'subject display_name Mina',
      }),
    ).toBeUndefined();
  });

  it('does not treat an ordinary word occurring in prose as a supplied identifier', () => {
    // `review` is a word the user happened to use, not an identifier they named.
    expect(
      findUserSuppliedPredicateIdentity({
        predicate: 'review_duration',
        userMessageText: 'The review took ninety minutes.',
      }),
    ).toBeUndefined();
  });

  it('does not flag a single-segment predicate', () => {
    expect(
      findUserSuppliedPredicateIdentity({ predicate: 'email', userMessageText: 'my email is x' }),
    ).toBeUndefined();
  });

  it('does not match an identifier buried inside a longer word', () => {
    expect(
      findUserSuppliedPredicateIdentity({
        predicate: 'has_checksum_token',
        userMessageText: 'the prechecksum_tokenizer ran',
      }),
    ).toBeUndefined();
  });

  it('handles an empty or missing message without claiming a rename', () => {
    expect(
      findUserSuppliedPredicateIdentity({ predicate: 'has_checksum_token', userMessageText: '' }),
    ).toBeUndefined();
    expect(
      findUserSuppliedPredicateIdentity({ predicate: '', userMessageText: TRACED_MESSAGE }),
    ).toBeUndefined();
  });
});

describe('the correction tells the caller exactly what to send', () => {
  it('names both the identifier the user wrote and the one that was used', () => {
    const message = buildPredicateIdentityCorrection({
      predicate: 'has_checksum_token',
      userSuppliedIdentity: 'checksum_token',
    });

    expect(message).toContain('`checksum_token`');
    expect(message).toContain('`has_checksum_token`');
    // It must say why this matters, not merely that it was refused.
    expect(message).toContain('cannot be recalled');
    expect(message).toContain('keeping subject, value, and scope unchanged');
  });
});
