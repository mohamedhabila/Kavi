import { runLinkUnderstanding } from '../services/links/service';
import {
  runMediaUnderstanding,
  type MediaUnderstandingDocumentRefusal,
} from '../services/media/service';
import {
  readSessionMemory,
  type SessionMemoryRead,
} from '../services/memory/memoryAccessGateway';
import { excludeTrailingInternalUserMessages } from '../services/context/messageScoping';
import { getSkillSystemPrompts } from '../services/skills/manager';
import type { LlmProviderConfig } from '../types/provider';
import type { Attachment } from '../types/attachment';
import type { Message } from '../types/message';
import { prepareAgentControlGraphRequestContext } from './graph/requestContext';
import {
  getUserMessagePromptContent,
  stripRuntimeContextFromUserContent,
} from './prompts/orchestratorPromptSections';
import { repairModelVisibleToolResultTranscript } from './orchestratorToolTranscript';
import type { CodeOwnedCurrentUserMessage } from './tools/toolExecutionContext';
import {
  captureSessionInternalUserMessages,
  rebuildSessionMemoryRefreshMessages,
} from './orchestrator/sessionMemoryRefreshMessages';

type LoggerLike = {
  devLog: (message: string, payload?: unknown) => void;
  devWarn: (message: string, payload?: unknown) => void;
};

type PreparationCallbacks = {
  onUserMessageEnriched?: (messageId: string, enrichedContent: string) => void;
  onUserMessageAttachmentsUpdated?: (messageId: string, attachments: Attachment[]) => void;
};

type PreMemoryEnrichmentResult = {
  messages: Message[];
  enrichedMessageId?: string;
  enrichedContent?: string;
  shouldPersistEnrichment?: boolean;
  /** Set only when a document-input refusal was structurally recorded on an attachment. */
  updatedAttachments?: Attachment[];
};

/**
 * Applies structured document-input refusals discovered by `runMediaUnderstanding` onto their
 * source attachments (matched by index into the same array `runMediaUnderstanding` was called
 * with). Returns the original `attachments` reference unchanged when nothing needs to change,
 * so callers can cheaply detect "nothing to persist" via reference equality.
 */
function applyDocumentInputRefusals(
  attachments: Attachment[] | undefined,
  refusals: ReadonlyArray<MediaUnderstandingDocumentRefusal>,
): Attachment[] | undefined {
  if (!attachments?.length || refusals.length === 0) {
    return attachments;
  }

  const refusalByAttachmentIndex = new Map(
    refusals.map((refusal) => [refusal.attachmentIndex, refusal]),
  );
  let changed = false;
  const nextAttachments = attachments.map((attachment, index) => {
    const refusal = refusalByAttachmentIndex.get(index);
    if (
      !refusal ||
      (attachment.documentInputRefusalReason === refusal.refusalReason &&
        attachment.documentInputRefusalMaxBytes === refusal.maxBytes)
    ) {
      return attachment;
    }

    changed = true;
    return {
      ...attachment,
      documentInputRefusalReason: refusal.refusalReason,
      ...(refusal.maxBytes !== undefined
        ? { documentInputRefusalMaxBytes: refusal.maxBytes }
        : {}),
    };
  });

  return changed ? nextAttachments : attachments;
}

export type OrchestratorMemoryAccessInput = Readonly<{
  internalUserMessageCount: number;
  logger: LoggerLike;
  memoryConversationId: string;
  messages: Message[];
}>;

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
  let documentInputRefusals: ReadonlyArray<MediaUnderstandingDocumentRefusal> = [];

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
      documentInputRefusals = mediaResult.documentInputRefusals;
    } catch {
      // Best-effort only.
    }
  }

  const currentUserContent = lastUserForEnrichment.enrichedContent || lastUserForEnrichment.content;
  const contentChanged = persistedEnrichedContent !== currentUserContent;
  const updatedAttachments = applyDocumentInputRefusals(
    lastUserForEnrichment.attachments,
    documentInputRefusals,
  );
  const attachmentsChanged = updatedAttachments !== lastUserForEnrichment.attachments;

  if (!contentChanged && !attachmentsChanged) {
    return { messages: params.messages };
  }

  return {
    messages: params.messages.map((message) =>
      message.id === lastUserForEnrichment.id
        ? {
            ...message,
            ...(contentChanged ? { enrichedContent: persistedEnrichedContent } : {}),
            ...(attachmentsChanged ? { attachments: updatedAttachments } : {}),
          }
        : message,
    ),
    enrichedMessageId: lastUserForEnrichment.id,
    ...(contentChanged
      ? {
          enrichedContent: persistedEnrichedContent,
          shouldPersistEnrichment: persistedEnrichedContent !== initialPersistedEnrichedContent,
        }
      : {}),
    ...(attachmentsChanged ? { updatedAttachments } : {}),
  };
}

/**
 * The request's messages without trailing internal user messages, and what it read from
 * memory for them. A memory read that fails leaves the request without memory, never
 * without an answer.
 */
export function loadOrchestratorMemoryAccessContext(params: OrchestratorMemoryAccessInput): {
  scopedMessages: Message[];
  memory: SessionMemoryRead;
} {
  const scopedMessages = excludeTrailingInternalUserMessages(
    params.messages,
    params.internalUserMessageCount,
  );
  try {
    return {
      scopedMessages,
      memory: readSessionMemory(params.memoryConversationId, scopedMessages),
    };
  } catch (memoryReadError: unknown) {
    params.logger.devWarn(
      'Memory unavailable for this request:',
      memoryReadError instanceof Error ? memoryReadError.message : String(memoryReadError),
    );
    return {
      scopedMessages,
      memory: { status: 'unavailable' },
    };
  }
}

export async function prepareOrchestratorRequestBundle(params: {
  activeModel: string;
  activeProvider: LlmProviderConfig;
  callbacks: PreparationCallbacks;
  conversationId: string;
  internalUserMessageCount: number;
  linkUnderstandingEnabled: boolean;
  logger: LoggerLike;
  memoryConversationId: string;
  maxLinks: number;
  mediaUnderstandingEnabled: boolean;
  messages: Message[];
  workflowScopeUserMessageId?: string;
}): Promise<{
  currentUserMessage?: CodeOwnedCurrentUserMessage;
  latestUserMessageText: string;
  memory: SessionMemoryRead;
  memoryRefreshInternalUserMessages: ReadonlyArray<Message>;
  skillPrompts: Awaited<ReturnType<typeof getSkillSystemPrompts>>;
  workingMessages: Message[];
}> {
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
  const memoryAccessContext = loadOrchestratorMemoryAccessContext({
    internalUserMessageCount: params.internalUserMessageCount,
    logger: params.logger,
    memoryConversationId: params.memoryConversationId,
    messages: enrichedRequest.messages,
  });

  const requestContext = prepareAgentControlGraphRequestContext({
    memoryScopedMessages: memoryAccessContext.scopedMessages,
    workflowScopeUserMessageId: params.workflowScopeUserMessageId,
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
  if (enrichedRequest.enrichedMessageId && enrichedRequest.updatedAttachments) {
    workingMessages = workingMessages.map((message) =>
      message.id === enrichedRequest.enrichedMessageId
        ? { ...message, attachments: enrichedRequest.updatedAttachments }
        : message,
    );
    params.callbacks.onUserMessageAttachmentsUpdated?.(
      enrichedRequest.enrichedMessageId,
      enrichedRequest.updatedAttachments,
    );
  }
  workingMessages = rebuildSessionMemoryRefreshMessages({
    internalUserMessages: memoryRefreshInternalUserMessages,
    workingMessages,
  });

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
    memory: memoryAccessContext.memory,
    memoryRefreshInternalUserMessages,
    skillPrompts,
    workingMessages,
  };
}
