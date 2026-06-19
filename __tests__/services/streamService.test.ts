import type { LlmProviderConfig } from '../../src/types/provider';
import { streamLlmMessage } from '../../src/services/llm/streamService';

const mockSendLlmMessage = jest.fn();
const mockStreamOpenAICompatibleChat = jest.fn();

jest.mock('../../src/services/llm/messageService', () => ({
  sendLlmMessage: (...args: any[]) => mockSendLlmMessage(...args),
}));

jest.mock('../../src/services/llm/providers/openaiChat/stream', () => ({
  streamOpenAICompatibleChat: (...args: any[]) => mockStreamOpenAICompatibleChat(...args),
}));

function makeProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'provider',
    name: 'Provider',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-5.4',
    enabled: true,
    ...overrides,
  };
}

async function collectEvents(generator: AsyncGenerator<any>): Promise<any[]> {
  const events: any[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('streamService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendLlmMessage.mockResolvedValue({});
    mockStreamOpenAICompatibleChat.mockImplementation(async function* (args: any) {
      yield {
        type: 'done',
        content: args.geminiTarget ? 'gemini' : 'non-gemini',
        completion: {
          completionStatus: 'complete',
        },
      };
    });
  });

  it('uses canonical provider family metadata for Gemini-compatible streaming through proxy transports', async () => {
    const provider = makeProvider({
      id: 'vertex-proxy',
      name: 'Corporate Relay',
      providerFamily: 'gemini',
      baseUrl:
        'https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1/endpoints/openapi',
      model: 'internal-proxy-model',
    });

    const events = await collectEvents(
      streamLlmMessage({
        provider,
        messages: [{ role: 'user', content: 'Hello' }],
        performFetch: jest.fn() as any,
      }),
    );

    expect(events.at(-1)?.content).toBe('gemini');
    expect(mockStreamOpenAICompatibleChat).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiTarget: true,
      }),
    );
  });

  it('falls back to hosted model family for Gemini models on compatible providers', async () => {
    const provider = makeProvider({
      id: 'openrouter',
      name: 'OpenRouter',
      providerFamily: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-2.5-pro',
    });

    const events = await collectEvents(
      streamLlmMessage({
        provider,
        messages: [{ role: 'user', content: 'Hello' }],
        performFetch: jest.fn() as any,
      }),
    );

    expect(events.at(-1)?.content).toBe('gemini');
    expect(mockStreamOpenAICompatibleChat).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiTarget: true,
      }),
    );
  });

  it('does not mark non-Gemini compatible streams as Gemini targets', async () => {
    const provider = makeProvider({
      id: 'corp-relay',
      name: 'Corporate Relay',
      providerFamily: 'custom',
      baseUrl: 'https://relay.example.com/v1',
      model: 'gpt-5.4',
    });

    const events = await collectEvents(
      streamLlmMessage({
        provider,
        messages: [{ role: 'user', content: 'Hello' }],
        performFetch: jest.fn() as any,
      }),
    );

    expect(events.at(-1)?.content).toBe('non-gemini');
    expect(mockStreamOpenAICompatibleChat).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiTarget: false,
      }),
    );
  });
});
