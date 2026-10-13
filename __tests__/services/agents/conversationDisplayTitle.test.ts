import { resolveConversationDisplayTitle } from '../../../src/services/agents/conversationDisplayTitle';
import { usePersonaConfigStore } from '../../../src/services/agents/store';

describe('what the conversation is called', () => {
  afterEach(() => {
    usePersonaConfigStore.setState({ overrides: {}, customPersonas: [] });
  });

  it('is the focus memory named for it', () => {
    expect(
      resolveConversationDisplayTitle({ title: '  Weekend in Porto ', personaId: 'writer' }),
    ).toBe('Weekend in Porto');
  });

  it('is the chosen persona name before any focus is named', () => {
    expect(resolveConversationDisplayTitle({ title: '', personaId: 'writer' })).toBe('Writer');
  });

  it('is the default persona name, with the user’s roster edit, when none was chosen', () => {
    usePersonaConfigStore.getState().setOverride('default', { name: 'Nour' });

    expect(resolveConversationDisplayTitle({ title: '', personaId: undefined })).toBe('Nour');
    expect(resolveConversationDisplayTitle(undefined)).toBe('Nour');
  });

  it('falls back to the default persona when the chosen one no longer exists', () => {
    expect(resolveConversationDisplayTitle({ title: '', personaId: 'deleted-persona' })).toBe(
      'Kavi',
    );
  });
});
