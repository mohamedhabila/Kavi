import {
  CONV_ID,
  setupToolDispatcherHarness,
  type ToolDispatcherHarness,
} from '../helpers/toolDispatcherHarness';
import type { ToolRuntimeOutcome } from '../../src/types/toolRuntimeOutcome';

let executeTool: ToolDispatcherHarness['executeToolInner'];
let builtinMod: ToolDispatcherHarness['builtinMod'];
let executeNativeTool: ToolDispatcherHarness['executeNativeTool'];
let mockRunJobNow: ToolDispatcherHarness['mockRunJobNow'];
let mockDeleteScheduledJob: ToolDispatcherHarness['mockDeleteScheduledJob'];
let mockCreateScheduledJob: ToolDispatcherHarness['mockCreateScheduledJob'];
let mockListScheduledJobs: ToolDispatcherHarness['mockListScheduledJobs'];
let mockSetScheduledJobEnabled: ToolDispatcherHarness['mockSetScheduledJobEnabled'];
let mockUpdateScheduledJob: ToolDispatcherHarness['mockUpdateScheduledJob'];
let mockGetJob: ToolDispatcherHarness['mockGetJob'];
let mockExecutePython: ToolDispatcherHarness['mockExecutePython'];
let mockRecordAgentRunEvidence: ToolDispatcherHarness['mockRecordAgentRunEvidence'];

function expectCompletedExecution(result: ToolRuntimeOutcome, output: string): void {
  expect(result.status).toBe('completed');
  expect(JSON.parse(result.content)).toEqual(
    expect.objectContaining({
      status: 'completed',
      workspaceMutationState: 'none_observed',
      output,
    }),
  );
}

beforeEach(() => {
  const harness = setupToolDispatcherHarness();
  executeTool = harness.executeToolInner;
  builtinMod = harness.builtinMod;
  executeNativeTool = harness.executeNativeTool;
  mockRunJobNow = harness.mockRunJobNow;
  mockDeleteScheduledJob = harness.mockDeleteScheduledJob;
  mockCreateScheduledJob = harness.mockCreateScheduledJob;
  mockListScheduledJobs = harness.mockListScheduledJobs;
  mockSetScheduledJobEnabled = harness.mockSetScheduledJobEnabled;
  mockUpdateScheduledJob = harness.mockUpdateScheduledJob;
  mockGetJob = harness.mockGetJob;
  mockExecutePython = harness.mockExecutePython;
  mockRecordAgentRunEvidence = harness.mockRecordAgentRunEvidence;
});

describe('executeToolInner — raw core tools routing', () => {
  it('routes memory_search with the shared conversation scope', async () => {
    const result = await executeTool('memory_search', '{"query":"state"}', CONV_ID);

    expect(result).toEqual({ status: 'completed', content: JSON.stringify({ status: 'ok' }) });
    expect(builtinMod.executeMemorySearch).toHaveBeenCalledWith(
      { query: 'state' },
      {
        memoryConversationId: CONV_ID,
        sourceThreadId: CONV_ID,
        personaId: 'default',
        taskId: null,
      },
    );
  });

  it('normalizes python file output without store evidence writes', async () => {
    mockExecutePython.mockResolvedValueOnce({
      success: true,
      output: 'analysis complete',
      files: [{ path: 'reports/analysis.json', contentBase64: 'e30=' }],
    });

    const result = await executeTool(
      'python',
      JSON.stringify({ code: 'print("analysis")' }),
      CONV_ID,
      {
        workspaceConversationId: CONV_ID,
      },
    );

    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print("analysis")',
      }),
    );
    expect(mockRecordAgentRunEvidence).not.toHaveBeenCalled();

    expect(result.status).toBe('completed');
    expect(JSON.parse(result.content)).toEqual(
      expect.objectContaining({
        status: 'completed',
        fileCount: 1,
      }),
    );
  });

  it('handles invalid JSON args gracefully', async () => {
    const result = await executeTool('read_file', '{invalid json', CONV_ID);
    // Robust arg parsing falls back to {} — tool runs with no args
    expect(result.status).toBe('failed');
  });

  it('routes cron create', async () => {
    const result = await executeTool(
      'cron',
      '{"action":"create","schedule":"0 * * * *","prompt":"test"}',
      CONV_ID,
    );
    const parsed = JSON.parse(result.content);
    expect(result.status).toBe('completed');
    expect(parsed.status).toBe('task_created');
    expect(parsed.id).toBe('job-1');
  });

  it('validates cron create arguments and preserves name and timezone', async () => {
    const invalid = await executeTool('cron', '{"action":"create"}', CONV_ID);
    expect(JSON.parse(invalid.content)).toMatchObject({
      status: 'rejected',
      code: 'invalid_scheduled_job',
    });
    expect(invalid.status).toBe('failed');

    await executeTool(
      'cron',
      JSON.stringify({
        action: 'create',
        name: 'Amsterdam morning',
        schedule: '0 9 * * *',
        prompt: 'Prepare my briefing',
        timezone: 'Europe/Amsterdam',
      }),
      CONV_ID,
    );
    expect(mockCreateScheduledJob).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'Amsterdam morning',
        schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Europe/Amsterdam' },
        prompt: 'Prepare my briefing',
        mode: 'agentic',
      }),
    );
  });

  it('routes cron update through the durable command boundary', async () => {
    mockGetJob.mockReturnValueOnce({
      id: 'job-1',
      schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'UTC' },
      payload: { prompt: 'Old prompt', mode: 'agentic', model: 'model-1' },
    });

    const result = await executeTool(
      'cron',
      JSON.stringify({
        action: 'update',
        id: 'job-1',
        newName: 'Updated briefing',
        schedule: '0 9 * * *',
        prompt: 'New prompt',
      }),
      CONV_ID,
    );

    expect(result.status).toBe('completed');
    expect(JSON.parse(result.content)).toMatchObject({ status: 'updated', id: 'job-1' });
    expect(mockUpdateScheduledJob).toHaveBeenCalledWith('job-1', {
      name: 'Updated briefing',
      schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'UTC' },
      payload: { prompt: 'New prompt', mode: 'agentic', model: 'model-1' },
    });
  });

  it('routes cron list', async () => {
    mockListScheduledJobs.mockResolvedValueOnce([
      {
        id: 'job-1',
        name: 'Briefing',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        payload: { prompt: 'Prepare it', mode: 'agentic' },
        nextRetryAtMs: 200,
        lastError: 'provider unavailable',
        lastWakeError: 'notifications denied',
      },
    ] as any);
    const result = await executeTool('cron', '{"action":"list"}', CONV_ID);
    const parsed = JSON.parse(result.content);
    expect(parsed.jobs[0]).toMatchObject({
      id: 'job-1',
      mode: 'agentic',
      state: 'retry_scheduled',
      nextRunAtMs: 200,
      lastError: 'provider unavailable',
      wakeWarning: 'notifications denied',
    });
  });

  it('routes cron delete', async () => {
    const result = await executeTool('cron', '{"action":"delete","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result.content);
    expect(parsed.status).toBe('deleted');
  });

  it('refuses to delete a running scheduled job claim', async () => {
    mockDeleteScheduledJob.mockResolvedValueOnce('busy');
    const result = await executeTool('cron', '{"action":"delete","id":"job-1"}', CONV_ID);
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'rejected',
      code: 'scheduled_job_busy',
      id: 'job-1',
    });
    expect(result.status).toBe('failed');
  });

  it('routes cron enable', async () => {
    const result = await executeTool('cron', '{"action":"enable","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result.content);
    expect(parsed.status).toBe('enabled');
  });

  it('routes cron disable', async () => {
    const result = await executeTool('cron', '{"action":"disable","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result.content);
    expect(parsed.status).toBe('disabled');
  });

  it('resolves an exact unique task name before disabling', async () => {
    mockListScheduledJobs.mockResolvedValueOnce([
      {
        id: 'job-discovery',
        name: 'discovery-proof',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 * * * *' },
        payload: { prompt: 'fixture', mode: 'agentic' },
      } as any,
    ]);

    const result = await executeTool(
      'cron',
      '{"action":"disable","name":"discovery-proof"}',
      CONV_ID,
    );

    expect(result.status).toBe('completed');
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'disabled',
      id: 'job-discovery',
    });
    expect(mockSetScheduledJobEnabled).toHaveBeenCalledWith('job-discovery', false);
  });

  it('rejects an ambiguous task name before mutation', async () => {
    mockListScheduledJobs.mockResolvedValueOnce([
      { id: 'job-1', name: 'duplicate', enabled: true } as any,
      { id: 'job-2', name: 'duplicate', enabled: false } as any,
    ]);

    const result = await executeTool('cron', '{"action":"disable","name":"duplicate"}', CONV_ID);

    expect(result.status).toBe('failed');
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'rejected',
      code: 'scheduled_job_target_ambiguous',
      repair: {
        retryable: true,
        tool: 'request_clarification',
      },
    });
    expect(mockSetScheduledJobEnabled).not.toHaveBeenCalled();
  });

  it('does not report success for an unknown cron enable target', async () => {
    mockSetScheduledJobEnabled.mockResolvedValueOnce({ status: 'not_found' });
    const result = await executeTool('cron', '{"action":"enable","id":"missing"}', CONV_ID);
    expect(result.status).toBe('failed');
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'rejected',
      code: 'scheduled_job_not_found',
      id: 'missing',
    });
  });

  it('routes cron run', async () => {
    const result = await executeTool('cron', '{"action":"run","id":"job-1"}', CONV_ID);
    const parsed = JSON.parse(result.content);
    expect(parsed.status).toBe('succeeded');
    expect(mockRunJobNow).toHaveBeenCalledWith('job-1', { trigger: 'manual' });
  });

  it('preserves a terminal cron run failure instead of reporting it as triggered', async () => {
    mockRunJobNow.mockResolvedValueOnce({
      status: 'failed',
      id: 'job-1',
      name: 'test job',
      error: 'provider unavailable',
    });
    const result = await executeTool('cron', '{"action":"run","id":"job-1"}', CONV_ID);
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'error',
      code: 'scheduled_job_failed',
      error: 'provider unavailable',
      id: 'job-1',
    });
    expect(result.status).toBe('failed');
  });

  it('marks a scheduled cron retry as incomplete error-like evidence', async () => {
    mockRunJobNow.mockResolvedValueOnce({
      status: 'retrying',
      id: 'job-1',
      name: 'test job',
      error: 'temporary provider failure',
    });
    const result = await executeTool('cron', '{"action":"run","id":"job-1"}', CONV_ID);
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'error',
      code: 'scheduled_job_retrying',
      retryScheduled: true,
    });
    expect(result.status).toBe('failed');
  });

  it('marks an already-running manual cron request as incomplete evidence', async () => {
    mockRunJobNow.mockResolvedValueOnce({
      status: 'busy',
      id: 'job-1',
      name: 'test job',
      error: 'The scheduled job already has an active execution.',
    });
    const result = await executeTool('cron', '{"action":"run","id":"job-1"}', CONV_ID);
    expect(JSON.parse(result.content)).toMatchObject({
      status: 'error',
      code: 'scheduled_job_busy',
    });
    expect(result.status).toBe('failed');
  });

  it('handles cron unknown action', async () => {
    const result = await executeTool('cron', '{"action":"bogus"}', CONV_ID);
    expect(result.status).toBe('failed');
    expect(JSON.parse(result.content).code).toBe('scheduled_job_action_unknown');
  });

  it('routes notify', async () => {
    const result = await executeTool('notification_send', '{"title":"hi","body":"there"}', CONV_ID);
    const parsed = JSON.parse(result.content);
    expect(parsed.status).toBe('notification_accepted');
    expect(executeNativeTool).toHaveBeenCalledWith(
      'notification_send',
      '{"title":"hi","body":"there"}',
      undefined,
    );
  });

  it('returns error for unknown tool', async () => {
    const result = await executeTool('nonexistent_tool', '{}', CONV_ID);
    expect(result.status).toBe('failed');
    expect(result.content).toContain('unknown tool');
  });

  it('routes javascript', async () => {
    const result = await executeTool('javascript', '{"code":"return 42"}', CONV_ID);
    expectCompletedExecution(result, '42');
  });

  it('routes python through the Pyodide bridge', async () => {
    const result = await executeTool(
      'python',
      '{"code":"print(40 + 2)","packages":["numpy"]}',
      CONV_ID,
    );
    expectCompletedExecution(result, '42');
    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print(40 + 2)',
        packages: ['numpy'],
      }),
    );
    expect(mockRecordAgentRunEvidence).not.toHaveBeenCalled();
  });

  it('routes python timeout overrides through the Pyodide bridge', async () => {
    const result = await executeTool(
      'python',
      '{"code":"print(40 + 2)","timeoutMs":120000}',
      CONV_ID,
    );
    expectCompletedExecution(result, '42');
    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print(40 + 2)',
        timeoutMs: 120000,
      }),
    );
  });

  it('routes python custom package indexes through the Pyodide bridge', async () => {
    const result = await executeTool(
      'python',
      '{"code":"print(40 + 2)","packages":["requests"],"indexUrls":["https://packages.example/simple"]}',
      CONV_ID,
    );

    expectCompletedExecution(result, '42');
    expect(mockExecutePython).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'print(40 + 2)',
        packages: ['requests'],
        indexUrls: ['https://packages.example/simple'],
      }),
    );
    expect(mockRecordAgentRunEvidence).not.toHaveBeenCalled();
  });
});
