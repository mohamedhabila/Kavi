import {
  executeAgentsConfigure,
  executeAgentsList,
  executeAgentsSwitch,
  executeMessageEffect,
  executePollCreate,
  executeSpeak,
  installBuiltinExecutorWrapperReset,
  mockPersonasStore,
  mockSpeakText,
  mockUpdatePersonaInConversation,
} from '../helpers/builtinExecutorWrappersHarness';

describe('builtin-executor wrapper coverage', () => {
  installBuiltinExecutorWrapperReset();

  it('validates poll creation and supported message effects', async () => {
    expect(JSON.parse(await executePollCreate({ question: '', options: ['A', 'B'] }))).toEqual({
      status: 'error',
      error: 'Poll question is required',
    });
    expect(
      JSON.parse(await executePollCreate({ question: 'Question', options: ['Only one'] })),
    ).toEqual({ status: 'error', error: 'At least two poll options are required' });

    const poll = JSON.parse(
      await executePollCreate({
        question: '  Ship it?  ',
        options: [' Yes ', 'No', ' Maybe '],
        allowMultiple: true,
        durationMs: 3000,
      }),
    );
    expect(poll).toEqual({
      status: 'created',
      poll: {
        id: expect.any(String),
        question: 'Ship it?',
        options: [
          { id: expect.any(String), label: 'Yes', votes: 0 },
          { id: expect.any(String), label: 'No', votes: 0 },
          { id: expect.any(String), label: 'Maybe', votes: 0 },
        ],
        allowMultiple: true,
        durationMs: 3000,
        createdAt: expect.any(Number),
      },
    });

    expect(JSON.parse(await executeMessageEffect({ effectId: 'invalid' }))).toEqual({
      status: 'error',
      error: 'Unsupported effect. Use confetti, balloons, or spotlight.',
    });
    expect(JSON.parse(await executeMessageEffect({ effectId: '  CONFETTI ' }))).toEqual({
      status: 'applied',
      effectId: 'confetti',
    });
  });

  it('speaks text successfully and returns an error payload when TTS fails', async () => {
    const success = JSON.parse(await executeSpeak({ text: 'Hello world', provider: 'system' }));
    expect(success).toEqual({ status: 'spoken', textLength: 11, provider: 'system' });
    expect(mockSpeakText).toHaveBeenCalledWith('Hello world', 'system');

    mockSpeakText.mockRejectedValueOnce(new Error('tts failed'));
    const failure = JSON.parse(await executeSpeak({ text: 'Hello world', provider: 'system' }));
    expect(failure).toEqual({ status: 'error', error: 'tts failed' });
  });

  it('lists agents, switches personas, and configures built-in, custom, and new personas', async () => {
    const listed = JSON.parse(await executeAgentsList());
    expect(listed.agents).toEqual([
      {
        id: 'default',
        name: 'Assistant',
        description: 'Built-in assistant',
        icon: 'A',
        custom: false,
      },
      {
        id: 'custom-reviewer',
        name: 'Reviewer',
        description: 'Reviews changes',
        icon: undefined,
        custom: true,
      },
    ]);

    await expect(executeAgentsSwitch({ personaId: 'missing' }, 'conv-1')).resolves.toBe(
      'Error: persona not found: missing. Use agents_list to see available personas.',
    );

    const switched = JSON.parse(await executeAgentsSwitch({ personaId: 'default' }, 'conv-1'));
    expect(switched).toEqual({ status: 'switched', personaId: 'default', name: 'Assistant' });
    expect(mockUpdatePersonaInConversation).toHaveBeenCalledWith('conv-1', 'default');

    const builtInConfigured = JSON.parse(
      await executeAgentsConfigure({
        personaId: 'default',
        name: 'Assistant Pro',
        temperature: 0.2,
      }),
    );
    expect(builtInConfigured).toEqual({
      status: 'configured',
      persona: { id: 'default', name: 'Assistant' },
    });
    expect(mockPersonasStore.setOverride).toHaveBeenCalledWith('default', {
      name: 'Assistant Pro',
      temperature: 0.2,
    });

    const customConfigured = JSON.parse(
      await executeAgentsConfigure({
        personaId: 'custom-reviewer',
        name: 'Reviewer Pro',
        systemPrompt: 'Review prod changes only',
      }),
    );
    expect(customConfigured).toEqual({
      status: 'configured',
      persona: { id: 'custom-reviewer', name: 'Reviewer Pro' },
    });

    const created = JSON.parse(
      await executeAgentsConfigure({
        personaId: 'new-specialist',
        systemPrompt: 'Handle niche tasks',
        providerId: 'openai',
      }),
    );
    expect(created).toEqual({
      status: 'created',
      persona: { id: 'new-specialist', name: 'new-specialist' },
    });
    expect(mockPersonasStore.upsertCustomPersona).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-specialist',
        name: 'new-specialist',
        providerId: 'openai',
        icon: '🔧',
      }),
    );
  });
});
