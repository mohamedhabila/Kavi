import type {
  AgentRun,
  AgentRunAsyncOperation,
  AgentRunCheckpointKind,
  AgentRunControlGraphState,
  AgentRunEvidenceEntry,
  AgentRunPlan,
} from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import { upsertAgentRunEvidenceEntries } from '../../services/agents/lifecycle/evidence';
import type { AgentRunEvidenceDraft } from '../../services/agents/lifecycle/evidenceTypes';
import { mergeAgentRunPlan } from '../../services/agents/agentRunStateModel';
import {
  areAgentRunControlGraphStatesEqual,
  normalizeAgentRunControlGraphState,
  updateAgentRunControlGraphAsyncWorkState,
} from '../../services/agents/agentControlGraphState';
import { normalizeAgentRunAsyncOperations } from '../../services/agents/agentRunAsyncState';
import {
  appendAgentCheckpoint,
  areAgentRunEvidenceEntriesEqual,
  isTargetAgentRun,
  normalizeAgentRunEvidence,
  resolveTargetAgentRunId,
} from './shared';

export function updateAgentRunAsyncWorkInConversation(
  conversation: Conversation,
  params?: {
    awaitingBackgroundWorkers?: boolean;
    checkpointDetail?: string;
    checkpointKind?: AgentRunCheckpointKind;
    checkpointTitle?: string;
    latestSummary?: string;
    pendingOperations?: AgentRunAsyncOperation[];
    timestamp?: number;
  },
  runId?: string,
): Conversation {
  const targetRunId = resolveTargetAgentRunId(conversation, runId);
  if (!targetRunId) {
    return conversation;
  }

  const hasPendingOperationsPatch = params?.pendingOperations !== undefined;
  const normalizedOperations = hasPendingOperationsPatch
    ? normalizeAgentRunAsyncOperations(params?.pendingOperations)
    : undefined;
  const timestamp = params?.timestamp ?? Date.now();
  let didUpdate = false;
  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (!isTargetAgentRun(run, targetRunId, true)) {
      return run;
    }

    const nextLatestSummary = params?.latestSummary ?? run.latestSummary;
    const nextControlGraph = updateAgentRunControlGraphAsyncWorkState(run.controlGraph, {
      ...(params?.awaitingBackgroundWorkers !== undefined
        ? { awaitingBackgroundWorkers: params.awaitingBackgroundWorkers }
        : {}),
      ...(hasPendingOperationsPatch ? { pendingOperations: normalizedOperations ?? [] } : {}),
      updatedAt: timestamp,
    });
    if (
      nextLatestSummary === run.latestSummary &&
      areAgentRunControlGraphStatesEqual(run.controlGraph, nextControlGraph) &&
      !params?.checkpointTitle
    ) {
      return run;
    }

    didUpdate = true;
    const nextRunBase: AgentRun = {
      ...run,
      updatedAt: Math.max(run.updatedAt, timestamp),
      latestSummary: nextLatestSummary,
      controlGraph: nextControlGraph,
    };

    return params?.checkpointTitle
      ? appendAgentCheckpoint(nextRunBase, {
          timestamp,
          kind: params.checkpointKind ?? 'run',
          title: params.checkpointTitle,
          detail: params.checkpointDetail ?? params.latestSummary,
        })
      : nextRunBase;
  });

  return didUpdate
    ? {
        ...conversation,
        updatedAt: Math.max(conversation.updatedAt, timestamp),
        agentRuns: nextRuns,
      }
    : conversation;
}

export function updateAgentRunControlGraphInConversation(
  conversation: Conversation,
  controlGraph: AgentRunControlGraphState | undefined,
  runId?: string,
): Conversation {
  const targetRunId = resolveTargetAgentRunId(conversation, runId);
  if (!targetRunId) {
    return conversation;
  }

  const normalizedControlGraph = normalizeAgentRunControlGraphState(controlGraph);
  const timestamp = normalizedControlGraph?.updatedAt ?? Date.now();
  let didUpdate = false;
  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (!isTargetAgentRun(run, targetRunId, true)) {
      return run;
    }

    if (areAgentRunControlGraphStatesEqual(run.controlGraph, normalizedControlGraph)) {
      return run;
    }

    didUpdate = true;
    return {
      ...run,
      updatedAt: Math.max(run.updatedAt, timestamp),
      controlGraph: normalizedControlGraph,
    };
  });

  return didUpdate
    ? {
        ...conversation,
        updatedAt: Math.max(conversation.updatedAt, timestamp),
        agentRuns: nextRuns,
      }
    : conversation;
}

export function updateAgentRunPlanInConversation(
  conversation: Conversation,
  patch: Partial<AgentRunPlan> & { timestamp?: number },
  runId?: string,
): Conversation {
  const targetRunId = resolveTargetAgentRunId(conversation, runId);
  if (!targetRunId) {
    return conversation;
  }

  const timestamp = patch.timestamp ?? Date.now();
  let didUpdate = false;
  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (!isTargetAgentRun(run, targetRunId)) {
      return run;
    }

    didUpdate = true;
    return {
      ...run,
      updatedAt: Math.max(run.updatedAt, timestamp),
      plan: mergeAgentRunPlan(run.plan, patch, run.goal, timestamp),
    };
  });

  return didUpdate
    ? {
        ...conversation,
        updatedAt: Math.max(conversation.updatedAt, timestamp),
        agentRuns: nextRuns,
      }
    : conversation;
}

export function recordAgentRunEvidenceInConversation(
  conversation: Conversation,
  entries: AgentRunEvidenceDraft | AgentRunEvidenceDraft[],
  params?: { timestamp?: number },
  runId?: string,
): { conversation: Conversation; recordedEntries: AgentRunEvidenceEntry[] | undefined } {
  const draftEntries = Array.isArray(entries) ? entries : [entries];
  const timestamp = params?.timestamp ?? Date.now();
  const targetRunId = resolveTargetAgentRunId(conversation, runId);
  if (!targetRunId) {
    return { conversation, recordedEntries: undefined };
  }

  let recordedEntries: AgentRunEvidenceEntry[] | undefined;
  let didUpdate = false;
  const nextRuns = (conversation.agentRuns ?? []).map((run) => {
    if (!isTargetAgentRun(run, targetRunId, !!runId)) {
      return run;
    }

    const nextEvidence = normalizeAgentRunEvidence(
      upsertAgentRunEvidenceEntries(run.evidence, draftEntries, timestamp),
    );

    if (areAgentRunEvidenceEntriesEqual(run.evidence, nextEvidence)) {
      recordedEntries = nextEvidence;
      return run;
    }

    didUpdate = true;
    recordedEntries = nextEvidence;
    return {
      ...run,
      updatedAt: Math.max(run.updatedAt, timestamp),
      evidence: nextEvidence,
    };
  });

  return {
    conversation: didUpdate
      ? {
          ...conversation,
          updatedAt: Math.max(conversation.updatedAt, timestamp),
          agentRuns: nextRuns,
        }
      : conversation,
    recordedEntries,
  };
}
