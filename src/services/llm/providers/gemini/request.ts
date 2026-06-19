import { normalizeToolInputSchema } from '../../../../utils/toolSchema';
import { resolveModelOutputTokenBudget } from '../../../context/outputTokenBudget';
import {
  isGemini3Model,
  isGeminiProModel,
} from '../../catalog/providerCapabilities';
import { resolveProviderStructuredOutputDeliberationControls } from '../../support/providerStructuredOutputDeliberation';
import type {
  ChatCompletionMessage,
  MessageRequestOptions,
  ReasoningEffort,
} from '../../support/contracts';
import { isPlainRecord } from '../../core/json';
import {
  normalizeSystemPromptSections,
  splitCacheableSystemPromptSections,
} from '../../core/systemPromptSections';
import { normalizeStructuredOutputOptions } from '../../core/structuredOutput';
import { buildGeminiFunctionCallingConfig } from '../../core/toolChoice';
import { buildGeminiConversation } from './conversation';
import {
  buildGeminiFunctionDeclarationSchema,
  cleanGeminiSchema,
  simplifyGeminiToolDescription,
} from './schema';

export type GeminiStructuredOutputSyntax = 'responseFormat' | 'responseSchema';

export function resolveGeminiStructuredOutputSyntax(
  baseUrl: string,
  helpers: {
    isVertexNativeGeminiBaseUrl: (baseUrl: string) => boolean;
  },
): GeminiStructuredOutputSyntax {
  return helpers.isVertexNativeGeminiBaseUrl(baseUrl)
    ? 'responseSchema'
    : 'responseFormat';
}

export function buildGeminiModelName(model: string): string {
  return model
    .replace(/^models\//i, '')
    .replace(/^publishers\/[^/]+\/models\//i, '')
    .replace(/^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\//i, '')
    .trim();
}

export function buildGeminiGenerateContentUrl(
  baseUrl: string,
  model: string,
  methodName: string,
  helpers: {
    isVertexNativeGeminiBaseUrl: (baseUrl: string) => boolean;
  },
): string {
  const geminiModel = buildGeminiModelName(model);
  const modelPath = helpers.isVertexNativeGeminiBaseUrl(baseUrl)
    ? `publishers/google/models/${encodeURIComponent(geminiModel)}`
    : `models/${encodeURIComponent(geminiModel)}`;
  return `${baseUrl}/${modelPath}:${methodName}`;
}

function getLegacyGeminiThinkingConfig(
  model: string,
  effort: ReasoningEffort,
): Record<string, unknown> {
  const isGemini3 = isGemini3Model(model);
  const isGeminiPro = isGeminiProModel(model);

  if (isGemini3) {
    const levelMap: Record<ReasoningEffort, string> = {
      none: isGeminiPro ? 'LOW' : 'MINIMAL',
      minimal: isGeminiPro ? 'LOW' : 'MINIMAL',
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
      xhigh: 'HIGH',
    };
    return { thinkingLevel: levelMap[effort] };
  }

  if (isGeminiPro) {
    const budgetMap: Record<ReasoningEffort, number> = {
      none: 128,
      minimal: 512,
      low: 2048,
      medium: 8192,
      high: 16384,
      xhigh: 32768,
    };
    return { thinkingBudget: budgetMap[effort] };
  }

  const budgetMap: Record<ReasoningEffort, number> = {
    none: 0,
    minimal: 256,
    low: 1024,
    medium: 4096,
    high: 16384,
    xhigh: 24576,
  };
  return { thinkingBudget: budgetMap[effort] };
}

function normalizeGeminiThinkingConfig(
  model: string,
  options: MessageRequestOptions,
  structuredOutputEnabled: boolean,
): Record<string, unknown> | undefined {
  const requestedThinking = isPlainRecord(options.thinking)
    ? { ...options.thinking }
    : undefined;

  if (requestedThinking) {
    const normalized: Record<string, unknown> = {};
    const includeThoughts =
      typeof requestedThinking.includeThoughts === 'boolean'
        ? requestedThinking.includeThoughts
        : typeof requestedThinking.include_thoughts === 'boolean'
          ? requestedThinking.include_thoughts
          : undefined;
    const thinkingLevel =
      typeof requestedThinking.thinkingLevel === 'string'
        ? requestedThinking.thinkingLevel
        : typeof requestedThinking.thinking_level === 'string'
          ? requestedThinking.thinking_level
          : undefined;
    const thinkingBudget =
      typeof requestedThinking.thinkingBudget === 'number'
        ? requestedThinking.thinkingBudget
        : typeof requestedThinking.thinking_budget === 'number'
          ? requestedThinking.thinking_budget
          : undefined;

    if (includeThoughts !== undefined) {
      normalized.includeThoughts = includeThoughts;
    }
    if (thinkingLevel) {
      normalized.thinkingLevel = thinkingLevel.toUpperCase();
    }
    if (Number.isFinite(thinkingBudget)) {
      normalized.thinkingBudget = Math.floor(thinkingBudget as number);
    }

    if (Object.keys(normalized).length > 0 && includeThoughts === undefined) {
      normalized.includeThoughts = true;
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  if (!options.reasoning_effort) {
    if (!structuredOutputEnabled) {
      return undefined;
    }
    const deliberationControls = resolveProviderStructuredOutputDeliberationControls({
      model,
      providerFamily: 'gemini',
    });
    if (isPlainRecord(deliberationControls.thinking)) {
      return deliberationControls.thinking;
    }
    return undefined;
  }

  return {
    ...getLegacyGeminiThinkingConfig(model, options.reasoning_effort),
    includeThoughts: true,
  };
}

export function buildGeminiRequestBody(args: {
  baseUrl: string;
  model: string;
  messages: ChatCompletionMessage[];
  options: MessageRequestOptions;
  structuredOutputSyntax: GeminiStructuredOutputSyntax;
  supportsGeminiStructuredOutputWithTools: (model: string) => boolean;
  supportsTemperature: (model: string) => boolean;
  isVertexNativeGeminiBaseUrl: (baseUrl: string) => boolean;
  reorderToolsForPromptCaching: (
    tools: NonNullable<MessageRequestOptions['tools']>,
  ) => NonNullable<MessageRequestOptions['tools']>;
}): Record<string, any> {
  const body: Record<string, any> = buildGeminiConversation(
    args.model,
    args.messages,
    {
      includeFunctionCallIds: !args.isVertexNativeGeminiBaseUrl(args.baseUrl),
    },
  );

  const appendDynamicSystemTail = (dynamicText?: string) => {
    const text = dynamicText?.trim();
    if (!text) {
      return;
    }
    body.contents = [
      ...(Array.isArray(body.contents) ? body.contents : []),
      { role: 'user', parts: [{ text }] },
    ];
  };

  if (args.options.enablePromptCaching && args.options.systemPromptSections?.length) {
    const splitPrompt = splitCacheableSystemPromptSections(args.options.systemPromptSections);
    if (splitPrompt.cacheableText) {
      body.systemInstruction = {
        parts: [{ text: splitPrompt.cacheableText }],
      };
    } else {
      delete body.systemInstruction;
    }
    appendDynamicSystemTail(splitPrompt.dynamicText);
  } else {
    const systemPromptSections = normalizeSystemPromptSections(args.options.systemPromptSections);
    if (systemPromptSections?.length) {
      body.systemInstruction = {
        parts: systemPromptSections.map((section) => ({ text: section.text })),
      };
    }
  }
  const generationConfig: Record<string, any> = {};
  const structuredOutput = normalizeStructuredOutputOptions(
    args.options.structuredOutput,
  );
  const canApplyStructuredOutput =
    structuredOutput &&
    (!args.options.tools?.length ||
      args.supportsGeminiStructuredOutputWithTools(args.model));
  const requestTools =
    args.options.tools?.length && args.options.enablePromptCaching
      ? args.reorderToolsForPromptCaching(args.options.tools)
      : args.options.tools;

  generationConfig.maxOutputTokens =
    args.options.maxTokens ?? resolveModelOutputTokenBudget(args.model);

  if (
    args.options.temperature !== undefined &&
    args.supportsTemperature(args.model)
  ) {
    generationConfig.temperature = args.options.temperature;
  }

  const thinkingConfig = normalizeGeminiThinkingConfig(
    args.model,
    args.options,
    Boolean(canApplyStructuredOutput && structuredOutput),
  );
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  if (canApplyStructuredOutput && structuredOutput) {
    const cleanedSchema =
      args.structuredOutputSyntax === 'responseSchema'
        ? cleanGeminiSchema(structuredOutput.schema, {
            target: 'function_declaration',
          })
        : cleanGeminiSchema(structuredOutput.schema, {
            target: 'structured_output',
          });
    if (args.structuredOutputSyntax === 'responseSchema') {
      generationConfig.responseMimeType = structuredOutput.mimeType;
      generationConfig.responseSchema = cleanedSchema;
    } else {
      generationConfig.responseFormat = {
        text: {
          mimeType: structuredOutput.mimeType,
          schema: cleanedSchema,
        },
      };
    }
  }

  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  if (requestTools?.length) {
    body.tools = [{
      functionDeclarations: requestTools.map((tool) => ({
        name: tool.name,
        description: simplifyGeminiToolDescription(tool.description),
        parameters: buildGeminiFunctionDeclarationSchema(
          normalizeToolInputSchema(tool.input_schema),
        ),
      })),
    }];

    const functionCallingConfig = buildGeminiFunctionCallingConfig(
      args.options.toolChoice,
    );
    if (functionCallingConfig) {
      body.toolConfig = {
        functionCallingConfig,
      };
    }
  }

  return body;
}

export function shouldRetryGeminiStructuredOutputWithLegacySyntax(
  status: number,
  errorText: string,
  body: Record<string, any>,
): boolean {
  if (status !== 400 || !body.generationConfig?.responseFormat) {
    return false;
  }

  return /unknown name\s+["']?responseFormat["']?|cannot find field/i.test(
    errorText,
  );
}
