import {
  isContextOverflowProviderError,
  isNonRetryableProviderRequestError,
} from '../../../src/services/llm/support/requestErrors';

describe('requestErrors', () => {
  it('treats context overflow request errors as retryable', () => {
    const error = new Error('LLM API error 400: maximum context length exceeded');

    expect(isContextOverflowProviderError(error)).toBe(true);
    expect(isNonRetryableProviderRequestError(error)).toBe(false);
  });

  it('treats typed local context pressure as retryable overflow', () => {
    const error = {
      code: 'LOCAL_LLM_CONTEXT_PRESSURE',
      message: 'local pressure',
    };

    expect(isContextOverflowProviderError(error)).toBe(true);
    expect(isNonRetryableProviderRequestError(error)).toBe(false);
  });

  it('keeps deterministic malformed requests non-retryable', () => {
    const error = new Error(
      'LLM API error 400 invalid_request_error: tool_result blocks must follow tool_use blocks',
    );

    expect(isContextOverflowProviderError(error)).toBe(false);
    expect(isNonRetryableProviderRequestError(error)).toBe(true);
  });
});
