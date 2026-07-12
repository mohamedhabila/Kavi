import type { LlmProviderConfig } from '../../types/provider';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { SUPER_AGENT_PERSONA_ID } from '../agents/personas';
import {
  providerRequiresApiKey,
  resolveConversationModel,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from '../llm/support/providerSupport';
import type { CronJob } from '../cron/types';
import { hasCompleteFinalAssistantMetadata } from '../../utils/assistantMessageMetadata';
import { synchronizeScheduledConversationMode } from './jobExecutorConversationTurns';
import { NonRetryableSchedulerExecutionError } from './executionError';

export async function resolveScheduledExecutionProvider(job: CronJob) {
  const settings = useSettingsStore.getState();
  const provider = resolveEnabledProvider(
    settings.providers,
    job.payload.providerId || settings.activeProviderId,
  );
  if (!provider) {
    throw new NonRetryableSchedulerExecutionError(
      new Error('No enabled provider configured for scheduled task execution'),
    );
  }
  const model =
    job.payload.model ||
    resolveConversationModel(provider, {
      activeProviderId: settings.activeProviderId,
      activeModel: settings.activeModel,
    }) ||
    provider.model;
  if (!model) {
    throw new NonRetryableSchedulerExecutionError(
      new Error(`Scheduled task "${job.name}" has no model configured`),
    );
  }
  const apiKey = await resolveProviderApiKey(provider);
  if (providerRequiresApiKey(provider) && !apiKey) {
    throw new NonRetryableSchedulerExecutionError(
      new Error(`Missing API key for provider "${provider.name}"`),
    );
  }
  const systemPrompt =
    settings.systemPrompt || 'You are a helpful personal AI assistant with access to tools.';
  return { settings, provider, model, apiKey, systemPrompt };
}

export function scheduledOccurrenceMessageIds(job: CronJob): {
  occurrenceId: string;
  userMessageId: string;
  assistantMessageId: string;
} {
  const occurrenceId = job.runningOccurrenceId ?? job.runningAttemptId;
  if (!occurrenceId) {
    throw new NonRetryableSchedulerExecutionError(
      new Error('Scheduled execution is missing its durable occurrence identity.'),
    );
  }
  return {
    occurrenceId,
    userMessageId: `scheduled:${occurrenceId}:user`,
    assistantMessageId: `scheduled:${occurrenceId}:assistant`,
  };
}

export function resolveScheduledExecutionConversation(params: {
  job: CronJob;
  provider: LlmProviderConfig;
  model: string;
  systemPrompt: string;
}): {
  chatState: ReturnType<typeof useChatStore.getState>;
  conversationId: string;
} {
  const { job, provider, model, systemPrompt } = params;
  const chatState = useChatStore.getState();
  const { userMessageId, assistantMessageId } = scheduledOccurrenceMessageIds(job);
  const projectedConversationId = chatState.conversations.find((conversation) =>
    conversation.messages.some(
      (message) => message.id === userMessageId || message.id === assistantMessageId,
    ),
  )?.id;
  const existingConversationId =
    projectedConversationId ||
    (job.retryConversationId &&
    chatState.conversations.some((conversation) => conversation.id === job.retryConversationId)
      ? job.retryConversationId
      : undefined) ||
    (job.delivery?.conversationId &&
    chatState.conversations.some((conversation) => conversation.id === job.delivery?.conversationId)
      ? job.delivery.conversationId
      : undefined) ||
    (job.sessionTarget === 'main' && job.wakeMode === 'continue'
      ? chatState.activeConversationId || undefined
      : undefined);
  const executionMode = job.payload.mode;
  const conversationId = existingConversationId
    ? existingConversationId
    : job.sessionTarget === 'main'
      ? chatState.getOrCreateCanonicalThread(provider.id, systemPrompt, model, {
          activate: false,
          personaId: executionMode === 'agentic' ? SUPER_AGENT_PERSONA_ID : undefined,
          mode: executionMode,
        })
      : chatState.createConversation(provider.id, systemPrompt, model, {
          activate: false,
          personaId: executionMode === 'agentic' ? SUPER_AGENT_PERSONA_ID : undefined,
          mode: executionMode,
        });
  return { chatState: useChatStore.getState(), conversationId };
}

export function configureScheduledExecutionConversation(params: {
  job: CronJob;
  provider: LlmProviderConfig;
  model: string;
  conversationId: string;
}): string {
  const chatState = useChatStore.getState();
  const executionPersonaId = synchronizeScheduledConversationMode(
    chatState,
    params.conversationId,
    params.job.payload.mode,
  );
  chatState.updateModelInConversation(params.conversationId, params.provider.id, params.model);
  return executionPersonaId;
}

export function resolveScheduledOccurrenceCompletedOutput(params: {
  job: CronJob;
  chatState: ReturnType<typeof useChatStore.getState>;
  conversationId: string;
}): string | undefined {
  const { userMessageId } = scheduledOccurrenceMessageIds(params.job);
  const conversation = params.chatState.conversations.find(
    (candidate) => candidate.id === params.conversationId,
  );
  const occurrenceStart = conversation?.messages.findIndex(
    (message) => message.id === userMessageId,
  );
  const nextUserIndex =
    conversation && occurrenceStart !== undefined && occurrenceStart >= 0
      ? conversation.messages.findIndex(
          (message, index) => index > occurrenceStart && message.role === 'user',
        )
      : -1;
  const occurrenceMessages =
    conversation && occurrenceStart !== undefined && occurrenceStart >= 0
      ? conversation.messages.slice(
          occurrenceStart + 1,
          nextUserIndex === -1 ? undefined : nextUserIndex,
        )
      : [];
  const terminalArtifact = [...occurrenceMessages]
    .reverse()
    .find(
      (message) =>
        message.role === 'tool' || (message.role === 'assistant' && !message.subAgentEvent),
    );
  return terminalArtifact && hasCompleteFinalAssistantMetadata(terminalArtifact)
    ? terminalArtifact.content
    : undefined;
}
