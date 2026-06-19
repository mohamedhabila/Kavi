import {
  CONV_ID,
  setupToolDispatcherHarness,
  type ToolDispatcherHarness,
} from '../helpers/toolDispatcherHarness';

let executeTool: ToolDispatcherHarness['executeTool'];
let sessionLaunchMod: ToolDispatcherHarness['sessionLaunchMod'];
let generateImage: ToolDispatcherHarness['generateImage'];
let editImage: ToolDispatcherHarness['editImage'];

beforeEach(() => {
  const harness = setupToolDispatcherHarness();
  executeTool = harness.executeTool;
  sessionLaunchMod = harness.sessionLaunchMod;
  generateImage = harness.generateImage;
  editImage = harness.editImage;
});

describe('executeTool — core tools routing', () => {
  it('routes image_generate', async () => {
    const result = await executeTool('image_generate', '{"prompt":"cat"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('generated');
    expect(parsed.fileUri).toBe('file:///mock/cache/generated.png');
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
      { prompt: 'cat', conversationId: CONV_ID },
    );
  });

  it('handles image_generate failure gracefully', async () => {
    (generateImage as jest.Mock).mockRejectedValueOnce(
      new Error('Anthropic does not support image generation'),
    );
    const result = await executeTool('image_generate', '{"prompt":"cat"}', CONV_ID);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('error');
    expect(parsed.message).toContain('Anthropic');
  });

  it('routes image_edit', async () => {
    const result = await executeTool(
      'image_edit',
      '{"prompt":"Add a teal scarf","imagePath":"assets/cat.png"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('edited');
    expect(parsed.fileUri).toBe('file:///mock/cache/edited.png');
    expect(editImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
      expect.objectContaining({
        prompt: 'Add a teal scarf',
        conversationId: CONV_ID,
        images: [
          expect.objectContaining({
            uri: 'file:///mock/documents/workspace/test-conv-123/assets/cat.png',
          }),
        ],
      }),
    );
  });

  it('handles image_edit failure gracefully', async () => {
    (editImage as jest.Mock).mockRejectedValueOnce(
      new Error('Image editing requires at least one input image'),
    );
    const result = await executeTool(
      'image_edit',
      '{"prompt":"Add a teal scarf","imagePath":"assets/cat.png"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('error');
    expect(parsed.message).toContain('requires at least one input image');
  });

  it('sessions_spawn passes resolved provider', async () => {
    await executeTool('sessions_spawn', '{"prompt":"hello"}', CONV_ID);
    expect(sessionLaunchMod.executeSessionSpawn).toHaveBeenCalledWith(
      { prompt: 'hello' },
      CONV_ID,
      expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
      expect.any(Array),
      'gpt-image-2',
      {
        controlGraphGoals: undefined,
        agentRunId: undefined,
      },
    );
  });

  it('sessions_send passes resolved provider', async () => {
    await executeTool('sessions_send', '{"sessionId":"s1","message":"hi"}', CONV_ID);
    expect(sessionLaunchMod.executeSessionSend).toHaveBeenCalledWith(
      { sessionId: 's1', message: 'hi' },
      expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
      undefined,
    );
  });

  it('sessions_spawn passes the parent runtime model instead of the provider default', async () => {
    await executeTool('sessions_spawn', '{"prompt":"hello"}', CONV_ID, {
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-parent',
        model: 'claude-default',
        enabled: true,
      },
      allProviders: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'sk-parent',
          model: 'claude-default',
          enabled: true,
        },
      ],
      model: 'claude-3-7-sonnet-20250219',
    });

    expect(sessionLaunchMod.executeSessionSpawn).toHaveBeenCalledWith(
      { prompt: 'hello' },
      CONV_ID,
      expect.objectContaining({
        id: 'anthropic',
        model: 'claude-3-7-sonnet-20250219',
      }),
      expect.arrayContaining([
        expect.objectContaining({
          id: 'anthropic',
          model: 'claude-3-7-sonnet-20250219',
        }),
      ]),
      'claude-3-7-sonnet-20250219',
      {
        controlGraphGoals: undefined,
        agentRunId: undefined,
      },
    );
  });

  it('sessions_send passes the parent runtime model instead of the provider default', async () => {
    await executeTool('sessions_send', '{"sessionId":"s1","message":"hi"}', CONV_ID, {
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-parent',
        model: 'claude-default',
        enabled: true,
      },
      model: 'claude-3-7-sonnet-20250219',
    });

    expect(sessionLaunchMod.executeSessionSend).toHaveBeenCalledWith(
      { sessionId: 's1', message: 'hi' },
      expect.objectContaining({
        id: 'anthropic',
        model: 'claude-3-7-sonnet-20250219',
      }),
      'claude-3-7-sonnet-20250219',
    );
  });
});
