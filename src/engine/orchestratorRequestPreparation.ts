import { runLinkUnderstanding } from '../services/links/service';
import { runMediaUnderstanding } from '../services/media/service';
import { type LivingMemoryBridgeOutput } from '../services/memory/livingMemoryBridge';
import { buildUnifiedMemoryAccessContext } from '../services/memory/memoryAccessGateway';
import type { RequestAssessment } from '../services/agents/requestGovernance';
import { getSkillSystemPrompts } from '../services/skills/manager';
import type { AgentRunControlGraphState } from '../types/agentRun';
import type { LlmProviderConfig } from '../types/provider';
import type { Message } from '../types/message';
import { getActiveGoal } from './goals/types';
import { buildScopedFallbackMemoryAccessContext } from './orchestratorContext';
import { prepareAgentControlGraphRequestContext } from './graph/requestContext';
import {
  getUserMessagePromptContent,
  stripRuntimeContextFromUserContent,
} from './prompts/orchestratorPromptSections';
import { repairModelVisibleToolResultTranscript } from './orchestratorToolTranscript';

type LoggerLike = {
  devLog: (message: string, payload?: unknown) => void;
  devWarn: (message: string, payload?: unknown) => void;
};

type PreparationCallbacks = {
  onUserMessageEnriched?: (messageId: string, enrichedContent: string) => void;
};

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
  personaId?: string;
  taskId?: string;
  workflowScopeUserMessageId?: string;
  graphSnapshot?: AgentRunControlGraphState;
}): Promise<{
  latestUserMessageText: string;
  livingMemory: LivingMemoryBridgeOutput | null;
  requestAssessment: RequestAssessment;
  skillPrompts: Awaited<ReturnType<typeof getSkillSystemPrompts>>;
  workingMessages: Message[];
}> {
  const memoryAccessMode = params.isSuperAgent ? 'agentic' : 'chat';
  const graphGoals = params.graphSnapshot?.goals;
  const graphActiveTaskId =
    params.graphSnapshot?.activeTaskId ?? getActiveGoal(graphGoals ?? [])?.id ?? params.taskId;
  let memoryAccessContext: Awaited<ReturnType<typeof buildUnifiedMemoryAccessContext>>;
  try {
    memoryAccessContext = await buildUnifiedMemoryAccessContext({
      messages: params.messages,
      conversationId: params.memoryConversationId,
      personaId: params.personaId,
      mode: memoryAccessMode,
      internalUserMessageCount: params.internalUserMessageCount,
      ...(graphActiveTaskId ? { taskId: graphActiveTaskId, activeTaskId: graphActiveTaskId } : {}),
      ...(graphGoals?.length ? { goals: graphGoals } : {}),
      ...(params.graphSnapshot?.asyncWork ? { asyncWork: params.graphSnapshot.asyncWork } : {}),
    });
  } catch (memoryAccessError: unknown) {
    params.logger.devWarn(
      'Unified memory access unavailable for this request:',
      memoryAccessError instanceof Error ? memoryAccessError.message : String(memoryAccessError),
    );
    memoryAccessContext = buildScopedFallbackMemoryAccessContext({
      messages: params.messages,
      personaId: params.personaId,
      mode: memoryAccessMode,
      internalUserMessageCount: params.internalUserMessageCount,
    });
  }

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
  });
  if (requestContext.missingWorkflowScopeAnchorId) {
    params.logger.devWarn(
      'Unable to find workflow scope anchor in scoped messages; falling back to latest request turn.',
      { workflowScopeUserMessageId: requestContext.missingWorkflowScopeAnchorId },
    );
  }

  const skillPrompts = await getSkillSystemPrompts(params.conversationId);

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

  const lastUserForEnrichment = workingMessages.findLast((message) => message.role === 'user');
  if (lastUserForEnrichment) {
    const initialPersistedEnrichedContent = getUserMessagePromptContent(lastUserForEnrichment);
    let persistedEnrichedContent = initialPersistedEnrichedContent;

    if (params.linkUnderstandingEnabled) {
      try {
        const linkResult = await runLinkUnderstanding(lastUserForEnrichment.content, {
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

    const currentWorkingUserContent =
      lastUserForEnrichment.enrichedContent || lastUserForEnrichment.content;
    if (persistedEnrichedContent !== currentWorkingUserContent) {
      workingMessages = workingMessages.map((message) =>
        message.id === lastUserForEnrichment.id
          ? { ...message, enrichedContent: persistedEnrichedContent }
          : message,
      );
    }

    if (
      persistedEnrichedContent !== initialPersistedEnrichedContent &&
      params.callbacks.onUserMessageEnriched
    ) {
      params.callbacks.onUserMessageEnriched?.(lastUserForEnrichment.id, persistedEnrichedContent);
    }
  }

  return {
    latestUserMessageText: requestContext.lastUserMessageText,
    livingMemory: memoryAccessContext.livingMemory,
    requestAssessment: requestContext.requestAssessment,
    skillPrompts,
    workingMessages,
  };
}
