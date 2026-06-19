import { DEFAULT_GEMINI_BASE_URL } from '../../src/constants/api';
import { getThinkingParams } from '../../src/engine/thinking';
import { buildToolDefinitions } from '../../src/engine/tools/definitions';
import { enforceContextBudget } from '../../src/services/context/budgetManager';
import { LlmService } from '../../src/services/llm/LlmService';
import type { LlmProviderConfig } from '../../src/types/provider';
import type { ToolDefinition } from '../../src/types/tool';

const describeLive = process.env.RUN_LIVE_NATIVE_PROVIDER_CHECKS === '1' ? describe : describe.skip;
const itLive = process.env.RUN_LIVE_NATIVE_PROVIDER_CHECKS === '1' ? it : it.skip;

const SYSTEM_PROMPT =
  'You are Kavi. When the user asks for file contents, use the read_file tool instead of guessing. If an exact file path is already provided, call read_file directly.';
const TOOL_PROMPT = 'Read the file at /workspace/app-status.txt and tell me the first line only.';
const TOOL_RESULT_CONTENT =
  'Provider native support is enabled.\nAll core provider transports are active.';

type CapturedRequest = {
  url: string;
  body: any;
  headers: Record<string, string>;
};

type StreamResult = {
  content: string;
  reasoning: string;
  toolCalls: Array<{ id: string; name: string; arguments: string; raw?: Record<string, any> }>;
  usages: Array<{
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }>;
};

function resolveAnthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY;
}

function resolveGeminiApiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  );
}

function normalizeCapturedHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, String(value)]));
  }

  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

async function captureFetches<T>(
  run: () => Promise<T>,
): Promise<{ result: T; requests: CapturedRequest[] }> {
  const originalFetch = global.fetch;
  const requests: CapturedRequest[] = [];

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let parsedBody: any = init?.body;
    if (typeof init?.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }

    requests.push({
      url: String(input),
      body: parsedBody,
      headers: normalizeCapturedHeaders(init?.headers),
    });

    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const result = await run();
    return { result, requests };
  } finally {
    global.fetch = originalFetch;
  }
}

function buildPreferredToolSet(provider: LlmProviderConfig, prompt: string): ToolDefinition[] {
  const _provider = provider;
  const _prompt = prompt;
  return buildToolDefinitions().filter((tool) => tool.name === 'read_file');
}

function buildBudgetedRequest(
  provider: LlmProviderConfig,
  systemPrompt: string,
  messages: Array<{
    role: string;
    content: string | any[];
    tool_call_id?: string;
    name?: string;
    [key: string]: any;
  }>,
  tools: ToolDefinition[],
  maxTokens: number,
) {
  const budget = enforceContextBudget(provider.model, systemPrompt, tools, messages, maxTokens);
  return {
    tools: budget.tools,
    messages: [{ role: 'system', content: budget.systemPrompt }, ...budget.messages],
    budget,
  };
}

async function collectStream(
  service: LlmService,
  messages: Array<{
    role: string;
    content: string | any[];
    tool_call_id?: string;
    name?: string;
    [key: string]: any;
  }>,
  options: Record<string, any>,
): Promise<StreamResult> {
  const result: StreamResult = {
    content: '',
    reasoning: '',
    toolCalls: [],
    usages: [],
  };

  for await (const event of service.streamMessage(messages as any, options)) {
    if (event.type === 'token' && event.content) {
      result.content += event.content;
    }
    if (event.type === 'reasoning' && event.content) {
      result.reasoning += event.content;
    }
    if (event.type === 'tool_call' && event.toolCall) {
      result.toolCalls.push(event.toolCall);
    }
    if (event.type === 'usage' && event.usage) {
      result.usages.push(event.usage);
    }
  }

  return result;
}

function getLastCapturedRequest(requests: CapturedRequest[]): CapturedRequest {
  const request = requests[requests.length - 1];
  if (!request) {
    throw new Error('Expected at least one captured request');
  }
  return request;
}

describeLive('LlmService native provider live validation', () => {
  jest.setTimeout(120_000);

  itLive(
    'validates Anthropic Haiku native Messages requests, thinking replay, and SSE streaming',
    async () => {
      const apiKey = resolveAnthropicApiKey();
      if (!apiKey) {
        throw new Error(
          'RUN_LIVE_NATIVE_PROVIDER_CHECKS=1 requires ANTHROPIC_API_KEY or a research-script fallback',
        );
      }

      const provider: LlmProviderConfig = {
        id: 'anthropic-live-native',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey,
        model: 'claude-haiku-4-5',
        enabled: true,
      };
      const service = new LlmService(provider);
      const tools = buildPreferredToolSet(provider, TOOL_PROMPT);
      expect(tools.map((tool) => tool.name)).toContain('read_file');

      const firstRequest = buildBudgetedRequest(
        provider,
        SYSTEM_PROMPT,
        [{ role: 'user', content: TOOL_PROMPT }],
        tools,
        4096,
      );
      const firstOptions = {
        tools: firstRequest.tools,
        maxTokens: 4096,
        temperature: 0.2,
        ...getThinkingParams('low', provider.model, { maxTokens: 4096 }),
      };

      const firstCall = await captureFetches(() =>
        service.sendMessage(firstRequest.messages as any, firstOptions as any),
      );
      const firstCaptured = getLastCapturedRequest(firstCall.requests);
      expect(firstCaptured.url).toContain('/messages');
      expect(firstCaptured.body.system).toContain('use the read_file tool');
      expect(Array.isArray(firstCaptured.body.messages)).toBe(true);
      expect(Array.isArray(firstCaptured.body.tools)).toBe(true);
      expect(firstCaptured.body.messages[0]?.role).toBe('user');
      expect(firstCaptured.body.messages[0]?.content).toBe(TOOL_PROMPT);
      expect(firstCaptured.body.tools[0]).toHaveProperty('input_schema');
      expect(firstCaptured.body.tools[0]).not.toHaveProperty('parameters');
      expect(firstCaptured.body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
      expect(firstCaptured.body.temperature).toBeUndefined();

      const firstResponse = firstCall.result;
      const firstToolCall = firstResponse.choices?.[0]?.message?.tool_calls?.[0];
      expect(firstToolCall?.function?.name).toBe('read_file');
      expect(typeof firstToolCall?.id).toBe('string');

      const assistantBlocks = firstResponse.choices?.[0]?.message?.providerReplay?.anthropicBlocks;
      expect(Array.isArray(assistantBlocks)).toBe(true);
      expect(
        assistantBlocks.some(
          (block: any) => block.type === 'tool_use' && block.name === 'read_file',
        ),
      ).toBe(true);
      expect(
        assistantBlocks.some(
          (block: any) =>
            block.type === 'thinking' &&
            typeof block.signature === 'string' &&
            block.signature.length > 0,
        ),
      ).toBe(true);

      const secondRequest = buildBudgetedRequest(
        provider,
        SYSTEM_PROMPT,
        [
          { role: 'user', content: TOOL_PROMPT },
          {
            role: 'assistant',
            content: firstResponse.choices?.[0]?.message?.content || '',
            providerReplay: firstResponse.choices?.[0]?.message?.providerReplay,
            tool_calls: firstResponse.choices?.[0]?.message?.tool_calls,
          },
          {
            role: 'tool',
            tool_call_id: firstToolCall.id,
            name: 'read_file',
            content: TOOL_RESULT_CONTENT,
          },
        ],
        tools,
        4096,
      );

      const secondCall = await captureFetches(() =>
        service.sendMessage(secondRequest.messages as any, firstOptions as any),
      );
      const secondCaptured = getLastCapturedRequest(secondCall.requests);
      expect(secondCaptured.url).toContain('/messages');
      expect(
        secondCaptured.body.messages.some(
          (message: any) =>
            message.role === 'assistant' &&
            Array.isArray(message.content) &&
            message.content.some(
              (block: any) => block.type === 'tool_use' && block.id === firstToolCall.id,
            ) &&
            message.content.some(
              (block: any) => block.type === 'thinking' && typeof block.signature === 'string',
            ),
        ),
      ).toBe(true);
      expect(
        secondCaptured.body.messages.some(
          (message: any) =>
            message.role === 'user' &&
            Array.isArray(message.content) &&
            message.content.some(
              (block: any) =>
                block.type === 'tool_result' && block.tool_use_id === firstToolCall.id,
            ),
        ),
      ).toBe(true);

      const anthropicFinalText = secondCall.result.choices?.[0]?.message?.content || '';
      expect(typeof anthropicFinalText).toBe('string');
      expect(anthropicFinalText).toMatch(/provider native support is enabled/i);

      const streamResult = await collectStream(
        service,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Reply with the single word READY.' },
        ],
        {
          model: provider.model,
          maxTokens: 256,
        },
      );

      expect(streamResult.content.length).toBeGreaterThan(0);
      expect(streamResult.content.toLowerCase()).toContain('ready');
    },
  );

  itLive(
    'validates Gemini 3 Flash Preview native generateContent requests, tool replay, and SSE streaming',
    async () => {
      const apiKey = resolveGeminiApiKey();
      if (!apiKey) {
        throw new Error(
          'RUN_LIVE_NATIVE_PROVIDER_CHECKS=1 requires GEMINI_API_KEY/GOOGLE_API_KEY or a research-script fallback',
        );
      }

      const provider: LlmProviderConfig = {
        id: 'gemini-live-native',
        name: 'Gemini',
        baseUrl: DEFAULT_GEMINI_BASE_URL,
        apiKey,
        model: 'gemini-3-flash-preview',
        enabled: true,
      };
      const service = new LlmService(provider);
      const tools = buildPreferredToolSet(provider, TOOL_PROMPT);
      expect(tools.map((tool) => tool.name)).toContain('read_file');

      const firstRequest = buildBudgetedRequest(
        provider,
        SYSTEM_PROMPT,
        [{ role: 'user', content: TOOL_PROMPT }],
        tools,
        4096,
      );
      const firstOptions = {
        model: provider.model,
        tools: firstRequest.tools,
        toolChoice: 'required',
        maxTokens: 4096,
        temperature: 1.0,
        ...getThinkingParams('medium', provider.model, { maxTokens: 4096 }),
      };
      const secondOptions = {
        ...firstOptions,
        toolChoice: 'auto',
      };

      const firstCall = await captureFetches(() =>
        service.sendMessage(firstRequest.messages as any, firstOptions as any),
      );
      const firstCaptured = getLastCapturedRequest(firstCall.requests);
      expect(firstCaptured.url).toContain('/models/gemini-3-flash-preview:generateContent');
      expect(firstCaptured.body.messages).toBeUndefined();
      expect(firstCaptured.body.systemInstruction?.parts?.[0]?.text).toContain(
        'use the read_file tool',
      );
      expect(Array.isArray(firstCaptured.body.contents)).toBe(true);
      expect(firstCaptured.body.contents[0]?.role).toBe('user');
      expect(Array.isArray(firstCaptured.body.tools?.[0]?.functionDeclarations)).toBe(true);
      expect(firstCaptured.body.tools?.[0]?.functionDeclarations?.[0]).toHaveProperty('parameters');
      expect(firstCaptured.body.tools?.[0]?.functionDeclarations?.[0]).not.toHaveProperty(
        'input_schema',
      );
      expect(firstCaptured.body.toolConfig?.functionCallingConfig?.mode).toBe('ANY');
      expect(firstCaptured.body.generationConfig?.temperature).toBe(1.0);
      expect(firstCaptured.body.generationConfig?.thinkingConfig?.thinkingLevel).toBe('MEDIUM');

      const firstResponse = firstCall.result;
      const firstToolCall = firstResponse.choices?.[0]?.message?.tool_calls?.[0];
      expect(firstToolCall?.function?.name).toBe('read_file');
      expect(typeof firstToolCall?.id).toBe('string');

      const secondRequest = buildBudgetedRequest(
        provider,
        SYSTEM_PROMPT,
        [
          { role: 'user', content: TOOL_PROMPT },
          {
            role: 'assistant',
            content: firstResponse.choices?.[0]?.message?.content || '',
            tool_calls: firstResponse.choices?.[0]?.message?.tool_calls,
          },
          {
            role: 'tool',
            tool_call_id: firstToolCall.id,
            name: 'read_file',
            content: TOOL_RESULT_CONTENT,
          },
        ],
        tools,
        4096,
      );

      const secondCall = await captureFetches(() =>
        service.sendMessage(secondRequest.messages as any, secondOptions as any),
      );
      const secondCaptured = getLastCapturedRequest(secondCall.requests);
      expect(secondCaptured.url).toContain('/models/gemini-3-flash-preview:generateContent');

      const modelFunctionCallPart = secondCaptured.body.contents
        .flatMap((content: any) => content.parts || [])
        .find((part: any) => part.functionCall?.name === firstToolCall.function?.name);
      const userFunctionResponsePart = secondCaptured.body.contents
        .flatMap((content: any) => content.parts || [])
        .find((part: any) => part.functionResponse?.name === firstToolCall.function?.name);

      expect(modelFunctionCallPart?.functionCall?.name).toBe('read_file');
      expect(modelFunctionCallPart?.functionCall).not.toHaveProperty('id');
      expect(
        typeof (
          modelFunctionCallPart?.thoughtSignature || modelFunctionCallPart?.thought_signature
        ),
      ).toBe('string');
      expect(userFunctionResponsePart?.functionResponse?.name).toBe('read_file');
      expect(userFunctionResponsePart?.functionResponse).not.toHaveProperty('id');
      expect(userFunctionResponsePart?.functionResponse?.response).toBeDefined();

      const geminiFinalText = secondCall.result.choices?.[0]?.message?.content || '';
      expect(typeof geminiFinalText).toBe('string');
      expect(geminiFinalText).toMatch(/provider native support is enabled/i);

      const streamResult = await collectStream(
        service,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Reply with the single word READY.' },
        ],
        {
          model: provider.model,
          maxTokens: 256,
          temperature: 1.0,
          ...getThinkingParams('minimal', provider.model, { maxTokens: 256 }),
        },
      );

      expect(streamResult.content.length).toBeGreaterThan(0);
      expect(streamResult.content.toLowerCase()).toContain('ready');
    },
  );
});
