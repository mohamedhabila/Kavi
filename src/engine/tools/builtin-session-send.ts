import type { LlmProviderConfig } from '../../types/provider';
import type { Message } from '../../types/message';
import {
  getSubAgent,
  getSessionContext,
  launchSubAgent,
  listActiveSubAgents,
  observeBackgroundSubAgentResult,
  startSubAgent,
} from '../../services/agents/subAgent';
import { resolveConversationWorkspaceTarget } from '../../services/conversationWorkspace/ownership';
import { resolveOwningConversationId } from '../../services/agents/lifecycle/stateMachine';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  assertProviderReadyForRequest,
  hydrateProviderForRequest,
} from '../../services/llm/support/providerSupport';
import { serializeTerminalSessionResult } from './builtin-session-resultSupport';
import {
  resolveBlockingWaitTimeoutMs,
  waitForStartedSubAgentResult,
} from './builtin-session-waitSupport';
import {
  buildFollowUpMessages,
  buildFollowUpPrompt,
  buildFollowUpSubAgentConfig,
  resolveChildSessionDepth,
} from './builtin-session-config';
import {
  mergeWorkerProviderIntoCatalog,
  resolveFollowUpWorkerModel,
} from './builtin-session-provider';
import { normalizeRequiredSessionText } from './builtin-session-prompt';

export async function executeSessionSend(
  args: {
    sessionId: string;
    message: string;
    waitForCompletion?: boolean;
    waitTimeoutMs?: number;
  },
  provider: LlmProviderConfig,
  inheritedModel?: string,
): Promise<string> {
  const agent = getSubAgent(args.sessionId);
  if (!agent) return `Error: session not found: ${args.sessionId}`;

  if (agent.status === 'running') {
    return JSON.stringify({
      status: 'running',
      sessionId: args.sessionId,
      currentActivity: agent.currentActivity,
      activeToolName: agent.activeToolName,
      message:
        'Session is still processing. The currentActivity field describes the active step. Use sessions_wait if you need to block for completion, or call sessions_cancel and respawn the worker with corrected instructions before sending follow-up work.',
    });
  }

  const normalizedMessage = normalizeRequiredSessionText(args.message, 'message');
  if (!normalizedMessage.value) {
    return JSON.stringify({ status: 'error', error: normalizedMessage.error });
  }

  const message = normalizedMessage.value;
  const previousContext = getSessionContext(args.sessionId);
  const conversations = useChatStore.getState().conversations;
  const parentConversationId = (() => {
    const resolvedFromSession = resolveOwningConversationId(args.sessionId, listActiveSubAgents());
    if (resolvedFromSession && resolvedFromSession !== args.sessionId) {
      return resolvedFromSession;
    }

    return (
      resolveOwningConversationId(
        previousContext?.config.parentConversationId ?? agent.parentConversationId,
        listActiveSubAgents(),
      ) ??
      previousContext?.config.parentConversationId ??
      agent.parentConversationId
    );
  })();
  const activeConversation = parentConversationId
    ? conversations.find((conversation) => conversation.id === parentConversationId)
    : undefined;
  const workspaceTarget = previousContext?.config.workspaceConversationId?.trim()
    ? {
        workspaceConversationId: previousContext.config.workspaceConversationId.trim(),
        workspaceReadFallbackConversationId:
          previousContext.config.workspaceReadFallbackConversationId?.trim() || undefined,
      }
    : parentConversationId
      ? resolveConversationWorkspaceTarget({
          conversationId: parentConversationId,
          conversations,
          subAgents: listActiveSubAgents(),
        })
      : undefined;
  const settings = useSettingsStore.getState();
  const previousOutput = previousContext?.conversationSummary || agent.output?.slice(0, 4000) || '';
  const followUpMessages: Message[] | undefined = buildFollowUpMessages(
    previousContext?.messages,
    message,
  );
  const followUpPrompt = buildFollowUpPrompt({
    message,
    previousContextExists: Boolean(previousContext),
    previousOutput,
    hasFollowUpMessages: Boolean(followUpMessages),
  });

  try {
    const storedProvider = previousContext?.provider;
    const followUpProvider = storedProvider
      ? await hydrateProviderForRequest(storedProvider)
      : provider;
    assertProviderReadyForRequest(
      followUpProvider,
      storedProvider
        ? `Worker provider "${storedProvider.name || storedProvider.id}"`
        : `Worker provider "${provider.name || provider.id}"`,
    );
    const followUpAllProviders = mergeWorkerProviderIntoCatalog(
      previousContext?.allProviders,
      followUpProvider,
    );
    const followUpModel = resolveFollowUpWorkerModel(
      followUpProvider,
      previousContext?.config.model,
      inheritedModel,
    );
    const followUpDepth = resolveChildSessionDepth(agent, previousContext);
    const followUpConfig = buildFollowUpSubAgentConfig({
      parentConversationId,
      workspaceConversationId: workspaceTarget?.workspaceConversationId,
      workspaceReadFallbackConversationId: workspaceTarget?.workspaceReadFallbackConversationId,
      sessionId: args.sessionId,
      followUpDepth,
      followUpPrompt,
      followUpMessages,
      followUpModel,
      systemPrompt: previousContext?.config.systemPrompt,
      agentRunId:
        previousContext?.config.agentRunId ??
        agent.agentRunId ??
        activeConversation?.activeAgentRunId,
      workstreamId: previousContext?.config.workstreamId ?? agent.workstreamId,
      name: previousContext?.config.name || agent.name,
      tools: previousContext?.config.tools,
      sandboxPolicy: previousContext?.config.sandboxPolicy || agent.sandboxPolicy,
      inheritMemory: previousContext?.config.inheritMemory ?? true,
      linkUnderstandingEnabled:
        previousContext?.config.linkUnderstandingEnabled ?? settings.linkUnderstandingEnabled,
      mediaUnderstandingEnabled:
        previousContext?.config.mediaUnderstandingEnabled ?? settings.mediaUnderstandingEnabled,
    });

    if (args.waitForCompletion) {
      const started = await startSubAgent(followUpConfig, followUpProvider, followUpAllProviders);
      const waitWindow = resolveBlockingWaitTimeoutMs(args.waitTimeoutMs);
      const waitTimeoutMs = waitWindow.waitTimeoutMs;
      const raceResult = await waitForStartedSubAgentResult(started, waitTimeoutMs);

      if (raceResult === null) {
        observeBackgroundSubAgentResult(started);
        return JSON.stringify({
          status: 'running',
          sessionId: started.sessionId,
          previousSessionId: args.sessionId,
          depth: started.depth,
          name: followUpConfig.name,
          ...(followUpConfig.workstreamId ? { workstreamId: followUpConfig.workstreamId } : {}),
          model: followUpModel,
          waitTimedOut: true,
          waitTimeoutMs,
          ...(waitWindow.usedDefault ? { usedDefaultWaitTimeout: true } : {}),
          guidance:
            'The worker is still running. Call sessions_wait if you need to keep blocking, or continue with other non-overlapping work until it completes.',
        });
      }

      return JSON.stringify({
        ...serializeTerminalSessionResult(raceResult),
        previousSessionId: args.sessionId,
        ...(followUpConfig.workstreamId ? { workstreamId: followUpConfig.workstreamId } : {}),
      });
    }

    const launched = await launchSubAgent(followUpConfig, followUpProvider, followUpAllProviders);
    return JSON.stringify({
      status: launched.status,
      sessionId: launched.sessionId,
      previousSessionId: args.sessionId,
      depth: launched.depth,
      name: followUpConfig.name,
      ...(followUpConfig.workstreamId ? { workstreamId: followUpConfig.workstreamId } : {}),
      model: followUpModel,
      guidance:
        'The worker is running in the background. Use sessions_wait when you need the final output, or continue with other non-overlapping work until it completes.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', error: message });
  }
}
