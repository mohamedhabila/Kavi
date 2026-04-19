import { useChatStore } from '../../store/useChatStore';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import { useSettingsStore } from '../../store/useSettingsStore';
import { generateId } from '../../utils/id';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import type {
  AgentRun,
  Conversation,
  LlmProviderConfig,
  Message,
  SubAgentSnapshot,
} from '../../types';
import { listActiveSubAgents } from './subAgent';
import {
  providerRequiresApiKey,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from '../llm/providerSupport';
import {
  buildAgentRunToolResultFallback,
  buildMissingFinalResponseFallback,
  collectAgentRunFinalizationEvidence,
  synthesizeAgentRunFinalAnswer,
} from './agentRunFinalization';
import {
  getAgentRunMessageSlice,
  getSubAgentsForAgentRun,
  hasDeliveredFinalAssistantResponse,
} from './workflowState';

const FINAL_RESPONSE_CHECKPOINT_TITLE = 'Final response delivered';
const MAX_LOG_DETAIL_CHARS = 320;

type ResolvedFinalizationProviderContext = {
  provider: LlmProviderConfig;
  model: string;
  systemPromptText: string;
};

function truncateLogDetail(value?: string, maxLength = MAX_LOG_DETAIL_CHARS): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function isPlainAgentRunAssistantMessage(message: Message): boolean {
  return (
    message.role === 'assistant' && !message.subAgentEvent && (message.toolCalls?.length ?? 0) === 0
  );
}

function findAgentRunReplaceableAssistantMessageId(
  messages: Message[],
  userMessageId: string,
): string | undefined {
  const runMessages = getAgentRunMessageSlice(messages, userMessageId);

  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    const message = runMessages[index];
    if (message.role === 'tool') {
      continue;
    }

    if (isPlainAgentRunAssistantMessage(message)) {
      const hasVisibleOutput =
        message.content.trim().length > 0 ||
        message.reasoning?.trim().length ||
        (message.attachments?.length ?? 0) > 0 ||
        !!message.effectId;
      return hasVisibleOutput ? undefined : message.id;
    }

    return undefined;
  }

  return undefined;
}

async function resolveConversationFinalizationContext(
  conversation: Conversation,
): Promise<ResolvedFinalizationProviderContext | undefined> {
  const settings = useSettingsStore.getState();
  const providerTemplate = resolveEnabledProvider(
    settings.providers,
    conversation.providerId || settings.activeProviderId,
  );
  const providerId = providerTemplate?.id || '';
  const model =
    conversation.modelOverride ||
    (providerId === settings.activeProviderId ? settings.activeModel || '' : '') ||
    providerTemplate?.model ||
    '';

  if (!providerId || !providerTemplate || !model) {
    return undefined;
  }

  const apiKey = await resolveProviderApiKey(providerTemplate);
  if (providerRequiresApiKey(providerTemplate) && !apiKey) {
    return undefined;
  }

  return {
    provider: {
      ...providerTemplate,
      apiKey,
    },
    model,
    systemPromptText: conversation.systemPrompt || settings.systemPrompt,
  };
}

async function synthesizeRecoveredAgentRunCompletion(params: {
  conversation: Conversation;
  run: AgentRun & { status: Exclude<AgentRun['status'], 'running'> };
  providerContext?: ResolvedFinalizationProviderContext;
  liveSubAgentSnapshots: ReadonlyArray<SubAgentSnapshot>;
}): Promise<{
  output?: string;
  providerReplay?: Message['providerReplay'];
  source: 'synthesized' | 'fallback' | 'none';
}> {
  const evidence = collectAgentRunFinalizationEvidence(
    params.conversation.messages,
    params.run.userMessageId,
    params.run.summary.startedTools,
    { liveSubAgentSnapshots: params.liveSubAgentSnapshots },
  );
  const fallbackOutput =
    buildAgentRunToolResultFallback({
      status: params.run.status,
      evidence,
    }) || buildMissingFinalResponseFallback(params.run.status);

  if (params.run.status !== 'completed') {
    return {
      output: fallbackOutput,
      source: 'fallback',
    };
  }

  const hasRecoverableEvidence =
    !evidence.hasIncompleteToolCalls &&
    (evidence.lastNonEmptyAssistantContent.trim().length > 0 ||
      evidence.resultPreviews.length > 0 ||
      evidence.lastSubstantiveResult.trim().length > 0);
  if (!hasRecoverableEvidence) {
    return {
      output: fallbackOutput,
      source: 'fallback',
    };
  }

  const providerContext =
    params.providerContext ?? (await resolveConversationFinalizationContext(params.conversation));
  if (!providerContext) {
    return {
      output: fallbackOutput,
      source: fallbackOutput ? 'fallback' : 'none',
    };
  }

  const synthesized = await synthesizeAgentRunFinalAnswer({
    provider: providerContext.provider,
    model: providerContext.model,
    systemPrompt: providerContext.systemPromptText,
    evidence,
  });

  const synthesizedOutput = synthesized.output?.trim();
  if (synthesizedOutput) {
    return {
      output: synthesizedOutput,
      providerReplay: synthesized.providerReplay,
      source: 'synthesized',
    };
  }

  return {
    output: fallbackOutput,
    source: fallbackOutput ? 'fallback' : 'none',
  };
}

export async function repairTerminalAgentRunsMissingFinalResponses(params?: {
  activeSubAgents?: ReadonlyArray<SubAgentSnapshot>;
}): Promise<string[]> {
  const repairedRunIds: string[] = [];
  const activeSubAgents = params?.activeSubAgents ?? listActiveSubAgents();
  const providerContextCache = new Map<string, ResolvedFinalizationProviderContext | undefined>();

  const initialConversations = useChatStore.getState().conversations;
  for (const initialConversation of initialConversations) {
    const runIds = (initialConversation.agentRuns ?? []).map((run) => run.id);

    for (const runId of runIds) {
      const store = useChatStore.getState();
      const conversation = store.conversations.find(
        (candidate) => candidate.id === initialConversation.id,
      );
      const run = conversation?.agentRuns?.find((candidate) => candidate.id === runId);
      if (!conversation || !run || run.status === 'running') {
        continue;
      }
      const terminalRun = run as AgentRun & { status: Exclude<AgentRun['status'], 'running'> };

      if (hasDeliveredFinalAssistantResponse(conversation.messages, terminalRun.userMessageId)) {
        continue;
      }

      let providerContext = providerContextCache.get(conversation.id);
      if (!providerContextCache.has(conversation.id)) {
        providerContext = await resolveConversationFinalizationContext(conversation);
        providerContextCache.set(conversation.id, providerContext);
      }

      const synthesized = await synthesizeRecoveredAgentRunCompletion({
        conversation,
        run: terminalRun,
        providerContext,
        liveSubAgentSnapshots: getSubAgentsForAgentRun(
          conversation,
          terminalRun.id,
          activeSubAgents,
        ),
      });
      const output = synthesized.output?.trim();
      if (!output) {
        continue;
      }

      const latestStore = useChatStore.getState();
      const latestConversation = latestStore.conversations.find(
        (candidate) => candidate.id === conversation.id,
      );
      const latestRun = latestConversation?.agentRuns?.find(
        (candidate) => candidate.id === terminalRun.id,
      );
      if (!latestConversation || !latestRun || latestRun.status === 'running') {
        continue;
      }

      if (
        hasDeliveredFinalAssistantResponse(latestConversation.messages, latestRun.userMessageId)
      ) {
        continue;
      }

      const targetMessageId = findAgentRunReplaceableAssistantMessageId(
        latestConversation.messages,
        latestRun.userMessageId,
      );
      const finalAssistantMetadata = buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason:
          synthesized.source === 'synthesized'
            ? 'synthesized_from_evidence'
            : 'fallback_from_evidence',
      });

      if (targetMessageId) {
        latestStore.updateMessage(conversation.id, targetMessageId, output);
        latestStore.updateMessageAssistantMetadata(
          conversation.id,
          targetMessageId,
          finalAssistantMetadata,
        );
        if (synthesized.source === 'synthesized' && synthesized.providerReplay) {
          latestStore.updateMessageProviderReplay(
            conversation.id,
            targetMessageId,
            synthesized.providerReplay,
          );
        } else {
          latestStore.updateMessageProviderReplay(conversation.id, targetMessageId, undefined);
        }
      } else {
        latestStore.addMessage(conversation.id, {
          id: generateId(),
          role: 'assistant',
          content: output,
          providerReplay:
            synthesized.source === 'synthesized' ? synthesized.providerReplay : undefined,
          assistantMetadata: finalAssistantMetadata,
        });
      }

      const deliveredTimestamp = Date.now();
      const preview = truncateLogDetail(output) || output;
      latestStore.appendAgentRunCheckpoint(
        conversation.id,
        {
          kind: 'run',
          title: FINAL_RESPONSE_CHECKPOINT_TITLE,
          detail: preview,
          timestamp: deliveredTimestamp,
        },
        latestRun.id,
      );
      latestStore.updateAgentRunSummary(
        conversation.id,
        {
          latestSummary: preview,
          timestamp: deliveredTimestamp,
        },
        latestRun.id,
      );
      latestStore.addConversationLog(conversation.id, {
        kind: 'state',
        level:
          latestRun.status === 'completed'
            ? 'success'
            : latestRun.status === 'cancelled'
              ? 'warning'
              : 'error',
        title: FINAL_RESPONSE_CHECKPOINT_TITLE,
        detail: preview,
        timestamp: deliveredTimestamp,
      });
      repairedRunIds.push(latestRun.id);
    }
  }

  if (repairedRunIds.length > 0) {
    await flushChatStorePersistenceNow();
  }

  return repairedRunIds;
}
