import {
  classifyNativeTransportErrorIdentity,
  classifyProviderError,
  createProviderRequestError,
} from '../../../src/services/llm/support/providerErrorClassification';

function anthropicBody(type: string, message: string): string {
  return JSON.stringify({ type: 'error', error: { type, message } });
}

function openAiBody(type: string, message: string, code?: string): string {
  return JSON.stringify({ error: { type, code, message } });
}

function geminiBody(status: string, message: string, code = 400): string {
  return JSON.stringify({ error: { code, status, message } });
}

describe('classifyProviderError — structured provider error bodies', () => {
  it('classifies each Anthropic error.type', () => {
    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'anthropic',
          status: 400,
          bodyText: anthropicBody('invalid_request_error', '参数格式不正确'),
        }),
      ),
    ).toMatchObject({ kind: 'invalid_request', classifiedBy: 'structured', retryable: false });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'anthropic',
          status: 401,
          bodyText: anthropicBody('authentication_error', 'clave de API inválida'),
        }),
      ),
    ).toMatchObject({ kind: 'auth', retryable: false, failoverEligible: false });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'anthropic',
          status: 403,
          bodyText: anthropicBody('permission_error', 'permission refusée'),
        }),
      ),
    ).toMatchObject({ kind: 'permission', retryable: false, failoverEligible: false });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'anthropic',
          status: 404,
          bodyText: anthropicBody('not_found_error', 'モデルが見つかりません'),
        }),
      ),
    ).toMatchObject({ kind: 'invalid_request', retryable: false });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'anthropic',
          status: 429,
          bodyText: anthropicBody('rate_limit_error', 'Zu viele Anfragen'),
        }),
      ),
    ).toMatchObject({ kind: 'rate_limited', retryable: true, failoverEligible: true });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'anthropic',
          status: 529,
          bodyText: anthropicBody('overloaded_error', 'Overloaded'),
        }),
      ),
    ).toMatchObject({ kind: 'server', retryable: true, failoverEligible: true });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'anthropic',
          status: 500,
          bodyText: anthropicBody('api_error', 'Internal error'),
        }),
      ),
    ).toMatchObject({ kind: 'server', retryable: true, failoverEligible: true });
  });

  it('narrows Anthropic invalid_request_error to context_overflow only when the message confirms it', () => {
    const result = classifyProviderError(
      createProviderRequestError({
        providerFamily: 'anthropic',
        status: 400,
        bodyText: anthropicBody('invalid_request_error', 'prompt is too long: maximum context length exceeded'),
      }),
    );

    expect(result).toMatchObject({
      kind: 'context_overflow',
      classifiedBy: 'structured',
      retryable: true,
      failoverEligible: false,
    });
  });

  it('classifies OpenAI context_length_exceeded from the structured code, independent of message language', () => {
    const result = classifyProviderError(
      createProviderRequestError({
        providerFamily: 'openai',
        status: 400,
        bodyText: openAiBody('invalid_request_error', 'このモデルの最大コンテキスト長を超えました', 'context_length_exceeded'),
      }),
    );

    expect(result).toMatchObject({
      kind: 'context_overflow',
      classifiedBy: 'structured',
      retryable: true,
      providerErrorCode: 'context_length_exceeded',
    });
  });

  it('classifies an OpenAI invalid_request_error without the overflow code as invalid_request', () => {
    const result = classifyProviderError(
      createProviderRequestError({
        providerFamily: 'openai',
        status: 400,
        bodyText: openAiBody('invalid_request_error', 'missing required field: model'),
      }),
    );

    expect(result).toMatchObject({ kind: 'invalid_request', classifiedBy: 'structured', retryable: false });
  });

  it('classifies Gemini error.status values', () => {
    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'gemini',
          status: 429,
          bodyText: geminiBody('RESOURCE_EXHAUSTED', '配额已用尽', 429),
        }),
      ),
    ).toMatchObject({ kind: 'rate_limited', retryable: true, failoverEligible: true });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'gemini',
          status: 400,
          bodyText: geminiBody('INVALID_ARGUMENT', 'input token count exceeds the maximum context length'),
        }),
      ),
    ).toMatchObject({ kind: 'context_overflow', retryable: true });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'gemini',
          status: 400,
          bodyText: geminiBody('INVALID_ARGUMENT', 'invalid field mask'),
        }),
      ),
    ).toMatchObject({ kind: 'invalid_request', retryable: false });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'gemini',
          status: 403,
          bodyText: geminiBody('PERMISSION_DENIED', 'permesso negato', 403),
        }),
      ),
    ).toMatchObject({ kind: 'permission', retryable: false });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'gemini',
          status: 401,
          bodyText: geminiBody('UNAUTHENTICATED', 'chave de API inválida', 401),
        }),
      ),
    ).toMatchObject({ kind: 'auth', retryable: false });

    expect(
      classifyProviderError(
        createProviderRequestError({
          providerFamily: 'gemini',
          status: 503,
          bodyText: geminiBody('UNAVAILABLE', 'service unavailable', 503),
        }),
      ),
    ).toMatchObject({ kind: 'server', retryable: true, failoverEligible: true });
  });
});

describe('classifyProviderError — native transport identity (tier 1, never message text)', () => {
  it('classifies a DOMException AbortError regardless of message language', () => {
    const error =
      typeof DOMException !== 'undefined'
        ? new DOMException('Опрос отменён', 'AbortError')
        : Object.assign(new Error('Опрос отменён'), { name: 'AbortError' });

    expect(classifyNativeTransportErrorIdentity(error)).toBe('aborted');

    const classification = classifyProviderError(error);
    expect(classification).toMatchObject({
      kind: 'aborted',
      classifiedBy: 'structured',
      retryable: true,
      failoverEligible: false,
    });
  });

  it('classifies Node network error codes as network, not from message text', () => {
    const error = Object.assign(new Error('kaboom'), { code: 'ECONNRESET' });
    expect(classifyProviderError(error)).toMatchObject({
      kind: 'network',
      classifiedBy: 'structured',
      retryable: true,
      failoverEligible: true,
    });
  });

  it('classifies Node timeout error codes as timeout', () => {
    const error = Object.assign(new Error('kaboom'), { code: 'ETIMEDOUT' });
    expect(classifyProviderError(error)).toMatchObject({ kind: 'timeout', classifiedBy: 'structured' });
  });

  it('distinguishes a plain-Error TimeoutError identity (the request transport shape) from AbortError', () => {
    // This is exactly the shape src/services/llm/core/fetchTransport.ts's
    // createAbortError() throws when the abort came from
    // createTimeoutSignal() — a bare Error, not a DOMException — so a
    // timeout must be retryable AND failover-eligible ...
    const timeoutError = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
    expect(classifyProviderError(timeoutError)).toMatchObject({
      kind: 'timeout',
      classifiedBy: 'structured',
      retryable: true,
      failoverEligible: true,
    });

    // ... while a user cancellation (name: 'AbortError') must be retryable
    // locally but never trigger a provider failover, and this must be
    // decided from the error's identity alone — both errors here carry
    // unrelated, non-diagnostic message text to prove message content is
    // not what drives the decision.
    const cancelError = Object.assign(new Error('operación cancelada por el usuario'), {
      name: 'AbortError',
    });
    expect(classifyProviderError(cancelError)).toMatchObject({
      kind: 'aborted',
      classifiedBy: 'structured',
      retryable: true,
      failoverEligible: false,
    });
  });

  it('classifies a bare TypeError from a failed fetch as network', () => {
    const error = new TypeError('Network request failed');
    expect(classifyProviderError(error)).toMatchObject({
      kind: 'network',
      classifiedBy: 'structured',
      failoverEligible: true,
    });
  });

  it('classifies the local context-pressure marker as context_overflow regardless of message', () => {
    const error = { code: 'LOCAL_LLM_CONTEXT_PRESSURE', message: '本地上下文压力过大' };
    expect(classifyProviderError(error)).toMatchObject({
      kind: 'context_overflow',
      classifiedBy: 'structured',
      retryable: true,
    });
  });
});

describe('classifyProviderError — status tier and prose fallback', () => {
  it('classifies a non-English message carrying only a 429 status as rate_limited/retryable', () => {
    const error = createProviderRequestError({
      providerFamily: 'openai',
      status: 429,
      bodyText: '请求过多，请稍后重试',
    });

    expect(classifyProviderError(error)).toMatchObject({
      kind: 'rate_limited',
      classifiedBy: 'status',
      retryable: true,
      failoverEligible: true,
      status: 429,
    });
  });

  it('classifies non-English 401/500 statuses without needing English text', () => {
    expect(
      classifyProviderError(
        createProviderRequestError({ providerFamily: 'openai', status: 401, bodyText: '認証エラー' }),
      ),
    ).toMatchObject({ kind: 'auth', retryable: false, failoverEligible: false });

    expect(
      classifyProviderError(
        createProviderRequestError({ providerFamily: 'openai', status: 500, bodyText: 'interner Fehler' }),
      ),
    ).toMatchObject({ kind: 'server', retryable: true, failoverEligible: true });
  });

  it('classifies an AbortError with no status via native identity even when the message is unrelated prose', () => {
    const error = Object.assign(new Error('La operación fue cancelada por el usuario'), {
      name: 'AbortError',
    });

    expect(classifyProviderError(error)).toMatchObject({
      kind: 'aborted',
      classifiedBy: 'structured',
      retryable: true,
      failoverEligible: false,
    });
  });

  it('falls back to prose matching for an unknown-shape error and records classifiedBy: prose_fallback', () => {
    const error = new Error('schema too complex for this request');
    expect(classifyProviderError(error)).toMatchObject({
      kind: 'invalid_request',
      classifiedBy: 'prose_fallback',
      retryable: false,
    });
  });

  it('falls back to network prose only when no status is present at all', () => {
    const error = new Error('socket hang up');
    expect(classifyProviderError(error)).toMatchObject({
      kind: 'network',
      classifiedBy: 'prose_fallback',
      retryable: true,
      failoverEligible: true,
    });
  });

  it('classifies a truly unrecognized error as unknown/retryable but not failover-eligible', () => {
    const error = new Error('something unexpected happened');
    expect(classifyProviderError(error)).toMatchObject({
      kind: 'unknown',
      classifiedBy: 'prose_fallback',
      retryable: true,
      failoverEligible: false,
    });
  });
});

describe('createProviderRequestError', () => {
  it('preserves the legacy "LLM API error N: body" message format for user-facing display', () => {
    const error = createProviderRequestError({
      providerFamily: 'anthropic',
      status: 400,
      bodyText: 'plain text body',
    });

    expect(error.message).toBe('LLM API error 400: plain text body');
    expect(error.status).toBe(400);
    expect(error.providerFamily).toBe('anthropic');
  });

  it('tolerates a non-JSON error body without throwing', () => {
    const error = createProviderRequestError({
      providerFamily: 'anthropic',
      status: 502,
      bodyText: '<html><body>Bad Gateway</body></html>',
    });

    expect(classifyProviderError(error)).toMatchObject({ kind: 'server', classifiedBy: 'status' });
  });
});
