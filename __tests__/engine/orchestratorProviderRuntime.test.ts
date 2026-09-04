import {
  isDirectAnthropicProvider,
  isIncompleteAssistantCompletion,
  shouldFailoverOnError,
} from '../../src/engine/orchestratorProviderRuntime';
import { createProviderRequestError } from '../../src/services/llm/support/providerErrorClassification';
import type { LlmProviderConfig } from '../../src/types/provider';

function makeProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'provider-1',
    name: 'Provider',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-5',
    enabled: true,
    ...overrides,
  };
}

describe('orchestratorProviderRuntime', () => {
  it('authorizes continuation past completion checks only for known provider dispositions', () => {
    expect(isIncompleteAssistantCompletion()).toBe(true);
    expect(
      isIncompleteAssistantCompletion({
        completionStatus: 'complete',
        finishReason: 'plausible_but_unowned_success',
      }),
    ).toBe(true);
    expect(
      isIncompleteAssistantCompletion({
        completionStatus: 'complete',
        finishReason: 'tool_calls',
      }),
    ).toBe(false);
    expect(
      isIncompleteAssistantCompletion({
        completionStatus: 'complete',
        finishReason: 'STOP',
      }),
    ).toBe(false);
    expect(
      isIncompleteAssistantCompletion({
        completionStatus: 'incomplete',
        finishReason: 'length',
      }),
    ).toBe(true);
  });

  it('honors explicit anthropic provider family metadata without rediscovering it from the URL', () => {
    expect(
      isDirectAnthropicProvider(
        makeProvider({
          name: 'Proxy Provider',
          providerFamily: 'anthropic',
          baseUrl: 'https://proxy.example.com/v1',
        }),
      ),
    ).toBe(true);
  });

  it('does not infer anthropic provider identity from a misleading provider name when metadata disagrees', () => {
    expect(
      isDirectAnthropicProvider(
        makeProvider({
          name: 'Anthropic via proxy',
          providerFamily: 'openai',
          baseUrl: 'https://proxy.example.com/v1',
        }),
      ),
    ).toBe(false);
  });

  it('fails over on network and 5xx errors regardless of message language', () => {
    expect(shouldFailoverOnError(new TypeError('Network request failed'))).toBe(true);
    expect(
      shouldFailoverOnError(
        createProviderRequestError({ providerFamily: 'openai', status: 503, bodyText: '服务不可用' }),
      ),
    ).toBe(true);
    expect(
      shouldFailoverOnError(
        createProviderRequestError({ providerFamily: 'openai', status: 429, bodyText: 'zu viele Anfragen' }),
      ),
    ).toBe(true);
  });

  it('does not fail over on 400 or 401 errors', () => {
    expect(
      shouldFailoverOnError(
        createProviderRequestError({ providerFamily: 'openai', status: 400, bodyText: 'bad request' }),
      ),
    ).toBe(false);
    expect(
      shouldFailoverOnError(
        createProviderRequestError({ providerFamily: 'openai', status: 401, bodyText: 'unauthorized' }),
      ),
    ).toBe(false);
  });
});
