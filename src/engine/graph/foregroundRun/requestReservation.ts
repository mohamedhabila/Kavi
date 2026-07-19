import type { Conversation, ModelProjectionOwner } from '../../../types/conversation';
import { prepareAgentRunResumeForOrchestrator } from '../runResumePreparation';
import { buildModelReadyMessages } from './modelReadyMessages';
import type { RunChatOptions } from './contracts';
import type { ExecuteForegroundConversationRunParams } from './executionTypes';
import {
  prepareForegroundRunRequestBootstrap,
  type ForegroundRunRequestClaim,
  type PreparedForegroundRunBootstrap,
} from './requestBootstrap';
import {
  buildForegroundProjectionReservation,
  claimForegroundProjectionReservation,
  terminalizeAndReleaseForegroundProjectionReservation,
} from './projectionReservation';
import type { AgentRunResumePreparation } from '../runResumePreparation';

type ReadyResume = Extract<AgentRunResumePreparation, { kind: 'ready' }>;

export type ForegroundRunRequestReservation =
  | Readonly<{
      kind: 'ready';
      preparedBootstrap: PreparedForegroundRunBootstrap;
      projectionOwner: ModelProjectionOwner;
      resumePreparation: ReadyResume;
    }>
  | Readonly<{ kind: 'unavailable'; message: string }>;

function resumeUnavailableMessage(reason: Exclude<AgentRunResumePreparation, { kind: 'ready' }>) {
  return reason.reason === 'missing_existing_owner'
    ? 'The original request for this agent run is unavailable. Restore it before resuming.'
    : reason.reason === 'missing_user_response'
      ? 'Answer the pending clarification before resuming this agent run.'
      : 'Foreground request message is missing.';
}

export async function reserveForegroundRunRequest(params: {
  claim: ForegroundRunRequestClaim;
  conversation: Conversation | undefined;
  conversationId: string;
  createAssistantMessageId: () => string;
  defaultConversationMode: Conversation['mode'];
  durability: ExecuteForegroundConversationRunParams['context']['durability'];
  foregroundRequestId: string;
  options?: RunChatOptions;
}): Promise<ForegroundRunRequestReservation> {
  const bootstrapResult = prepareForegroundRunRequestBootstrap({
    claim: params.claim,
    conversation: params.conversation,
    createAssistantMessageId: params.createAssistantMessageId,
    defaultConversationMode: params.defaultConversationMode,
    options: params.options,
  });
  if (bootstrapResult.kind === 'reuse_unavailable') {
    return { kind: 'unavailable', message: 'The requested agent run is unavailable.' };
  }
  const preparedBootstrap = bootstrapResult.prepared;
  const bootstrap = preparedBootstrap.bootstrap;
  const resumePreparation = prepareAgentRunResumeForOrchestrator({
    existingRun: bootstrap.existingRun,
    fallbackUserMessageId: bootstrap.latestUserMessage?.id,
    messages: buildModelReadyMessages(params.conversation?.messages ?? []),
  });
  if (resumePreparation.kind === 'unavailable') {
    return { kind: 'unavailable', message: resumeUnavailableMessage(resumePreparation) };
  }
  const projectionOwner = buildForegroundProjectionReservation({
    runId: params.foregroundRequestId,
    requestMessageId: resumePreparation.workflowScopeUserMessageId,
    assistantMessageId: bootstrap.assistantMessageId,
  });
  try {
    await claimForegroundProjectionReservation({
      durability: params.durability,
      conversationId: params.conversationId,
      owner: projectionOwner,
      insertAssistantPlaceholder: bootstrap.shouldInsertPlaceholderAssistant,
    });
  } catch (error: unknown) {
    if (params.durability.ownsModelProjection(params.conversationId, projectionOwner)) {
      await terminalizeAndReleaseForegroundProjectionReservation({
        durability: params.durability,
        conversationId: params.conversationId,
        owner: projectionOwner,
        detail: `Projection reservation persistence failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    return {
      kind: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { kind: 'ready', preparedBootstrap, projectionOwner, resumePreparation };
}
