import type {
  AnthropicEffort,
  AnthropicOutputConfig,
  ChatCompletionMessage,
  MessageRequestOptions,
  StructuredOutputOptions,
} from '../../support/contracts';
import { resolveModelOutputTokenBudget } from '../../../context/outputTokenBudget';
import { rejectsSamplingParams } from '../../catalog/providerCapabilities';
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

/** The caller's output_config; its effort is one the model declares (thinking.ts). */
export function normalizeAnthropicOutputConfig(
  outputConfig: unknown,
): AnthropicOutputConfig | undefined {
  if (!isPlainRecord(outputConfig)) {
    return undefined;
  }

  const normalized: AnthropicOutputConfig = { ...outputConfig };
  if (typeof normalized.effort === 'string') {
    normalized.effort = normalized.effort.toLowerCase() as AnthropicEffort;
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
  if (!type) {
    return undefined;
  }

  // `disabled` is the model's declared off switch (thinking.ts): sent as is, because a
  // model that thinks by default keeps thinking when the parameter is omitted.
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

  const requestedThinking = isPlainRecord(args.options.thinking)
    ? { ...args.options.thinking }
    : undefined;
  if (!requestedThinking) {
    return {
      temperature: normalizedTemperature,
      ...(requestedOutputConfig ? { outputConfig: requestedOutputConfig } : {}),
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
    thinking: withDroppedStaleThinking(visibleThinking),
    ...(requestedOutputConfig ? { outputConfig: requestedOutputConfig } : {}),
    temperature: visibleThinking.type === 'disabled' ? normalizedTemperature : undefined,
  };
}

/**
 * Thinking that drops a replayed block the API can no longer bind to its conversation,
 * rather than failing the request (ANTHROPIC_THINKING_BINDING_BETA). Accepted with adaptive
 * and enabled thinking on every model; models without the check ignore it.
 */
function withDroppedStaleThinking(thinking: Record<string, unknown>): Record<string, unknown> {
  return thinking.type === 'adaptive' || thinking.type === 'enabled'
    ? { ...thinking, block_binding: { prefix_mismatch_behavior: 'drop_block' } }
    : thinking;
}

/**
 * Manual (enabled) thinking interleaves with tool calls only under the interleaved-thinking
 * beta on the Claude 4 models that have it. The Claude API, Bedrock and Vertex accept the
 * header on every model and ignore it where it does nothing, and adaptive thinking
 * interleaves without it, so no model list decides.
 * https://platform.claude.com/docs/en/build-with-claude/extended-thinking#interleaved-thinking-in-manual-mode
 */
export function needsAnthropicInterleavedThinkingBeta(
  options: MessageRequestOptions,
  thinking: Record<string, unknown> | undefined,
): boolean {
  return thinking?.type === 'enabled' && Boolean(options.tools?.length);
}
