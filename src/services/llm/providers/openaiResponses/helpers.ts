import { normalizeOpenAIPromptCacheKey } from '../../../context/tokenOptimization';
import { resolveModelOutputTokenBudget } from '../../../context/outputTokenBudget';
import type { ToolDefinition } from '../../../../types/tool';
import { normalizeUsage } from '../../../usage/tracker';
import { normalizeToolInputSchema } from '../../../../utils/toolSchema';
import { splitCacheableSystemPromptSections } from '../../core/systemPromptSections';
import {
  isOpenAIReasoningModel as supportsOpenAIReasoningModel,
  supportsTemperature as providerSupportsTemperature,
} from '../../catalog/providerCapabilities';
import type {
  ChatCompletionMessage,
  MessageRequestOptions,
  StreamedToolCall,
  StructuredOutputOptions,
} from '../../support/contracts';
import { isPlainRecord, tryParseJson } from '../../core/json';
import { extractOpenAIReasoningText } from '../../core/reasoningExtraction';
import { isStrictCompatibleSchema, strictifyOpenAiSchema } from '../../core/schemaTransforms';
import { mergeStreamedArgumentText } from '../../core/streaming/toolCallAccumulator';
import { normalizeStructuredOutputOptions } from '../../core/structuredOutput';
import { buildOpenAIToolChoice, shouldDisableParallelToolUse } from '../../core/toolChoice';
import { buildOpenAIResponsesInput } from './conversation';

function appendDynamicSystemPromptToTail(
  input: Array<Record<string, any>>,
  dynamicSystemPrompt?: string,
): Array<Record<string, any>> {
  const dynamicText = dynamicSystemPrompt?.trim();
  if (!dynamicText) {
    return input;
  }

  return [...input, { role: 'system', content: dynamicText }];
}

export function buildOpenAIResponsesReplayInputContext(
  options: MessageRequestOptions,
): Record<string, any>[] | undefined {
  if (!options.enablePromptCaching || !options.systemPromptSections?.length) {
    return undefined;
  }

  const dynamicText = splitCacheableSystemPromptSections(
    options.systemPromptSections,
  ).dynamicText?.trim();
  return dynamicText ? [{ role: 'system', content: dynamicText }] : undefined;
}

function buildCacheAwareOpenAIResponsesInput(args: {
  messages: ChatCompletionMessage[];
  model: string;
  options: MessageRequestOptions;
}): ReturnType<typeof buildOpenAIResponsesInput> {
  if (!args.options.enablePromptCaching || !args.options.systemPromptSections?.length) {
    return buildOpenAIResponsesInput(args.messages, args.model);
  }

  const splitPrompt = splitCacheableSystemPromptSections(args.options.systemPromptSections);
  if (!splitPrompt.cacheableText && !splitPrompt.dynamicText) {
    return buildOpenAIResponsesInput(args.messages, args.model);
  }

  const inputWithoutSystemMessages = buildOpenAIResponsesInput(
    args.messages.filter((message) => message.role !== 'system'),
    args.model,
  );

  return {
    instructions: splitPrompt.cacheableText ?? inputWithoutSystemMessages.instructions,
    input: appendDynamicSystemPromptToTail(
      inputWithoutSystemMessages.input,
      splitPrompt.dynamicText,
    ),
  };
}

export function normalizeOpenAIPromptCacheRetention(
  retention?: 'in_memory' | 'in-memory' | '24h',
): 'in_memory' | '24h' {
  return retention === 'in_memory' || retention === 'in-memory' ? 'in_memory' : '24h';
}

export function buildOpenAIResponsesToolDefinition(tool: ToolDefinition): Record<string, any> {
  const normalizedSchema = normalizeToolInputSchema(tool.input_schema);
  const useStrict = tool.strict !== false && isStrictCompatibleSchema(normalizedSchema);
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: useStrict ? strictifyOpenAiSchema(normalizedSchema) : normalizedSchema,
    strict: useStrict,
  };
}

export function buildOpenAIResponsesTextFormat(
  structuredOutput: StructuredOutputOptions,
): Record<string, any> {
  const normalizedSchema = normalizeToolInputSchema(structuredOutput.schema);
  const useStrict = structuredOutput.strict !== false && isStrictCompatibleSchema(normalizedSchema);
  return {
    type: 'json_schema',
    name: structuredOutput.name || 'structured_output',
    schema: useStrict ? strictifyOpenAiSchema(normalizedSchema) : normalizedSchema,
    strict: useStrict,
  };
}

export function buildOpenAIResponsesBody(args: {
  model: string;
  messages: ChatCompletionMessage[];
  options: MessageRequestOptions;
  serializeOpenAIPromptCacheHints?: boolean;
  reorderToolsForPromptCaching?: (tools: ToolDefinition[]) => ToolDefinition[];
}): Record<string, any> {
  const responsesInput = buildCacheAwareOpenAIResponsesInput({
    messages: args.messages,
    model: args.model,
    options: args.options,
  });
  const body: Record<string, any> = {
    model: args.model,
    instructions: responsesInput.instructions,
    input: responsesInput.input,
    stream: args.options.stream ?? false,
    store: false,
  };

  body.max_output_tokens = args.options.maxTokens ?? resolveModelOutputTokenBudget(args.model);

  if (args.options.temperature !== undefined && providerSupportsTemperature(args.model)) {
    body.temperature = args.options.temperature;
  }

  const structuredOutput = normalizeStructuredOutputOptions(args.options.structuredOutput);
  const reasoningEffort = args.options.reasoning_effort ?? (structuredOutput ? 'none' : undefined);
  if (reasoningEffort && supportsOpenAIReasoningModel(args.model)) {
    body.reasoning = { effort: reasoningEffort, summary: 'auto' };
  }

  if (supportsOpenAIReasoningModel(args.model)) {
    body.include = ['reasoning.encrypted_content'];
  }

  if (structuredOutput) {
    body.text = {
      format: buildOpenAIResponsesTextFormat(structuredOutput),
    };
  }

  const requestTools =
    args.options.tools?.length && args.options.enablePromptCaching
      ? (args.reorderToolsForPromptCaching?.(args.options.tools) ?? args.options.tools)
      : args.options.tools;

  if (requestTools?.length) {
    body.tools = requestTools.map((tool) => buildOpenAIResponsesToolDefinition(tool));
    const toolChoice = buildOpenAIToolChoice(args.options.toolChoice);
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
    if (shouldDisableParallelToolUse(args.options.toolChoice)) {
      body.parallel_tool_calls = false;
    }
  }

  if (args.options.enablePromptCaching && args.serializeOpenAIPromptCacheHints !== false) {
    const promptCacheKey = normalizeOpenAIPromptCacheKey(args.options.promptCacheKey);
    if (promptCacheKey) {
      body.prompt_cache_key = promptCacheKey;
    }
    body.prompt_cache_retention = normalizeOpenAIPromptCacheRetention(
      args.options.promptCacheRetention,
    );
  }

  return body;
}

export function buildOpenAIResponseToolRaw(
  item: Record<string, any>,
  context: { outputIndex?: number; reasoningItems?: Record<string, any>[] } = {},
): Record<string, any> {
  const callId =
    typeof item.call_id === 'string' && item.call_id.trim().length > 0
      ? item.call_id.trim()
      : typeof item.id === 'string'
        ? item.id.trim()
        : '';
  const argumentsText =
    typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {});

  const raw: Record<string, any> = {
    id: callId,
    type: 'function',
    function: {
      name: typeof item.name === 'string' ? item.name : '',
      arguments: argumentsText,
    },
  };

  const openAiMetadata: Record<string, any> = {};
  if (typeof item.id === 'string' && item.id.trim().length > 0) {
    openAiMetadata.itemId = item.id.trim();
  }
  if (callId) {
    openAiMetadata.callId = callId;
  }
  if (typeof context.outputIndex === 'number') {
    openAiMetadata.outputIndex = context.outputIndex;
  }
  if (Array.isArray(context.reasoningItems) && context.reasoningItems.length > 0) {
    openAiMetadata.reasoningItems = context.reasoningItems;
  }
  if (Object.keys(openAiMetadata).length > 0) {
    raw._openai = openAiMetadata;
  }

  return raw;
}

function mergeOpenAIArgumentSnapshot(existing: string, incoming: string): string {
  if (!incoming) {
    return existing;
  }

  if (!existing) {
    return incoming;
  }

  const existingJson = tryParseJson(existing);
  const incomingJson = tryParseJson(incoming);

  if (isPlainRecord(existingJson) && isPlainRecord(incomingJson)) {
    return JSON.stringify({
      ...existingJson,
      ...incomingJson,
    });
  }

  if (!isPlainRecord(existingJson) && isPlainRecord(incomingJson)) {
    return incoming;
  }

  if (Array.isArray(existingJson) && Array.isArray(incomingJson)) {
    return incomingJson.length >= existingJson.length ? incoming : existing;
  }

  if (!Array.isArray(existingJson) && Array.isArray(incomingJson)) {
    return incoming;
  }

  return mergeStreamedArgumentText(existing, incoming);
}

export function mergeOpenAIStreamToolCall(
  existing: StreamedToolCall | undefined,
  raw: Record<string, any>,
): StreamedToolCall {
  const nextRaw: Record<string, any> = isPlainRecord(existing?.raw) ? { ...existing.raw } : {};

  if (typeof raw.id === 'string' && raw.id.length > 0) {
    nextRaw.id = raw.id;
  }

  if (typeof raw.type === 'string' && raw.type.length > 0) {
    nextRaw.type = raw.type;
  }

  if (isPlainRecord(raw._openai)) {
    nextRaw._openai = {
      ...(isPlainRecord(nextRaw._openai) ? nextRaw._openai : {}),
      ...raw._openai,
    };
  }

  if (isPlainRecord(raw.function)) {
    const nextFunction = isPlainRecord(nextRaw.function) ? { ...nextRaw.function } : {};
    if (typeof raw.function.name === 'string' && raw.function.name.length > 0) {
      nextFunction.name = raw.function.name;
    }
    if (typeof raw.function.arguments === 'string') {
      nextFunction.arguments = mergeOpenAIArgumentSnapshot(
        typeof nextFunction.arguments === 'string'
          ? nextFunction.arguments
          : existing?.arguments || '',
        raw.function.arguments,
      );
    }
    nextRaw.function = nextFunction;
  }

  return {
    id: typeof nextRaw.id === 'string' && nextRaw.id.length > 0 ? nextRaw.id : existing?.id || '',
    name:
      typeof nextRaw.function?.name === 'string' && nextRaw.function.name.length > 0
        ? nextRaw.function.name
        : existing?.name || '',
    arguments:
      typeof nextRaw.function?.arguments === 'string'
        ? nextRaw.function.arguments
        : existing?.arguments || '',
    ...(Object.keys(nextRaw).length > 0 ? { raw: nextRaw } : {}),
  };
}

export function normalizeOpenAIResponsesUsage(usage: any): Record<string, any> | undefined {
  const normalizedUsage = normalizeUsage(usage);
  if (!normalizedUsage) {
    return undefined;
  }

  const normalized: Record<string, any> = {
    prompt_tokens: normalizedUsage.inputTokens,
    completion_tokens: normalizedUsage.outputTokens,
    total_tokens: normalizedUsage.totalTokens,
    prompt_tokens_details: {
      cached_tokens: normalizedUsage.cacheReadTokens,
      ...(normalizedUsage.cacheWriteTokens > 0
        ? { cache_write_tokens: normalizedUsage.cacheWriteTokens }
        : {}),
    },
    output_tokens_details: usage.output_tokens_details ?? usage.outputTokensDetails ?? {},
  };

  if (normalizedUsage.cacheReadTokens > 0) {
    normalized.cache_read_input_tokens = normalizedUsage.cacheReadTokens;
  }

  if (normalizedUsage.cacheWriteTokens > 0) {
    normalized.cache_creation_input_tokens = normalizedUsage.cacheWriteTokens;
  }

  return normalized;
}

export function normalizeOpenAIResponsesResult(
  json: any,
  options: { replayInputContext?: Record<string, any>[] } = {},
): any {
  const output = Array.isArray(json?.output)
    ? json.output.filter((item: unknown): item is Record<string, any> => isPlainRecord(item))
    : [];
  const responseId =
    typeof json?.id === 'string' && json.id.trim().length > 0 ? json.id.trim() : '';
  const reasoningItems = output.filter((item: Record<string, any>) => item.type === 'reasoning');
  const reasoning = extractOpenAIReasoningText(reasoningItems);

  const toolCalls: Array<Record<string, any>> = [];
  output.forEach((item: Record<string, any>, outputIndex: number) => {
    if (item.type !== 'function_call') {
      return;
    }
    const raw = buildOpenAIResponseToolRaw(item, { outputIndex, reasoningItems });
    toolCalls.push({
      id: raw.id,
      type: 'function',
      index: toolCalls.length,
      function: { ...raw.function },
      raw,
    });
  });

  let content = typeof json?.output_text === 'string' ? json.output_text : '';
  if (!content) {
    const contentParts: string[] = [];
    for (const item of output) {
      if (item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) {
        continue;
      }

      for (const part of item.content) {
        if (!isPlainRecord(part)) {
          continue;
        }
        if (part.type === 'output_text' && typeof part.text === 'string') {
          contentParts.push(part.text);
        }
        if (part.type === 'refusal' && typeof part.refusal === 'string') {
          contentParts.push(part.refusal);
        }
      }
    }
    content = contentParts.join('');
  }

  const usage = normalizeOpenAIResponsesUsage(json?.usage);
  const outputParsed =
    json?.output_parsed !== undefined ? json.output_parsed : tryParseJson(content);
  return {
    ...(responseId ? { id: responseId } : {}),
    choices: [
      {
        message: {
          role: 'assistant',
          content,
          ...(reasoning ? { reasoning } : {}),
          ...(output.length > 0 || responseId
            ? {
                providerReplay: {
                  ...(responseId ? { openaiResponseId: responseId } : {}),
                  ...(options.replayInputContext?.length
                    ? { openaiResponseInputContext: options.replayInputContext }
                    : {}),
                  ...(output.length > 0 ? { openaiResponseOutput: output } : {}),
                },
              }
            : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason:
          toolCalls.length > 0 ? 'tool_calls' : json?.status === 'incomplete' ? 'length' : 'stop',
      },
    ],
    ...(outputParsed !== undefined ? { output_parsed: outputParsed } : {}),
    ...(usage ? { usage } : {}),
  };
}
