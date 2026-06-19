import type { Message } from '../../types/message';
import type { SubAgentActivityEntry, SubAgentSnapshot } from '../../types/subAgent';
import {
  cloneAttachments,
  collectResolvedAttachments,
  stripAttachmentPayloads,
} from '../../utils/messageAttachments';
import { OUTPUT_TRUNCATION } from './lifecycle/runConfig';
import { normalizePreviewText } from './lifecycle/runText';
import { truncateTranscriptText } from './lifecycle/sessionContextMessages';

type ProgressChanges<TAgent extends SubAgentSnapshot> = Partial<
  Pick<
    TAgent,
    | 'currentActivity'
    | 'activeToolName'
    | 'activeToolStartedAt'
    | 'lastToolResultPreview'
    | 'launchState'
    | 'modelResponsePendingSince'
    | 'taskLedger'
  >
>;

type ProgressOptions = {
  activityKind?: SubAgentActivityEntry['kind'];
  activityText?: string;
  announce?: boolean;
  markProgress?: boolean;
};

function cloneTaskLedgerItems<TAgent extends SubAgentSnapshot>(
  taskLedger: TAgent['taskLedger'],
): TAgent['taskLedger'] {
  return taskLedger?.map((item) => ({
    ...item,
    ...(item.successCriteria ? { successCriteria: [...item.successCriteria] } : {}),
    ...(item.dependencies ? { dependencies: [...item.dependencies] } : {}),
    ...(item.requirements ? { requirements: [...item.requirements] } : {}),
    ...(item.requiredCapabilities ? { requiredCapabilities: [...item.requiredCapabilities] } : {}),
    ...(item.completedEvidence ? { completedEvidence: [...item.completedEvidence] } : {}),
  })) as TAgent['taskLedger'];
}

export function createSubAgentStateRuntime<TAgent extends SubAgentSnapshot>(params: {
  cloneAgent: (agent: TAgent) => TAgent;
  sanitizeTranscriptMessage: (message: Message) => Message;
  clearQueuedLaunchWatch: (sessionId: string) => void;
  scheduleProgressAnnouncement: (agent: TAgent) => void;
  maxActivityLogEntries: number;
  maxActivityTextChars: number;
  maxToolResultPreviewChars: number;
  finalizationMaxTranscriptMessages: number;
}) {
  function sanitizePersistedAgentSnapshot(agent: TAgent): TAgent {
    const sanitizedArtifacts = stripAttachmentPayloads(agent.artifacts);

    return {
      ...params.cloneAgent(agent),
      ...(agent.name ? { name: normalizePreviewText(agent.name, 120) } : {}),
      ...(agent.output ? { output: truncateTranscriptText(agent.output, OUTPUT_TRUNCATION) } : {}),
      ...(agent.toolsUsed ? { toolsUsed: agent.toolsUsed.slice(-10) } : {}),
      ...(agent.currentActivity
        ? {
            currentActivity: normalizePreviewText(
              agent.currentActivity,
              params.maxActivityTextChars,
            ),
          }
        : {}),
      ...(agent.activeToolName
        ? { activeToolName: normalizePreviewText(agent.activeToolName, 120) }
        : {}),
      ...(agent.lastToolResultPreview
        ? {
            lastToolResultPreview: normalizePreviewText(
              agent.lastToolResultPreview,
              params.maxToolResultPreviewChars,
            ),
          }
        : {}),
      ...(agent.activityLog
        ? {
            activityLog: agent.activityLog.slice(-params.maxActivityLogEntries).map((entry) => ({
              timestamp: entry.timestamp,
              kind: entry.kind,
              text: normalizePreviewText(entry.text, params.maxActivityTextChars) || entry.text,
            })),
          }
        : {}),
      ...(sanitizedArtifacts ? { artifacts: sanitizedArtifacts } : {}),
    };
  }

  function refreshSubAgentArtifacts(agent: TAgent, messages: Message[]): void {
    const artifacts = collectResolvedAttachments(messages);
    agent.artifacts = artifacts?.length ? cloneAttachments(artifacts) : undefined;
  }

  function appendTranscriptMessage(messages: Message[], message: Message): void {
    const sanitized = params.sanitizeTranscriptMessage(message);
    const hasRenderableContent = !!sanitized.content.trim();
    const hasToolCalls = (sanitized.toolCalls?.length || 0) > 0;
    if (!hasRenderableContent && !hasToolCalls && sanitized.role !== 'tool') {
      return;
    }

    messages.push(sanitized);
    if (messages.length > params.finalizationMaxTranscriptMessages) {
      messages.splice(1, messages.length - params.finalizationMaxTranscriptMessages);
    }
  }

  function appendActivity(
    agent: TAgent,
    kind: SubAgentActivityEntry['kind'],
    text: string | undefined,
  ): void {
    const normalized = normalizePreviewText(text, params.maxToolResultPreviewChars);
    if (!normalized) {
      return;
    }

    const nextEntry: SubAgentActivityEntry = {
      timestamp: Date.now(),
      kind,
      text: normalized,
    };

    const previousEntries = agent.activityLog || [];
    const lastEntry = previousEntries[previousEntries.length - 1];
    const dedupedEntries =
      lastEntry?.kind === nextEntry.kind && lastEntry.text === nextEntry.text
        ? previousEntries
        : [...previousEntries, nextEntry];

    agent.activityLog = dedupedEntries.slice(-params.maxActivityLogEntries);
  }

  function updateAgentProgress(
    agent: TAgent,
    changes: ProgressChanges<TAgent>,
    options?: ProgressOptions,
  ): void {
    const now = Date.now();

    if (Object.prototype.hasOwnProperty.call(changes, 'currentActivity')) {
      agent.currentActivity = normalizePreviewText(
        changes.currentActivity,
        params.maxToolResultPreviewChars,
      );
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'activeToolName')) {
      agent.activeToolName = changes.activeToolName;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'activeToolStartedAt')) {
      agent.activeToolStartedAt = changes.activeToolStartedAt;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'lastToolResultPreview')) {
      agent.lastToolResultPreview = normalizePreviewText(
        changes.lastToolResultPreview,
        params.maxToolResultPreviewChars,
      );
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'modelResponsePendingSince')) {
      agent.modelResponsePendingSince =
        typeof changes.modelResponsePendingSince === 'number'
          ? changes.modelResponsePendingSince
          : undefined;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'taskLedger')) {
      agent.taskLedger = cloneTaskLedgerItems(changes.taskLedger);
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'launchState')) {
      agent.launchState = changes.launchState;
      if (changes.launchState !== 'queued') {
        params.clearQueuedLaunchWatch(agent.sessionId);
      }
    }

    agent.updatedAt = now;
    if (options?.markProgress !== false) {
      agent.lastProgressAt = now;
    }

    if (options?.activityKind && options.activityText) {
      appendActivity(agent, options.activityKind, options.activityText);
    }

    if (options?.announce !== false) {
      params.scheduleProgressAnnouncement(agent);
    }
  }

  function markModelResponseObserved(agent: TAgent): void {
    if (agent.modelResponsePendingSince == null) {
      return;
    }

    updateAgentProgress(
      agent,
      {
        modelResponsePendingSince: undefined,
        launchState: 'active',
      } as ProgressChanges<TAgent>,
      {
        announce: false,
      },
    );
  }

  return {
    sanitizePersistedAgentSnapshot,
    refreshSubAgentArtifacts,
    appendTranscriptMessage,
    appendActivity,
    updateAgentProgress,
    markModelResponseObserved,
  };
}
