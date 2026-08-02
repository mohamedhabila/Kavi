import {
  admitPendingClarificationReply,
  buildPendingClarificationReplyContext,
  type ClarificationReplyAdmission,
} from '../../../services/agents/clarificationReplyAdmission';
import { createAgentRunAbortError } from '../../../services/runtimeError';
import { acquireMainInferenceLease } from '../../../services/memory/onDeviceGuards';
import { recordConversationUsageEvent } from '../../../services/usage/conversationUsage';
import type { Conversation } from '../../../types/conversation';
import type { ModelProjectionOwner } from '../../../types/conversation';
import type { RunChatOptions } from './contracts';
import type { ExecuteForegroundConversationRunParams } from './executionTypes';
import { prepareAgentRunResumeForOrchestrator } from '../runResumePreparation';
import { buildModelReadyMessages } from './modelReadyMessages';
import type { ForegroundRunPreflightResult } from './preflight';
import {
  prepareForegroundRunRequestBootstrap,
  type ForegroundRunRequestClaim,
  type PreparedForegroundRunBootstrap,
} from './requestBootstrap';
import { retargetForegroundProjectionReservation } from './projectionReservation';
import type { AgentRunResumePreparation } from '../runResumePreparation';

type ReadyPreflight = Extract<ForegroundRunPreflightResult, { kind: 'ready' }>;
type ReadyResume = Extract<AgentRunResumePreparation, { kind: 'ready' }>;

export type ForegroundClarificationReplyAdmissionResult =
  | Readonly<{ kind: 'ready'; admission?: ClarificationReplyAdmission }>
  | Readonly<{ kind: 'superseded' }>;

export async function resolveForegroundClarificationReplyAdmission(params: {
  conversation: Conversation | undefined;
  conversationId: string;
  foregroundRequestId: string;
  isCurrentRunInvocation: () => boolean;
  options?: RunChatOptions;
  preflight: ReadyPreflight;
  signal: AbortSignal;
}): Promise<ForegroundClarificationReplyAdmissionResult> {
  const clarificationContext = params.options?.reuseAgentRunId
    ? undefined
    : buildPendingClarificationReplyContext(params.conversation);
  if (!clarificationContext) return { kind: 'ready' };

  const lease = acquireMainInferenceLease(
    `foreground-admission:${params.conversationId}:${params.foregroundRequestId}`,
  );
  let admission: ClarificationReplyAdmission;
  try {
    admission = await admitPendingClarificationReply({
      context: clarificationContext,
      provider: params.preflight.providerWithApiKey,
      model: params.preflight.model,
      signal: params.signal,
      requestDispatchGuard: () => {
        if (!params.isCurrentRunInvocation()) {
          throw createAgentRunAbortError('Request superseded during clarification admission.');
        }
      },
    });
  } catch {
    if (!params.isCurrentRunInvocation()) return { kind: 'superseded' };
    admission = {
      runId: clarificationContext.runId,
      disposition: 'ambiguous',
      resolvedInformationKeys: [],
    };
  } finally {
    lease.release();
  }

  for (const usage of admission.usages ?? []) {
    recordConversationUsageEvent({
      conversationId: params.conversationId,
      usage,
      providerId: params.preflight.provider.id,
      source: 'primary',
      agentRunId: admission.runId,
      emitLog: true,
    });
  }
  return { kind: 'ready', admission };
}

export type ForegroundClarificationAdmissionTransition =
  | Readonly<{
      kind: 'ready';
      preparedBootstrap: PreparedForegroundRunBootstrap;
      projectionOwner: ModelProjectionOwner;
      resumePreparation: ReadyResume;
    }>
  | Readonly<{ kind: 'stopped'; detail: string }>;

export async function transitionForegroundClarificationAdmission(params: {
  claim: ForegroundRunRequestClaim;
  conversation: Conversation | undefined;
  conversationId: string;
  defaultConversationMode: Conversation['mode'];
  durability: ExecuteForegroundConversationRunParams['context']['durability'];
  foregroundRequestId: string;
  isCurrentRunInvocation: () => boolean;
  onProjectionOwnerChanged: (owner: ModelProjectionOwner) => void;
  options?: RunChatOptions;
  preflight: ReadyPreflight;
  preparedBootstrap: PreparedForegroundRunBootstrap;
  projectionOwner: ModelProjectionOwner;
  signal: AbortSignal;
}): Promise<ForegroundClarificationAdmissionTransition> {
  const admissionResult = await resolveForegroundClarificationReplyAdmission(params);
  if (admissionResult.kind === 'superseded') {
    return {
      kind: 'stopped',
      detail: 'The request was superseded during clarification admission.',
    };
  }
  const admission = admissionResult.admission;
  let preparedBootstrap = params.preparedBootstrap;
  if (admission?.disposition === 'new_request') {
    const replacement = prepareForegroundRunRequestBootstrap({
      claim: params.claim,
      conversation: params.conversation,
      createAssistantMessageId: () => preparedBootstrap.bootstrap.assistantMessageId,
      defaultConversationMode: params.defaultConversationMode,
      clarificationReplyAdmission: admission,
      options: params.options,
    });
    if (replacement.kind === 'reuse_unavailable') {
      return { kind: 'stopped', detail: 'The admitted replacement request became unavailable.' };
    }
    preparedBootstrap = replacement.prepared;
  }

  const bootstrap = preparedBootstrap.bootstrap;
  const resumePreparation = prepareAgentRunResumeForOrchestrator({
    existingRun: bootstrap.existingRun,
    fallbackUserMessageId: bootstrap.latestUserMessage?.id,
    messages: buildModelReadyMessages(params.conversation?.messages ?? []),
    resolvedUserInformationKeys:
      admission?.disposition === 'answer' && admission.runId === bootstrap.existingRun?.id
        ? admission.resolvedInformationKeys
        : undefined,
  });
  if (resumePreparation.kind === 'unavailable') {
    return {
      kind: 'stopped',
      detail: `Admitted request resume failed: ${resumePreparation.reason}.`,
    };
  }
  const projectionOwner = await retargetForegroundProjectionReservation({
    durability: params.durability,
    conversationId: params.conversationId,
    owner: params.projectionOwner,
    requestMessageId: resumePreparation.workflowScopeUserMessageId,
    onOwnerChanged: params.onProjectionOwnerChanged,
  });
  return { kind: 'ready', preparedBootstrap, projectionOwner, resumePreparation };
}
