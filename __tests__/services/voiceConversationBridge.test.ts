import {
  registerVoiceConversationHandler,
  resetVoiceConversationBridgeForTests,
  sendVoiceConversationTurn,
  VoiceConversationBridgeError,
} from '../../src/services/voice/voiceConversationBridge';

describe('voiceConversationBridge', () => {
  beforeEach(() => {
    resetVoiceConversationBridgeForTests();
  });

  afterEach(() => {
    resetVoiceConversationBridgeForTests();
  });

  it('routes a voice turn through the registered canonical chat handler', async () => {
    const handler = jest.fn().mockResolvedValue('  Saved assistant response  ');
    registerVoiceConversationHandler(handler);

    await expect(
      sendVoiceConversationTurn('Help me plan dinner', {
        additionalSystemPrompt: 'Be concise.',
      }),
    ).resolves.toBe('Saved assistant response');
    expect(handler).toHaveBeenCalledWith('Help me plan dinner', {
      additionalSystemPrompt: 'Be concise.',
    });
  });

  it('rejects when Chat has not registered an execution owner', async () => {
    await expect(sendVoiceConversationTurn('hello')).rejects.toEqual(
      expect.objectContaining<Partial<VoiceConversationBridgeError>>({
        name: 'VoiceConversationBridgeError',
        kind: 'unavailable',
      }),
    );
  });

  it('rejects an empty response instead of speaking a false success', async () => {
    registerVoiceConversationHandler(jest.fn().mockResolvedValue('   '));

    await expect(sendVoiceConversationTurn('hello')).rejects.toEqual(
      expect.objectContaining<Partial<VoiceConversationBridgeError>>({
        kind: 'no_response',
      }),
    );
  });

  it('only unregisters the handler associated with that registration', async () => {
    const firstCleanup = registerVoiceConversationHandler(
      jest.fn().mockResolvedValue('first'),
    );
    registerVoiceConversationHandler(jest.fn().mockResolvedValue('second'));

    firstCleanup();

    await expect(sendVoiceConversationTurn('hello')).resolves.toBe('second');
  });
});
