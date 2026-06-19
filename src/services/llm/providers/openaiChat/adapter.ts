import { normalizeOpenAIPromptCacheKey } from '../../../context/tokenOptimization';
import { resolveModelOutputTokenBudget } from '../../../context/outputTokenBudget';
import { normalizeToolInputSchema } from '../../../../utils/toolSchema';
import { tryParseJson } from '../../core/json';
import { splitCacheableSystemPromptSections } from '../../core/systemPromptSections';
import type {
  ChatCompletionMessage,
  MessageRequestOptions,
  StructuredOutputOptions,
  ToolChoiceMode,
} from '../../support/contracts';

export async function sendOpenAICompatibleChat(args: {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  messages: ChatCompletionMessage[];
  options: MessageRequestOptions;
  isGeminiModel: (model: string) => boolean;
  supportsTemperature: (model: string) => boolean;
  isOpenAIReasoningModel: (model: string) => boolean;
  isOpenAIProvider: () => boolean;
  isOpenRouterProvider: () => boolean;
  isAnthropicModel: (model: string) => boolean;
  buildCompatibleStructuredOutputFormat: (
    structuredOutput: StructuredOutputOptions,
  ) => Record<string, any>;
  buildCompatibleToolChoice: (
    choice: ToolChoiceMode | undefined,
  ) => Record<string, any> | string | undefined;
  shouldDisableParallelToolUse: (choice: ToolChoiceMode | undefined) => boolean;
  normalizeOpenAIPromptCacheRetention: (
    retention?: MessageRequestOptions['promptCacheRetention'],
  ) => 'in_memory' | '24h';
  reorderToolsForPromptCaching: (
    tools: NonNullable<MessageRequestOptions['tools']>,
  ) => NonNullable<MessageRequestOptions['tools']>;
  normalizeStructuredOutputOptions: (
    value: unknown,
  ) => StructuredOutputOptions | undefined;
  strictifyOpenAiSchema: (schema: Record<string, any>) => Record<string, any>;
  isStrictCompatibleSchema: (schema: Record<string, any>) => boolean;
  performFetch: (
    url: string,
    init: RequestInit,
    preferStreaming?: boolean,
  ) => Promise<Response>;
}): Promise<any> {
  const appendDynamicTextToLatestUserMessage = (
    messages: ChatCompletionMessage[],
    dynamicText?: string,
  ): ChatCompletionMessage[] => {
    const text = dynamicText?.trim();
    if (!text) {
      return messages;
    }

    const updated = messages.map((message) => ({ ...message }));
    for (let index = updated.length - 1; index >= 0; index -= 1) {
      if (updated[index].role !== 'user') {
        continue;
      }

      const content = updated[index].content;
      updated[index] = {
        ...updated[index],
        content:
          typeof content === 'string'
            ? content.length > 0
              ? `${content}\n\n${text}`
              : text
            : Array.isArray(content)
              ? [...content, { type: 'text', text }]
              : text,
      };
      return updated;
    }

    return [...updated, { role: 'user', content: text }];
  };

  const buildCacheStableMessages = (): ChatCompletionMessage[] => {
    if (!args.options.enablePromptCaching || !args.options.systemPromptSections?.length) {
      return args.messages;
    }

    const splitPrompt = splitCacheableSystemPromptSections(args.options.systemPromptSections);
    if (!splitPrompt.cacheableText && !splitPrompt.dynamicText) {
      return args.messages;
    }

    const messagesWithoutSystem = args.messages.filter((message) => message.role !== 'system');
    return appendDynamicTextToLatestUserMessage(
      [
        ...(splitPrompt.cacheableText
          ? [{ role: 'system' as const, content: splitPrompt.cacheableText }]
          : []),
        ...messagesWithoutSystem,
      ],
      splitPrompt.dynamicText,
    );
  };

  const normalizeOpenRouterSessionId = (rawValue: unknown): string | undefined => {
    if (typeof rawValue !== 'string') {
      return undefined;
    }
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return undefined;
    }
    if (trimmed.length <= 256) {
      return trimmed;
    }
    return normalizeOpenAIPromptCacheKey(trimmed);
  };

  const body: Record<string, any> = {
    model: args.model,
    messages: buildCacheStableMessages(),
    stream: args.options.stream ?? false,
  };
  const requestTools =
    args.options.tools?.length && args.options.enablePromptCaching
      ? args.reorderToolsForPromptCaching(args.options.tools)
      : args.options.tools;

  if (args.options.stream && args.isGeminiModel(args.model)) {
    body.stream_options = { include_usage: true };
  }

  body.max_tokens = args.options.maxTokens ?? resolveModelOutputTokenBudget(args.model);
  if (
    args.options.temperature !== undefined &&
    args.supportsTemperature(args.model)
  ) {
    body.temperature = args.options.temperature;
  }
  const structuredOutput = args.normalizeStructuredOutputOptions(
    args.options.structuredOutput,
  );
  const reasoningEffort =
    args.options.reasoning_effort ?? (structuredOutput ? 'none' : undefined);
  if (
    reasoningEffort &&
    args.isOpenAIReasoningModel(args.model)
  ) {
    body.reasoning_effort = reasoningEffort;
  }
  if (structuredOutput) {
    body.response_format = args.buildCompatibleStructuredOutputFormat(structuredOutput);
  }
  if (requestTools?.length) {
    body.tools = requestTools.map((tool) => {
      const normalizedSchema = normalizeToolInputSchema(tool.input_schema);
      const useStrict =
        args.isOpenAIProvider() &&
        tool.strict !== false &&
        args.isStrictCompatibleSchema(normalizedSchema);

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: useStrict
            ? args.strictifyOpenAiSchema(normalizedSchema)
            : normalizedSchema,
          ...(useStrict ? { strict: true } : {}),
        },
      };
    });
    const toolChoice = args.buildCompatibleToolChoice(args.options.toolChoice);
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
    if (args.shouldDisableParallelToolUse(args.options.toolChoice)) {
      body.parallel_tool_calls = false;
    }
  }

  if (args.isOpenAIProvider() && args.options.enablePromptCaching) {
    const promptCacheKey = normalizeOpenAIPromptCacheKey(args.options.promptCacheKey);
    if (promptCacheKey) {
      body.prompt_cache_key = promptCacheKey;
    }
    body.prompt_cache_retention = args.normalizeOpenAIPromptCacheRetention(
      args.options.promptCacheRetention,
    );
  }

  if (args.isOpenRouterProvider() && args.options.enablePromptCaching) {
    const sessionId = normalizeOpenRouterSessionId(
      args.options.conversationId ?? args.options.promptCacheKey,
    );
    if (sessionId) {
      body.session_id = sessionId;
    }
    if (args.isAnthropicModel(args.model)) {
      body.cache_control = { type: 'ephemeral' };
    }
  }

  const requestHeaders = args.options.stream
    ? { ...args.headers, Accept: 'text/event-stream' }
    : args.headers;

  const response = await args.performFetch(
    `${args.baseUrl}/chat/completions`,
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
  const content = json?.choices?.[0]?.message?.content;
  const outputParsed =
    structuredOutput && typeof content === 'string'
      ? tryParseJson(content)
      : undefined;
  return outputParsed !== undefined
    ? {
        ...json,
        output_parsed: outputParsed,
      }
    : json;
}
