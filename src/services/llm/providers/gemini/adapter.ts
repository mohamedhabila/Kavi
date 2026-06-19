import type {
  ChatCompletionMessage,
  MessageRequestOptions,
} from '../../support/contracts';
import { buildDeclaredToolNameSet } from '../../core/toolNameFilter';

type GeminiImplicitPromptCacheEvent = {
  event: 'provider_managed' | 'skip';
  reason: string;
};

function recordGeminiPromptCacheEvent(
  options: MessageRequestOptions,
  event: GeminiImplicitPromptCacheEvent,
): void {
  const promptCache = options.usageTelemetry?.promptCache;
  if (!promptCache) {
    return;
  }

  promptCache.event = event.event;
  promptCache.reason = `gemini_${event.reason}`;
}

export async function sendGeminiNative(args: {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  messages: ChatCompletionMessage[];
  options: MessageRequestOptions;
  buildGeminiModelName: (model: string) => string;
  buildGeminiRequestBody: (
    baseUrl: string,
    model: string,
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions,
    structuredOutputSyntax?: 'responseFormat' | 'responseSchema',
  ) => Record<string, any>;
  buildGeminiGenerateContentUrl: (
    baseUrl: string,
    model: string,
    methodName: string,
  ) => string;
  shouldRetryGeminiStructuredOutputWithLegacySyntax: (
    status: number,
    errorText: string,
    body: Record<string, any>,
  ) => boolean;
  normalizeGeminiResponse: (
    json: any,
    options?: { declaredToolNames?: ReadonlySet<string> },
  ) => any;
  attachProviderResponse: (payload: any, provider: 'gemini', raw: any) => any;
  splitCacheableSystemPromptSections: (
    sections: MessageRequestOptions['systemPromptSections'],
  ) => { cacheableText?: string; dynamicText?: string };
  performFetch: (
    url: string,
    init: RequestInit,
    preferStreaming?: boolean,
  ) => Promise<Response>;
}): Promise<any> {
  const geminiModel = args.buildGeminiModelName(args.model);
  const body = args.buildGeminiRequestBody(
    args.baseUrl,
    geminiModel,
    args.messages,
    args.options,
  );
  const declaredToolNames = buildDeclaredToolNameSet(args.options.tools);
  const { cacheableText } = args.splitCacheableSystemPromptSections(
    args.options.systemPromptSections,
  );

  if (args.options.enablePromptCaching && cacheableText) {
    recordGeminiPromptCacheEvent(args.options, {
      event: 'provider_managed',
      reason: 'implicit_cache',
    });
  } else if (args.options.enablePromptCaching && !cacheableText) {
    recordGeminiPromptCacheEvent(args.options, {
      event: 'skip',
      reason: 'no_cacheable_system_prompt',
    });
  }

  const methodName = args.options.stream
    ? 'streamGenerateContent?alt=sse'
    : 'generateContent';
  const requestHeaders = args.options.stream
    ? { ...args.headers, Accept: 'text/event-stream' }
    : args.headers;

  let response = await args.performFetch(
    args.buildGeminiGenerateContentUrl(args.baseUrl, args.model, methodName),
    {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: args.options.signal,
    },
    args.options.stream ?? false,
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    if (
      !args.options.stream &&
      args.shouldRetryGeminiStructuredOutputWithLegacySyntax(
        response.status,
        errorText,
        body,
      )
    ) {
      const retryBody = args.buildGeminiRequestBody(
        args.baseUrl,
        geminiModel,
        args.messages,
        args.options,
        'responseSchema',
      );
      response = await args.performFetch(
        args.buildGeminiGenerateContentUrl(args.baseUrl, args.model, methodName),
        {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(retryBody),
          signal: args.options.signal,
        },
        false,
      );
      if (response.ok) {
        const json = await response.json();
        return args.attachProviderResponse(
          args.normalizeGeminiResponse(json, { declaredToolNames }),
          'gemini',
          json,
        );
      }

      const retryErrorText = await response.text().catch(() => response.statusText);
      throw new Error(`LLM API error ${response.status}: ${retryErrorText}`);
    }
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }

  if (args.options.stream) {
    return response;
  }

  const json = await response.json();
  return args.attachProviderResponse(
    args.normalizeGeminiResponse(json, { declaredToolNames }),
    'gemini',
    json,
  );
}
