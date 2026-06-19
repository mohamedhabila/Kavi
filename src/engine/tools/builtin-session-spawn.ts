import type { LlmProviderConfig } from '../../types/provider';
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
import { buildGraphDelegatedWorkerContract } from '../graph/delegatedWorkerContract';
import { resolveDelegatedWorkerSpawnPlan } from '../graph/delegatedWorkerSpawn';
import { useChatStore } from '../../store/useChatStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { serializeTerminalSessionResult } from './builtin-session-resultSupport';
import {
  resolveBlockingWaitTimeoutMs,
  waitForStartedSubAgentResult,
} from './builtin-session-waitSupport';
import {
  buildDelegatedInitialMessages,
  normalizeDelegatedWorkerPrompt,
  findLatestUserMessageWithAttachments,
} from './builtin-session-prompt';
import { resolveSpawnWorkerModel } from './builtin-session-provider';
import type { ToolExecutionContext } from './toolExecutionContext';
import {
  buildSpawnSubAgentConfig,
  resolveChildSessionDepth,
  sanitizeWorkerName,
} from './builtin-session-config';

function selectExactSubAgentSession<T extends { sessionId?: string }>(
  session: T | undefined,
  sessionId: string,
): T | undefined {
  return session?.sessionId?.trim() === sessionId.trim() ? session : undefined;
}

function normalizeOptionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = Array.from(
    new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)),
  );
  return values.length > 0 ? values : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function executeSessionSpawn(
  args: {
    prompt?: string;
    workstreamId?: string;
    goalScope?: { goalIds?: string[] };
    dependsOnWorkstreams?: string[];
    name?: string;
    tools?: string[];
    waitForCompletion?: boolean;
  },
  conversationId: string,
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
  inheritedModel?: string,
  executionContext?: Pick<ToolExecutionContext, 'controlGraphGoals' | 'agentRunId'>,
): Promise<string> {
  try {
    const normalizedPrompt = normalizeDelegatedWorkerPrompt(args);
    if (!normalizedPrompt.value) {
      return JSON.stringify({ status: 'error', error: normalizedPrompt.error });
    }

    const prompt = normalizedPrompt.value;
    const workerModel = resolveSpawnWorkerModel(provider, inheritedModel);
    const sanitizedName = sanitizeWorkerName(args.name);
    const sanitizedWorkerTools = normalizeOptionalStringList(args.tools);
    const sanitizedWorkstreamId = normalizeOptionalString(args.workstreamId);

    const currentSession = selectExactSubAgentSession(getSubAgent(conversationId), conversationId);
    const currentSessionContext = getSessionContext(conversationId);
    const liveWorkers = listActiveSubAgents();
    const conversations = useChatStore.getState().conversations;
    const parentConversationId =
      resolveOwningConversationId(
        currentSession?.parentConversationId ?? currentSessionContext?.config.parentConversationId,
        liveWorkers,
      ) ??
      currentSession?.parentConversationId?.trim() ??
      currentSessionContext?.config.parentConversationId?.trim() ??
      conversationId;
    const workspaceTarget = currentSessionContext?.config.workspaceConversationId?.trim()
      ? {
          workspaceConversationId: currentSessionContext.config.workspaceConversationId.trim(),
          workspaceReadFallbackConversationId:
            currentSessionContext.config.workspaceReadFallbackConversationId?.trim() || undefined,
        }
      : resolveConversationWorkspaceTarget({
          conversationId: parentConversationId,
          conversations,
          subAgents: liveWorkers,
        });
    const activeConversation = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === parentConversationId);
    const settings = useSettingsStore.getState();
    const agentRunId =
      executionContext?.agentRunId ||
      activeConversation?.activeAgentRunId ||
      currentSession?.agentRunId ||
      currentSessionContext?.config.agentRunId;
    const childDepth = resolveChildSessionDepth(currentSession, currentSessionContext);

    const launchPlan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt,
        name: sanitizedName,
        workstreamId: sanitizedWorkstreamId,
        goalScope: args.goalScope,
        dependsOnWorkstreams: args.dependsOnWorkstreams,
        depth: childDepth,
      },
      conversation: activeConversation,
      parentConversationId,
      agentRunId: executionContext?.agentRunId ?? agentRunId,
      liveWorkers,
      parentGoals: executionContext?.controlGraphGoals,
    });
    if (launchPlan.status !== 'ready') {
      return JSON.stringify(launchPlan.response);
    }

    const { activeRun, spawnGate } = launchPlan;
    const goals = launchPlan.goals;

    const parentSessionId =
      currentSession?.sessionId || (currentSessionContext ? conversationId : undefined);
    const workerContract = buildGraphDelegatedWorkerContract({
      normalizedPrompt: prompt,
      goalId: spawnGate.workstreamId,
      goals,
      configuredTools: sanitizedWorkerTools,
      availableWorkerTools: sanitizedWorkerTools,
    });
    const workerPrompt = workerContract.prompt;
    const effectiveConfiguredWorkerTools = workerContract.configuredTools ?? sanitizedWorkerTools;

    const workerTools = effectiveConfiguredWorkerTools
      ? [...effectiveConfiguredWorkerTools]
      : undefined;
    const initialMessages = buildDelegatedInitialMessages(
      workerPrompt,
      findLatestUserMessageWithAttachments(currentSessionContext?.messages) ??
        findLatestUserMessageWithAttachments(activeConversation?.messages),
    );

    const config = buildSpawnSubAgentConfig({
      parentConversationId,
      workspaceConversationId: workspaceTarget.workspaceConversationId,
      workspaceReadFallbackConversationId: workspaceTarget.workspaceReadFallbackConversationId,
      parentSessionId,
      childDepth,
      workerPrompt,
      initialMessages,
      workerModel,
      agentRunId: activeRun?.id ?? agentRunId,
      workstreamId: spawnGate.workstreamId,
      sanitizedName,
      workerTools,
      linkUnderstandingEnabled: settings.linkUnderstandingEnabled,
      mediaUnderstandingEnabled: settings.mediaUnderstandingEnabled,
    });

    if (args.waitForCompletion) {
      const started = await startSubAgent(config, provider, allProviders);
      const waitWindow = resolveBlockingWaitTimeoutMs(undefined);
      const waitTimeoutMs = waitWindow.waitTimeoutMs;
      const raceResult = await waitForStartedSubAgentResult(started, waitTimeoutMs);

      if (raceResult === null) {
        observeBackgroundSubAgentResult(started, { announce: true });
        return JSON.stringify({
          status: 'running',
          sessionId: started.sessionId,
          depth: started.depth,
          name: sanitizedName,
          ...(spawnGate.workstreamId ? { workstreamId: spawnGate.workstreamId } : {}),
          model: config.model || provider.model,
          waitTimedOut: true,
          waitTimeoutMs,
          ...(waitWindow.usedDefault ? { usedDefaultWaitTimeout: true } : {}),
          guidance:
            'The worker is still running. Call sessions_wait if you need to keep blocking, or continue with other non-overlapping work until it completes.',
        });
      }

      return JSON.stringify({
        ...serializeTerminalSessionResult(raceResult),
        ...(spawnGate.workstreamId ? { workstreamId: spawnGate.workstreamId } : {}),
      });
    }

    const launched = await launchSubAgent(config, provider, allProviders);
    return JSON.stringify({
      status: launched.status,
      sessionId: launched.sessionId,
      depth: launched.depth,
      name: sanitizedName,
      ...(spawnGate.workstreamId ? { workstreamId: spawnGate.workstreamId } : {}),
      model: config.model || provider.model,
      guidance:
        'The worker is running in the background. Use sessions_wait when you need the final output, or continue with other non-overlapping work until it completes.',
    });
  } catch (err: unknown) {
    let message: string;
    let errorClass = 'unknown';
    if (err instanceof Error && err.message.includes('MAX_SPAWN_DEPTH')) {
      errorClass = 'max_spawn_depth';
      message =
        'Max sub-agent nesting depth exceeded. Consider breaking the task into parallel agents instead.';
    } else if (err instanceof TypeError) {
      errorClass = 'type_error';
      message = `Configuration error: ${err.message}. Check that a provider is properly configured.`;
    } else {
      errorClass = err instanceof Error ? err.name || 'error' : typeof err;
      message = err instanceof Error ? err.message : String(err);
    }
    return JSON.stringify({
      status: 'error',
      code: 'session_spawn_error',
      errorClass,
      error: message,
    });
  }
}
