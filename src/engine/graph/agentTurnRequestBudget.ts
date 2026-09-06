import { recordBudgetAuditEntry } from '../../services/context/budgetAudit';
import { enforceContextBudget, inspectContextBudget } from '../../services/context/budgetManager';
import { compressToolDefinitions } from '../tools/toolManagerTokenBudget';
import { buildToolSurfaceTokenAudit, type ToolSurfaceTokenAudit } from './toolSurfaceTokenAudit';
import type {
  CompactionContext,
  ContextEngine,
  ForcedCompactionTier,
} from '../../services/context/types';
import { estimateTokens, getWorkingContextWindow } from '../../services/context/tokenCounter';
import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import type { Message } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
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
import { stampPromptCachePlacement } from './promptCacheToolPlacement';
import type { SystemPromptSection } from '../prompts/orchestratorPromptSections';

type BudgetCompactionEngine = Pick<ContextEngine, 'compact'> | null;
export type AgentTurnCompactionEngine = BudgetCompactionEngine;

export interface PrepareAgentTurnRequestBudgetParams {
  /** Threaded through to `formatMessagesForApi` so a PDF attachment's document-capability
   *  gate (see `documentCapabilities.ts`) is evaluated against the model actually serving
   *  this turn. Omit only where no request will actually be sent (e.g. a pure estimate). */
  activeProvider?: LlmProviderConfig;
  compactionEngine: BudgetCompactionEngine;
  conversationId: string;
  enrichedSystemPrompt: string;
  enrichedSystemPromptSections?: ReadonlyArray<SystemPromptSection>;
  iteration?: number;
  livingMemory?: LivingMemoryBridgeOutput | null;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  /** True when the turn runs on an on-device runtime, which needs a phone-sized window. */
  onDeviceProvider?: boolean;
  /** Pending-work state forwarded to the context engine so summaries stay actionable. */
  compactionContext?: CompactionContext;
  pinnedToolNames?: ReadonlyArray<string>;
  sessionPinnedCount?: number;
  turnPinnedCount?: number;
  /** Provider family for the online token-calibration EMA (see `tokenCounter.ts`); applied to
   *  every estimate this function computes directly. Omit for a pure structural estimate. */
  requestFamily?: string;
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
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  currentTokenCount?: number;
  tokenBudget?: number;
  forceTier?: ForcedCompactionTier;
  failureLabel: string;
  compactionContext?: CompactionContext;
  /** Provider family for the online token-calibration EMA (see `tokenCounter.ts`). */
  requestFamily?: string;
  warn: (message: string, error: unknown) => void;
}

function extractGoalsPromptSection(
  sections: ReadonlyArray<SystemPromptSection> | undefined,
): string | null {
  if (!sections?.length) {
    return null;
  }
  const goalsSection = sections.find((section) => section.purpose === 'goals');
  return goalsSection?.text ?? null;
}

function extractWorkflowTaskAnchorPromptSection(
  sections: ReadonlyArray<SystemPromptSection> | undefined,
): string | undefined {
  return sections?.find((section) => section.purpose === 'workflow_task_anchor')?.text;
}

export async function compactAgentTurnWorkingMessages(
  params: CompactAgentTurnWorkingMessagesParams,
): Promise<{ messages: Message[]; compacted: boolean }> {
  if (!params.compactionEngine) {
    return { messages: params.currentMessages, compacted: false };
  }

  try {
    // Merge `requestFamily` into the compaction context so `compact()` can calibrate its own
    // internal token estimates even when the caller has no other pending-work state to pass —
    // hence the merge runs whenever either is present, not only when `compactionContext` is.
    const effectiveCompactionContext: CompactionContext | undefined =
      params.compactionContext || params.requestFamily !== undefined
        ? { ...params.compactionContext, requestFamily: params.requestFamily }
        : undefined;
    const compactResult = await params.compactionEngine.compact({
      sessionId: params.conversationId,
      messages: params.currentMessages,
      ...(params.currentTokenCount != null ? { currentTokenCount: params.currentTokenCount } : {}),
      ...(params.tokenBudget != null ? { tokenBudget: params.tokenBudget } : {}),
      ...(params.forceTier ? { forceTier: params.forceTier } : {}),
      ...(effectiveCompactionContext ? { compactionContext: effectiveCompactionContext } : {}),
    });
    if (!compactResult.compacted || !compactResult.result) {
      return { messages: params.currentMessages, compacted: false };
    }

    const applied = applyCompactionResultToWorkingMessages(
      params.currentMessages,
      compactResult,
      params.requestFamily,
    );
    params.onCompaction?.(applied);
    return { messages: applied.messages, compacted: true };
  } catch (compactionError: unknown) {
    params.warn(params.failureLabel, compactionError);
    return { messages: params.currentMessages, compacted: false };
  }
}

async function previewRequestBudget(params: {
  activeProvider?: LlmProviderConfig;
  enrichedSystemPrompt: string;
  candidateMessages: Message[];
  onDeviceProvider?: boolean;
  requestFamily?: string;
  requestMaxTokens: number;
  requestModel: string;
  toolsForIteration: ToolDefinition[];
}) {
  const candidateApiMessages = await formatMessagesForApi(
    params.enrichedSystemPrompt,
    params.candidateMessages,
    params.activeProvider
      ? { provider: params.activeProvider, model: params.requestModel }
      : undefined,
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
      { onDeviceProvider: params.onDeviceProvider === true, family: params.requestFamily },
    ),
  };
}

function estimateApiMessageTokens(
  message: {
    role: string;
    content: string | any[];
    [key: string]: any;
  },
  family: string | undefined,
): number {
  const content =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  return estimateTokens(content, family) + 4;
}

function buildMessageTokenBuckets(
  messages: ReadonlyArray<{ role: string; content: string | any[]; [key: string]: any }>,
  family: string | undefined,
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
      const tokens = estimateApiMessageTokens(message, family);
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
  family: string | undefined;
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
  const messageBuckets = buildMessageTokenBuckets(params.budgetResult.messages, params.family);

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
  const workingContextOptions = { onDeviceProvider: params.onDeviceProvider === true };
  const compactionContext: CompactionContext | undefined = params.compactionContext
    ? {
        ...params.compactionContext,
        requestModel: params.requestModel,
        onDeviceProvider: params.onDeviceProvider === true,
      }
    : { requestModel: params.requestModel, onDeviceProvider: params.onDeviceProvider === true };
  const contextWindow = getWorkingContextWindow(params.requestModel, workingContextOptions);
  let workingMessages = repairModelVisibleToolResultTranscript(params.workingMessages);
  const toolsForIteration = stampPromptCachePlacement(params.toolsForIteration ?? []);
  const currentGoalsPromptSection = extractGoalsPromptSection(params.enrichedSystemPromptSections);
  const workflowTaskAnchorPromptSection = extractWorkflowTaskAnchorPromptSection(
    params.enrichedSystemPromptSections,
  );
  let compactionApplied = false;

  let modelVisibleMessages = sanitizeModelVisibleWorkingMessages(workingMessages);
  let budgetPreview = await previewRequestBudget({
    activeProvider: params.activeProvider,
    enrichedSystemPrompt: params.enrichedSystemPrompt,
    candidateMessages: modelVisibleMessages,
    onDeviceProvider: params.onDeviceProvider === true,
    requestFamily: params.requestFamily,
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
        onCompaction: params.onCompaction,
        currentTokenCount: estimateWorkingMessageTokens(workingMessages, params.requestFamily),
        forceTier,
        failureLabel: 'Pre-flight compaction failed, continuing without compaction',
        ...(compactionContext ? { compactionContext } : {}),
        requestFamily: params.requestFamily,
        warn: params.warn,
      });
      if (!budgetCompaction.compacted) {
        continue;
      }
      compactionApplied = true;

      workingMessages = repairModelVisibleToolResultTranscript(budgetCompaction.messages);
      modelVisibleMessages = sanitizeModelVisibleWorkingMessages(workingMessages);
      budgetPreview = await previewRequestBudget({
        activeProvider: params.activeProvider,
        enrichedSystemPrompt: params.enrichedSystemPrompt,
        candidateMessages: modelVisibleMessages,
        onDeviceProvider: params.onDeviceProvider === true,
        requestFamily: params.requestFamily,
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
      activeProvider: params.activeProvider,
      enrichedSystemPrompt: params.enrichedSystemPrompt,
      candidateMessages: placeholderCompactedModelVisibleMessages,
      onDeviceProvider: params.onDeviceProvider === true,
      requestFamily: params.requestFamily,
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
  const compactionOptions = { pinnedToolNames: new Set(pinnedToolNames), family: params.requestFamily };
  const candidateTools = compressToolDefinitions(toolsForIteration, compactionOptions);
  const budgetResult = enforceContextBudget(
    params.requestModel,
    params.enrichedSystemPrompt,
    toolsForIteration,
    budgetPreview.nonSystemApiMessages,
    params.requestMaxTokens,
    {
      ...workingContextOptions,
      family: params.requestFamily,
      pinnedToolNames,
      protectedSystemPromptSection: workflowTaskAnchorPromptSection,
    },
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

  const memoryCacheableTokens = (params.livingMemory?.sections ?? [])
    .filter((section) => section.cacheable === true)
    .reduce((sum, section) => sum + estimateTokens(section.text, params.requestFamily), 0);
  const goalsTokens = estimateTokens(currentGoalsPromptSection ?? '', params.requestFamily);
  const memoryDynamicTokens = Math.max(
    0,
    Math.round((params.livingMemory?.recalledFactCount ?? 0) * 48),
  );
  const usageTokenBuckets = buildUsageTokenBuckets({
    budgetResult,
    family: params.requestFamily,
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
