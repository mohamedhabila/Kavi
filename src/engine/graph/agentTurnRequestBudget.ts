import { recordBudgetAuditEntry } from '../../services/context/budgetAudit';
import { enforceContextBudget, inspectContextBudget } from '../../services/context/budgetManager';
import { compressToolDefinitions } from '../tools/toolManagerTokenBudget';
import { buildToolSurfaceTokenAudit, type ToolSurfaceTokenAudit } from './toolSurfaceTokenAudit';
import { collectCacheableProfileSections } from '../../services/context/postCompactionReinject';
import type { ContextEngine, ForcedCompactionTier } from '../../services/context/types';
import { estimateTokens, getWorkingContextWindow } from '../../services/context/tokenCounter';
import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import type { Message } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import type { UsageTokenBuckets } from '../../types/usage';
import { formatMessagesForApi } from '../orchestratorMessageFormatting';
import {
  applyCompactionResultToWorkingMessages,
  estimateWorkingMessageTokens,
  type OrchestratorCompactionEvent,
} from '../orchestratorCompaction';
import { repairModelVisibleToolResultTranscript } from '../orchestratorToolTranscript';
import { sanitizeModelVisibleWorkingMessages } from './modelVisibleWorkingMessages';

type BudgetCompactionEngine = Pick<ContextEngine, 'compact'> | null;
export type AgentTurnCompactionEngine = BudgetCompactionEngine;

export interface PrepareAgentTurnRequestBudgetParams {
  compactionEngine: BudgetCompactionEngine;
  conversationId: string;
  enrichedSystemPrompt: string;
  enrichedSystemPromptSections?: ReadonlyArray<{ text: string; cacheable?: boolean }>;
  iteration?: number;
  livingMemory?: LivingMemoryBridgeOutput | null;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  pinnedToolNames?: ReadonlyArray<string>;
  sessionPinnedCount?: number;
  turnPinnedCount?: number;
  requestMaxTokens: number;
  requestModel: string;
  toolsForIteration: ReadonlyArray<ToolDefinition> | undefined;
  warn: (message: string, error: unknown) => void;
  workingMessages: Message[];
}

export interface PreparedAgentTurnRequestBudget {
  budgetResult: ReturnType<typeof enforceContextBudget>;
  contextWindow: number;
  toolSurfaceTokenAudit?: ToolSurfaceTokenAudit;
  usageTokenBuckets: UsageTokenBuckets;
  workingMessages: Message[];
}

export interface CompactAgentTurnWorkingMessagesParams {
  compactionEngine: BudgetCompactionEngine;
  conversationId: string;
  currentMessages: Message[];
  goalsPromptSection?: string | null;
  livingMemory?: LivingMemoryBridgeOutput | null;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  profileSections?: ReadonlyArray<string>;
  currentTokenCount?: number;
  tokenBudget?: number;
  forceTier?: ForcedCompactionTier;
  failureLabel: string;
  warn: (message: string, error: unknown) => void;
}

function extractGoalsPromptSection(
  sections: ReadonlyArray<{ text: string }> | undefined,
): string | null {
  if (!sections?.length) {
    return null;
  }
  const goalsSection = sections.find((section) => section.text.includes('## Current Goals'));
  return goalsSection?.text ?? null;
}

function resolveCompactionReinjectParams(params: {
  goalsPromptSection?: string | null;
  livingMemory?: LivingMemoryBridgeOutput | null;
  profileSections?: ReadonlyArray<string>;
  promptSections?: ReadonlyArray<{ text: string; cacheable?: boolean }>;
}): {
  goalsPromptSection?: string | null;
  profileSections: string[];
} {
  const profileSections =
    params.profileSections ??
    collectCacheableProfileSections(params.livingMemory?.sections ?? params.promptSections);
  const goalsPromptSection =
    params.goalsPromptSection ?? extractGoalsPromptSection(params.promptSections);
  return {
    goalsPromptSection,
    profileSections: [...profileSections],
  };
}

function buildLivingMemoryCompactionHints(
  livingMemory: LivingMemoryBridgeOutput | null | undefined,
): {
  focusBlock?: string;
  idleSinceLastTurnMs?: number;
  openThreads?: string[];
} {
  return {
    ...(livingMemory && typeof livingMemory.idleSinceLastTurnMs === 'number'
      ? { idleSinceLastTurnMs: livingMemory.idleSinceLastTurnMs }
      : {}),
    ...(livingMemory?.focusBlockText ? { focusBlock: livingMemory.focusBlockText } : {}),
    ...(livingMemory && livingMemory.openThreadLabels.length > 0
      ? { openThreads: livingMemory.openThreadLabels }
      : {}),
  };
}

export async function compactAgentTurnWorkingMessages(
  params: CompactAgentTurnWorkingMessagesParams,
): Promise<{ messages: Message[]; compacted: boolean }> {
  const compactionHints = buildLivingMemoryCompactionHints(params.livingMemory);
  if (!params.compactionEngine) {
    return { messages: params.currentMessages, compacted: false };
  }

  try {
    const compactResult = await params.compactionEngine.compact({
      sessionId: params.conversationId,
      messages: params.currentMessages,
      ...(params.currentTokenCount != null ? { currentTokenCount: params.currentTokenCount } : {}),
      ...(params.tokenBudget != null ? { tokenBudget: params.tokenBudget } : {}),
      ...(params.forceTier ? { forceTier: params.forceTier } : {}),
      ...compactionHints,
    });
    if (!compactResult.compacted || !compactResult.result) {
      return { messages: params.currentMessages, compacted: false };
    }

    const reinject = resolveCompactionReinjectParams({
      goalsPromptSection: params.goalsPromptSection,
      livingMemory: params.livingMemory,
      profileSections: params.profileSections,
    });
    const applied = applyCompactionResultToWorkingMessages(
      params.currentMessages,
      compactResult,
      reinject,
    );
    params.onCompaction?.(applied);
    return { messages: applied.messages, compacted: true };
  } catch (compactionError: unknown) {
    params.warn(params.failureLabel, compactionError);
    return { messages: params.currentMessages, compacted: false };
  }
}

async function previewRequestBudget(params: {
  enrichedSystemPrompt: string;
  candidateMessages: Message[];
  requestMaxTokens: number;
  requestModel: string;
  toolsForIteration: ToolDefinition[];
}) {
  const candidateApiMessages = await formatMessagesForApi(
    params.enrichedSystemPrompt,
    params.candidateMessages,
  );
  const nonSystemCandidateApiMessages =
    candidateApiMessages[0]?.role === 'system'
      ? candidateApiMessages.slice(1)
      : candidateApiMessages;

  return {
    nonSystemApiMessages: nonSystemCandidateApiMessages,
    pressure: inspectContextBudget(
      params.requestModel,
      params.enrichedSystemPrompt,
      params.toolsForIteration,
      nonSystemCandidateApiMessages,
      params.requestMaxTokens,
    ),
  };
}

function estimateApiMessageTokens(message: {
  role: string;
  content: string | any[];
  [key: string]: any;
}): number {
  const content =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  return estimateTokens(content) + 4;
}

function buildMessageTokenBuckets(
  messages: ReadonlyArray<{ role: string; content: string | any[]; [key: string]: any }>,
): Pick<UsageTokenBuckets, 'conversationHistoryTokens' | 'toolResultTokens' | 'userTurnTokens'> {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }

  return messages.reduce(
    (acc, message, index) => {
      const tokens = estimateApiMessageTokens(message);
      if (message.role === 'tool') {
        acc.toolResultTokens += tokens;
      } else if (index === latestUserIndex) {
        acc.userTurnTokens += tokens;
      } else {
        acc.conversationHistoryTokens += tokens;
      }
      return acc;
    },
    {
      conversationHistoryTokens: 0,
      toolResultTokens: 0,
      userTurnTokens: 0,
    },
  );
}

function buildUsageTokenBuckets(params: {
  budgetResult: ReturnType<typeof enforceContextBudget>;
  goalsTokens: number;
  memoryCacheableTokens: number;
  memoryDynamicTokens: number;
}): UsageTokenBuckets {
  const rawMemoryContextTokens = Math.round(
    params.memoryCacheableTokens + params.memoryDynamicTokens + params.goalsTokens,
  );
  const memoryContextTokens = Math.min(
    Math.max(0, rawMemoryContextTokens),
    Math.max(0, params.budgetResult.result.systemPromptTokens),
  );
  const messageBuckets = buildMessageTokenBuckets(params.budgetResult.messages);

  return {
    systemPromptTokens: Math.max(
      0,
      params.budgetResult.result.systemPromptTokens - memoryContextTokens,
    ),
    toolDeclarationTokens: Math.max(0, params.budgetResult.result.toolsTokens),
    memoryContextTokens,
    conversationHistoryTokens: Math.max(0, messageBuckets.conversationHistoryTokens),
    userTurnTokens: Math.max(0, messageBuckets.userTurnTokens),
    toolResultTokens: Math.max(0, messageBuckets.toolResultTokens),
  };
}

export async function prepareAgentTurnRequestBudget(
  params: PrepareAgentTurnRequestBudgetParams,
): Promise<PreparedAgentTurnRequestBudget> {
  const contextWindow = getWorkingContextWindow(params.requestModel);
  let workingMessages = repairModelVisibleToolResultTranscript(params.workingMessages);
  const toolsForIteration = [...(params.toolsForIteration ?? [])];
  const compactionReinject = resolveCompactionReinjectParams({
    livingMemory: params.livingMemory,
    promptSections: params.enrichedSystemPromptSections,
  });
  let compactionApplied = false;

  let modelVisibleMessages = sanitizeModelVisibleWorkingMessages(workingMessages);
  let budgetPreview = await previewRequestBudget({
    enrichedSystemPrompt: params.enrichedSystemPrompt,
    candidateMessages: modelVisibleMessages,
    requestMaxTokens: params.requestMaxTokens,
    requestModel: params.requestModel,
    toolsForIteration,
  });
  if (
    params.compactionEngine &&
    workingMessages.length > 1 &&
    budgetPreview.pressure.requiresMessageWindowing
  ) {
    for (const forceTier of ['tool_clearing', 'selective', 'aggressive'] as const) {
      if (!budgetPreview.pressure.requiresMessageWindowing) {
        break;
      }

      const budgetCompaction = await compactAgentTurnWorkingMessages({
        compactionEngine: params.compactionEngine,
        conversationId: params.conversationId,
        currentMessages: workingMessages,
        goalsPromptSection: compactionReinject.goalsPromptSection,
        livingMemory: params.livingMemory,
        onCompaction: params.onCompaction,
        profileSections: compactionReinject.profileSections,
        currentTokenCount: estimateWorkingMessageTokens(workingMessages),
        forceTier,
        failureLabel: 'Pre-flight compaction failed, continuing without compaction',
        warn: params.warn,
      });
      if (!budgetCompaction.compacted) {
        continue;
      }
      compactionApplied = true;

      workingMessages = repairModelVisibleToolResultTranscript(budgetCompaction.messages);
      modelVisibleMessages = sanitizeModelVisibleWorkingMessages(workingMessages);
      budgetPreview = await previewRequestBudget({
        enrichedSystemPrompt: params.enrichedSystemPrompt,
        candidateMessages: modelVisibleMessages,
        requestMaxTokens: params.requestMaxTokens,
        requestModel: params.requestModel,
        toolsForIteration,
      });
    }
  }

  if (budgetPreview.pressure.requiresMessageWindowing) {
    const placeholderCompactedModelVisibleMessages = sanitizeModelVisibleWorkingMessages(
      workingMessages,
      {
        compactHistoricalToolResults: true,
      },
    );
    const placeholderCompactionPreview = await previewRequestBudget({
      enrichedSystemPrompt: params.enrichedSystemPrompt,
      candidateMessages: placeholderCompactedModelVisibleMessages,
      requestMaxTokens: params.requestMaxTokens,
      requestModel: params.requestModel,
      toolsForIteration,
    });

    if (
      placeholderCompactionPreview.pressure.requiresMessageWindowing !==
        budgetPreview.pressure.requiresMessageWindowing ||
      placeholderCompactionPreview.pressure.totalTokens < budgetPreview.pressure.totalTokens
    ) {
      modelVisibleMessages = placeholderCompactedModelVisibleMessages;
      budgetPreview = placeholderCompactionPreview;
    }
  }

  const pinnedToolNames = Array.from(
    new Set((params.pinnedToolNames ?? []).map((name) => name.trim()).filter(Boolean)),
  );
  const compactionOptions = { pinnedToolNames: new Set(pinnedToolNames) };
  const candidateTools = compressToolDefinitions(toolsForIteration, compactionOptions);
  const budgetResult = enforceContextBudget(
    params.requestModel,
    params.enrichedSystemPrompt,
    toolsForIteration,
    budgetPreview.nonSystemApiMessages,
    params.requestMaxTokens,
    { pinnedToolNames },
  );
  const toolSurfaceTokenAudit =
    toolsForIteration.length > 0
      ? buildToolSurfaceTokenAudit({
          candidateTools,
          retainedTools: budgetResult.tools,
          compactionOptions,
          sessionPinnedCount: params.sessionPinnedCount,
          turnPinnedCount: params.turnPinnedCount,
        })
      : undefined;

  const memoryCacheableTokens = compactionReinject.profileSections.reduce(
    (sum, section) => sum + estimateTokens(section),
    0,
  );
  const goalsTokens = estimateTokens(compactionReinject.goalsPromptSection ?? '');
  const memoryDynamicTokens = Math.max(
    0,
    Math.round((params.livingMemory?.recalledFactCount ?? 0) * 48),
  );
  const usageTokenBuckets = buildUsageTokenBuckets({
    budgetResult,
    goalsTokens,
    memoryCacheableTokens,
    memoryDynamicTokens,
  });
  recordBudgetAuditEntry({
    conversationId: params.conversationId,
    iteration: params.iteration ?? 0,
    model: params.requestModel,
    layers: {
      system: budgetPreview.pressure.systemPromptTokens,
      tools: budgetPreview.pressure.toolsTokens,
      messages: budgetPreview.pressure.messagesTokens,
      memory_cacheable: Math.round(memoryCacheableTokens),
      memory_dynamic: memoryDynamicTokens,
      goals: Math.round(goalsTokens),
    },
    totalTokens: budgetPreview.pressure.totalTokens,
    contextWindow,
    compactionApplied,
  });

  return {
    budgetResult,
    contextWindow,
    toolSurfaceTokenAudit,
    usageTokenBuckets,
    workingMessages,
  };
}
