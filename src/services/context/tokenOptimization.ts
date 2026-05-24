// ---------------------------------------------------------------------------
// Kavi — Token Optimization Helpers
// ---------------------------------------------------------------------------
// Production-oriented heuristics for reducing token cost in long-running agent
// sessions without materially degrading quality.

import type { LlmProviderConfig, ToolDefinition } from '../../types';
import type { ThinkingLevel } from '../../engine/thinking';
import { looksLikeGeminiProvider as looksLikeNativeGeminiProvider } from '../../constants/api';
import { getWorkingContextWindow } from './tokenCounter';

// Gemini 3 models cannot disable thinking — the thinking token budget is
// consumed from the max_tokens allowance.  These overheads account for the
// thinking budget so the visible response is not truncated.
const GEMINI_THINKING_OVERHEAD: Record<string, number> = {
  low: 1536, // "minimal" mapped to low
  medium: 8192,
  high: 24576,
};

function isGeminiModel(model: string): boolean {
  return model.toLowerCase().includes('gemini');
}

function isGemini3Model(model: string): boolean {
  const lower = model.toLowerCase();
  return lower.includes('gemini-3') || lower.includes('gemini-3.');
}

export interface IterationPlanningArgs {
  provider: LlmProviderConfig;
  primaryModel: string;
  allowModelDowngrade?: boolean;
  iteration: number;
  maxTokens: number;
  actionableRequest: boolean;
  hasRecentToolMessages: boolean;
  hasAttachments: boolean;
  thinkingLevel: ThinkingLevel;
  responseBudgetProfile?: ResponseBudgetProfile;
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
}

export type ResponseBudgetProfile = 'default' | 'sub-agent';

export const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64;

const TOOL_HEAVY_TOKEN_CAP = 2048;
const ACTIONABLE_FIRST_TURN_CAP = 3072;
const DEFAULT_RESPONSE_CAP = 4096;
const ATTACHMENT_RESPONSE_CAP = 6144;
const SUB_AGENT_TOOL_HEAVY_TOKEN_CAP = 8192;
const SUB_AGENT_ACTIONABLE_FIRST_TURN_CAP = 12288;
const SUB_AGENT_DEFAULT_RESPONSE_CAP = 8192;
const SUB_AGENT_ATTACHMENT_RESPONSE_CAP = 12288;
const SUB_AGENT_REASONING_FLOOR = 8192;
const SUB_AGENT_MAX_TOKENS = 12288;
const SUB_AGENT_REASONING_MAX_TOKENS = 16384;
const DEFAULT_FINALIZATION_MAX_TOKENS = 4096;
const REASONING_FINALIZATION_MAX_TOKENS = 8192;
const MAX_OUTPUT_CONTEXT_SHARE = 0.5;
const OUTPUT_CONTEXT_HEADROOM = 4096;
const PROMPT_CACHE_KEY_LABEL_MAX_LENGTH = 24;
const PROMPT_CACHE_KEY_PREFIX = 'cm';

const ECONOMY_MODEL_CANDIDATES: Record<string, string[]> = {
  'gpt-5.5': ['gpt-5.4-mini', 'gpt-5-mini'],
  'gpt-5.4': ['gpt-5.4-mini', 'gpt-5-mini'],
  'gpt-5.2': ['gpt-5-mini'],
  'gpt-5.1': ['gpt-5.1-codex-mini', 'gpt-5-mini'],
  'claude-opus-4-7': ['claude-sonnet-4-6', 'claude-haiku-4-5'],
  'claude-sonnet-4-6': ['claude-haiku-4-5'],
  'claude-sonnet-4-5': ['claude-haiku-4-5'],
  'gemini-3.5-flash': ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'],
  'gemini-2.5-pro': ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  'gemini-3.1-pro-preview': ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'],
  'o3': ['o4-mini'],
};

function normalizeAvailableModels(provider: LlmProviderConfig): string[] {
  const explicit = provider.availableModels || [];
  const legacy = (provider as any).models || [];
  const hidden = new Set(provider.hiddenModels || []);
  return Array.from(new Set([provider.model, ...explicit, ...legacy]))
    .filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
    .filter((model) => !hidden.has(model));
}

export function pickEconomyModel(provider: LlmProviderConfig, primaryModel: string): string | null {
  const available = normalizeAvailableModels(provider);
  const directCandidates = ECONOMY_MODEL_CANDIDATES[primaryModel] || [];
  for (const candidate of directCandidates) {
    if (available.includes(candidate)) {
      return candidate;
    }
  }

  const lowerPrimary = primaryModel.toLowerCase();
  if (
    lowerPrimary.includes('gpt-5') ||
    lowerPrimary.includes('claude') ||
    lowerPrimary.includes('gemini')
  ) {
    const suffixHints = ['mini', 'flash', 'haiku', 'lite'];
    for (const candidate of available) {
      const lowerCandidate = candidate.toLowerCase();
      if (candidate === primaryModel) {
        continue;
      }
      if (!suffixHints.some((hint) => lowerCandidate.includes(hint))) {
        continue;
      }
      if (
        (lowerPrimary.includes('gpt-5') && lowerCandidate.includes('gpt-5')) ||
        (lowerPrimary.includes('claude') && lowerCandidate.includes('claude')) ||
        (lowerPrimary.includes('gemini') && lowerCandidate.includes('gemini'))
      ) {
        return candidate;
      }
    }
  }

  return null;
}

function clampThinkingLevel(level: ThinkingLevel, upperBound: ThinkingLevel): ThinkingLevel {
  const order: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  const current = order.indexOf(level);
  const max = order.indexOf(upperBound);
  return order[Math.min(current, max)];
}

function isReasoningHeavyModel(model: string): boolean {
  const lower = model.toLowerCase();
  return (
    lower.includes('claude') ||
    lower.includes('gemini') ||
    lower.includes('gpt-5') ||
    lower === 'o1' ||
    lower.startsWith('o1-') ||
    lower === 'o3' ||
    lower.startsWith('o3-') ||
    lower.includes('o4')
  );
}

function clampOutputBudgetToContext(model: string, requestedTokens: number): number {
  const workingContext = getWorkingContextWindow(model);
  const maxByShare = Math.floor(workingContext * MAX_OUTPUT_CONTEXT_SHARE);
  const maxByHeadroom = Math.max(1024, workingContext - OUTPUT_CONTEXT_HEADROOM);
  const hardCap = Math.max(1024, Math.min(maxByShare, maxByHeadroom));
  return Math.max(1024, Math.min(requestedTokens, hardCap));
}

function resolveResponseCap(
  profile: ResponseBudgetProfile,
  args: Pick<
    IterationPlanningArgs,
    'actionableRequest' | 'hasRecentToolMessages' | 'hasAttachments'
  >,
): number {
  if (profile === 'sub-agent') {
    return args.hasAttachments
      ? SUB_AGENT_ATTACHMENT_RESPONSE_CAP
      : args.hasRecentToolMessages
        ? SUB_AGENT_TOOL_HEAVY_TOKEN_CAP
        : args.actionableRequest
          ? SUB_AGENT_ACTIONABLE_FIRST_TURN_CAP
          : SUB_AGENT_DEFAULT_RESPONSE_CAP;
  }

  return args.hasAttachments
    ? ATTACHMENT_RESPONSE_CAP
    : args.hasRecentToolMessages
      ? TOOL_HEAVY_TOKEN_CAP
      : args.actionableRequest
        ? ACTIONABLE_FIRST_TURN_CAP
        : DEFAULT_RESPONSE_CAP;
}

export function resolveSubAgentMaxTokens(model: string): number {
  const requestedBudget = isReasoningHeavyModel(model)
    ? SUB_AGENT_REASONING_MAX_TOKENS
    : SUB_AGENT_MAX_TOKENS;
  return clampOutputBudgetToContext(model, requestedBudget);
}

export function resolveFinalizationMaxTokens(model: string): number {
  const requestedBudget = isReasoningHeavyModel(model)
    ? REASONING_FINALIZATION_MAX_TOKENS
    : DEFAULT_FINALIZATION_MAX_TOKENS;
  return clampOutputBudgetToContext(model, requestedBudget);
}

export function getEscalatedFinalizationMaxTokens(currentMaxTokens: number, model: string): number {
  const retryCeiling = resolveSubAgentMaxTokens(model);
  const retryFloor = Math.max(resolveFinalizationMaxTokens(model), 8192);
  if (currentMaxTokens >= retryCeiling) {
    return currentMaxTokens;
  }

  return Math.min(retryCeiling, Math.max(currentMaxTokens * 2, retryFloor));
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
    provider,
    primaryModel,
    allowModelDowngrade = false,
    iteration,
    maxTokens,
    actionableRequest,
    hasRecentToolMessages,
    hasAttachments,
    thinkingLevel,
    responseBudgetProfile = 'default',
  } = args;

  const responseCap = resolveResponseCap(responseBudgetProfile, {
    actionableRequest,
    hasRecentToolMessages,
    hasAttachments,
  });

  let plannedMaxTokens = Math.max(512, Math.min(maxTokens, responseCap));
  if (responseBudgetProfile === 'sub-agent' && isReasoningHeavyModel(primaryModel)) {
    plannedMaxTokens = Math.max(
      plannedMaxTokens,
      Math.min(maxTokens, clampOutputBudgetToContext(primaryModel, SUB_AGENT_REASONING_FLOOR)),
    );
  }

  // Tool-planning turns should not be starved by the default economy caps.
  // Use a substantially higher protected floor so the model has enough room
  // to reason through tool selection and arguments, while still leaving retry
  // headroom above the first attempt when a provider exhausts its output cap.
  if (actionableRequest || hasRecentToolMessages) {
    plannedMaxTokens = Math.max(plannedMaxTokens, resolveFinalizationMaxTokens(primaryModel));
  }

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

  if (responseBudgetProfile === 'sub-agent') {
    plannedMaxTokens = Math.min(plannedMaxTokens, resolveSubAgentMaxTokens(primaryModel));
  }

  if (hasAttachments || thinkingLevel === 'high' || thinkingLevel === 'xhigh') {
    return {
      model: primaryModel,
      maxTokens: plannedMaxTokens,
      thinkingLevel,
      reason: 'attachments-or-high-reasoning',
    };
  }

  if (iteration > 1 && hasRecentToolMessages) {
    const economyModel = pickEconomyModel(provider, primaryModel);
    return {
      model: allowModelDowngrade ? economyModel || primaryModel : primaryModel,
      maxTokens: plannedMaxTokens,
      thinkingLevel: clampThinkingLevel(
        thinkingLevel,
        allowModelDowngrade && economyModel ? 'minimal' : 'low',
      ),
      reason:
        allowModelDowngrade && economyModel
          ? 'tool-follow-up-economy-model'
          : 'tool-follow-up-primary-model',
    };
  }

  return {
    model: primaryModel,
    maxTokens: plannedMaxTokens,
    thinkingLevel: clampThinkingLevel(thinkingLevel, actionableRequest ? 'low' : 'medium'),
    reason: actionableRequest ? 'actionable-request-capped-output' : 'default-response-cap',
  };
}

export function buildPromptCacheKey(args: {
  conversationId: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
}): string {
  // OpenAI combines prompt_cache_key with its own prompt-prefix hash, so we
  // only need a short conversation-scoped key here. Avoid embedding provider
  // or model identifiers because those can exceed the 64-char API limit and
  // unnecessarily fragment cache affinity across primary/economy model turns.
  const conversationLabel = compactPromptCacheLabel(args.conversationId, 'conversation');
  const fingerprint = hashPromptCacheMaterial(args.conversationId);
  return `${PROMPT_CACHE_KEY_PREFIX}:${conversationLabel}:${fingerprint}`;
}

function getPromptCachingThreshold(model: string, providerId?: string): number {
  const lowerModel = model.toLowerCase();
  const lowerProvider = (providerId || '').toLowerCase();

  if (
    lowerProvider.includes('gemini') ||
    lowerProvider.includes('google') ||
    lowerModel.includes('gemini')
  ) {
    if (
      lowerModel.includes('gemini-3.1-pro') ||
      lowerModel.includes('gemini-3-pro') ||
      lowerModel.includes('gemini-2.5-pro')
    ) {
      return 4096;
    }
    if (
      lowerModel.includes('gemini-3.5-flash') ||
      lowerModel.includes('gemini-3.1-flash-lite') ||
      lowerModel.includes('gemini-3-flash') ||
      lowerModel.includes('gemini-2.5-flash') ||
      lowerModel.includes('gemini-2.5-flash-lite')
    ) {
      return 1024;
    }
    if (lowerModel.includes('pro')) {
      return 4096;
    }
    if (lowerModel.includes('flash') || lowerModel.includes('lite')) {
      return 1024;
    }
    return 1024;
  }

  if (lowerProvider.includes('anthropic') || lowerModel.includes('claude')) {
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
    lowerProvider.includes('openai') ||
    lowerModel.includes('gpt') ||
    lowerModel === 'o3' ||
    lowerModel.includes('o4')
  ) {
    return 1024;
  }

  return 1024;
}

export function shouldEnablePromptCaching(
  model: string,
  estimatedInputTokens: number,
  providerId?: string,
): boolean {
  return estimatedInputTokens >= getPromptCachingThreshold(model, providerId);
}

function looksLikeOpenAIProvider(provider: LlmProviderConfig): boolean {
  const lowerId = provider.id.toLowerCase();
  const lowerName = provider.name.toLowerCase();
  const lowerBase = provider.baseUrl.toLowerCase();
  return (
    lowerId.includes('openai') ||
    lowerName.includes('openai') ||
    lowerBase.includes('api.openai.com')
  );
}

function looksLikeAnthropicProvider(provider: LlmProviderConfig, model: string): boolean {
  const lowerId = provider.id.toLowerCase();
  const lowerName = provider.name.toLowerCase();
  const lowerBase = provider.baseUrl.toLowerCase();
  const lowerModel = model.toLowerCase();
  return (
    lowerId.includes('anthropic') ||
    lowerName.includes('anthropic') ||
    lowerBase.includes('anthropic.com') ||
    lowerModel.includes('claude')
  );
}

function looksLikeGeminiProvider(provider: LlmProviderConfig, model: string): boolean {
  const lowerId = provider.id.toLowerCase();
  return (
    looksLikeNativeGeminiProvider(provider) ||
    (!provider.baseUrl && (lowerId.includes('gemini') || lowerId.includes('google'))) ||
    (!provider.baseUrl && model.toLowerCase().includes('gemini'))
  );
}

export function buildPromptCachingPlan(args: {
  provider: LlmProviderConfig;
  model: string;
  estimatedInputTokens: number;
  conversationId: string;
  systemPrompt: string;
  tools: ToolDefinition[];
}): PromptCachingPlan {
  const enabled = shouldEnablePromptCaching(
    args.model,
    args.estimatedInputTokens,
    args.provider.id,
  );

  if (!enabled) {
    return { enablePromptCaching: false };
  }

  if (looksLikeOpenAIProvider(args.provider)) {
    return {
      enablePromptCaching: true,
      promptCacheKey: buildPromptCacheKey({
        conversationId: args.conversationId,
        providerId: args.provider.id,
        model: args.model,
        systemPrompt: args.systemPrompt,
        tools: args.tools,
      }),
    };
  }

  if (looksLikeAnthropicProvider(args.provider, args.model)) {
    return {
      enablePromptCaching: true,
    };
  }

  if (looksLikeGeminiProvider(args.provider, args.model)) {
    // Native Gemini caching is provider-managed. Enable cache-aware request
    // shaping without synthesizing OpenAI-style routing keys.
    return {
      enablePromptCaching: true,
    };
  }

  return { enablePromptCaching: false };
}
