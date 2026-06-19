import { isToolResultErrorLike } from '../../../../utils/toolResultErrors';
import { normalizeToolInputSchema } from '../../../../utils/toolSchema';
import { resolveModelOutputTokenBudget } from '../../../context/outputTokenBudget';
import { normalizeUsage } from '../../../usage/tracker';
import { isPlainRecord, tryParseJson } from '../../core/json';
import { splitCacheableSystemPromptSections } from '../../core/systemPromptSections';
import type {
  ChatCompletionMessage,
  MessageRequestOptions,
  ToolChoiceMode,
} from '../../support/contracts';

const MAX_ANTHROPIC_CACHE_BREAKPOINTS = 4;
const MAX_ANTHROPIC_MESSAGE_CACHE_BREAKPOINTS = 2;

function appendAnthropicDynamicSystemTail(args: {
  messages: Array<{ role: string; content: string | any[] }>;
  dynamicText?: string;
  mergeAnthropicContent: (existing: string | any[], incoming: string | any[]) => string | any[];
}): Array<{ role: string; content: string | any[] }> {
  const dynamicText = args.dynamicText?.trim();
  if (!dynamicText) {
    return args.messages;
  }

  const messages = args.messages.map((message) => ({ ...message }));
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') {
      continue;
    }
    messages[index] = {
      ...messages[index],
      content: args.mergeAnthropicContent(messages[index].content, dynamicText),
    };
    return messages;
  }

  return [...messages, { role: 'user', content: dynamicText }];
}

function contentHasCacheControl(content: string | any[]): boolean {
  return Array.isArray(content) && content.some((block) => isPlainRecord(block.cache_control));
}

function addAnthropicMessageCacheControl(
  content: string | any[],
  cacheControl: { type: 'ephemeral' },
): string | any[] {
  if (typeof content === 'string') {
    return content.trim().length > 0
      ? [{ type: 'text', text: content, cache_control: cacheControl }]
      : content;
  }

  let marked = false;
  const blocks = content.map((block, index) => {
    if (
      marked ||
      !isPlainRecord(block) ||
      block.type !== 'text' ||
      typeof block.text !== 'string' ||
      block.text.trim().length === 0
    ) {
      return block;
    }

    const hasLaterTextBlock = content
      .slice(index + 1)
      .some(
        (candidate) =>
          isPlainRecord(candidate) &&
          candidate.type === 'text' &&
          typeof candidate.text === 'string' &&
          candidate.text.trim().length > 0,
      );
    if (hasLaterTextBlock) {
      return block;
    }

    marked = true;
    return { ...block, cache_control: cacheControl };
  });

  return marked ? blocks : content;
}

function applyAnthropicMessageCacheBreakpoints(args: {
  messages: Array<{ role: string; content: string | any[] }>;
  breakpointsAvailable: number;
  cacheControl: { type: 'ephemeral' };
}): Array<{ role: string; content: string | any[] }> {
  const messageBreakpointLimit = Math.min(
    args.breakpointsAvailable,
    MAX_ANTHROPIC_MESSAGE_CACHE_BREAKPOINTS,
  );
  if (messageBreakpointLimit <= 0 || args.messages.length < 2) {
    return args.messages;
  }

  const messages = args.messages.map((message) => ({ ...message }));
  let applied = 0;
  for (let index = messages.length - 2; index >= 0 && applied < messageBreakpointLimit; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }
    if (contentHasCacheControl(message.content)) {
      continue;
    }
    const content = addAnthropicMessageCacheControl(message.content, args.cacheControl);
    if (content === message.content) {
      continue;
    }
    messages[index] = { ...message, content };
    applied += 1;
  }

  return messages;
}

export async function sendAnthropicMessages(args: {
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  messages: Array<{
    role: string;
    content: string | any[];
    tool_call_id?: string;
    name?: string;
  }>;
  options: MessageRequestOptions;
  sanitizeAnthropicRequestOptions: (
    model: string,
    messages: ChatCompletionMessage[],
    options: MessageRequestOptions,
  ) => {
    temperature?: number;
    thinking?: Record<string, unknown>;
    outputConfig?: Record<string, any>;
  };
  normalizeAnthropicAssistantBlocks: (
    message: ChatCompletionMessage,
    options?: { stripThinkingWithoutToolUse?: boolean },
  ) => any[];
  mergeAnthropicContent: (
    existing: string | any[],
    incoming: string | any[],
  ) => string | any[];
  mergeAnthropicToolResultsById: (blocks: any[]) => any[];
  mergeAnthropicAssistantContent: (
    existing: string | any[],
    incoming: string | any[],
  ) => string | any[];
  normalizeAnthropicUserContent: (content: unknown) => string | any[];
  anthropicContentIsEmpty: (content: string | any[]) => boolean;
  normalizeAnthropicConversationHistory: (
    messages: Array<{ role: string; content: string | any[] }>,
  ) => Array<{ role: string; content: string | any[] }>;
  buildAnthropicToolRaw: (
    id: string,
    name: string,
    argumentsText: string,
  ) => Record<string, any>;
  extractAnthropicReasoningText: (assistantBlocks: any[]) => string | undefined;
  buildAnthropicToolChoice: (
    choice: ToolChoiceMode | undefined,
  ) => Record<string, any> | undefined;
  shouldIncludeAnthropicInterleavedThinkingBeta: (
    model: string,
    options: MessageRequestOptions,
    thinking: unknown,
  ) => boolean;
  buildAnthropicSystemPromptContent: (args: {
    systemContent?: string;
    sections?: MessageRequestOptions['systemPromptSections'];
    enablePromptCaching?: boolean;
  }) => string | Array<Record<string, any>> | undefined;
  reorderAnthropicToolsForCaching: (
    tools: NonNullable<MessageRequestOptions['tools']>,
  ) => {
    orderedTools: NonNullable<MessageRequestOptions['tools']>;
    lastStablePrefixIndex: number;
  };
  simplifyAnthropicToolDescription: (
    description: string | undefined,
  ) => string;
  simplifyAnthropicSchema: (
    schema: Record<string, any>,
    options: { strict: boolean },
  ) => Record<string, any>;
  isAnthropicStrictEligible: (schema: Record<string, any>) => boolean;
  strictifySchema: (schema: Record<string, any>) => Record<string, any>;
  isStrictCompatibleSchema: (schema: Record<string, any>) => boolean;
  maxAnthropicStrictTools: number;
  anthropicEphemeralCacheControl: { type: 'ephemeral' };
  anthropicInterleavedThinkingBeta: string;
  performFetch: (
    url: string,
    init: RequestInit,
    preferStreaming?: boolean,
  ) => Promise<Response>;
  attachProviderResponse: (payload: any, provider: 'anthropic', raw: any) => any;
}): Promise<any> {
  const anthropicOptions = args.sanitizeAnthropicRequestOptions(
    args.model,
    args.messages as ChatCompletionMessage[],
    args.options,
  );
  let systemContent: string | undefined;
  const anthropicMessages: Array<{ role: string; content: string | any[] }> = [];
  let pendingToolResults: any[] = [];

  const flushPendingToolResults = () => {
    if (pendingToolResults.length === 0) {
      return;
    }

    const lastMsg = anthropicMessages[anthropicMessages.length - 1];
    if (lastMsg?.role === 'user') {
      lastMsg.content = args.mergeAnthropicContent(
        lastMsg.content,
        args.mergeAnthropicToolResultsById(pendingToolResults),
      );
    } else {
      anthropicMessages.push({
        role: 'user',
        content: args.mergeAnthropicToolResultsById(pendingToolResults),
      });
    }
    pendingToolResults = [];
  };

  for (const msg of args.messages) {
    if (msg.role === 'system') {
      systemContent =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      continue;
    }

    if (msg.role === 'tool') {
      const toolContent =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const toolUseId =
        typeof msg.tool_call_id === 'string' ? msg.tool_call_id.trim() : '';
      if (!toolUseId) {
        continue;
      }
      const isError =
        (msg as any).is_error === true || isToolResultErrorLike(toolContent);
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: toolContent,
        ...(isError ? { is_error: true } : {}),
      });
      continue;
    }

    flushPendingToolResults();

    if (msg.role === 'assistant') {
      const contentBlocks = args.normalizeAnthropicAssistantBlocks(
        msg as ChatCompletionMessage,
        { stripThinkingWithoutToolUse: true },
      );
      if (contentBlocks.length === 0) {
        continue;
      }

      const hasToolCalls = contentBlocks.some((block: any) => block.type === 'tool_use');
      const content: string | any[] =
        !hasToolCalls &&
        contentBlocks.length === 1 &&
        contentBlocks[0].type === 'text'
          ? contentBlocks[0].text
          : contentBlocks;

      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg?.role === 'assistant') {
        lastMsg.content = args.mergeAnthropicAssistantContent(lastMsg.content, content);
      } else {
        anthropicMessages.push({ role: 'assistant', content });
      }
      continue;
    }

    if (msg.role === 'user') {
      const normalizedContent = args.normalizeAnthropicUserContent(msg.content);
      if (args.anthropicContentIsEmpty(normalizedContent)) {
        continue;
      }

      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg?.role === 'user') {
        lastMsg.content = args.mergeAnthropicContent(
          lastMsg.content,
          normalizedContent,
        );
      } else {
        anthropicMessages.push({ role: msg.role, content: normalizedContent });
      }
    }
  }

  flushPendingToolResults();
  const splitSystemPrompt = splitCacheableSystemPromptSections(args.options.systemPromptSections);
  const normalizedAnthropicMessages = appendAnthropicDynamicSystemTail({
    messages: args.normalizeAnthropicConversationHistory(anthropicMessages),
    dynamicText: args.options.enablePromptCaching ? splitSystemPrompt.dynamicText : undefined,
    mergeAnthropicContent: args.mergeAnthropicContent,
  });

  const body: Record<string, any> = {
    model: args.model,
    messages: normalizedAnthropicMessages,
    max_tokens: args.options.maxTokens ?? resolveModelOutputTokenBudget(args.model),
    stream: args.options.stream ?? false,
  };

  const anthropicSystemContent = args.buildAnthropicSystemPromptContent({
    systemContent,
    sections: args.options.systemPromptSections,
    enablePromptCaching: args.options.enablePromptCaching,
  });

  if (anthropicSystemContent) body.system = anthropicSystemContent;
  if (anthropicOptions.temperature !== undefined) {
    body.temperature = anthropicOptions.temperature;
  }
  if (anthropicOptions.thinking) body.thinking = anthropicOptions.thinking;
  if (anthropicOptions.outputConfig) {
    body.output_config = anthropicOptions.outputConfig;
  }
  let toolCacheBreakpointCount = 0;
  if (args.options.tools?.length) {
    const anthropicToolPlan = args.options.enablePromptCaching
      ? args.reorderAnthropicToolsForCaching(args.options.tools)
      : { orderedTools: args.options.tools, lastStablePrefixIndex: -1 };
    toolCacheBreakpointCount =
      args.options.enablePromptCaching && anthropicToolPlan.lastStablePrefixIndex >= 0 ? 1 : 0;
    let strictBudget = args.maxAnthropicStrictTools;
    body.tools = anthropicToolPlan.orderedTools.map((tool, index) => {
      const normalizedSchema = normalizeToolInputSchema(tool.input_schema);
      const useStrict =
        tool.strict !== false &&
        args.isStrictCompatibleSchema(normalizedSchema) &&
        strictBudget > 0 &&
        args.isAnthropicStrictEligible(normalizedSchema);
      if (useStrict) strictBudget--;
      const base: Record<string, any> = {
        name: tool.name,
        description: args.simplifyAnthropicToolDescription(tool.description),
        input_schema: args.simplifyAnthropicSchema(
          useStrict ? args.strictifySchema(normalizedSchema) : normalizedSchema,
          { strict: useStrict },
        ),
      };
      if (
        args.options.enablePromptCaching &&
        index === anthropicToolPlan.lastStablePrefixIndex
      ) {
        base.cache_control = args.anthropicEphemeralCacheControl;
      }
      if (useStrict) base.strict = true;
      return base;
    });
    const toolChoice = args.buildAnthropicToolChoice(args.options.toolChoice);
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }

  if (args.options.enablePromptCaching) {
    body.cache_control = args.anthropicEphemeralCacheControl;
    const automaticCacheBreakpointCount = 1;
    const systemCacheBreakpointCount = Array.isArray(body.system)
      ? body.system.filter((block: unknown) => isPlainRecord(block) && isPlainRecord(block.cache_control))
          .length
      : 0;
    const breakpointsAvailable = Math.max(
      0,
      MAX_ANTHROPIC_CACHE_BREAKPOINTS -
        automaticCacheBreakpointCount -
        systemCacheBreakpointCount -
        toolCacheBreakpointCount,
    );
    body.messages = applyAnthropicMessageCacheBreakpoints({
      messages: body.messages,
      breakpointsAvailable,
      cacheControl: args.anthropicEphemeralCacheControl,
    });
  }

  const requestHeaders: Record<string, string> = args.options.stream
    ? { ...args.headers, Accept: 'text/event-stream' }
    : { ...args.headers };

  if (
    args.shouldIncludeAnthropicInterleavedThinkingBeta(
      args.model,
      args.options,
      anthropicOptions.thinking,
    )
  ) {
    requestHeaders['anthropic-beta'] = args.anthropicInterleavedThinkingBeta;
  }

  let response = await args.performFetch(
    `${args.baseUrl}/messages`,
    {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: args.options.signal,
    },
    args.options.stream ?? false,
  );

  if (!response.ok && response.status === 400 && body.tools?.length) {
    const errorText = await response.text().catch(() => '');
    if (/schema.*too.*complex/i.test(errorText)) {
      body.tools = body.tools.map((tool: Record<string, any>) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      }));
      response = await args.performFetch(
        `${args.baseUrl}/messages`,
        {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(body),
          signal: args.options.signal,
        },
        args.options.stream ?? false,
      );
    }

    if (!response.ok) {
      const retryErrorText = await response.text().catch(() => response.statusText);
      throw new Error(`LLM API error ${response.status}: ${retryErrorText}`);
    }
  } else if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }

  if (args.options.stream) {
    return response;
  }

  const json = await response.json();
  const normalizedUsage = normalizeUsage(json.usage);
  const assistantBlocks = args.normalizeAnthropicAssistantBlocks({
    role: 'assistant',
    content: Array.isArray(json.content) ? json.content : [],
  });
  const reasoning = args.extractAnthropicReasoningText(assistantBlocks);
  const providerReplay =
    assistantBlocks.length > 0 ? { anthropicBlocks: assistantBlocks } : undefined;
  const contentText =
    json.content?.map((content: any) =>
      content.type === 'text' ? content.text : '',
    ).join('') || '';
  const outputParsed = tryParseJson(contentText);

  const normalizedResponse = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: contentText,
          ...(reasoning ? { reasoning } : {}),
          ...(providerReplay ? { providerReplay } : {}),
          tool_calls: json.content
            ?.filter((content: any) => content.type === 'tool_use')
            .map((content: any, index: number) => ({
              id: content.id,
              type: 'function',
              index,
              function: {
                name: content.name,
                arguments: JSON.stringify(content.input),
              },
              raw: args.buildAnthropicToolRaw(
                content.id,
                content.name,
                JSON.stringify(content.input ?? {}),
              ),
            })),
        },
        finish_reason:
          json.stop_reason === 'end_turn'
            ? 'stop'
            : json.stop_reason === 'tool_use'
              ? 'tool_calls'
              : json.stop_reason,
      },
    ],
    ...(outputParsed !== undefined ? { output_parsed: outputParsed } : {}),
    usage: {
      prompt_tokens: normalizedUsage?.inputTokens ?? 0,
      completion_tokens: normalizedUsage?.outputTokens ?? 0,
      total_tokens:
        normalizedUsage?.totalTokens ??
        (normalizedUsage?.inputTokens ?? 0) + (normalizedUsage?.outputTokens ?? 0),
      cache_creation_input_tokens: normalizedUsage?.cacheWriteTokens ?? 0,
      cache_read_input_tokens: normalizedUsage?.cacheReadTokens ?? 0,
    },
  };

  return args.attachProviderResponse(normalizedResponse, 'anthropic', json);
}
