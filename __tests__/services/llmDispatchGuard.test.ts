import { finalizeProviderConfig } from '../../src/constants/api';
import { sendLlmMessage } from '../../src/services/llm/messageService';
import { streamLlmMessage } from '../../src/services/llm/streamService';

const provider = finalizeProviderConfig({
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  model: 'gpt-5-mini',
  enabled: true,
});

describe('LLM provider dispatch guard', () => {
  it('fails a non-streaming request before transport invocation', () => {
    const performFetch = jest.fn();
    const requestDispatchGuard = jest.fn(() => {
      throw new Error('request generation expired');
    });

    expect(() =>
      sendLlmMessage({
        provider,
        messages: [{ role: 'user', content: 'Continue' }],
        options: { requestDispatchGuard },
        performFetch,
      }),
    ).toThrow('request generation expired');
    expect(requestDispatchGuard).toHaveBeenCalledTimes(1);
    expect(performFetch).not.toHaveBeenCalled();
  });

  it('fails a streaming request before transport invocation', async () => {
    const performFetch = jest.fn();
    const requestDispatchGuard = jest.fn(() => {
      throw new Error('request generation expired');
    });
    const stream = streamLlmMessage({
      provider,
      messages: [{ role: 'user', content: 'Continue' }],
      options: { requestDispatchGuard },
      performFetch,
    });

    await expect(stream.next()).rejects.toThrow('request generation expired');
    expect(requestDispatchGuard).toHaveBeenCalledTimes(1);
    expect(performFetch).not.toHaveBeenCalled();
  });
});
