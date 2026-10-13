import type { LlmProviderConfig } from '../../types/provider';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  providerRequiresApiKey,
  resolveConversationModel,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from '../llm/support/providerSupport';
import type { CronJob } from '../cron/types';
import { hasCompleteFinalAssistantMetadata } from '../../utils/assistantMessageMetadata';
import { NonRetryableSchedulerExecutionError } from './executionError';
import { resolveConversationPersonaForMode } from '../../engine/graph/conversation/modeTransitions';
import { resolveForegroundConversationExecutionContext } from '../../engine/graph/foregroundRun/executionContext';

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
  // Kavi is one conversation: a scheduled job is a turn in it, unless an earlier attempt of
  // this occurrence already lives in a conversation.
  const conversationId =
    projectedConversationId ??
    (job.retryConversationId &&
    chatState.conversations.some((conversation) => conversation.id === job.retryConversationId)
      ? job.retryConversationId
      : undefined) ??
    ensureScheduledConversation({ provider, model, systemPrompt });
  return { chatState: useChatStore.getState(), conversationId };
}

/** Creates the one conversation the way the chat screen does when none exists yet. */
function ensureScheduledConversation(params: {
  provider: LlmProviderConfig;
  model: string;
  systemPrompt: string;
}): string {
  const mode = useSettingsStore.getState().defaultConversationMode;
  return useChatStore
    .getState()
    .ensureConversation(params.provider.id, params.systemPrompt, params.model, {
      activate: false,
      mode,
      personaId: resolveConversationPersonaForMode({ nextMode: mode }),
    });
}

/**
 * A scheduled run is a turn in the conversation: it runs with the persona a foreground turn
 * would use and leaves the conversation's persona and model alone. Like any turn, it can
 * escalate a chitchat conversation to agentic when it discovers a tool chitchat may not call.
 */
export function resolveScheduledExecutionPersona(conversationId: string): string {
  return resolveForegroundConversationExecutionContext({
    conversation: useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === conversationId),
    defaultConversationMode: useSettingsStore.getState().defaultConversationMode,
  }).personaId;
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
