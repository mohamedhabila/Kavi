import { readFileSync } from 'fs';
import path from 'path';

import { LlmService } from '../../src/services/llm/LlmService';

const describeLive = process.env.RUN_LIVE_ANTHROPIC === '1' ? describe : describe.skip;
const itLive = process.env.RUN_LIVE_ANTHROPIC === '1' ? it : it.skip;

describeLive('LlmService Anthropic Live Smoke', () => {
  jest.setTimeout(45_000);

  const apiKey = process.env.ANTHROPIC_API_KEY;

  itLive('accepts sanitized legacy tool history and multimodal user content', async () => {
    if (!apiKey) {
      throw new Error('RUN_LIVE_ANTHROPIC=1 requires ANTHROPIC_API_KEY');
    }

    const sampleImageBase64 = readFileSync(
      path.join(process.cwd(), 'assets', 'favicon.png'),
    ).toString('base64');

    const service = new LlmService({
      id: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey,
      model: 'claude-haiku-4-5',
      enabled: true,
    });

    const toolResponse = await service.sendMessage(
      [
        { role: 'user', content: 'Sort [3,1,2] using javascript.' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '' },
            { type: 'tool_use', id: 'toolu_1', name: 'javascript', input: {} },
          ],
        } as any,
        {
          role: 'tool',
          tool_call_id: 'toolu_1',
          name: 'javascript',
          content: "Error: 'code' is required for javascript and must be a string",
          is_error: true,
        } as any,
      ],
      {
        tools: [
          {
            name: 'javascript',
            description: 'Execute JavaScript.',
            input_schema: {
              type: 'object',
              properties: {
                code: { type: 'string' },
              },
              required: ['code'],
            },
          },
        ],
        maxTokens: 256,
      },
    );

    expect(toolResponse.choices?.[0]?.message?.tool_calls?.[0]?.function?.name).toBe('javascript');

    const visionResponse = await service.sendMessage(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image briefly.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${sampleImageBase64}` } },
          ],
        },
      ] as any,
      {
        maxTokens: 128,
      },
    );

    expect(typeof visionResponse.choices?.[0]?.message?.content).toBe('string');
    expect(visionResponse.choices?.[0]?.message?.content?.length).toBeGreaterThan(0);
  });
});
