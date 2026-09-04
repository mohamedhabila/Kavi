// ---------------------------------------------------------------------------
// Tests — Media Understanding: Service (runMediaUnderstanding)
// ---------------------------------------------------------------------------

import { runMediaUnderstanding } from '../../src/services/media/service';
import { i18n } from '../../src/i18n/manager';
import type { Attachment } from '../../src/types/attachment';
import type { LlmProviderConfig } from '../../src/types/provider';

const legacyFileSystem = jest.requireMock('expo-file-system/legacy') as {
  readAsStringAsync: jest.Mock;
};

// Mock LlmService
const mockSendMessage = jest.fn();
jest.mock('../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
  })),
}));

// Mock voice transcription
const mockTranscribeAudio = jest.fn();
jest.mock('../../src/services/voice/voice', () => ({
  transcribeAudio: (...args: any[]) => mockTranscribeAudio(...args),
}));

const makeProvider = (
  overrides: Partial<Pick<LlmProviderConfig, 'model' | 'availableModels' | 'modelCapabilities'>> = {},
): LlmProviderConfig => ({
  id: 'test',
  name: 'Test Provider',
  baseUrl: 'https://api.test.com/v1',
  apiKey: 'sk-test',
  model: 'chat-model',
  enabled: true,
  ...overrides,
});

const makeImageAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'img1',
  type: 'image',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  uri: 'file:///photo.jpg',
  size: 1024,
  base64: 'abc123base64data',
  ...overrides,
});

const makeAudioAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'aud1',
  type: 'file',
  name: 'recording.mp3',
  mimeType: 'audio/mpeg',
  uri: 'file:///recording.mp3',
  size: 2048,
  ...overrides,
});

beforeEach(async () => {
  mockSendMessage.mockReset();
  mockTranscribeAudio.mockReset();
  legacyFileSystem.readAsStringAsync.mockReset();
  require('expo-file-system').__resetStore?.();
  await i18n.setLocale('en');
});

describe('runMediaUnderstanding', () => {
  it('returns original body when disabled', async () => {
    const result = await runMediaUnderstanding('Hello', [makeImageAttachment()], {
      enabled: false,
      provider: makeProvider(),
      model: 'chat-model',
    });
    expect(result.enrichedBody).toBe('Hello');
    expect(result.processedCount).toBe(0);
  });

  it('returns original body when no attachments', async () => {
    const result = await runMediaUnderstanding('Hello', [], {
      enabled: true,
      provider: makeProvider(),
      model: 'chat-model',
    });
    expect(result.enrichedBody).toBe('Hello');
    expect(result.processedCount).toBe(0);
  });

  describe('when the active model already has vision', () => {
    it('skips the description call entirely and leaves the raw image to the existing vision path', async () => {
      const provider = makeProvider({
        modelCapabilities: { 'chat-model': { vision: true, tools: true } },
      });

      const result = await runMediaUnderstanding('What is this?', [makeImageAttachment()], {
        enabled: true,
        provider,
        model: 'chat-model',
      });

      expect(result.processedCount).toBe(0);
      expect(result.enrichedBody).toBe('What is this?');
      expect(result.enrichedBody).not.toContain('<media_context>');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('when the active model lacks vision', () => {
    it('describes the image using another vision-capable model on the same provider', async () => {
      const provider = makeProvider({
        availableModels: ['chat-model', 'vision-model'],
        modelCapabilities: {
          'chat-model': { vision: false, tools: true },
          'vision-model': { vision: true, tools: true },
        },
      });
      mockSendMessage.mockResolvedValue({
        choices: [{ message: { content: 'A sunset over the ocean.' } }],
      });
      legacyFileSystem.readAsStringAsync.mockResolvedValue('abc123base64data');

      const result = await runMediaUnderstanding('What is this?', [makeImageAttachment()], {
        enabled: true,
        provider,
        model: 'chat-model',
      });

      expect(result.processedCount).toBe(1);
      expect(result.enrichedBody).toContain('A sunset over the ocean.');
      expect(result.enrichedBody).toContain('<media_context>');
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[1]?.model).toBe('vision-model');
    });

    it('prefers the provider default model over an active model when the default has vision', async () => {
      const provider = makeProvider({
        model: 'vision-default',
        availableModels: ['vision-default', 'other-vision-model'],
        modelCapabilities: {
          'chat-model': { vision: false, tools: true },
          'vision-default': { vision: true, tools: true },
          'other-vision-model': { vision: true, tools: true },
        },
      });
      mockSendMessage.mockResolvedValue({
        choices: [{ message: { content: 'A mountain range.' } }],
      });
      legacyFileSystem.readAsStringAsync.mockResolvedValue('abc123base64data');

      const result = await runMediaUnderstanding('What is this?', [makeImageAttachment()], {
        enabled: true,
        provider,
        model: 'chat-model',
      });

      expect(result.processedCount).toBe(1);
      expect(mockSendMessage.mock.calls[0]?.[1]?.model).toBe('vision-default');
    });

    it('treats image attachments with generic mime types as images when the extension or type says so', async () => {
      const provider = makeProvider({
        availableModels: ['chat-model', 'vision-model'],
        modelCapabilities: {
          'chat-model': { vision: false },
          'vision-model': { vision: true, tools: true },
        },
      });
      mockSendMessage.mockResolvedValue({
        choices: [{ message: { content: 'A diagram screenshot.' } }],
      });
      legacyFileSystem.readAsStringAsync.mockResolvedValue('abc123base64data');

      const result = await runMediaUnderstanding(
        'Describe this',
        [makeImageAttachment({ name: 'diagram.png', mimeType: 'application/octet-stream' })],
        { enabled: true, provider, model: 'chat-model' },
      );

      expect(result.processedCount).toBe(1);
      expect(result.enrichedBody).toContain('A diagram screenshot.');
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('returns no output and skips the call when the provider has no vision-capable model at all', async () => {
      const provider = makeProvider({
        availableModels: ['chat-model'],
        modelCapabilities: { 'chat-model': { vision: false, tools: true } },
      });

      const result = await runMediaUnderstanding('Describe this', [makeImageAttachment()], {
        enabled: true,
        provider,
        model: 'chat-model',
      });

      expect(result.processedCount).toBe(0);
      expect(result.enrichedBody).toBe('Describe this');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('loads image bytes from local storage when inline base64 is absent', async () => {
      const provider = makeProvider({
        availableModels: ['chat-model', 'vision-model'],
        modelCapabilities: { 'chat-model': { vision: false }, 'vision-model': { vision: true } },
      });
      legacyFileSystem.readAsStringAsync.mockResolvedValue('fromfilebase64');
      mockSendMessage.mockResolvedValue({
        choices: [{ message: { content: 'Loaded from file.' } }],
      });

      const result = await runMediaUnderstanding(
        'Check image',
        [makeImageAttachment({ base64: undefined })],
        { enabled: true, provider, model: 'chat-model' },
      );

      expect(result.processedCount).toBe(1);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]?.[0]?.content?.[1]?.image_url?.url).toBe(
        'data:image/jpeg;base64,fromfilebase64',
      );
    });

    it('returns error when image payload is unavailable', async () => {
      const provider = makeProvider({
        availableModels: ['chat-model', 'vision-model'],
        modelCapabilities: { 'chat-model': { vision: false }, 'vision-model': { vision: true } },
      });
      legacyFileSystem.readAsStringAsync.mockRejectedValue(new Error('missing file'));

      const result = await runMediaUnderstanding(
        'Check image',
        [makeImageAttachment({ base64: undefined })],
        { enabled: true, provider, model: 'chat-model' },
      );

      expect(result.processedCount).toBe(0);
    });

    it('handles LLM errors gracefully', async () => {
      const provider = makeProvider({
        availableModels: ['chat-model', 'vision-model'],
        modelCapabilities: { 'chat-model': { vision: false }, 'vision-model': { vision: true } },
      });
      legacyFileSystem.readAsStringAsync.mockResolvedValue('abc123base64data');
      mockSendMessage.mockRejectedValue(new Error('API error'));

      const result = await runMediaUnderstanding('Describe image', [makeImageAttachment()], {
        enabled: true,
        provider,
        model: 'chat-model',
      });

      expect(result.processedCount).toBe(0);
    });

    it('asks for the description in the active app language (fr → français)', async () => {
      await i18n.setLocale('fr');
      const provider = makeProvider({
        availableModels: ['chat-model', 'vision-model'],
        modelCapabilities: { 'chat-model': { vision: false }, 'vision-model': { vision: true } },
      });
      mockSendMessage.mockResolvedValue({
        choices: [{ message: { content: 'Une plage.' } }],
      });
      legacyFileSystem.readAsStringAsync.mockResolvedValue('abc123base64data');

      await runMediaUnderstanding('Décris cette image', [makeImageAttachment()], {
        enabled: true,
        provider,
        model: 'chat-model',
      });

      const promptText = mockSendMessage.mock.calls[0]?.[0]?.[0]?.content?.[0]?.text as string;
      expect(promptText).toContain('français');
    });
  });

  it('transcribes audio using Whisper', async () => {
    mockTranscribeAudio.mockResolvedValue({ text: 'Hello world spoken audio.' });

    const result = await runMediaUnderstanding('What does this say?', [makeAudioAttachment()], {
      enabled: true,
      provider: makeProvider(),
      model: 'chat-model',
    });

    expect(result.processedCount).toBe(1);
    expect(result.enrichedBody).toContain('Hello world spoken audio.');
    expect(result.enrichedBody).toContain('Transcript:');
    expect(mockTranscribeAudio).toHaveBeenCalledWith('file:///recording.mp3');
  });

  it('skips re-transcribing dedicated voice-note attachments that already include a transcript', async () => {
    const result = await runMediaUnderstanding(
      'Use the transcript already sent in the user message',
      [
        makeAudioAttachment({
          type: 'audio',
          transcript: 'Ship the production voice-note flow.',
        }),
      ],
      { enabled: true, provider: makeProvider(), model: 'chat-model' },
    );

    expect(result.processedCount).toBe(0);
    expect(result.enrichedBody).toBe('Use the transcript already sent in the user message');
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
  });

  it('skips generic audio attachments when a transcript is already attached', async () => {
    const result = await runMediaUnderstanding(
      'Treat this as text-only content',
      [
        makeAudioAttachment({
          transcript: 'Deploy the hotfix after tests pass.',
        }),
      ],
      { enabled: true, provider: makeProvider(), model: 'chat-model' },
    );

    expect(result.processedCount).toBe(0);
    expect(result.enrichedBody).toBe('Treat this as text-only content');
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
  });

  it('treats audio attachments with generic mime types as audio when the extension indicates it', async () => {
    mockTranscribeAudio.mockResolvedValue({ text: 'Recovered from extension fallback.' });

    const result = await runMediaUnderstanding(
      'Transcribe this',
      [makeAudioAttachment({ name: 'voice.m4a', mimeType: 'application/octet-stream' })],
      { enabled: true, provider: makeProvider(), model: 'chat-model' },
    );

    expect(result.processedCount).toBe(1);
    expect(result.enrichedBody).toContain('Recovered from extension fallback.');
    expect(mockTranscribeAudio).toHaveBeenCalledWith('file:///recording.mp3');
  });

  it('handles mixed image and audio attachments', async () => {
    const provider = makeProvider({
      availableModels: ['chat-model', 'vision-model'],
      modelCapabilities: { 'chat-model': { vision: false }, 'vision-model': { vision: true } },
    });
    legacyFileSystem.readAsStringAsync.mockResolvedValue('abc123base64data');
    mockSendMessage.mockResolvedValue({
      choices: [{ message: { content: 'A cat photo.' } }],
    });
    mockTranscribeAudio.mockResolvedValue({ text: 'Meeting notes.' });

    const result = await runMediaUnderstanding(
      'Analyze these',
      [makeImageAttachment(), makeAudioAttachment()],
      { enabled: true, provider, model: 'chat-model' },
    );

    expect(result.processedCount).toBe(2);
    expect(result.enrichedBody).toContain('A cat photo.');
    expect(result.enrichedBody).toContain('Meeting notes.');
  });

  it('extracts local text documents', async () => {
    const { File } = require('expo-file-system');
    new File('file:///notes.md').write('# Notes\n\nShip the fix today.');

    const result = await runMediaUnderstanding(
      'Review this document',
      [
        {
          id: 'f1',
          type: 'file',
          name: 'notes.md',
          mimeType: 'text/markdown',
          uri: 'file:///notes.md',
          size: 128,
        },
      ],
      { enabled: true, provider: makeProvider(), model: 'chat-model' },
    );

    expect(result.processedCount).toBe(1);
    expect(result.enrichedBody).toContain('[Document Attachment #1]');
    expect(result.enrichedBody).toContain('Ship the fix today.');
  });

  it('summarizes pdf attachments instead of dropping them', async () => {
    const result = await runMediaUnderstanding(
      'What is this?',
      [
        {
          id: 'f1',
          type: 'file',
          name: 'doc.pdf',
          mimeType: 'application/pdf',
          uri: 'file:///doc.pdf',
          size: 500,
        },
      ],
      { enabled: true, provider: makeProvider(), model: 'chat-model' },
    );

    expect(result.processedCount).toBe(1);
    expect(result.enrichedBody).toContain('[Document Attachment #1]');
    expect(result.enrichedBody).toContain('Attached PDF: doc.pdf');
  });

  it('handles transcription errors gracefully', async () => {
    mockTranscribeAudio.mockRejectedValue(new Error('Whisper failed'));

    const result = await runMediaUnderstanding('Transcribe audio', [makeAudioAttachment()], {
      enabled: true,
      provider: makeProvider(),
      model: 'chat-model',
    });

    expect(result.processedCount).toBe(0);
  });
});
