import { createScheduledJob, listScheduledJobs } from '../../services/scheduler/commands';
import type { CronSchedule } from '../../services/cron/types';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

type ScheduledJob = Awaited<ReturnType<typeof listScheduledJobs>>[number];
type ScheduledJobTargetResolution =
  | Readonly<{ status: 'resolved'; id: string; job?: ScheduledJob }>
  | Readonly<{ status: 'rejected'; outcome: ToolRuntimeOutcome }>;

export function rejectedScheduledJobOutcome(params: {
  code: string;
  error: string;
  repair?: Readonly<Record<string, unknown>>;
  details?: Readonly<Record<string, unknown>>;
}): ToolRuntimeOutcome {
  return failedToolOutcome(
    JSON.stringify({
      status: 'rejected',
      code: params.code,
      error: params.error,
      ...(params.details ?? {}),
      ...(params.repair ? { repair: params.repair } : {}),
    }),
  );
}

function normalizeScheduledJobName(value: unknown): string {
  return typeof value === 'string' ? value.trim().normalize('NFC') : '';
}

export async function resolveScheduledJobTarget(params: {
  action: string;
  id: unknown;
  name: unknown;
}): Promise<ScheduledJobTargetResolution> {
  const id = typeof params.id === 'string' ? params.id.trim() : '';
  if (id) return { status: 'resolved', id };

  const name = normalizeScheduledJobName(params.name);
  if (!name) {
    return {
      status: 'rejected',
      outcome: rejectedScheduledJobOutcome({
        code: 'scheduled_job_target_required',
        error: `A task id or exact task name is required for the ${params.action} action.`,
        repair: {
          retryable: true,
          code: 'scheduled_job_target_required',
          missingFields: ['id', 'name'],
          tool: 'cron',
          expectedShape: { action: 'list' },
          retryArguments: { action: 'list' },
        },
      }),
    };
  }

  let jobs: ScheduledJob[];
  try {
    jobs = await listScheduledJobs();
  } catch (error) {
    return {
      status: 'rejected',
      outcome: rejectedScheduledJobOutcome({
        code: 'scheduled_job_lookup_failed',
        error: error instanceof Error ? error.message : String(error),
        repair: {
          retryable: true,
          code: 'scheduled_job_lookup_failed',
          tool: 'cron',
          retryArguments: { action: 'list' },
        },
      }),
    };
  }

  const matches = jobs.filter((job) => normalizeScheduledJobName(job.name) === name);
  if (matches.length === 1) {
    return { status: 'resolved', id: matches[0].id, job: matches[0] };
  }
  if (matches.length === 0) {
    return {
      status: 'rejected',
      outcome: rejectedScheduledJobOutcome({
        code: 'scheduled_job_not_found',
        error: `No scheduled task has the exact name: ${name}`,
        details: { name },
        repair: {
          retryable: true,
          code: 'scheduled_job_not_found',
          fields: ['name'],
          tool: 'cron',
          retryArguments: { action: 'list' },
        },
      }),
    };
  }
  return {
    status: 'rejected',
    outcome: rejectedScheduledJobOutcome({
      code: 'scheduled_job_target_ambiguous',
      error: `Multiple scheduled tasks have the exact name: ${name}`,
      details: {
        name,
        matches: matches.map((job) => ({
          id: job.id,
          name: job.name,
          schedule: job.schedule,
          enabled: job.enabled,
        })),
      },
      repair: {
        retryable: true,
        code: 'scheduled_job_target_ambiguous',
        fields: ['name'],
        tool: 'request_clarification',
      },
    }),
  };
}

export type CronScheduleNormalization =
  | { ok: true; schedule: CronSchedule; echo: unknown }
  | { ok: false; error: string };

/**
 * Accepts either the current structured schedule object —
 * `{kind:'cron',expr,tz?}` | `{kind:'at',at}` | `{kind:'every',seconds}` —
 * or, for one more release, a bare cron-expression string for backward
 * compatibility. A bare string is treated as `{kind:'cron', expr: <string>}`
 * and echoed back verbatim in tool output so existing callers see no change.
 */
export function normalizeCronScheduleArg(raw: unknown, timezone: string): CronScheduleNormalization {
  if (typeof raw === 'string') {
    const expr = raw.trim();
    if (!expr) return { ok: false, error: 'schedule is required.' };
    return {
      ok: true,
      schedule: { kind: 'cron', expr, ...(timezone ? { tz: timezone } : {}) },
      echo: raw,
    };
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if (record.kind === 'cron') {
      const expr = typeof record.expr === 'string' ? record.expr.trim() : '';
      if (!expr) return { ok: false, error: 'schedule.expr is required for kind "cron".' };
      const tz = typeof record.tz === 'string' && record.tz.trim() ? record.tz.trim() : timezone || undefined;
      const schedule: CronSchedule = { kind: 'cron', expr, ...(tz ? { tz } : {}) };
      return { ok: true, schedule, echo: schedule };
    }
    if (record.kind === 'at') {
      const at = typeof record.at === 'string' ? record.at.trim() : '';
      if (!at) return { ok: false, error: 'schedule.at is required for kind "at".' };
      const schedule: CronSchedule = { kind: 'at', at };
      return { ok: true, schedule, echo: schedule };
    }
    if (record.kind === 'every') {
      const seconds =
        typeof record.seconds === 'number' && Number.isFinite(record.seconds) ? record.seconds : NaN;
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return { ok: false, error: 'schedule.seconds must be a positive number for kind "every".' };
      }
      const schedule: CronSchedule = { kind: 'every', everyMs: Math.round(seconds * 1000) };
      return { ok: true, schedule, echo: schedule };
    }
    return { ok: false, error: 'schedule.kind must be one of cron, at, every.' };
  }

  return { ok: false, error: 'schedule is required.' };
}

export async function executeCreateTask(args: {
  schedule?: unknown;
  prompt?: unknown;
  name?: unknown;
  timezone?: unknown;
  mode?: unknown;
}): Promise<ToolRuntimeOutcome> {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const timezone = typeof args.timezone === 'string' ? args.timezone.trim() : '';
  if (args.mode !== undefined && args.mode !== 'agentic' && args.mode !== 'chitchat') {
    return rejectedScheduledJobOutcome({
      code: 'invalid_scheduled_job',
      error: 'mode must be agentic or chitchat.',
      repair: {
        retryable: true,
        code: 'invalid_scheduled_job',
        invalidFields: ['mode'],
      },
    });
  }
  const mode = args.mode === 'chitchat' ? 'chitchat' : 'agentic';
  const hasSchedule =
    typeof args.schedule === 'string' ? args.schedule.trim().length > 0 : args.schedule != null;
  if (!hasSchedule || !prompt) {
    const missingFields = [!hasSchedule ? 'schedule' : '', !prompt ? 'prompt' : ''].filter(Boolean);
    return rejectedScheduledJobOutcome({
      code: 'invalid_scheduled_job',
      error: 'Both schedule and prompt are required to create a scheduled job.',
      repair: {
        retryable: true,
        code: 'invalid_scheduled_job',
        missingFields,
      },
    });
  }

  const normalized = normalizeCronScheduleArg(args.schedule, timezone);
  if (!normalized.ok) {
    return rejectedScheduledJobOutcome({
      code: 'invalid_scheduled_job',
      error: normalized.error,
      repair: { retryable: true, code: 'invalid_scheduled_job', invalidFields: ['schedule'] },
    });
  }

  try {
    const created = await createScheduledJob({
      name: name || prompt.slice(0, 60),
      schedule: normalized.schedule,
      prompt,
      mode,
    });
    return completedToolOutcome(
      JSON.stringify({
        status: 'task_created',
        id: created.id,
        schedule: normalized.echo,
        prompt,
        ...(timezone ? { timezone } : {}),
        ...(created.warning ? { warning: created.warning } : {}),
      }),
    );
  } catch (error) {
    return failedToolOutcome(
      JSON.stringify({
        status: 'error',
        code: 'scheduled_job_create_failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
