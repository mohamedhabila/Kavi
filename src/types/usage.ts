export interface ConversationUsageEntry {
  model: string;
  providerId?: string;
  source?: ConversationUsageSource;
  modality?: 'image';
  toolCallId?: string;
  sessionId?: string;
  parentSessionId?: string;
  agentRunId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCost: number;
  tokenDetails?: UsageTokenDetails;
  tokenBuckets?: UsageTokenBuckets;
  promptCache?: UsagePromptCacheTelemetry;
  timestamp: number;
}

export interface ConversationUsageSummary {
  entries: ConversationUsageEntry[];
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalTokens: number;
  totalCost: number;
  totalCalls: number;
  lastModel?: string;
  lastProviderId?: string;
  lastUpdatedAt?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  model: string;
  tokenDetails?: UsageTokenDetails;
  tokenBuckets?: UsageTokenBuckets;
  promptCache?: UsagePromptCacheTelemetry;
}

export interface UsageTokenDetails {
  inputTextTokens?: number;
  inputImageTokens?: number;
  outputTextTokens?: number;
  outputImageTokens?: number;
  outputThinkingTokens?: number;
}

export interface UsageTokenBuckets {
  systemPromptTokens: number;
  toolDeclarationTokens: number;
  memoryContextTokens: number;
  conversationHistoryTokens: number;
  userTurnTokens: number;
  toolResultTokens: number;
}

export type UsagePromptCacheEvent = 'create' | 'reuse' | 'skip' | 'provider_managed';

export type UsagePromptCacheMode =
  | 'openai_native'
  | 'anthropic_native'
  | 'gemini_native'
  | 'openrouter_compatible'
  | 'unsupported';

export type UsagePromptCachePrefixDivergenceReason =
  | 'no_tools'
  | 'no_stable_tool_prefix'
  | 'stable_prefix_with_dynamic_suffix'
  | 'fully_stable_prefix';

export interface UsagePromptCacheTelemetry {
  eligible: boolean;
  enabled: boolean;
  estimatedInputTokens: number;
  thresholdTokens: number;
  providerFamily: string;
  hostedFamily?: string;
  mode: UsagePromptCacheMode;
  event: UsagePromptCacheEvent;
  reason: string;
  explicitCacheName?: string;
  stableSystemPromptDigest?: string;
  stableToolDeclarationDigest?: string;
  cacheablePrefixDigest?: string;
  toolDeclarationDigest?: string;
  prefixDivergenceReason?: UsagePromptCachePrefixDivergenceReason;
}

export type ConversationUsageSource = 'primary' | 'sub-agent' | 'sub-agent-finalizer' | 'pilot';

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  tokenDetails?: UsageTokenDetails;
}

export interface SessionUsage {
  conversationId: string;
  entries: UsageEntry[];
  totalInput: number;
  totalOutput: number;
  totalCacheRead?: number;
  totalCacheWrite?: number;
  totalCost: number;
}

export interface UsageEntry {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  tokenBuckets?: UsageTokenBuckets;
  promptCache?: UsagePromptCacheTelemetry;
  timestamp: number;
  estimatedCost?: number;
}
