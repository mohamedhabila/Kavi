import { act } from '@testing-library/react-native';
import { usePersonaConfigStore } from '../../../src/services/agents/store';

describe('usePersonaConfigStore', () => {
  beforeEach(() => {
    act(() => {
      usePersonaConfigStore.getState().reset();
    });
  });

  it('merges persona overrides and clears them by persona id', () => {
    act(() => {
      usePersonaConfigStore.getState().setOverride('coder', {
        name: 'Code Specialist',
        temperature: 0.2,
      });
      usePersonaConfigStore.getState().setOverride('coder', {
        description: 'Handles implementation work',
        providerId: 'openai',
      });
    });

    expect(usePersonaConfigStore.getState().overrides).toEqual({
      coder: {
        name: 'Code Specialist',
        temperature: 0.2,
        description: 'Handles implementation work',
        providerId: 'openai',
      },
    });

    act(() => {
      usePersonaConfigStore.getState().clearOverride('coder');
    });

    expect(usePersonaConfigStore.getState().overrides).toEqual({});
  });

  it('upserts, replaces, removes, and resets custom personas', () => {
    const firstPersona = {
      id: 'custom-reviewer',
      name: 'Reviewer',
      description: 'Reviews risky changes',
      systemPrompt: 'Review the diff carefully',
      providerId: 'anthropic',
      model: 'claude',
      temperature: 0.1,
      thinkingLevel: 'medium' as const,
    };
    const updatedPersona = {
      ...firstPersona,
      description: 'Reviews production changes',
      systemPrompt: 'Review production diffs carefully',
      providerId: 'openai',
    };
    const secondPersona = {
      id: 'custom-researcher',
      name: 'Researcher',
      description: 'Collects background context',
      systemPrompt: 'Search for implementation details',
    };

    act(() => {
      usePersonaConfigStore.getState().upsertCustomPersona(firstPersona);
      usePersonaConfigStore.getState().upsertCustomPersona(secondPersona);
      usePersonaConfigStore.getState().upsertCustomPersona(updatedPersona);
    });

    expect(usePersonaConfigStore.getState().customPersonas).toEqual([
      updatedPersona,
      secondPersona,
    ]);

    act(() => {
      usePersonaConfigStore.getState().removeCustomPersona('custom-reviewer');
    });

    expect(usePersonaConfigStore.getState().customPersonas).toEqual([secondPersona]);

    act(() => {
      usePersonaConfigStore.getState().reset();
    });

    expect(usePersonaConfigStore.getState().customPersonas).toEqual([]);
    expect(usePersonaConfigStore.getState().overrides).toEqual({});
  });
});
