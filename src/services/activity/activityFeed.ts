import type { CronJob, SchedulerTerminalReport } from '../cron/types';
import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { RemoteApprovalRequest } from '../../types/remote';
import type { ExecutionTrace } from '../scheduler/traceStore';
import { redactSensitiveText } from '../security/toolDetailRedaction';
import {
  selectActiveConversationExecutionState,
  selectAgentRunExecutionPresentation,
} from '../agents/activeConversationExecutionState';

export type ActivityFilter = 'pending' | 'active' | 'recent' | 'automations';
export type ActivityItemKind = 'approval' | 'assistant-run' | 'automation' | 'automation-result';
export type ActivityItemStatus =
  | 'waiting'
  | 'active'
  | 'needs-attention'
  | 'scheduled'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'denied'
  | 'expired'
  | 'interrupted'
  | 'retrying';

export interface ActivityItem {
  id: string;
  kind: ActivityItemKind;
  status: ActivityItemStatus;
  title: string;
  detail?: string;
  timestamp: number;
  sourceConversationId?: string;
  sourceConversationTitle?: string;
  approvalId?: string;
  agentRunId?: string;
  automationId?: string;
  artifactPaths?: string[];
  nextOccurrenceAt?: number;
}

export interface ActivityFeedInput {
  approvalRequests: readonly RemoteApprovalRequest[];
  conversations: readonly Conversation[];
  foregroundConversationIds?: ReadonlySet<string>;
  liveWorkerRunKeys?: ReadonlySet<string>;
  schedulerJobs: readonly CronJob[];
  schedulerReports: readonly SchedulerTerminalReport[];
  schedulerTraces?: readonly ExecutionTrace[];
}

const MAX_ACTIVITY_TEXT_LENGTH = 180;
const PENDING_STATUSES = new Set<ActivityItemStatus>(['waiting', 'needs-attention']);
const ACTIVE_STATUSES = new Set<ActivityItemStatus>(['active', 'retrying']);
const RECENT_STATUSES = new Set<ActivityItemStatus>([
  'completed',
  'failed',
  'denied',
  'expired',
  'interrupted',
]);

function safeActivityText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return redactSensitiveText(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_ACTIVITY_TEXT_LENGTH);
}

function getRunStatus(
  run: AgentRun,
  conversation: Conversation,
  foregroundConversationIds: ReadonlySet<string>,
  liveWorkerRunKeys: ReadonlySet<string>,
): ActivityItemStatus {
  switch (run.status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'interrupted';
    default: {
      const executionState = selectActiveConversationExecutionState(
        conversation,
        { hasActiveRequest: foregroundConversationIds.has(conversation.id) },
        {
          hasLiveBackgroundWorker: liveWorkerRunKeys.has(
            getActivityRunKey(conversation.id, run.id),
          ),
        },
      );
      const presentation = selectAgentRunExecutionPresentation(run, executionState);
      if (presentation === 'running') return 'active';
      if (presentation === 'waiting_for_user') return 'waiting';
      return 'needs-attention';
    }
  }
}

function getRunDetail(run: AgentRun): string | undefined {
  const activePhase = run.phases.find((phase) => phase.status === 'active');
  const detail = safeActivityText(run.latestSummary || activePhase?.detail || activePhase?.title);
  return detail || undefined;
}

function getRunArtifactPaths(run: AgentRun): string[] | undefined {
  const paths = Array.from(
    new Set(
      (run.evidence ?? [])
        .filter((entry) => entry.kind === 'artifact' && entry.artifactWorkspacePath)
        .map((entry) => entry.artifactWorkspacePath as string),
    ),
  );
  return paths.length > 0 ? paths : undefined;
}

function getApprovalStatus(status: RemoteApprovalRequest['status']): ActivityItemStatus {
  switch (status) {
    case 'approved':
      return 'completed';
    case 'rejected':
      return 'denied';
    case 'expired':
      return 'expired';
    default:
      return 'waiting';
  }
}

function getAutomationStatus(job: CronJob): ActivityItemStatus {
  if (job.runningAttemptId) return 'active';
  if (!job.enabled) return 'paused';
  if (job.lastFailureAtMs && (!job.lastSuccessAtMs || job.lastFailureAtMs >= job.lastSuccessAtMs)) {
    return job.nextRetryAtMs ? 'retrying' : 'failed';
  }
  return 'scheduled';
}

function getAutomationReportStatus(status: SchedulerTerminalReport['status']): ActivityItemStatus {
  if (status === 'success') return 'completed';
  if (status === 'retrying') return 'retrying';
  return 'failed';
}

function getAutomationTraceStatus(status: ExecutionTrace['status']): ActivityItemStatus {
  if (status === 'success') return 'completed';
  if (status === 'retrying') return 'retrying';
  if (status === 'skipped') return 'interrupted';
  return 'failed';
}

function sortActivityItems(left: ActivityItem, right: ActivityItem): number {
  const statusWeight = (status: ActivityItemStatus): number => {
    if (PENDING_STATUSES.has(status)) return 0;
    if (ACTIVE_STATUSES.has(status)) return 1;
    return 2;
  };
  const weightDifference = statusWeight(left.status) - statusWeight(right.status);
  if (weightDifference !== 0) return weightDifference;
  return right.timestamp - left.timestamp || left.id.localeCompare(right.id);
}

export function getActivityRunKey(conversationId: string, runId: string): string {
  return `${conversationId}:${runId}`;
}

export function buildActivityFeed(input: ActivityFeedInput): ActivityItem[] {
  const foregroundConversationIds = input.foregroundConversationIds ?? new Set<string>();
  const liveWorkerRunKeys = input.liveWorkerRunKeys ?? new Set<string>();
  const conversationsById = new Map(
    input.conversations.map((conversation) => [conversation.id, conversation]),
  );
  const items: ActivityItem[] = [];

  for (const request of input.approvalRequests) {
    const job = request.jobId
      ? input.schedulerJobs.find((candidate) => candidate.id === request.jobId)
      : undefined;
    const detail = safeActivityText(request.description);
    items.push({
      id: `approval:${request.id}`,
      kind: 'approval',
      status: getApprovalStatus(request.status),
      title: safeActivityText(request.title),
      ...(detail ? { detail } : {}),
      timestamp: request.resolvedAt ?? request.requestedAt,
      approvalId: request.id,
      ...(job ? { automationId: job.id } : {}),
    });
  }

  for (const conversation of input.conversations) {
    const sourceConversationTitle = safeActivityText(conversation.title);
    let hasVisibleActiveRun = false;
    for (const run of conversation.agentRuns ?? []) {
      const status = getRunStatus(run, conversation, foregroundConversationIds, liveWorkerRunKeys);
      if (status === 'active') hasVisibleActiveRun = true;
      const title = safeActivityText(run.goal) || sourceConversationTitle;
      const detail = getRunDetail(run);
      const artifactPaths = getRunArtifactPaths(run);
      items.push({
        id: `assistant-run:${conversation.id}:${run.id}`,
        kind: 'assistant-run',
        status,
        title,
        ...(detail ? { detail } : {}),
        timestamp: run.completedAt ?? run.updatedAt ?? run.createdAt,
        sourceConversationId: conversation.id,
        ...(sourceConversationTitle ? { sourceConversationTitle } : {}),
        agentRunId: run.id,
        ...(artifactPaths ? { artifactPaths } : {}),
      });
    }

    if (foregroundConversationIds.has(conversation.id) && !hasVisibleActiveRun) {
      items.push({
        id: `assistant-run:${conversation.id}:foreground`,
        kind: 'assistant-run',
        status: 'active',
        title: sourceConversationTitle,
        timestamp: conversation.updatedAt,
        sourceConversationId: conversation.id,
        ...(sourceConversationTitle ? { sourceConversationTitle } : {}),
      });
    }
  }

  for (const job of input.schedulerJobs) {
    items.push({
      id: `automation:${job.id}`,
      kind: 'automation',
      status: getAutomationStatus(job),
      title: safeActivityText(job.name),
      timestamp: job.updatedAtMs,
      automationId: job.id,
      ...(job.runningConversationId ? { sourceConversationId: job.runningConversationId } : {}),
      ...(job.nextRunAtMs ? { nextOccurrenceAt: job.nextRunAtMs } : {}),
    });
  }

  const schedulerTraces = input.schedulerTraces ?? [];
  const tracedReportIds = new Set(
    schedulerTraces
      .map((trace) => (trace.id.startsWith('trace-') ? trace.id.slice('trace-'.length) : ''))
      .filter(Boolean),
  );

  for (const trace of schedulerTraces) {
    const detail = safeActivityText(trace.error || trace.warnings?.[0]);
    items.push({
      id: `automation-result:${trace.id}`,
      kind: 'automation-result',
      status: getAutomationTraceStatus(trace.status),
      title: safeActivityText(trace.jobName),
      ...(detail ? { detail } : {}),
      timestamp: trace.completedAt,
      automationId: trace.jobId,
    });
  }

  for (const report of input.schedulerReports) {
    if (tracedReportIds.has(report.id)) continue;
    const conversation = report.conversationId
      ? conversationsById.get(report.conversationId)
      : undefined;
    const detail = safeActivityText(report.error || report.warnings?.[0]);
    const sourceConversationTitle = safeActivityText(conversation?.title);
    items.push({
      id: `automation-result:${report.id}`,
      kind: 'automation-result',
      status: getAutomationReportStatus(report.status),
      title: safeActivityText(report.jobName),
      ...(detail ? { detail } : {}),
      timestamp: report.completedAtMs,
      automationId: report.jobId,
      ...(report.conversationId ? { sourceConversationId: report.conversationId } : {}),
      ...(sourceConversationTitle ? { sourceConversationTitle } : {}),
    });
  }

  return items.sort(sortActivityItems);
}

export function filterActivityFeed(
  items: readonly ActivityItem[],
  filter: ActivityFilter,
): ActivityItem[] {
  switch (filter) {
    case 'pending':
      return items.filter((item) => PENDING_STATUSES.has(item.status));
    case 'active':
      return items.filter((item) => ACTIVE_STATUSES.has(item.status));
    case 'automations':
      return items.filter(
        (item) => item.kind === 'automation' || item.kind === 'automation-result',
      );
    default:
      return items.filter((item) => RECENT_STATUSES.has(item.status));
  }
}

export function countActivityFeed(items: readonly ActivityItem[]): Record<ActivityFilter, number> {
  return {
    pending: filterActivityFeed(items, 'pending').length,
    active: filterActivityFeed(items, 'active').length,
    recent: filterActivityFeed(items, 'recent').length,
    automations: filterActivityFeed(items, 'automations').length,
  };
}
