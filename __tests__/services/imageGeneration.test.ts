import { File, Paths } from 'expo-file-system';
import {
  buildGeneratedImageAttachment,
  editImage,
  generateImage,
  parseGeneratedImageResult,
} from '../../src/services/media/imageGeneration';
import { LlmService } from '../../src/services/llm/LlmService';

jest.mock('../../src/services/llm/LlmService');

const mockExpoFetch = jest.fn();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));

const MockedLlmService = LlmService as jest.MockedClass<typeof LlmService>;
const expoFileSystemMock = jest.requireMock('expo-file-system') as {
  __getStore: () => Record<string, string | Uint8Array>;
  __resetStore: () => void;
};
const PNG_WITHOUT_ALPHA_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x49, 0x44, 0x41, 0x54, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00,
]).toString('base64');

describe('imageGeneration service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    expoFileSystemMock.__resetStore();
  });

  it('persists base64 image output to the conversation workspace when a conversation is provided', async () => {
    MockedLlmService.prototype.generateImage.mockResolvedValue({
      model: 'gpt-image-1.5',
      b64_json: 'YmFzZTY0',
      outputFormat: 'png',
      revisedPrompt: 'revised',
    });

    const result = await generateImage(
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-image-1.5',
        enabled: true,
      },
      {
        prompt: 'A cat astronaut',
        quality: 'high',
        conversationId: 'conv-123',
      },
    );

    expect(result.status).toBe('generated');
    expect(result.fileUri).toContain('/workspace/conv-123/');
    expect(result.workspacePath).toBe(result.fileName);
    expect(result.size).toBe(6);

    const store = expoFileSystemMock.__getStore();
    const written = store[result.fileUri];
    expect(written).toBeInstanceOf(Uint8Array);
    expect(Array.from(written as Uint8Array)).toEqual([98, 97, 115, 101, 54, 52]);
  });

  it('derives the workspace path from legacy generated image results when the file lives in the conversation workspace', () => {
    const parsed = parseGeneratedImageResult(
      JSON.stringify({
        status: 'generated',
        providerId: 'openai',
        model: 'gpt-image-1.5',
        mimeType: 'image/png',
        fileUri: 'file:///mock/document/workspace/conv-123/images/generated-image.png',
        fileName: 'generated-image.png',
        size: 2048,
      }),
    );

    expect(parsed?.workspacePath).toBe('images/generated-image.png');
    expect(buildGeneratedImageAttachment('tool-1', parsed!)).toEqual(
      expect.objectContaining({
        workspacePath: 'images/generated-image.png',
      }),
    );
  });

  it('parses edited image results and preserves edit metadata', () => {
    const parsed = parseGeneratedImageResult(
      JSON.stringify({
        status: 'edited',
        providerId: 'openai',
        model: 'gpt-image-1.5',
        mimeType: 'image/png',
        fileUri: 'file:///mock/documents/workspace/conv-123/edited-image.png',
        fileName: 'edited-image.png',
        size: 1024,
        sourceCount: 2,
        maskApplied: true,
      }),
    );

    expect(parsed).toEqual(
      expect.objectContaining({
        status: 'edited',
        sourceCount: 2,
        maskApplied: true,
        workspacePath: 'edited-image.png',
      }),
    );
  });

  it('preserves normalized image usage in parsed tool results', () => {
    const parsed = parseGeneratedImageResult(
      JSON.stringify({
        status: 'generated',
        providerId: 'openai',
        model: 'gpt-image-1.5',
        mimeType: 'image/png',
        fileUri: 'file:///mock/document/workspace/conv-123/generated-image.png',
        fileName: 'generated-image.png',
        size: 2048,
        usage: {
          model: 'gpt-image-1.5',
          inputTokens: 320,
          outputTokens: 960,
          totalTokens: 1280,
          tokenDetails: {
            inputTextTokens: 120,
            inputImageTokens: 200,
            outputImageTokens: 960,
          },
        },
      }),
    );

    expect(parsed?.usage).toEqual(
      expect.objectContaining({
        model: 'gpt-image-1.5',
        inputTokens: 320,
        outputTokens: 960,
        totalTokens: 1280,
        tokenDetails: expect.objectContaining({
          inputImageTokens: 200,
          outputImageTokens: 960,
        }),
      }),
    );
  });

  it('persists base64 image output to cache when no conversation is provided', async () => {
    MockedLlmService.prototype.generateImage.mockResolvedValue({
      model: 'gpt-image-1.5',
      b64_json: 'YmFzZTY0',
      outputFormat: 'png',
    });

    const result = await generateImage(
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-image-1.5',
        enabled: true,
      },
      {
        prompt: 'A cat astronaut',
      },
    );

    expect(result.fileUri).toContain(Paths.cache.uri);
    expect(result.workspacePath).toBeUndefined();
  });

  it('downloads remote image output into the conversation workspace', async () => {
    MockedLlmService.prototype.generateImage.mockResolvedValue({
      model: 'gpt-image-1.5',
      url: 'https://example.com/generated.png',
    });
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'image/png' : null),
      },
      bytes: async () => new Uint8Array([1, 2, 3, 4]),
    });

    const result = await generateImage(
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-image-1.5',
        enabled: true,
      },
      {
        prompt: 'A city skyline',
        conversationId: 'conv-remote',
      },
    );

    expect(mockExpoFetch).toHaveBeenCalledWith('https://example.com/generated.png');
    expect(result.fileUri).toContain('/workspace/conv-remote/');
    expect(result.remoteUrl).toBe('https://example.com/generated.png');
    expect(result.size).toBe(4);

    const store = expoFileSystemMock.__getStore();
    expect(store[result.fileUri]).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('rejects non-image downloads returned by remote image URLs', async () => {
    MockedLlmService.prototype.generateImage.mockResolvedValue({
      model: 'gpt-image-1.5',
      url: 'https://example.com/generated.png',
    });
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name: string) => {
          const normalized = name.toLowerCase();
          if (normalized === 'content-type') return 'text/html; charset=utf-8';
          if (normalized === 'content-length') return '18';
          return null;
        },
      },
      bytes: async () => new Uint8Array([60, 104, 116, 109, 108]),
    });

    await expect(
      generateImage(
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-image-1.5',
          enabled: true,
        },
        {
          prompt: 'A city skyline',
          conversationId: 'conv-remote',
        },
      ),
    ).rejects.toThrow('Image download returned non-image content-type');
  });

  it('fails fast when generated image bytes are not persisted', async () => {
    MockedLlmService.prototype.generateImage.mockResolvedValue({
      model: 'gpt-image-1.5',
      b64_json: 'YmFzZTY0',
      outputFormat: 'png',
    });

    const writeSpy = jest
      .spyOn(File.prototype, 'write')
      .mockImplementation(() => undefined as unknown as void);
    await expect(
      generateImage(
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-image-1.5',
          enabled: true,
        },
        {
          prompt: 'A cat astronaut',
          conversationId: 'conv-123',
        },
      ),
    ).rejects.toThrow('Generated image could not be persisted to local storage');
    writeSpy.mockRestore();
  });

  it('persists edited image output with source metadata to the conversation workspace', async () => {
    const sourceFile = new File(Paths.document, 'workspace', 'conv-edit', 'source.png');
    sourceFile.write(new Uint8Array([1, 2, 3, 4]));
    const maskFile = new File(Paths.document, 'workspace', 'conv-edit', 'mask.png');
    maskFile.write(new Uint8Array([5, 6, 7, 8]));

    MockedLlmService.prototype.editImage.mockResolvedValue({
      model: 'gpt-image-1.5',
      b64_json: 'RURJVA==',
      outputFormat: 'png',
      revisedPrompt: 'edited prompt',
    });

    const result = await editImage(
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-image-1.5',
        enabled: true,
      },
      {
        prompt: 'Add a red scarf but keep the cat unchanged',
        images: [{ uri: sourceFile.uri, name: 'source.png', mimeType: 'image/png' }],
        mask: { uri: maskFile.uri, name: 'mask.png', mimeType: 'image/png' },
        conversationId: 'conv-edit',
        inputFidelity: 'high',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'edited',
        sourceCount: 1,
        maskApplied: true,
        revisedPrompt: 'edited prompt',
      }),
    );
    expect(MockedLlmService.prototype.editImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Add a red scarf but keep the cat unchanged',
        inputFidelity: 'high',
        images: [expect.objectContaining({ uri: sourceFile.uri })],
        mask: expect.objectContaining({ uri: maskFile.uri }),
      }),
    );
  });

  it('rejects explicit masks for Gemini image editing', async () => {
    const sourceFile = new File(Paths.document, 'workspace', 'conv-gemini', 'source.png');
    sourceFile.write(new Uint8Array([1, 2, 3, 4]));

    await expect(
      editImage(
        {
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'gemini-key',
          model: 'gemini-3.1-flash-image-preview',
          enabled: true,
        },
        {
          prompt: 'Change only the lamp shade to green',
          images: [
            {
              uri: sourceFile.uri,
              name: 'source.png',
              mimeType: 'image/png',
              base64: 'AQIDBA==',
            },
          ],
          mask: {
            uri: 'file:///mock/documents/workspace/conv-gemini/mask.png',
            name: 'mask.png',
            mimeType: 'image/png',
          },
        },
      ),
    ).rejects.toThrow('Gemini image editing does not support explicit mask inputs');
  });

  it('rejects remote OpenAI edit inputs that are not uploadable local files', async () => {
    await expect(
      editImage(
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-image-1.5',
          enabled: true,
        },
        {
          prompt: 'Add a red scarf but keep the cat unchanged',
          images: [
            { uri: 'https://example.com/source.png', name: 'source.png', mimeType: 'image/png' },
          ],
        },
      ),
    ).rejects.toThrow('Input image #1 must reference a local device file');
  });

  it('rejects PNG masks without an alpha channel before calling OpenAI edits', async () => {
    const sourceFile = new File(Paths.document, 'workspace', 'conv-mask', 'source.png');
    sourceFile.write(new Uint8Array([1, 2, 3, 4]));
    const maskFile = new File(Paths.document, 'workspace', 'conv-mask', 'mask.png');
    maskFile.write(new Uint8Array([5, 6, 7, 8]));

    await expect(
      editImage(
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-image-1.5',
          enabled: true,
        },
        {
          prompt: 'Only replace the masked area',
          images: [{ uri: sourceFile.uri, name: 'source.png', mimeType: 'image/png' }],
          mask: {
            uri: maskFile.uri,
            name: 'mask.png',
            mimeType: 'image/png',
            base64: PNG_WITHOUT_ALPHA_BASE64,
          },
        },
      ),
    ).rejects.toThrow('PNG image edit masks must include an alpha channel');

    expect(MockedLlmService.prototype.editImage).not.toHaveBeenCalled();
  });

  it('rejects unsupported anthropic image generation', async () => {
    await expect(
      generateImage(
        {
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'sk-test',
          model: 'claude-sonnet-4-6',
          enabled: true,
        },
        {
          prompt: 'A dragon',
        },
      ),
    ).rejects.toThrow('Image generation is not supported by Anthropic');
  });
});
