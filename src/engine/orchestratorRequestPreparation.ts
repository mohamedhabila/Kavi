import { runLinkUnderstanding } from '../services/links/service';
import { runMediaUnderstanding } from '../services/media/service';
import { type LivingMemoryBridgeOutput } from '../services/memory/livingMemoryBridge';
import { buildUnifiedMemoryAccessContext } from '../services/memory/memoryAccessGateway';
import { excludeTrailingInternalUserMessages } from '../services/context/messageScoping';
import type { RequestContinuation, RequestFrame } from '../services/agents/requestFrame';
import { getSkillSystemPrompts } from '../services/skills/manager';
import type { AgentRunControlGraphState } from '../types/agentRun';
import type { LlmProviderConfig } from '../types/provider';
import type { Message } from '../types/message';
import {
  resolveMemoryContextStrategy,
  resolveMemoryRetrievalStrategy,
  type MemoryContextStrategy,
  type MemoryRetrievalStrategy,
} from '../services/memory/memoryAccessPolicy';
import { getActiveGoal } from './goals/types';
import { buildScopedFallbackMemoryAccessContext } from './orchestratorContext';
import { prepareAgentControlGraphRequestContext } from './graph/requestContext';
import {
  getUserMessagePromptContent,
  stripRuntimeContextFromUserContent,
} from './prompts/orchestratorPromptSections';
import { repairModelVisibleToolResultTranscript } from './orchestratorToolTranscript';
import type { CodeOwnedCurrentUserMessage } from './tools/toolExecutionContext';
import { isMemoryReadEpochCurrent } from '../services/memory/policy';
import { captureSessionInternalUserMessages } from './orchestrator/sessionMemoryRefreshMessages';

type LoggerLike = {
  devLog: (message: string, payload?: unknown) => void;
  devWarn: (message: string, payload?: unknown) => void;
};

type PreparationCallbacks = {
  onUserMessageEnriched?: (messageId: string, enrichedContent: string) => void;
};

type PreMemoryEnrichmentResult = {
  messages: Message[];
  enrichedMessageId?: string;
  enrichedContent?: string;
  shouldPersistEnrichment?: boolean;
};

export type OrchestratorMemoryAccessInput = Readonly<{
  activeModel: string;
  activeProvider: LlmProviderConfig;
  asyncWork?: AgentRunControlGraphState['asyncWork'];
  goals?: AgentRunControlGraphState['goals'];
  internalUserMessageCount: number;
  isSuperAgent: boolean;
  logger: LoggerLike;
  memoryContextStrategy?: MemoryContextStrategy;
  memoryConversationId: string;
  memoryRetrievalStrategy?: MemoryRetrievalStrategy;
  messages: Message[];
  personaId: string;
  sourceThreadId: string;
  taskId: string | null;
}>;

function resolveRequestContinuation(
  graphSnapshot: AgentRunControlGraphState | undefined,
): RequestContinuation {
  if (!graphSnapshot) return 'new';
  if (graphSnapshot.pendingUserInput) return 'resume_waiting_user';
  if (
    graphSnapshot.status === 'waiting_async' ||
    graphSnapshot.asyncWork.awaitingBackgroundWorkers ||
    graphSnapshot.asyncWork.pendingOperations.some(
      (operation) => operation.status === 'running' || operation.status === 'cancel_requested',
    )
  ) {
    return 'resume_waiting_async';
  }
  return 'resume';
}

async function enrichLatestUserMessageForRequest(params: {
  activeModel: string;
  activeProvider: LlmProviderConfig;
  internalUserMessageCount: number;
  linkUnderstandingEnabled: boolean;
  maxLinks: number;
  mediaUnderstandingEnabled: boolean;
  messages: Message[];
}): Promise<PreMemoryEnrichmentResult> {
  const visibleMessages = excludeTrailingInternalUserMessages(
    params.messages,
    params.internalUserMessageCount,
  );
  const lastUserForEnrichment = visibleMessages.findLast((message) => message.role === 'user');
  if (!lastUserForEnrichment) {
    return { messages: params.messages };
  }

  const initialPersistedEnrichedContent = getUserMessagePromptContent(lastUserForEnrichment);
  let persistedEnrichedContent = initialPersistedEnrichedContent;

  if (params.linkUnderstandingEnabled) {
    try {
      const linkResult = await runLinkUnderstanding(persistedEnrichedContent, {
        enabled: true,
        maxLinks: params.maxLinks,
      });
      persistedEnrichedContent = linkResult.enrichedBody;
    } catch {
      // Best-effort only.
    }
  }

  if (params.mediaUnderstandingEnabled && lastUserForEnrichment.attachments?.length) {
    try {
      const mediaResult = await runMediaUnderstanding(
        persistedEnrichedContent,
        lastUserForEnrichment.attachments,
        {
          enabled: true,
          provider: params.activeProvider,
          model: params.activeModel,
        },
      );
      persistedEnrichedContent = mediaResult.enrichedBody;
    } catch {
      // Best-effort only.
    }
  }

  const currentUserContent = lastUserForEnrichment.enrichedContent || lastUserForEnrichment.content;
  if (persistedEnrichedContent === currentUserContent) {
    return { messages: params.messages };
  }

  return {
    messages: params.messages.map((message) =>
      message.id === lastUserForEnrichment.id
        ? { ...message, enrichedContent: persistedEnrichedContent }
        : message,
    ),
    enrichedMessageId: lastUserForEnrichment.id,
    enrichedContent: persistedEnrichedContent,
    shouldPersistEnrichment: persistedEnrichedContent !== initialPersistedEnrichedContent,
  };
}

export async function loadOrchestratorMemoryAccessContext(
  params: OrchestratorMemoryAccessInput,
): Promise<Awaited<ReturnType<typeof buildUnifiedMemoryAccessContext>>> {
  const memoryRetrievalStrategy = resolveMemoryRetrievalStrategy(params.memoryRetrievalStrategy);
  const memoryContextStrategy = resolveMemoryContextStrategy(params.memoryContextStrategy);
  try {
    return await buildUnifiedMemoryAccessContext({
      messages: params.messages,
      memoryConversationId: params.memoryConversationId,
      sourceThreadId: params.sourceThreadId,
      personaId: params.personaId,
      taskId: params.taskId,
      mode: params.isSuperAgent ? 'agentic' : 'chat',
      internalUserMessageCount: params.internalUserMessageCount,
      ...(params.taskId ? { activeTaskId: params.taskId } : {}),
      ...(params.goals?.length ? { goals: params.goals } : {}),
      ...(params.asyncWork ? { asyncWork: params.asyncWork } : {}),
      retrievalLlm: {
        provider: params.activeProvider,
        model: params.activeModel,
      },
      retrievalStrategy: memoryRetrievalStrategy,
      contextStrategy: memoryContextStrategy,
    });
  } catch (memoryAccessError: unknown) {
    if (memoryRetrievalStrategy !== 'production' || memoryContextStrategy !== 'production') {
      throw memoryAccessError;
    }
    params.logger.devWarn(
      'Unified memory access unavailable for this request:',
      memoryAccessError instanceof Error ? memoryAccessError.message : String(memoryAccessError),
    );
    return {
      ...buildScopedFallbackMemoryAccessContext({
        messages: params.messages,
        personaId: params.personaId,
        mode: params.isSuperAgent ? 'agentic' : 'chat',
        internalUserMessageCount: params.internalUserMessageCount,
      }),
      consistencyBarrier: {
        outcome: 'degraded',
        durationMs: 0,
        waitedMs: 0,
        queryCount: 0,
        matchedJobCount: 0,
        queueAgeMs: null,
        initialJobStatus: null,
        finalJobStatus: null,
      },
    };
  }
}

export async function prepareOrchestratorRequestBundle(params: {
  activeModel: string;
  activeProvider: LlmProviderConfig;
  callbacks: PreparationCallbacks;
  conversationId: string;
  graphOwnedRun: boolean;
  internalUserMessageCount: number;
  isSuperAgent: boolean;
  linkUnderstandingEnabled: boolean;
  logger: LoggerLike;
  memoryConversationId: string;
  maxLinks: number;
  mediaUnderstandingEnabled: boolean;
  messages: Message[];
  personaId: string;
  taskId: string | null;
  workflowScopeUserMessageId?: string;
  graphSnapshot?: AgentRunControlGraphState;
  memoryRetrievalStrategy?: MemoryRetrievalStrategy;
  memoryContextStrategy?: MemoryContextStrategy;
}): Promise<{
  currentUserMessage?: CodeOwnedCurrentUserMessage;
  latestUserMessageText: string;
  livingMemory: LivingMemoryBridgeOutput | null;
  memoryConsistencyBarrier: Awaited<
    ReturnType<typeof buildUnifiedMemoryAccessContext>
  >['consistencyBarrier'];
  memoryRefreshInternalUserMessages: ReadonlyArray<Message>;
  requestFrame: RequestFrame;
  skillPrompts: Awaited<ReturnType<typeof getSkillSystemPrompts>>;
  workingMessages: Message[];
}> {
  const graphGoals = params.graphSnapshot?.goals;
  const graphActiveTaskId =
    params.graphSnapshot?.activeTaskId ?? getActiveGoal(graphGoals ?? [])?.id ?? params.taskId;
  const enrichedRequest = await enrichLatestUserMessageForRequest({
    activeModel: params.activeModel,
    activeProvider: params.activeProvider,
    internalUserMessageCount: params.internalUserMessageCount,
    linkUnderstandingEnabled: params.linkUnderstandingEnabled,
    maxLinks: params.maxLinks,
    mediaUnderstandingEnabled: params.mediaUnderstandingEnabled,
    messages: params.messages,
  });
  const memoryRefreshInternalUserMessages = captureSessionInternalUserMessages(
    enrichedRequest.messages,
    params.internalUserMessageCount,
  );
  const memoryAccessContext = await loadOrchestratorMemoryAccessContext({
    activeModel: params.activeModel,
    activeProvider: params.activeProvider,
    ...(params.graphSnapshot?.asyncWork ? { asyncWork: params.graphSnapshot.asyncWork } : {}),
    ...(graphGoals?.length ? { goals: graphGoals } : {}),
    internalUserMessageCount: params.internalUserMessageCount,
    isSuperAgent: params.isSuperAgent,
    logger: params.logger,
    memoryContextStrategy: params.memoryContextStrategy,
    memoryConversationId: params.memoryConversationId,
    memoryRetrievalStrategy: params.memoryRetrievalStrategy,
    messages: enrichedRequest.messages,
    personaId: params.personaId,
    sourceThreadId: params.conversationId,
    taskId: graphActiveTaskId ?? null,
  });

  if (memoryAccessContext.boundary.startIndex > 0) {
    params.logger.devLog(
      'Scoped context boundary:',
      JSON.stringify({
        startIndex: memoryAccessContext.boundary.startIndex,
        reason: memoryAccessContext.boundary.reason,
        idleGapMs: memoryAccessContext.boundary.idleGapMs,
        droppedMessages: memoryAccessContext.boundary.droppedMessageCount,
      }),
    );
  }

  const requestContext = prepareAgentControlGraphRequestContext({
    memoryScopedMessages: memoryAccessContext.scopedMessages,
    workflowScopeUserMessageId: params.workflowScopeUserMessageId,
    graphOwnedRun: params.graphOwnedRun,
    continuation: resolveRequestContinuation(params.graphSnapshot),
  });
  if (requestContext.missingWorkflowScopeAnchorId) {
    params.logger.devWarn(
      'Unable to find workflow scope anchor in scoped messages; falling back to latest request turn.',
      { workflowScopeUserMessageId: requestContext.missingWorkflowScopeAnchorId },
    );
  }

  const skillPrompts = await getSkillSystemPrompts(params.conversationId);
  const livingMemoryEpoch = memoryAccessContext.livingMemory?.memoryReadEpoch;
  const memoryReadStillCurrent =
    memoryAccessContext.livingMemory === null ||
    (livingMemoryEpoch !== undefined && isMemoryReadEpochCurrent(livingMemoryEpoch));
  const livingMemory = memoryReadStillCurrent ? memoryAccessContext.livingMemory : null;
  const memoryConsistencyBarrier = memoryReadStillCurrent
    ? memoryAccessContext.consistencyBarrier
    : { ...memoryAccessContext.consistencyBarrier, outcome: 'opt_out' as const };

  let workingMessages = repairModelVisibleToolResultTranscript(
    requestContext.graphOwnedModelContextMessages.map((message) => {
      if (message.role !== 'user' || !message.enrichedContent) {
        return message;
      }

      const sanitizedEnrichedContent = stripRuntimeContextFromUserContent(message.enrichedContent);
      if (sanitizedEnrichedContent === message.enrichedContent) {
        return message;
      }

      return sanitizedEnrichedContent.length > 0 && sanitizedEnrichedContent !== message.content
        ? { ...message, enrichedContent: sanitizedEnrichedContent }
        : { ...message, enrichedContent: undefined };
    }),
  );

  if (enrichedRequest.enrichedMessageId && enrichedRequest.enrichedContent) {
    workingMessages = workingMessages.map((message) =>
      message.id === enrichedRequest.enrichedMessageId
        ? { ...message, enrichedContent: enrichedRequest.enrichedContent }
        : message,
    );
    if (enrichedRequest.shouldPersistEnrichment) {
      params.callbacks.onUserMessageEnriched?.(
        enrichedRequest.enrichedMessageId,
        enrichedRequest.enrichedContent,
      );
    }
  }

  return {
    ...(requestContext.requestContextLastUserMessage
      ? {
          currentUserMessage: {
            id: requestContext.requestContextLastUserMessage.id,
            text: stripRuntimeContextFromUserContent(
              requestContext.requestContextLastUserMessage.content,
            ),
          },
        }
      : {}),
    latestUserMessageText: requestContext.lastUserMessageText,
    livingMemory,
    memoryConsistencyBarrier,
    memoryRefreshInternalUserMessages,
    requestFrame: requestContext.requestFrame,
    skillPrompts,
    workingMessages,
  };
}
