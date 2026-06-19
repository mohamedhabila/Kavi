import type {
  AnthropicEffort,
  AnthropicOutputConfig,
  ChatCompletionMessage,
  MessageRequestOptions,
  StructuredOutputOptions,
} from '../../support/contracts';
import { resolveModelOutputTokenBudget } from '../../../context/outputTokenBudget';
import {
  isAnthropicClaude4Model,
  isAnthropicClaude4OpusModel,
  supportsAnthropicAdaptiveThinking,
} from '../../catalog/providerCapabilities';
import { isPlainRecord } from '../../core/json';
import { normalizeStructuredOutputOptions } from '../../core/structuredOutput';
import { isForcedToolChoice } from '../../core/toolChoice';
import { canContinueAnthropicThinking, isAnthropicToolLoopInProgress } from './toolReplay';

export function buildAnthropicStructuredOutputFormat(
  structuredOutput: StructuredOutputOptions,
  helpers: {
    simplifyAnthropicSchema: (
      schema: Record<string, any>,
      options: { strict: boolean },
    ) => Record<string, any>;
    strictifySchema: (schema: Record<string, any>) => Record<string, any>;
  },
): Record<string, any> {
  const normalizedSchema = structuredOutput.schema;
  return {
    type: 'json_schema',
    schema: helpers.simplifyAnthropicSchema(helpers.strictifySchema(normalizedSchema), {
      strict: true,
    }),
  };
}

export function normalizeAnthropicOutputConfig(
  outputConfig: unknown,
): AnthropicOutputConfig | undefined {
  if (!isPlainRecord(outputConfig)) {
    return undefined;
  }

  const normalized: AnthropicOutputConfig = { ...outputConfig };
  const effort = typeof normalized.effort === 'string' ? normalized.effort.toLowerCase() : '';

  if (effort) {
    if (/^(low|medium|high|max)$/.test(effort)) {
      normalized.effort = effort as AnthropicEffort;
    } else {
      delete normalized.effort;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function buildAnthropicOutputConfig(
  options: MessageRequestOptions,
  helpers: {
    simplifyAnthropicSchema: (
      schema: Record<string, any>,
      options: { strict: boolean },
    ) => Record<string, any>;
    strictifySchema: (schema: Record<string, any>) => Record<string, any>;
  },
): AnthropicOutputConfig | undefined {
  const explicitOutputConfig = normalizeAnthropicOutputConfig(options.output_config);
  const structuredOutput = normalizeStructuredOutputOptions(options.structuredOutput);

  if (!explicitOutputConfig && !structuredOutput) {
    return undefined;
  }

  const outputConfig: AnthropicOutputConfig = explicitOutputConfig
    ? { ...explicitOutputConfig }
    : {};

  if (structuredOutput) {
    outputConfig.format = buildAnthropicStructuredOutputFormat(structuredOutput, helpers);
  }

  return Object.keys(outputConfig).length > 0 ? outputConfig : undefined;
}

function isDirectAnthropicTemperatureRestrictedModel(model: string | undefined): boolean {
  const lower = (model || '').toLowerCase();

  return (
    /claude-(?:opus|sonnet)-4-[6-9](?:$|[^0-9])/.test(lower) ||
    /claude-(?:opus|sonnet)-[5-9](?:$|[^0-9])/.test(lower)
  );
}

function normalizeAnthropicTemperature(
  model: string | undefined,
  temperature: number | undefined,
): number | undefined {
  if (!Number.isFinite(temperature)) {
    return undefined;
  }

  if (!isDirectAnthropicTemperatureRestrictedModel(model)) {
    return temperature;
  }

  return Math.abs((temperature as number) - 1) < Number.EPSILON ? 1 : undefined;
}

function ensureAnthropicThinkingDisplay(
  thinking: Record<string, unknown>,
): Record<string, unknown> {
  const type = typeof thinking.type === 'string' ? thinking.type : '';
  if (!type || type === 'disabled' || typeof thinking.display === 'string') {
    return thinking;
  }

  return {
    ...thinking,
    display: 'summarized',
  };
}

function clampAnthropicThinkingConfig(
  thinking: Record<string, unknown>,
  maxTokens: number,
): Record<string, unknown> | undefined {
  const type = typeof thinking.type === 'string' ? thinking.type : '';
  if (!type || type === 'disabled') {
    return undefined;
  }

  if (type !== 'enabled') {
    return thinking;
  }

  const rawBudget =
    typeof thinking.budget_tokens === 'number' ? Math.floor(thinking.budget_tokens) : NaN;
  if (!Number.isFinite(rawBudget) || rawBudget <= 0) {
    return thinking;
  }

  if (maxTokens <= 1024) {
    return undefined;
  }

  if (rawBudget < maxTokens) {
    return thinking;
  }

  return {
    ...thinking,
    budget_tokens: Math.max(1024, maxTokens - 1),
  };
}

export function sanitizeAnthropicRequestOptions(args: {
  model: string;
  messages: ChatCompletionMessage[];
  options: MessageRequestOptions;
  buildAnthropicOutputConfig: (options: MessageRequestOptions) => AnthropicOutputConfig | undefined;
}): {
  thinking?: Record<string, unknown>;
  outputConfig?: AnthropicOutputConfig;
  temperature?: number;
} {
  const normalizedTemperature = normalizeAnthropicTemperature(args.model, args.options.temperature);
  const requestedThinking = isPlainRecord(args.options.thinking)
    ? { ...args.options.thinking }
    : undefined;
  const requestedOutputConfig = args.buildAnthropicOutputConfig(args.options);
  const formatOnlyOutputConfig: AnthropicOutputConfig | undefined = isPlainRecord(
    requestedOutputConfig?.format,
  )
    ? { format: requestedOutputConfig.format }
    : undefined;
  if (!requestedThinking) {
    return {
      temperature: normalizedTemperature,
      ...(formatOnlyOutputConfig ? { outputConfig: formatOnlyOutputConfig } : {}),
    };
  }

  const thinking = clampAnthropicThinkingConfig(
    requestedThinking,
    args.options.maxTokens ?? resolveModelOutputTokenBudget(args.model),
  );
  if (!thinking) {
    return {
      temperature: normalizedTemperature,
      ...(formatOnlyOutputConfig ? { outputConfig: formatOnlyOutputConfig } : {}),
    };
  }
  const visibleThinking = ensureAnthropicThinkingDisplay(thinking);

  const toolLoopInProgress = isAnthropicToolLoopInProgress(args.messages);

  if (
    isForcedToolChoice(args.options.toolChoice) ||
    (toolLoopInProgress && !canContinueAnthropicThinking(args.messages))
  ) {
    return {
      temperature: normalizedTemperature,
      ...(formatOnlyOutputConfig ? { outputConfig: formatOnlyOutputConfig } : {}),
    };
  }

  return {
    thinking: visibleThinking,
    ...(requestedOutputConfig ? { outputConfig: requestedOutputConfig } : {}),
    temperature: undefined,
  };
}

export function shouldIncludeAnthropicInterleavedThinkingBeta(args: {
  model: string | undefined;
  defaultModel?: string;
  options: MessageRequestOptions;
  thinking?: Record<string, unknown>;
}): boolean {
  if (!args.thinking || !args.options.tools?.length) {
    return false;
  }

  const targetModel = args.model || args.defaultModel;
  if (!isAnthropicClaude4Model(targetModel)) {
    return false;
  }

  const thinkingType =
    typeof args.thinking.type === 'string' ? args.thinking.type.toLowerCase() : '';

  if (isAnthropicClaude4OpusModel(targetModel)) {
    return false;
  }

  if (supportsAnthropicAdaptiveThinking(targetModel)) {
    return thinkingType === 'enabled';
  }

  return true;
}
