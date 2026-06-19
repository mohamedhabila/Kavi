import type { ChatCompletionMessage, MessageRequestOptions } from '../../support/contracts';

export async function sendOpenAIResponses(args: {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  messages: ChatCompletionMessage[];
  options: MessageRequestOptions;
  buildOpenAIResponsesBody: (
    model: string,
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions,
  ) => Record<string, any>;
  performFetch: (
    url: string,
    init: RequestInit,
    preferStreaming?: boolean,
  ) => Promise<Response>;
  normalizeOpenAIResponsesResult: (json: any) => any;
  attachProviderResponse: (
    payload: any,
    provider: 'openai-responses',
    raw: any,
  ) => any;
}): Promise<any> {
  const body = args.buildOpenAIResponsesBody(args.model, args.messages, args.options);
  const requestHeaders = args.options.stream
    ? { ...args.headers, Accept: 'text/event-stream' }
    : args.headers;

  const response = await args.performFetch(
    `${args.baseUrl}/responses`,
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
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }

  if (args.options.stream) {
    return response;
  }

  const json = await response.json();
  return args.attachProviderResponse(
    args.normalizeOpenAIResponsesResult(json),
    'openai-responses',
    json,
  );
}
