// ---------------------------------------------------------------------------
// Kavi — Enhanced Exec Tool (Background SSH, Approval Gates)
// ---------------------------------------------------------------------------
// Extends the base SSH exec with background execution mode, output streaming,
// and integration with the approval store for sensitive operations.

import { generateId } from '../../utils/id';
import { useRemoteStore } from '../../services/remote/store';
import { needsApprovalWithContext, requestToolApproval } from '../../services/remote/approvalStore';
import { executeSshCommand, resolveSshTarget } from '../../services/ssh/connector';
import { unrefTimerIfSupported } from '../../utils/timers';

// ── Types ────────────────────────────────────────────────────────────────

export interface BackgroundExecResult {
  jobId: string;
  status: 'started' | 'rejected' | 'error';
  message: string;
}

export interface ExecOptions {
  /** Run in background (non-blocking) */
  background?: boolean;
  /** Timeout in ms for foreground execution (default 30s) */
  timeoutMs?: number;
  /** Working directory */
  cwd?: string;
  /** Target SSH config ID */
  targetId?: string;
}

// ── Background task tracking ─────────────────────────────────────────────

interface BackgroundTask {
  jobId: string;
  command: string;
  targetId?: string;
  startedAt: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  output: string;
  error?: string;
}

const backgroundTasks = new Map<string, BackgroundTask>();

// ── Core execution ──────────────────────────────────────────────────────

/**
 * Execute a command with enhanced features: approval check, background mode.
 */
export async function enhancedExec(command: string, options: ExecOptions = {}): Promise<string> {
  // 1. Check approval gate
  if (
    needsApprovalWithContext('ssh_exec', { command, cwd: options.cwd, targetId: options.targetId })
  ) {
    const decision = await requestToolApproval({
      toolName: 'ssh_exec',
      targetId: options.targetId,
      description: `Execute command: ${command}${options.cwd ? ` (in ${options.cwd})` : ''}`,
    });

    if (decision !== 'approved') {
      return JSON.stringify({
        status: 'rejected',
        reason: decision,
        command,
      });
    }
  }

  // 2. Background mode
  if (options.background) {
    return startBackgroundExec(command, options);
  }

  // 3. Foreground execution with timeout
  return executeForeground(command, options);
}

async function executeForeground(command: string, options: ExecOptions): Promise<string> {
  const target = await resolveSshTarget(options.targetId);

  const timeoutMs = options.timeoutMs ?? 30_000;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    const result = await Promise.race([
      executeSshCommand(target, command, options.cwd),
      new Promise<string>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Command timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        unrefTimerIfSupported(timeout);
      }),
    ]);

    return JSON.stringify({
      status: 'executed',
      targetId: target.id,
      command,
      cwd: options.cwd || target.remoteRoot || null,
      output: result,
    });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function startBackgroundExec(command: string, options: ExecOptions): Promise<string> {
  const jobId = `bg-exec-${generateId()}`;
  const remoteStore = useRemoteStore.getState();

  // Create remote job for tracking
  remoteStore.createJob({
    jobType: 'agent-job',
    targetId: options.targetId,
    status: 'running',
    requestedBy: 'agent',
    executionSurface: 'ssh',
    summary: `Background: ${command}`,
  });

  const task: BackgroundTask = {
    jobId,
    command,
    targetId: options.targetId,
    startedAt: Date.now(),
    status: 'running',
    output: '',
  };
  backgroundTasks.set(jobId, task);

  // Start async execution (non-blocking)
  execInBackground(jobId, command, options).catch((err: unknown) => {
    const t = backgroundTasks.get(jobId);
    if (t) {
      t.status = 'failed';
      t.error = err instanceof Error ? err.message : String(err);
    }
  });

  return JSON.stringify({
    status: 'started',
    jobId,
    command,
    message:
      'Command started in background. Use ssh_background_job_status or ssh_background_job_wait to monitor it.',
  });
}

async function execInBackground(
  jobId: string,
  command: string,
  options: ExecOptions,
): Promise<void> {
  const task = backgroundTasks.get(jobId);
  if (!task) return;

  try {
    const target = await resolveSshTarget(options.targetId);
    const output = await executeSshCommand(target, command, options.cwd);

    task.status = 'completed';
    task.output = output;

    useRemoteStore.getState().updateJob(jobId, {
      status: 'completed',
      progressText: output.slice(0, 200),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    task.status = 'failed';
    task.error = message;

    useRemoteStore.getState().updateJob(jobId, {
      status: 'failed',
      error: message,
    });
  }
}

// ── Background job management ───────────────────────────────────────────

export function getBackgroundJob(jobId: string): BackgroundTask | undefined {
  return backgroundTasks.get(jobId);
}

export function listBackgroundJobs(): BackgroundTask[] {
  return Array.from(backgroundTasks.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export function cancelBackgroundJob(jobId: string): boolean {
  const task = backgroundTasks.get(jobId);
  if (!task || task.status !== 'running') return false;
  task.status = 'cancelled';
  return true;
}

export function cleanupBackgroundJobs(maxAgeMs = 3600_000): number {
  const now = Date.now();
  let count = 0;
  for (const [id, task] of backgroundTasks) {
    if (now - task.startedAt > maxAgeMs && task.status !== 'running') {
      backgroundTasks.delete(id);
      count++;
    }
  }
  return count;
}
