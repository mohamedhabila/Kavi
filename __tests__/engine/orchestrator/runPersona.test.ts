// ---------------------------------------------------------------------------
// Tests - Orchestrator: which persona a run speaks as
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  getPersona,
  mockStreamMessage,
  makeProvider,
  makeCallbacks,
  createStreamGenerator,
  type OrchestratorOptions,
} from '../../helpers/orchestratorHarness';
import { resolvePersonaSystemPrompt } from '../../../src/services/agents/personas';

const EDITED_DEFAULT_PERSONA = {
  id: 'default',
  name: 'Kavi',
  description: 'Personal assistant for everyday life',
  systemPrompt: 'You are Kavi, edited in the agent roster.',
};

const WRITER_PERSONA = {
  id: 'writer',
  name: 'Writer',
  description: 'Writes',
  systemPrompt: 'You are a writer.',
};

function respondOnce(): void {
  mockStreamMessage.mockImplementationOnce(() =>
    createStreamGenerator(
      [
        { type: 'token', content: 'OK' },
        { type: 'done', content: 'OK' },
      ],
      'text',
    ),
  );
}

function runWith(personaId: string | undefined): Promise<unknown> {
  const options: OrchestratorOptions = {
    provider: makeProvider(),
    model: 'gpt-5.4',
    conversationId: 'conv-run-persona',
    executionRunId: 'run-persona',
    systemPrompt: '',
    ...(personaId ? { personaId } : {}),
    messages: [{ id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() }],
  };
  return runOrchestrator(options, makeCallbacks());
}

describe('the persona a run speaks as', () => {
  beforeEach(() => {
    (getPersona as jest.Mock).mockImplementation((personaId: string) =>
      personaId === 'default'
        ? EDITED_DEFAULT_PERSONA
        : personaId === 'writer'
          ? WRITER_PERSONA
          : undefined,
    );
  });

  it('is the default persona, with its roster edits, when the conversation chose none', async () => {
    respondOnce();
    await runWith(undefined);

    expect(getPersona).toHaveBeenCalledWith('default');
    expect(resolvePersonaSystemPrompt).toHaveBeenCalledWith(EDITED_DEFAULT_PERSONA, '');
  });

  it('is the persona the conversation chose', async () => {
    respondOnce();
    await runWith('writer');

    expect(resolvePersonaSystemPrompt).toHaveBeenCalledWith(WRITER_PERSONA, '');
  });

  it('falls back to the default persona when the chosen one no longer exists', async () => {
    respondOnce();
    await runWith('deleted-custom-persona');

    expect(resolvePersonaSystemPrompt).toHaveBeenCalledWith(EDITED_DEFAULT_PERSONA, '');
  });
});
