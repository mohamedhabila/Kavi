import type {
  AgentRun,
  AgentRunAsyncOperation,
  AgentRunCheckpoint,
  AgentRunEvidenceEntry,
  AgentRunPilotEvaluation,
  AgentRunPlan,
  AgentRunSummary,
  Conversation,
  ConversationLogEntry,
  ConversationUsageEntry,
  ConversationUsageSummary,
  Message,
  MessageProviderReplay,
  SubAgentActivityEntry,
  SubAgentSnapshot,
  ToolCall,
} from '../types';
import { stripAttachmentPayload } from '../utils/messageAttachments';

const MAX_PERSISTED_SYSTEM_PROMPT_CHARS = 24_000;
const MAX_PERSISTED_USER_CONTENT_CHARS = 20_000;
const MAX_PERSISTED_TOOL_CONTENT_CHARS = 12_000;
const MAX_PERSISTED_ENRICHED_CONTENT_CHARS = 20_000;
const MAX_PERSISTED_REASONING_CHARS = 8_000;
const MAX_PERSISTED_TOOL_ARGUMENT_CHARS = 4_000;
const MAX_PERSISTED_TOOL_RESULT_CHARS = 8_000;
const MAX_PERSISTED_TOOL_ERROR_CHARS = 4_000;
const MAX_PERSISTED_TOOL_PROGRESS_CHARS = 400;
const MAX_PERSISTED_LOG_TITLE_CHARS = 160;
const MAX_PERSISTED_LOG_DETAIL_CHARS = 800;
const MAX_PERSISTED_USAGE_ENTRIES = 80;
const MAX_PERSISTED_LOG_ENTRIES = 120;
const MAX_PERSISTED_AGENT_RUNS = 12;
const MAX_PERSISTED_AGENT_RUN_CHECKPOINTS = 40;
const MAX_PERSISTED_AGENT_RUN_EVIDENCE = 64;
const MAX_PERSISTED_PLAN_TEXT_CHARS = 2_000;
const MAX_PERSISTED_PLAN_RAW_CHARS = 4_000;
const MAX_PERSISTED_EVIDENCE_CONTENT_CHARS = 1_200;
const MAX_PERSISTED_EVIDENCE_PATH_CHARS = 320;
const MAX_PERSISTED_EVIDENCE_URI_CHARS = 800;
const MAX_PERSISTED_WORKSTREAMS = 8;
const MAX_PERSISTED_LIST_ITEMS = 12;
const MAX_PERSISTED_TAGS = 24;
const MAX_PERSISTED_EXACT_REPLAY_MESSAGES = 8;
const MAX_PERSISTED_REASONING_MESSAGES = 24;
const MAX_PERSISTED_SUB_AGENT_ACTIVITY_ENTRIES = 8;
const MAX_PERSISTED_SUB_AGENT_ACTIVITY_TEXT_CHARS = 180;
const MAX_PERSISTED_SUB_AGENT_OUTPUT_CHARS = 4_000;
const MAX_PERSISTED_PENDING_ASYNC_OPERATIONS = 8;

function truncateText(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function normalizeText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function keepAnchoredTail<T>(items: T[] | undefined, maxItems: number): T[] | undefined {
  if (!items?.length) {
    return undefined;
  }

  if (items.length <= maxItems) {
    return [...items];
  }

  return [items[0], ...items.slice(-(maxItems - 1))];
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clonePlainRecord(value: unknown): Record<string, any> | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, any>;
}

function clonePlainRecordArray(value: unknown): Record<string, any>[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sanitized = value
    .filter((entry): entry is Record<string, any> => isPlainRecord(entry))
    .map((entry) => clonePlainRecord(entry) as Record<string, any>);

  return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizeProviderReplay(
  providerReplay: MessageProviderReplay | undefined,
): MessageProviderReplay | undefined {
  if (!isPlainRecord(providerReplay)) {
    return undefined;
  }

  const openaiResponseId =
    typeof providerReplay.openaiResponseId === 'string' &&
    providerReplay.openaiResponseId.trim().length > 0
      ? providerReplay.openaiResponseId.trim()
      : undefined;
  const openaiResponseOutput = clonePlainRecordArray(providerReplay.openaiResponseOutput);
  const geminiParts = clonePlainRecordArray(providerReplay.geminiParts);
  const anthropicBlocks = clonePlainRecordArray(providerReplay.anthropicBlocks);

  if (!openaiResponseId && !openaiResponseOutput && !geminiParts && !anthropicBlocks) {
    return undefined;
  }

  return {
    ...(openaiResponseId ? { openaiResponseId } : {}),
    ...(openaiResponseOutput ? { openaiResponseOutput } : {}),
    ...(geminiParts ? { geminiParts } : {}),
    ...(anthropicBlocks ? { anthropicBlocks } : {}),
  };
}

function sanitizeAsyncOperationArgs(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const sanitizedEntries = Object.entries(value)
    .map<[string, string | number | boolean] | null>(([key, entryValue]) => {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        return null;
      }

      if (typeof entryValue === 'string') {
        const normalizedValue = truncateText(entryValue, MAX_PERSISTED_LOG_TITLE_CHARS);
        return normalizedValue ? [normalizedKey, normalizedValue] : null;
      }

      if (typeof entryValue === 'number' || typeof entryValue === 'boolean') {
        return [normalizedKey, entryValue];
      }

      return null;
    })
    .filter((entry): entry is [string, string | number | boolean] => entry !== null);

  return sanitizedEntries.length > 0 ? Object.fromEntries(sanitizedEntries) : undefined;
}

function sanitizeAgentRunAsyncOperation(operation: AgentRunAsyncOperation): AgentRunAsyncOperation {
  return {
    key: truncateText(operation.key, MAX_PERSISTED_LOG_TITLE_CHARS) || operation.key,
    kind: operation.kind,
    resourceId:
      truncateText(operation.resourceId, MAX_PERSISTED_LOG_TITLE_CHARS) || operation.resourceId,
    displayName:
      truncateText(operation.displayName, MAX_PERSISTED_LOG_TITLE_CHARS) || operation.displayName,
    status: operation.status,
    lastUpdatedByTool:
      truncateText(operation.lastUpdatedByTool, MAX_PERSISTED_LOG_TITLE_CHARS) ||
      operation.lastUpdatedByTool,
    updatedAt: operation.updatedAt,
    monitorToolNames: operation.monitorToolNames
      .slice(0, MAX_PERSISTED_LIST_ITEMS)
      .map((toolName) => truncateText(toolName, MAX_PERSISTED_LOG_TITLE_CHARS) || toolName),
    ...(operation.waitToolName
      ? {
          waitToolName:
            truncateText(operation.waitToolName, MAX_PERSISTED_LOG_TITLE_CHARS) ||
            operation.waitToolName,
        }
      : {}),
    ...(operation.statusArgs
      ? { statusArgs: sanitizeAsyncOperationArgs(operation.statusArgs) }
      : {}),
    ...(operation.waitArgs ? { waitArgs: sanitizeAsyncOperationArgs(operation.waitArgs) } : {}),
  };
}

function sanitizeToolCall(toolCall: ToolCall, preserveRaw: boolean): ToolCall {
  const raw = preserveRaw ? clonePlainRecord(toolCall.raw) : undefined;

  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: truncateText(toolCall.arguments, MAX_PERSISTED_TOOL_ARGUMENT_CHARS) || '{}',
    ...(raw ? { raw } : {}),
    status: toolCall.status,
    ...(toolCall.startedAt !== undefined ? { startedAt: toolCall.startedAt } : {}),
    ...(toolCall.updatedAt !== undefined ? { updatedAt: toolCall.updatedAt } : {}),
    ...(toolCall.completedAt !== undefined ? { completedAt: toolCall.completedAt } : {}),
    ...(toolCall.progressText
      ? { progressText: truncateText(toolCall.progressText, MAX_PERSISTED_TOOL_PROGRESS_CHARS) }
      : {}),
    ...(toolCall.result
      ? { result: truncateText(toolCall.result, MAX_PERSISTED_TOOL_RESULT_CHARS) }
      : {}),
    ...(toolCall.error
      ? { error: truncateText(toolCall.error, MAX_PERSISTED_TOOL_ERROR_CHARS) }
      : {}),
  };
}

function sanitizeSubAgentActivity(entry: SubAgentActivityEntry): SubAgentActivityEntry {
  return {
    timestamp: entry.timestamp,
    kind: entry.kind,
    text: truncateText(entry.text, MAX_PERSISTED_SUB_AGENT_ACTIVITY_TEXT_CHARS) || entry.text,
  };
}

function sanitizeSubAgentSnapshot(snapshot: SubAgentSnapshot): SubAgentSnapshot {
  return {
    ...snapshot,
    ...(snapshot.name ? { name: truncateText(snapshot.name, MAX_PERSISTED_LOG_TITLE_CHARS) } : {}),
    ...(snapshot.output
      ? { output: truncateText(snapshot.output, MAX_PERSISTED_SUB_AGENT_OUTPUT_CHARS) }
      : {}),
    ...(snapshot.toolsUsed
      ? { toolsUsed: snapshot.toolsUsed.slice(-MAX_PERSISTED_LIST_ITEMS) }
      : {}),
    ...(snapshot.currentActivity
      ? {
          currentActivity: truncateText(
            snapshot.currentActivity,
            MAX_PERSISTED_SUB_AGENT_ACTIVITY_TEXT_CHARS,
          ),
        }
      : {}),
    ...(snapshot.activeToolName
      ? { activeToolName: truncateText(snapshot.activeToolName, MAX_PERSISTED_LOG_TITLE_CHARS) }
      : {}),
    ...(snapshot.lastToolResultPreview
      ? {
          lastToolResultPreview: truncateText(
            snapshot.lastToolResultPreview,
            MAX_PERSISTED_LOG_DETAIL_CHARS,
          ),
        }
      : {}),
    ...(snapshot.activityLog
      ? {
          activityLog: snapshot.activityLog
            .slice(-MAX_PERSISTED_SUB_AGENT_ACTIVITY_ENTRIES)
            .map((entry) => sanitizeSubAgentActivity(entry)),
        }
      : {}),
    ...(snapshot.artifacts
      ? { artifacts: snapshot.artifacts.map((attachment) => stripAttachmentPayload(attachment)) }
      : {}),
  };
}

function getMessageContentLimit(message: Message): number {
  if (message.role === 'tool') {
    return MAX_PERSISTED_TOOL_CONTENT_CHARS;
  }

  return MAX_PERSISTED_USER_CONTENT_CHARS;
}

function sanitizeMessageContent(message: Message): string {
  if (message.role === 'assistant') {
    return normalizeText(message.content) || '';
  }

  return truncateText(message.content, getMessageContentLimit(message)) || '';
}

function sanitizeMessage(
  message: Message,
  options: { preserveReplay: boolean; preserveReasoning: boolean },
): Message {
  const providerReplay = options.preserveReplay
    ? sanitizeProviderReplay(message.providerReplay)
    : undefined;

  return {
    id: message.id,
    role: message.role,
    content: sanitizeMessageContent(message),
    timestamp: message.timestamp,
    ...(message.enrichedContent
      ? {
          enrichedContent: truncateText(
            message.enrichedContent,
            MAX_PERSISTED_ENRICHED_CONTENT_CHARS,
          ),
        }
      : {}),
    ...(message.toolCalls?.length
      ? {
          toolCalls: message.toolCalls.map((toolCall) =>
            sanitizeToolCall(toolCall, options.preserveReplay),
          ),
        }
      : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.attachments?.length
      ? { attachments: message.attachments.map((attachment) => stripAttachmentPayload(attachment)) }
      : {}),
    ...(message.isError ? { isError: true } : {}),
    ...(options.preserveReasoning && message.reasoning
      ? { reasoning: truncateText(message.reasoning, MAX_PERSISTED_REASONING_CHARS) }
      : {}),
    ...(providerReplay ? { providerReplay } : {}),
    ...(message.assistantMetadata ? { assistantMetadata: { ...message.assistantMetadata } } : {}),
    ...(message.effectId ? { effectId: message.effectId } : {}),
    ...(message.subAgentEvent
      ? {
          subAgentEvent: {
            ...message.subAgentEvent,
            snapshot: sanitizeSubAgentSnapshot(message.subAgentEvent.snapshot),
          },
        }
      : {}),
  };
}

function sanitizeUsageEntry(entry: ConversationUsageEntry): ConversationUsageEntry {
  const tokenDetails = entry.tokenDetails
    ? {
        ...(typeof entry.tokenDetails.inputTextTokens === 'number' &&
        Number.isFinite(entry.tokenDetails.inputTextTokens)
          ? { inputTextTokens: Math.max(0, entry.tokenDetails.inputTextTokens) }
          : {}),
        ...(typeof entry.tokenDetails.inputImageTokens === 'number' &&
        Number.isFinite(entry.tokenDetails.inputImageTokens)
          ? { inputImageTokens: Math.max(0, entry.tokenDetails.inputImageTokens) }
          : {}),
        ...(typeof entry.tokenDetails.outputTextTokens === 'number' &&
        Number.isFinite(entry.tokenDetails.outputTextTokens)
          ? { outputTextTokens: Math.max(0, entry.tokenDetails.outputTextTokens) }
          : {}),
        ...(typeof entry.tokenDetails.outputImageTokens === 'number' &&
        Number.isFinite(entry.tokenDetails.outputImageTokens)
          ? { outputImageTokens: Math.max(0, entry.tokenDetails.outputImageTokens) }
          : {}),
        ...(typeof entry.tokenDetails.outputThinkingTokens === 'number' &&
        Number.isFinite(entry.tokenDetails.outputThinkingTokens)
          ? { outputThinkingTokens: Math.max(0, entry.tokenDetails.outputThinkingTokens) }
          : {}),
      }
    : undefined;

  return {
    model: entry.model,
    ...(entry.providerId ? { providerId: entry.providerId } : {}),
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.modality ? { modality: entry.modality } : {}),
    ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    ...(entry.parentSessionId ? { parentSessionId: entry.parentSessionId } : {}),
    ...(entry.agentRunId ? { agentRunId: entry.agentRunId } : {}),
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheWriteTokens: entry.cacheWriteTokens,
    totalTokens: entry.totalTokens,
    estimatedCost: entry.estimatedCost,
    ...(tokenDetails && Object.keys(tokenDetails).length > 0 ? { tokenDetails } : {}),
    timestamp: entry.timestamp,
  };
}

function sanitizeUsage(
  usage: ConversationUsageSummary | undefined,
): ConversationUsageSummary | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    ...usage,
    entries: usage.entries
      .slice(-MAX_PERSISTED_USAGE_ENTRIES)
      .map((entry) => sanitizeUsageEntry(entry)),
  };
}

function sanitizeLogEntry(entry: ConversationLogEntry): ConversationLogEntry {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    level: entry.level,
    kind: entry.kind,
    title: truncateText(entry.title, MAX_PERSISTED_LOG_TITLE_CHARS) || entry.title,
    ...(entry.detail ? { detail: truncateText(entry.detail, MAX_PERSISTED_LOG_DETAIL_CHARS) } : {}),
  };
}

function sanitizeCheckpoint(entry: AgentRunCheckpoint): AgentRunCheckpoint {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    kind: entry.kind,
    title: truncateText(entry.title, MAX_PERSISTED_LOG_TITLE_CHARS) || entry.title,
    ...(entry.detail ? { detail: truncateText(entry.detail, MAX_PERSISTED_LOG_DETAIL_CHARS) } : {}),
  };
}

function sanitizeEvidenceEntry(entry: AgentRunEvidenceEntry): AgentRunEvidenceEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    status: entry.status,
    recorder: entry.recorder,
    title: truncateText(entry.title, MAX_PERSISTED_LOG_TITLE_CHARS) || entry.title,
    content: truncateText(entry.content, MAX_PERSISTED_EVIDENCE_CONTENT_CHARS) || entry.content,
    ...(entry.dedupeKey
      ? { dedupeKey: truncateText(entry.dedupeKey, MAX_PERSISTED_LOG_TITLE_CHARS) }
      : {}),
    ...(entry.sourceName
      ? { sourceName: truncateText(entry.sourceName, MAX_PERSISTED_LOG_TITLE_CHARS) }
      : {}),
    ...(entry.sourceUri
      ? { sourceUri: truncateText(entry.sourceUri, MAX_PERSISTED_EVIDENCE_URI_CHARS) }
      : {}),
    ...(entry.toolName
      ? { toolName: truncateText(entry.toolName, MAX_PERSISTED_LOG_TITLE_CHARS) }
      : {}),
    ...(entry.workerSessionId
      ? { workerSessionId: truncateText(entry.workerSessionId, MAX_PERSISTED_LOG_TITLE_CHARS) }
      : {}),
    ...(entry.artifactWorkspacePath
      ? {
          artifactWorkspacePath: truncateText(
            entry.artifactWorkspacePath,
            MAX_PERSISTED_EVIDENCE_PATH_CHARS,
          ),
        }
      : {}),
    ...(entry.tags?.length
      ? {
          tags: entry.tags
            .slice(0, MAX_PERSISTED_LIST_ITEMS)
            .map((tag) => truncateText(tag, MAX_PERSISTED_LOG_TITLE_CHARS) || tag),
        }
      : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function sanitizeRunSummary(summary: AgentRunSummary): AgentRunSummary {
  return {
    assistantTurns: summary.assistantTurns,
    startedTools: summary.startedTools,
    completedTools: summary.completedTools,
    failedTools: summary.failedTools,
    spawnedSubAgents: summary.spawnedSubAgents,
    ...(summary.durationMs !== undefined ? { durationMs: summary.durationMs } : {}),
  };
}

function sanitizeAgentRunPlan(plan: AgentRunPlan | undefined): AgentRunPlan | undefined {
  if (!plan) {
    return undefined;
  }

  return {
    objective: truncateText(plan.objective, MAX_PERSISTED_PLAN_TEXT_CHARS) || plan.objective,
    successCriteria: plan.successCriteria
      .slice(0, MAX_PERSISTED_LIST_ITEMS)
      .map((item) => truncateText(item, MAX_PERSISTED_PLAN_TEXT_CHARS) || item),
    stopConditions: plan.stopConditions
      .slice(0, MAX_PERSISTED_LIST_ITEMS)
      .map((item) => truncateText(item, MAX_PERSISTED_PLAN_TEXT_CHARS) || item),
    workstreams: plan.workstreams.slice(0, MAX_PERSISTED_WORKSTREAMS).map((workstream) => ({
      id: workstream.id,
      title: truncateText(workstream.title, MAX_PERSISTED_PLAN_TEXT_CHARS) || workstream.title,
      ...(workstream.goal
        ? { goal: truncateText(workstream.goal, MAX_PERSISTED_PLAN_TEXT_CHARS) }
        : {}),
      ...(workstream.successCriteria
        ? {
            successCriteria: workstream.successCriteria
              .slice(0, MAX_PERSISTED_LIST_ITEMS)
              .map((item) => truncateText(item, MAX_PERSISTED_PLAN_TEXT_CHARS) || item),
          }
        : {}),
      ...(workstream.dependencies
        ? {
            dependencies: workstream.dependencies
              .slice(0, MAX_PERSISTED_LIST_ITEMS)
              .map((item) => truncateText(item, MAX_PERSISTED_PLAN_TEXT_CHARS) || item),
          }
        : {}),
    })),
    ...(plan.rawPlan ? { rawPlan: truncateText(plan.rawPlan, MAX_PERSISTED_PLAN_RAW_CHARS) } : {}),
    updatedAt: plan.updatedAt,
  };
}

function sanitizeAgentRunPilotEvaluation(
  evaluation: AgentRunPilotEvaluation | undefined,
): AgentRunPilotEvaluation | undefined {
  if (!evaluation) {
    return undefined;
  }

  return {
    evaluatorVersion:
      truncateText(evaluation.evaluatorVersion, MAX_PERSISTED_LOG_TITLE_CHARS) ||
      evaluation.evaluatorVersion,
    evaluatedAt: evaluation.evaluatedAt,
    objective:
      truncateText(evaluation.objective, MAX_PERSISTED_PLAN_TEXT_CHARS) || evaluation.objective,
    completionScore: evaluation.completionScore,
    adherenceScore: evaluation.adherenceScore,
    evidenceScore: evaluation.evidenceScore,
    processScore: evaluation.processScore,
    overallScore: evaluation.overallScore,
    maxOverallScore: evaluation.maxOverallScore,
    approvalThreshold: evaluation.approvalThreshold,
    approved: evaluation.approved,
    recommendedAction: evaluation.recommendedAction,
    controlAction: evaluation.controlAction,
    confidence: evaluation.confidence,
    summary: truncateText(evaluation.summary, MAX_PERSISTED_LOG_DETAIL_CHARS) || evaluation.summary,
    rationale:
      truncateText(evaluation.rationale, MAX_PERSISTED_LOG_DETAIL_CHARS) || evaluation.rationale,
    ...(evaluation.source ? { source: evaluation.source } : {}),
    ...(evaluation.fallbackReason ? { fallbackReason: evaluation.fallbackReason } : {}),
    ...(evaluation.stateSignature
      ? { stateSignature: normalizeText(evaluation.stateSignature) }
      : {}),
    ...(evaluation.progressSignature
      ? { progressSignature: normalizeText(evaluation.progressSignature) }
      : {}),
    strengths: evaluation.strengths
      .slice(0, MAX_PERSISTED_LIST_ITEMS)
      .map((item) => truncateText(item, MAX_PERSISTED_LOG_DETAIL_CHARS) || item),
    gaps: evaluation.gaps
      .slice(0, MAX_PERSISTED_LIST_ITEMS)
      .map((item) => truncateText(item, MAX_PERSISTED_LOG_DETAIL_CHARS) || item),
    nextActions: evaluation.nextActions
      .slice(0, MAX_PERSISTED_LIST_ITEMS)
      .map((item) => truncateText(item, MAX_PERSISTED_LOG_DETAIL_CHARS) || item),
    criterionEvaluations: evaluation.criterionEvaluations
      .slice(0, MAX_PERSISTED_LIST_ITEMS)
      .map((criterionEvaluation) => ({
        criterion:
          truncateText(criterionEvaluation.criterion, MAX_PERSISTED_PLAN_TEXT_CHARS) ||
          criterionEvaluation.criterion,
        score: criterionEvaluation.score,
        maxScore: criterionEvaluation.maxScore,
        status: criterionEvaluation.status,
        rationale:
          truncateText(criterionEvaluation.rationale, MAX_PERSISTED_LOG_DETAIL_CHARS) ||
          criterionEvaluation.rationale,
      })),
  };
}

function sanitizeAgentRun(run: AgentRun): AgentRun {
  return {
    ...run,
    goal: truncateText(run.goal, MAX_PERSISTED_PLAN_TEXT_CHARS) || run.goal,
    phases: run.phases.map((phase) => ({
      ...phase,
      ...(phase.detail
        ? { detail: truncateText(phase.detail, MAX_PERSISTED_LOG_DETAIL_CHARS) }
        : {}),
    })),
    checkpoints: (keepAnchoredTail(run.checkpoints, MAX_PERSISTED_AGENT_RUN_CHECKPOINTS) ?? []).map(
      (entry) => sanitizeCheckpoint(entry),
    ),
    ...(run.evidence?.length
      ? {
          evidence: run.evidence
            .slice(-MAX_PERSISTED_AGENT_RUN_EVIDENCE)
            .map((entry) => sanitizeEvidenceEntry(entry)),
        }
      : {}),
    ...(run.plan ? { plan: sanitizeAgentRunPlan(run.plan) } : {}),
    ...(run.latestPilotEvaluation
      ? { latestPilotEvaluation: sanitizeAgentRunPilotEvaluation(run.latestPilotEvaluation) }
      : {}),
    ...(run.pendingAsyncOperations
      ? {
          pendingAsyncOperations: run.pendingAsyncOperations
            .slice(0, MAX_PERSISTED_PENDING_ASYNC_OPERATIONS)
            .map((operation) => sanitizeAgentRunAsyncOperation(operation)),
        }
      : {}),
    ...(run.latestSummary
      ? { latestSummary: truncateText(run.latestSummary, MAX_PERSISTED_PLAN_RAW_CHARS) }
      : {}),
    summary: sanitizeRunSummary(run.summary),
  };
}

export function sanitizeConversationForPersistence(conversation: Conversation): Conversation {
  const messages = conversation.messages ?? [];
  const replayStart = Math.max(0, messages.length - MAX_PERSISTED_EXACT_REPLAY_MESSAGES);
  const reasoningStart = Math.max(0, messages.length - MAX_PERSISTED_REASONING_MESSAGES);

  return {
    ...conversation,
    title: truncateText(conversation.title, MAX_PERSISTED_LOG_TITLE_CHARS) || conversation.title,
    systemPrompt:
      truncateText(conversation.systemPrompt, MAX_PERSISTED_SYSTEM_PROMPT_CHARS) ||
      conversation.systemPrompt,
    tags: conversation.tags?.slice(0, MAX_PERSISTED_TAGS),
    messages: messages.map((message, index) =>
      sanitizeMessage(message, {
        preserveReplay: index >= replayStart,
        preserveReasoning: index >= reasoningStart,
      }),
    ),
    logs: (conversation.logs ?? [])
      .slice(-MAX_PERSISTED_LOG_ENTRIES)
      .map((entry) => sanitizeLogEntry(entry)),
    agentRuns: (conversation.agentRuns ?? [])
      .slice(-MAX_PERSISTED_AGENT_RUNS)
      .map((run) => sanitizeAgentRun(run)),
    ...(conversation.usage ? { usage: sanitizeUsage(conversation.usage) } : {}),
  };
}

export function partializeChatPersistState<
  T extends {
    conversations: Conversation[];
    activeConversationId: string | null;
  },
>(state: T): Pick<T, 'conversations' | 'activeConversationId'> {
  return {
    conversations: state.conversations.map((conversation) =>
      sanitizeConversationForPersistence(conversation),
    ),
    activeConversationId: state.activeConversationId,
  };
}
