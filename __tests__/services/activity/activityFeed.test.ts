import {
  buildActivityFeed,
  countActivityFeed,
  filterActivityFeed,
  getActivityRunKey,
} from '../../../src/services/activity/activityFeed';
import type { AgentRun } from '../../../src/types/agentRun';
import type { Conversation } from '../../../src/types/conversation';
import type { RemoteApprovalRequest } from '../../../src/types/remote';
import type { CronJob, SchedulerTerminalReport } from '../../../src/services/cron/types';
import type { ExecutionTrace } from '../../../src/services/scheduler/traceStore';

function run(id: string, status: AgentRun['status'], updatedAt: number): AgentRun {
  return {
    id,
    userMessageId: `message-${id}`,
    goal: `Goal ${id}`,
    status,
    createdAt: updatedAt - 10,
    updatedAt,
    currentPhase: 'work',
    phases: [{ key: 'work', title: 'Working', status: 'active', updatedAt }],
    checkpoints: [],
    summary: {
      assistantTurns: 1,
      startedTools: 0,
      completedTools: 0,
      failedTools: 0,
      spawnedSubAgents: 0,
    },
  };
}

function conversation(agentRuns: AgentRun[]): Conversation {
  return {
    id: 'conversation-1',
    title: 'Trip planning',
    messages: [],
    providerId: 'provider-1',
    systemPrompt: '',
    createdAt: 1,
    updatedAt: 50,
    activeAgentRunId: agentRuns[agentRuns.length - 1]?.id,
    agentRuns,
  };
}

const approval: RemoteApprovalRequest = {
  id: 'approval-1',
  title: 'Send the itinerary',
  description: 'Share it with the calendar service',
  status: 'pending',
  requestedAt: 80,
  decisionPolicy: { persistentApproval: 'forbidden', expiryFallback: 'reject' },
};

const job: CronJob = {
  id: 'job-1',
  definitionRevision: 1,
  name: 'Morning briefing',
  enabled: true,
  createdAtMs: 10,
  updatedAtMs: 70,
  schedule: { kind: 'every', everyMs: 86_400_000 },
  sessionTarget: 'isolated',
  wakeMode: 'new',
  payload: { prompt: 'Summarize the day', mode: 'agentic' },
  nextRunAtMs: 1_000,
};

const report: SchedulerTerminalReport = {
  id: 'report-1',
  jobId: 'job-1',
  jobName: 'Morning briefing',
  status: 'success',
  notification: 'success',
  startedAtMs: 55,
  completedAtMs: 60,
  attempt: 1,
  trigger: 'scheduled',
  conversationId: 'conversation-1',
};

const trace: ExecutionTrace = {
  id: 'trace-report-1',
  jobId: 'job-1',
  jobName: 'Morning briefing',
  status: 'success',
  startedAt: 55,
  completedAt: 60,
  durationMs: 5,
  attempt: 1,
  trigger: 'scheduled',
};

describe('activity feed', () => {
  it('uses verified liveness instead of trusting a persisted running status', () => {
    const running = run('run-1', 'running', 40);
    const source = conversation([running]);

    const staleItem = buildActivityFeed({
      approvalRequests: [],
      conversations: [source],
      schedulerJobs: [],
      schedulerReports: [],
    })[0];
    const liveItem = buildActivityFeed({
      approvalRequests: [],
      conversations: [source],
      foregroundConversationIds: new Set([source.id]),
      schedulerJobs: [],
      schedulerReports: [],
    })[0];

    expect(staleItem.status).toBe('needs-attention');
    expect(liveItem.status).toBe('active');
  });

  it('combines decisions, assistant work, automations, reports, and linked creations', () => {
    const completed = run('run-complete', 'completed', 90);
    completed.completedAt = 95;
    completed.evidence = [
      {
        id: 'artifact-1',
        kind: 'artifact',
        status: 'verified',
        recorder: 'tool',
        title: 'Itinerary',
        content: 'Created',
        artifactWorkspacePath: 'travel/itinerary.pdf',
        createdAt: 90,
        updatedAt: 90,
      },
    ];

    const items = buildActivityFeed({
      approvalRequests: [approval],
      conversations: [conversation([completed])],
      schedulerJobs: [job],
      schedulerReports: [report],
    });

    expect(items.map((item) => item.kind)).toEqual([
      'approval',
      'assistant-run',
      'automation',
      'automation-result',
    ]);
    expect(items.find((item) => item.agentRunId === completed.id)?.artifactPaths).toEqual([
      'travel/itinerary.pdf',
    ]);
    expect(countActivityFeed(items)).toEqual({
      pending: 1,
      active: 0,
      recent: 2,
      automations: 2,
    });
    expect(filterActivityFeed(items, 'automations')).toHaveLength(2);
  });

  it('creates active direct-response items and redacts secrets from visible copy', () => {
    const credential = ['sk-', 'x'.repeat(24)].join('');
    const source = conversation([]);
    source.title = `Use ${credential}`;

    const items = buildActivityFeed({
      approvalRequests: [],
      conversations: [source],
      foregroundConversationIds: new Set([source.id]),
      liveWorkerRunKeys: new Set([getActivityRunKey(source.id, 'unused')]),
      schedulerJobs: [],
      schedulerReports: [],
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'assistant-run:conversation-1:foreground',
        status: 'active',
        title: 'Use [REDACTED]',
        sourceConversationTitle: 'Use [REDACTED]',
      }),
    ]);
    expect(JSON.stringify(items)).not.toContain(credential);
  });

  it('uses durable scheduler traces for history and deduplicates the delivery queue', () => {
    const items = buildActivityFeed({
      approvalRequests: [],
      conversations: [],
      schedulerJobs: [job],
      schedulerReports: [report],
      schedulerTraces: [trace],
    });

    expect(items.filter((item) => item.kind === 'automation-result')).toEqual([
      expect.objectContaining({
        id: 'automation-result:trace-report-1',
        automationId: 'job-1',
        status: 'completed',
      }),
    ]);
  });
});
