import { resolvePersonaContextPolicy } from '../../src/services/agents/personaContextPolicy';

describe('persona context policy identity', () => {
  it('uses the default policy only when the persona is absent', () => {
    expect(resolvePersonaContextPolicy(undefined, 'chat')).toEqual(
      resolvePersonaContextPolicy('default', 'chat'),
    );
  });

  it('applies an exact registered persona override', () => {
    expect(resolvePersonaContextPolicy('researcher', 'chat').recallLimit).toBe(10);
  });

  it('rejects malformed persona identities instead of normalizing them to another policy', () => {
    expect(() => resolvePersonaContextPolicy(' researcher', 'chat')).toThrow(
      'persona_context_id_invalid',
    );
    expect(() => resolvePersonaContextPolicy('', 'chat')).toThrow('persona_context_id_invalid');
  });
});
