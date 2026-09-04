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
  rejectsSamplingParams,
  rejectsThinkingParam,
  requiresAdaptiveThinkingOnly,
  supportedEffortLevels,
  supportsAdaptiveThinking,
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
  model?: string,
): AnthropicOutputConfig | undefined {
  if (!isPlainRecord(outputConfig)) {
    return undefined;
  }

  const normalized: AnthropicOutputConfig = { ...outputConfig };
  const effort = typeof normalized.effort === 'string' ? normalized.effort.toLowerCase() : '';

  if (effort) {
    const allowedEfforts = supportedEffortLevels(model);
    if (allowedEfforts.includes(effort as AnthropicEffort)) {
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
  model?: string,
): AnthropicOutputConfig | undefined {
  const explicitOutputConfig = normalizeAnthropicOutputConfig(options.output_config, model);
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

function normalizeAnthropicTemperature(
  model: string | undefined,
  temperature: number | undefined,
): number | undefined {
  if (!Number.isFinite(temperature)) {
    return undefined;
  }

  // Fable and every Opus/Sonnet 4.7+ (including 5.x) 400 on any sampling param —
  // there is no "safe default" value to fall back to, so it's dropped outright
  // rather than clamped to 1 the way it used to be for this whole model range.
  if (rejectsSamplingParams(model)) {
    return undefined;
  }

  return temperature;
}

/**
 * Reshapes a caller-supplied `thinking` block to match what `model` actually accepts:
 *  - Fable: no `thinking` param at all — handled by the caller before this runs.
 *  - Opus/Sonnet 4.7+ (adaptive-only): `type:'enabled'` (the legacy budget_tokens shape)
 *    is rewritten to `{type:'adaptive'}`, since `budget_tokens` 400s on these models.
 *  - Everything else (4.6 and older): passed through unchanged.
 */
function adjustAnthropicThinkingForModel(
  model: string | undefined,
  thinking: Record<string, unknown>,
): Record<string, unknown> {
  const type = typeof thinking.type === 'string' ? thinking.type.toLowerCase() : '';
  if (type === 'enabled' && requiresAdaptiveThinkingOnly(model)) {
    return { type: 'adaptive' };
  }
  return thinking;
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
  buildAnthropicOutputConfig: (
    options: MessageRequestOptions,
    model: string,
  ) => AnthropicOutputConfig | undefined;
}): {
  thinking?: Record<string, unknown>;
  outputConfig?: AnthropicOutputConfig;
  temperature?: number;
} {
  const normalizedTemperature = normalizeAnthropicTemperature(args.model, args.options.temperature);
  const requestedOutputConfig = args.buildAnthropicOutputConfig(args.options, args.model);
  const formatOnlyOutputConfig: AnthropicOutputConfig | undefined = isPlainRecord(
    requestedOutputConfig?.format,
  )
    ? { format: requestedOutputConfig.format }
    : undefined;

  // Fable's thinking is always on server-side and takes no `thinking` param at all —
  // sending one (in any shape) 400s, so it never reaches the clamp/adaptive logic below.
  if (rejectsThinkingParam(args.model)) {
    return {
      temperature: normalizedTemperature,
      ...(requestedOutputConfig ? { outputConfig: requestedOutputConfig } : {}),
    };
  }

  const requestedThinking = isPlainRecord(args.options.thinking)
    ? adjustAnthropicThinkingForModel(args.model, { ...args.options.thinking })
    : undefined;
  if (!requestedThinking) {
    // Adaptive-only models (Opus/Sonnet 4.7+) don't take an explicit `thinking` param
    // for their default mode either — "omitting = no thinking" (or, for Opus 5,
    // "adaptive by default") — but `output_config.effort` is still a valid, orthogonal
    // lever in that state, so it shouldn't be dropped just because `thinking` is absent.
    const effortAppliesWithoutThinking = supportedEffortLevels(args.model).length > 0;
    return {
      temperature: normalizedTemperature,
      ...(effortAppliesWithoutThinking
        ? requestedOutputConfig
          ? { outputConfig: requestedOutputConfig }
          : {}
        : formatOnlyOutputConfig
          ? { outputConfig: formatOnlyOutputConfig }
          : {}),
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

  if (supportsAdaptiveThinking(targetModel)) {
    return thinkingType === 'enabled';
  }

  return true;
}
