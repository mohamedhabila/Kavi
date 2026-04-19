import { useChatStore } from '../../store/useChatStore';
import type { ConversationUsageSource, TokenUsage, ToolCall } from '../../types';
import {
  estimateCost,
  getUsageCacheSummary,
  isZeroCostModel,
  normalizeUsage,
  recordUsage,
} from './tracker';
import { parseGeneratedImageResult } from '../media/imageGeneration';

export interface ConversationUsageRecordOptions {
  conversationId: string;
  usage: TokenUsage;
  providerId?: string;
  source?: ConversationUsageSource;
  modality?: 'image';
  toolCallId?: string;
  sessionId?: string;
  parentSessionId?: string;
  agentRunId?: string;
  estimatedCost?: number;
  timestamp?: number;
  recordSessionUsage?: boolean;
  emitLog?: boolean;
}

function formatTokenCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString();
}

function formatUsdCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.0000';
  }
  if (value < 0.0001) {
    return '<$0.0001';
  }
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function formatUsageSourceLabel(source?: ConversationUsageSource): string | undefined {
  switch (source) {
    case 'primary':
      return 'Primary';
    case 'sub-agent':
      return 'Sub-agent';
    case 'sub-agent-finalizer':
      return 'Sub-agent finalizer';
    case 'pilot':
      return 'Pilot';
    default:
      return undefined;
  }
}

export function buildUsageLogDetail(
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    tokenDetails?: TokenUsage['tokenDetails'];
  },
  estimatedCost: number,
  source?: ConversationUsageSource,
): string {
  const cacheSummary = getUsageCacheSummary(usage);
  const parts = [
    ...(formatUsageSourceLabel(source) ? [formatUsageSourceLabel(source)!] : []),
    usage.model,
    `in ${formatTokenCount(usage.inputTokens)}`,
    `out ${formatTokenCount(usage.outputTokens)}`,
    `cost ${formatUsdCost(estimatedCost)}`,
  ];

  if (cacheSummary.cacheReadTokens > 0 || cacheSummary.cacheWriteTokens > 0) {
    parts.push(
      `cache ${formatTokenCount(cacheSummary.cacheReadTokens)} / ${formatTokenCount(cacheSummary.cacheDenominatorTokens)}`,
    );
    if (cacheSummary.cacheWriteTokens > 0) {
      parts.push(`write ${formatTokenCount(cacheSummary.cacheWriteTokens)}`);
    }
  }

  if ((usage.tokenDetails?.inputImageTokens ?? 0) > 0) {
    parts.push(`img in ${formatTokenCount(usage.tokenDetails?.inputImageTokens ?? 0)}`);
  }

  if ((usage.tokenDetails?.outputImageTokens ?? 0) > 0) {
    parts.push(`img out ${formatTokenCount(usage.tokenDetails?.outputImageTokens ?? 0)}`);
  }

  if ((usage.tokenDetails?.outputThinkingTokens ?? 0) > 0) {
    parts.push(`thinking ${formatTokenCount(usage.tokenDetails?.outputThinkingTokens ?? 0)}`);
  }

  return parts.join(' · ');
}

export function extractResponseTokenUsage(
  response: unknown,
  model: string,
): TokenUsage | undefined {
  const usage = normalizeUsage((response as { usage?: unknown } | undefined)?.usage);
  if (!usage) {
    return undefined;
  }

  return {
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    ...(usage.tokenDetails ? { tokenDetails: usage.tokenDetails } : {}),
  };
}

export function extractImageToolUsage(
  toolCall?: Pick<ToolCall, 'name' | 'status' | 'result'>,
): TokenUsage | undefined {
  if (
    !toolCall ||
    toolCall.status !== 'completed' ||
    !toolCall.result ||
    (toolCall.name !== 'image_generate' && toolCall.name !== 'image_edit')
  ) {
    return undefined;
  }

  return parseGeneratedImageResult(toolCall.result)?.usage;
}

export function recordImageToolConversationUsage(
  options: Omit<ConversationUsageRecordOptions, 'usage'> & {
    toolCall?: Pick<ToolCall, 'id' | 'name' | 'status' | 'result' | 'completedAt' | 'updatedAt'>;
  },
): void {
  if (!options.toolCall) {
    return;
  }

  const usage = extractImageToolUsage(options.toolCall);
  if (!usage) {
    return;
  }

  const existingConversation = useChatStore
    .getState()
    .conversations.find((conversation) => conversation.id === options.conversationId);
  const toolCallId = options.toolCall.id;
  if (
    toolCallId &&
    existingConversation?.usage?.entries.some((entry) => entry.toolCallId === toolCallId)
  ) {
    return;
  }

  recordConversationUsageEvent({
    ...options,
    usage,
    modality: 'image',
    toolCallId,
    timestamp: options.timestamp ?? options.toolCall.completedAt ?? options.toolCall.updatedAt,
  });
}

export function recordConversationUsageEvent(options: ConversationUsageRecordOptions): void {
  const inputTokens = Math.max(0, options.usage.inputTokens ?? 0);
  const outputTokens = Math.max(0, options.usage.outputTokens ?? 0);
  const cacheReadTokens = Math.max(0, options.usage.cacheReadTokens ?? 0);
  const cacheWriteTokens = Math.max(0, options.usage.cacheWriteTokens ?? 0);
  const totalTokens = Math.max(inputTokens + outputTokens, options.usage.totalTokens ?? 0);
  const usage: TokenUsage = {
    model: options.usage.model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    ...(options.usage.tokenDetails ? { tokenDetails: options.usage.tokenDetails } : {}),
  };
  const estimatedCost = isZeroCostModel(usage.model)
    ? 0
    : (options.estimatedCost ??
      estimateCost(usage.model, inputTokens, outputTokens, {
        cacheReadTokens,
        cacheWriteTokens,
        tokenDetails: usage.tokenDetails,
      }));

  const chatStoreState = useChatStore.getState();

  chatStoreState.recordConversationUsage?.(options.conversationId, {
    ...usage,
    providerId: options.providerId,
    source: options.source,
    modality: options.modality,
    toolCallId: options.toolCallId,
    sessionId: options.sessionId,
    parentSessionId: options.parentSessionId,
    agentRunId: options.agentRunId,
    timestamp: options.timestamp,
    estimatedCost,
  });

  if (options.recordSessionUsage) {
    recordUsage(options.conversationId, usage);
  }

  if (options.emitLog) {
    chatStoreState.addConversationLog?.(options.conversationId, {
      kind: 'usage',
      title: 'Usage recorded',
      detail: buildUsageLogDetail(usage, estimatedCost, options.source),
      timestamp: options.timestamp,
    });
  }
}
