import type { Conversation } from '../../../types/conversation';
import type { ForegroundAgentRunCounters } from '../foregroundRunPhaseEffects';
import {
  buildForegroundRunBootstrapSelection,
  type ForegroundRunBootstrapSelection,
} from './bootstrap';
import type { RunChatOptions } from './contracts';

export type ForegroundRunRequestBootstrapResult = {
  abortController: AbortController;
  assistantMessageId: string;
  bootstrap: ForegroundRunBootstrapSelection;
  foregroundRequestId: string;
  initialCounters: ForegroundAgentRunCounters;
  trackedAgentRunId: string | undefined;
};

export type ForegroundRunRequestClaim = Pick<
  ForegroundRunRequestBootstrapResult,
  'abortController' | 'foregroundRequestId'
>;

export type PreparedForegroundRunBootstrap = {
  claim: ForegroundRunRequestClaim;
  bootstrap: ForegroundRunBootstrapSelection;
};

function normalizedReuseRunId(options: RunChatOptions | undefined): string | undefined {
  const value = options?.reuseAgentRunId?.trim();
  return value || undefined;
}

export function prepareForegroundRunRequestClaim(params: {
  createForegroundRequestId: () => string;
  options?: RunChatOptions;
  registerForegroundRequest: (requestId: string, abortController: AbortController) => void;
  shouldAutoAbortPreviousForegroundRequest: (reason: string) => void;
}): ForegroundRunRequestClaim {
  if (!normalizedReuseRunId(params.options)) {
    params.shouldAutoAbortPreviousForegroundRequest('Superseded by a new user turn.');
  }

  const abortController = new AbortController();
  const foregroundRequestId = params.createForegroundRequestId();
  params.registerForegroundRequest(foregroundRequestId, abortController);

  return {
    abortController,
    foregroundRequestId,
  };
}

export function prepareForegroundRunRequestBootstrap(params: {
  claim: ForegroundRunRequestClaim;
  conversation: Conversation | undefined;
  createAssistantMessageId: () => string;
  defaultConversationMode: Conversation['mode'];
  options?: RunChatOptions;
}):
  | { kind: 'ready'; prepared: PreparedForegroundRunBootstrap }
  | {
      kind: 'reuse_unavailable';
      runId: string;
    } {
  const requestedReuseRunId = normalizedReuseRunId(params.options);
  const bootstrap = buildForegroundRunBootstrapSelection({
    conversation: params.conversation,
    createAssistantMessageId: params.createAssistantMessageId,
    defaultConversationMode: params.defaultConversationMode,
    reuseAgentRunId: requestedReuseRunId,
    reuseAssistantDraft: params.options?.reuseAssistantDraft,
  });
  if (requestedReuseRunId && bootstrap.existingRun?.id !== requestedReuseRunId) {
    return { kind: 'reuse_unavailable', runId: requestedReuseRunId };
  }

  return { kind: 'ready', prepared: { claim: params.claim, bootstrap } };
}

export function completeForegroundRunRequestBootstrap(params: {
  prepared: PreparedForegroundRunBootstrap;
  conversation: Conversation | undefined;
  startTrackedRun: (bootstrap: ForegroundRunBootstrapSelection) => string | undefined;
  supersedeExistingRun: (runId: string, runningWorkerCount: number) => void;
}): ForegroundRunRequestBootstrapResult {
  const { bootstrap, claim } = params.prepared;

  if (bootstrap.supersededRun && params.conversation) {
    params.supersedeExistingRun(bootstrap.supersededRun.id, bootstrap.supersededRunningWorkerCount);
  }

  return {
    ...claim,
    assistantMessageId: bootstrap.assistantMessageId,
    bootstrap,
    initialCounters: {
      assistantTurns: (bootstrap.existingRun?.summary.assistantTurns ?? 0) + 1,
      startedTools: bootstrap.existingRun?.summary.startedTools ?? 0,
      completedTools: bootstrap.existingRun?.summary.completedTools ?? 0,
      failedTools: bootstrap.existingRun?.summary.failedTools ?? 0,
      spawnedSubAgents: bootstrap.existingRun?.summary.spawnedSubAgents ?? 0,
      runStartedAt: bootstrap.existingRun?.createdAt ?? Date.now(),
    },
    trackedAgentRunId: params.startTrackedRun(bootstrap),
  };
}
