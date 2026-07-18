import { resolveExternalActionContract } from '../../src/engine/externalActionContract';

describe('resolveExternalActionContract', () => {
  const contract = {
    name: 'next_action',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  };

  it('normalizes a controller contract when product tools are disabled', () => {
    expect(resolveExternalActionContract(contract, true)).toEqual({
      ...contract,
      mimeType: 'application/json',
    });
  });

  it('rejects ambiguous or malformed authority configurations', () => {
    expect(() => resolveExternalActionContract(contract, false)).toThrow(
      'requires product tools to be disabled',
    );
    expect(() => resolveExternalActionContract({}, true)).toThrow(
      'must contain a valid JSON schema',
    );
  });
});
