// ---------------------------------------------------------------------------
// Kavi — Token Optimization Helpers
// ---------------------------------------------------------------------------
// Production-oriented heuristics for reducing token cost in long-running agent
// sessions without materially degrading quality.

import type { LlmProviderConfig } from '../../types/provider';
import type { ToolDefinition } from '../../types/tool';
import type { UsagePromptCacheMode, UsagePromptCacheTelemetry } from '../../types/usage';
import type { ThinkingLevel } from '../../engine/thinking';
import {
  isGemini3Model as isGemini3HostedModel,
  isOpenAIReasoningModel,
} from '../llm/catalog/providerCapabilities';
import { resolveModelHostedFamily } from '../llm/catalog/providerFamilies';
import { buildPromptCachingToolOrder, buildToolDeclarationDigest } from '../llm/core/toolCaching';
export {
  getEscalatedFinalizationMaxTokens,
  OUTPUT_TOKEN_MAX,
  resolveFinalizationMaxTokens,
  resolveModelOutputTokenBudget,
  resolveSubAgentMaxTokens,
} from './outputTokenBudget';
import { resolveFinalizationMaxTokens } from './outputTokenBudget';

// Gemini 3 models cannot disable thinking — the thinking token budget is
// consumed from the max_tokens allowance.  These overheads account for the
// thinking budget so the visible response is not truncated.
const GEMINI_THINKING_OVERHEAD: Record<string, number> = {
  low: 1536, // "minimal" mapped to low
  medium: 8192,
  high: 24576,
};

function isGeminiModel(model: string): boolean {
  return resolveModelHostedFamily(model) === 'gemini';
}

function isGemini3Model(model: string): boolean {
  return isGemini3HostedModel(model);
}

export interface IterationPlanningArgs {
  provider: LlmProviderConfig;
  primaryModel: string;
  iteration: number;
  maxTokens: number;
  actionableRequest: boolean;
  hasRecentToolMessages: boolean;
  hasAttachments: boolean;
  thinkingLevel: ThinkingLevel;
}

export interface IterationPlanningResult {
  model: string;
  maxTokens: number;
  thinkingLevel: ThinkingLevel;
  reason: string;
}

export interface PromptCachingPlan {
  enablePromptCaching: boolean;
  promptCacheKey?: string;
  telemetry: UsagePromptCacheTelemetry;
}

export const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

const PROMPT_CACHE_KEY_LABEL_MAX_LENGTH = 24;
const PROMPT_CACHE_KEY_PREFIX = 'cm';

function clampThinkingLevel(level: ThinkingLevel, upperBound: ThinkingLevel): ThinkingLevel {
  const order: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  const current = order.indexOf(level);
  const max = order.indexOf(upperBound);
  return order[Math.min(current, max)];
}

function fnv1aHash(str: string, seed = 0x811c9dc5): string {
  let hash = seed >>> 0;
  for (let index = 0; index < str.length; index++) {
    hash ^= str.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function hashPromptCacheMaterial(value: string): string {
  const normalized = value || 'empty';
  return `${fnv1aHash(normalized)}${fnv1aHash(`${normalized}\u0000${normalized.length}`, 0x9e3779b1)}`;
}

function compactPromptCacheLabel(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    return fallback;
  }

  if (normalized.length <= PROMPT_CACHE_KEY_LABEL_MAX_LENGTH) {
    return normalized;
  }

  const head = normalized.slice(0, 14).replace(/-+$/g, '');
  const tail = normalized.slice(-8).replace(/^-+/, '');

  if (!head) {
    return tail || fallback;
  }
  if (!tail) {
    return head;
  }

  return `${head}-${tail}`.slice(0, PROMPT_CACHE_KEY_LABEL_MAX_LENGTH);
}

export function normalizeOpenAIPromptCacheKey(rawKey?: string | null): string | undefined {
  if (typeof rawKey !== 'string') {
    return undefined;
  }

  const trimmed = rawKey.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length <= OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH) {
    return trimmed;
  }

  const label = compactPromptCacheLabel(trimmed, 'cache');
  const fingerprint = hashPromptCacheMaterial(trimmed);
  const maxLabelLength = Math.max(
    1,
    OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH - `${PROMPT_CACHE_KEY_PREFIX}::${fingerprint}`.length,
  );

  return `${PROMPT_CACHE_KEY_PREFIX}:${label.slice(0, maxLabelLength)}:${fingerprint}`;
}

export function planIterationModel(args: IterationPlanningArgs): IterationPlanningResult {
  const {
    primaryModel,
    iteration,
    maxTokens,
    actionableRequest,
    hasRecentToolMessages,
    hasAttachments,
    thinkingLevel,
  } = args;

  const outputCeiling = resolveFinalizationMaxTokens(primaryModel);
  let plannedMaxTokens = Math.max(512, Math.min(maxTokens, outputCeiling));

  // Gemini 3 thinking models consume thinking tokens from the max_tokens
  // budget — add overhead so the actual content is not cut off.
  if (isGeminiModel(primaryModel)) {
    const effectiveThinking = isGemini3Model(primaryModel) ? thinkingLevel : 'off';
    const overhead = GEMINI_THINKING_OVERHEAD[effectiveThinking] ?? 0;
    if (overhead > 0) {
      plannedMaxTokens = Math.max(plannedMaxTokens + overhead, 8192);
    } else {
      // Even non-thinking Gemini models benefit from a higher floor
      plannedMaxTokens = Math.max(plannedMaxTokens, 4096);
    }
  }

  plannedMaxTokens = Math.min(plannedMaxTokens, outputCeiling);

  if (hasAttachments || thinkingLevel === 'high' || thinkingLevel === 'xhigh') {
    return {
      model: primaryModel,
      maxTokens: plannedMaxTokens,
      thinkingLevel,
      reason: 'attachments-or-high-reasoning',
    };
  }

  if (iteration > 1 && hasRecentToolMessages) {
    return {
      model: primaryModel,
      maxTokens: plannedMaxTokens,
      thinkingLevel: clampThinkingLevel(thinkingLevel, 'low'),
      reason: 'tool-follow-up-primary-model',
    };
  }

  return {
    model: primaryModel,
    maxTokens: plannedMaxTokens,
    thinkingLevel: clampThinkingLevel(thinkingLevel, actionableRequest ? 'low' : 'medium'),
    reason: actionableRequest ? 'actionable-request-capped-output' : 'default-response-cap',
  };
}

type PromptCacheStructure = {
  stableSystemPromptDigest: string;
  stableToolDeclarationDigest: string;
  cacheablePrefixDigest: string;
  cacheablePrefixFingerprint: string;
  toolDeclarationDigest: string;
  prefixDivergenceReason: NonNullable<UsagePromptCacheTelemetry['prefixDivergenceReason']>;
};

function resolvePromptCachePrefixDivergenceReason(args: {
  toolCount: number;
  stablePrefixToolCount: number;
}): PromptCacheStructure['prefixDivergenceReason'] {
  if (args.toolCount === 0) {
    return 'no_tools';
  }
  if (args.stablePrefixToolCount === 0) {
    return 'no_stable_tool_prefix';
  }
  if (args.stablePrefixToolCount === args.toolCount) {
    return 'fully_stable_prefix';
  }
  return 'stable_prefix_with_dynamic_suffix';
}

function buildPromptCacheStructure(args: {
  systemPrompt: string;
  stableSystemPrompt?: string;
  tools: ToolDefinition[];
}): PromptCacheStructure {
  const { orderedTools, lastStablePrefixIndex } = buildPromptCachingToolOrder(args.tools);
  const stablePrefixTools =
    lastStablePrefixIndex >= 0 ? orderedTools.slice(0, lastStablePrefixIndex + 1) : [];
  const toolDeclarationDigest = buildToolDeclarationDigest(orderedTools);
  const stablePrefixToolDeclarationDigest = buildToolDeclarationDigest(stablePrefixTools);
  const stableSystemPromptFingerprint = hashPromptCacheMaterial(
    args.stableSystemPrompt ?? args.systemPrompt,
  );
  const cacheablePrefixMaterial = [
    stableSystemPromptFingerprint,
    stablePrefixToolDeclarationDigest,
  ].join(':');
  const cacheablePrefixFingerprint = hashPromptCacheMaterial(cacheablePrefixMaterial);

  return {
    stableSystemPromptDigest: `system-prompt-fnv1a32:${stableSystemPromptFingerprint}`,
    stableToolDeclarationDigest: stablePrefixToolDeclarationDigest,
    cacheablePrefixDigest: `prompt-prefix-fnv1a32:${cacheablePrefixFingerprint}`,
    cacheablePrefixFingerprint,
    toolDeclarationDigest,
    prefixDivergenceReason: resolvePromptCachePrefixDivergenceReason({
      toolCount: args.tools.length,
      stablePrefixToolCount: stablePrefixTools.length,
    }),
  };
}

export function buildPromptCacheKey(args: {
  conversationId: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  stableSystemPrompt?: string;
  tools: ToolDefinition[];
}): string {
  const conversationLabel = compactPromptCacheLabel(args.conversationId, 'conversation');
  return `${PROMPT_CACHE_KEY_PREFIX}:${conversationLabel}`;
}

type PromptCachingProviderContext = Pick<
  LlmProviderConfig,
  'id' | 'name' | 'baseUrl' | 'providerFamily'
>;
type PromptCachingProviderFamily = NonNullable<PromptCachingProviderContext['providerFamily']>;

function resolvePromptCachingProviderFamily(
  provider: PromptCachingProviderContext,
  model: string,
): NonNullable<PromptCachingProviderContext['providerFamily']> {
  const configuredFamily = provider.providerFamily || 'custom';
  if (configuredFamily !== 'custom') {
    return configuredFamily;
  }

  return resolveModelHostedFamily(model) ?? configuredFamily;
}

function getPromptCachingThreshold(model: string, provider: PromptCachingProviderContext): number {
  const lowerModel = model.toLowerCase();
  const providerFamily = resolvePromptCachingProviderFamily(provider, model);
  const hostedFamily = resolveModelHostedFamily(model);

  if (providerFamily === 'gemini') {
    if (
      lowerModel.includes('gemini-3.5') ||
      lowerModel.includes('gemini-3.1') ||
      lowerModel.includes('gemini-3')
    ) {
      return 4096;
    }
    if (lowerModel.includes('gemini-2.5')) {
      return 2048;
    }
    return 4096;
  }

  if (providerFamily === 'openrouter') {
    if (hostedFamily === 'gemini') {
      if (
        lowerModel.includes('gemini-3.5') ||
        lowerModel.includes('gemini-3.1') ||
        lowerModel.includes('gemini-3')
      ) {
        return 4096;
      }
      if (lowerModel.includes('gemini-2.5')) {
        return 2048;
      }
      return 4096;
    }
    if (hostedFamily === 'anthropic') {
      if (lowerModel.includes('claude-opus-4') || lowerModel.includes('claude-haiku-4')) {
        return 4096;
      }
      if (lowerModel.includes('claude-sonnet-4') || lowerModel.includes('claude-haiku-3')) {
        return 2048;
      }
    }
    return 1024;
  }

  if (providerFamily === 'anthropic') {
    if (lowerModel.includes('claude-opus-4')) {
      return 4096;
    }
    if (lowerModel.includes('claude-haiku-4')) {
      return 4096;
    }
    if (lowerModel.includes('claude-sonnet-4')) {
      return 2048;
    }
    if (lowerModel.includes('claude-haiku-3')) {
      return 2048;
    }
    return 1024;
  }

  // OpenAI prompt caching is automatic at 1024+ prompt tokens.
  if (
    providerFamily === 'openai' ||
    lowerModel.startsWith('gpt-') ||
    isOpenAIReasoningModel(model)
  ) {
    return 1024;
  }

  return 1024;
}

export function shouldEnablePromptCaching(
  model: string,
  estimatedInputTokens: number,
  provider: PromptCachingProviderContext,
): boolean {
  return estimatedInputTokens >= getPromptCachingThreshold(model, provider);
}

function buildPromptCacheTelemetry(args: {
  eligible: boolean;
  enabled: boolean;
  estimatedInputTokens: number;
  explicitCacheName?: string;
  hostedFamily?: string;
  mode: UsagePromptCacheMode;
  promptCacheStructure: PromptCacheStructure;
  providerFamily: string;
  reason: string;
  thresholdTokens: number;
}): UsagePromptCacheTelemetry {
  return {
    eligible: args.eligible,
    enabled: args.enabled,
    estimatedInputTokens: Math.max(0, Math.floor(args.estimatedInputTokens)),
    thresholdTokens: Math.max(0, Math.floor(args.thresholdTokens)),
    providerFamily: args.providerFamily,
    ...(args.hostedFamily ? { hostedFamily: args.hostedFamily } : {}),
    mode: args.mode,
    event: args.enabled ? 'provider_managed' : 'skip',
    reason: args.reason,
    ...(args.explicitCacheName ? { explicitCacheName: args.explicitCacheName } : {}),
    stableSystemPromptDigest: args.promptCacheStructure.stableSystemPromptDigest,
    stableToolDeclarationDigest: args.promptCacheStructure.stableToolDeclarationDigest,
    cacheablePrefixDigest: args.promptCacheStructure.cacheablePrefixDigest,
    toolDeclarationDigest: args.promptCacheStructure.toolDeclarationDigest,
    prefixDivergenceReason: args.promptCacheStructure.prefixDivergenceReason,
  };
}

function resolvePromptCacheMode(providerFamily: PromptCachingProviderFamily): UsagePromptCacheMode {
  switch (providerFamily) {
    case 'openai':
      return 'openai_native';
    case 'anthropic':
      return 'anthropic_native';
    case 'gemini':
      return 'gemini_native';
    case 'openrouter':
      return 'openrouter_compatible';
    default:
      return 'unsupported';
  }
}

export function buildPromptCachingPlan(args: {
  provider: LlmProviderConfig;
  model: string;
  estimatedInputTokens: number;
  conversationId: string;
  systemPrompt: string;
  stableSystemPrompt?: string;
  tools: ToolDefinition[];
}): PromptCachingPlan {
  const providerFamily = resolvePromptCachingProviderFamily(args.provider, args.model);
  const hostedFamily = resolveModelHostedFamily(args.model);
  const thresholdTokens = getPromptCachingThreshold(args.model, args.provider);
  const eligible = args.estimatedInputTokens >= thresholdTokens;
  const mode = resolvePromptCacheMode(providerFamily);
  const promptCacheStructure = buildPromptCacheStructure({
    systemPrompt: args.systemPrompt,
    stableSystemPrompt: args.stableSystemPrompt,
    tools: args.tools,
  });

  if (!eligible) {
    return {
      enablePromptCaching: false,
      telemetry: buildPromptCacheTelemetry({
        eligible: false,
        enabled: false,
        estimatedInputTokens: args.estimatedInputTokens,
        hostedFamily,
        mode,
        promptCacheStructure,
        providerFamily,
        reason: 'below_threshold',
        thresholdTokens,
      }),
    };
  }

  if (providerFamily === 'openai') {
    const promptCacheKey = buildPromptCacheKey({
      conversationId: args.conversationId,
      providerId: args.provider.id,
      model: args.model,
      systemPrompt: args.systemPrompt,
      stableSystemPrompt: args.stableSystemPrompt,
      tools: args.tools,
    });
    return {
      enablePromptCaching: true,
      promptCacheKey,
      telemetry: buildPromptCacheTelemetry({
        eligible: true,
        enabled: true,
        estimatedInputTokens: args.estimatedInputTokens,
        explicitCacheName: promptCacheKey,
        hostedFamily,
        mode: 'openai_native',
        promptCacheStructure,
        providerFamily,
        reason: 'automatic_prompt_cache',
        thresholdTokens,
      }),
    };
  }

  if (providerFamily === 'anthropic') {
    return {
      enablePromptCaching: true,
      telemetry: buildPromptCacheTelemetry({
        eligible: true,
        enabled: true,
        estimatedInputTokens: args.estimatedInputTokens,
        hostedFamily,
        mode: 'anthropic_native',
        promptCacheStructure,
        providerFamily,
        reason: 'cache_control_breakpoints',
        thresholdTokens,
      }),
    };
  }

  if (providerFamily === 'gemini') {
    // Native Gemini caching is provider-managed. Enable cache-aware request
    // shaping without synthesizing OpenAI-style routing keys.
    return {
      enablePromptCaching: true,
      telemetry: buildPromptCacheTelemetry({
        eligible: true,
        enabled: true,
        estimatedInputTokens: args.estimatedInputTokens,
        hostedFamily,
        mode: 'gemini_native',
        promptCacheStructure,
        providerFamily,
        reason: 'managed_or_implicit_cache',
        thresholdTokens,
      }),
    };
  }

  if (providerFamily === 'openrouter') {
    // OpenRouter exposes provider-native/implicit caching through an
    // OpenAI-compatible transport. Keep the plan cache-aware for stable
    // ordering and session stickiness, but do not synthesize OpenAI-only
    // prompt_cache_key fields.
    return {
      enablePromptCaching: true,
      telemetry: buildPromptCacheTelemetry({
        eligible: true,
        enabled: true,
        estimatedInputTokens: args.estimatedInputTokens,
        hostedFamily,
        mode: 'openrouter_compatible',
        promptCacheStructure,
        providerFamily,
        reason: 'sticky_provider_cache',
        thresholdTokens,
      }),
    };
  }

  return {
    enablePromptCaching: false,
    telemetry: buildPromptCacheTelemetry({
      eligible: true,
      enabled: false,
      estimatedInputTokens: args.estimatedInputTokens,
      hostedFamily,
      mode: 'unsupported',
      promptCacheStructure,
      providerFamily,
      reason: 'unsupported_provider',
      thresholdTokens,
    }),
  };
}
