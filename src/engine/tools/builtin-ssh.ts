import {
  deleteSshPath,
  executeSshCommand,
  listSshDirectory,
  makeSshDirectory,
  readSshTextFile,
  renameSshPath,
  resolveSshTarget,
  writeSshTextFile,
} from '../../services/ssh/connector';
import {
  normalizeSshExecResult,
  normalizeSshListResult,
  normalizeSshMutationResult,
  normalizeSshReadResult,
} from './resultNormalization/sshResult';
import { enhancedExec, getBackgroundJob } from './enhancedExec';
import { runAsyncPollLoop } from '../asyncTracking/pollLoop';
import { persistWorkingDirectory } from './sshWorkingDirectoryPersistence';
export { getLastWorkingDirectory } from './sshWorkingDirectoryPersistence';

export async function executeSshExec(args: {
  targetId?: string;
  command: string;
  cwd?: string;
  background?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  if (args.background || args.timeoutMs) {
    return enhancedExec(args.command, {
      background: args.background,
      timeoutMs: args.timeoutMs,
      cwd: args.cwd,
      targetId: args.targetId,
    });
  }

  const target = await resolveSshTarget(args.targetId);
  const output = await executeSshCommand(target, args.command, args.cwd);

  if (args.cwd) {
    await persistWorkingDirectory(target.id, args.cwd);
  }

  return normalizeSshExecResult({
    targetId: target.id,
    command: args.command,
    cwd: args.cwd || target.remoteRoot || null,
    output,
  });
}

function buildSshBackgroundJobResult(
  jobId: string,
  options?: {
    status?: string;
    command?: string;
    targetId?: string;
    startedAt?: number;
    output?: string;
    error?: string;
    timedOut?: boolean;
  },
): string {
  const output = typeof options?.output === 'string' ? options.output.trim() : '';
  const outputExcerpt = output
    ? output.length <= 2000
      ? output
      : `${output.slice(0, 1997).trimEnd()}...`
    : undefined;
  const normalizedStatus = typeof options?.status === 'string' ? options.status : 'unknown';
  const summary =
    normalizedStatus === 'running'
      ? `SSH background job ${jobId} is still running.`
      : normalizedStatus === 'completed'
        ? `SSH background job ${jobId} completed.`
        : normalizedStatus === 'cancelled'
          ? `SSH background job ${jobId} was cancelled.`
          : normalizedStatus === 'failed'
            ? `SSH background job ${jobId} failed.`
            : `SSH background job ${jobId} status: ${normalizedStatus}.`;

  return JSON.stringify({
    jobId,
    status: normalizedStatus,
    summary,
    ...(typeof options?.command === 'string' ? { command: options.command } : {}),
    ...(typeof options?.targetId === 'string' ? { targetId: options.targetId } : {}),
    ...(typeof options?.startedAt === 'number' ? { startedAt: options.startedAt } : {}),
    ...(outputExcerpt ? { outputExcerpt } : {}),
    ...(typeof options?.error === 'string' && options.error.trim() ? { error: options.error } : {}),
    ...(options?.timedOut ? { timedOut: true } : {}),
    guidance:
      normalizedStatus === 'running'
        ? 'Continue with ssh_background_job_wait or ssh_background_job_status until the job reaches a terminal state before finalizing your answer.'
        : undefined,
  });
}

export async function executeSshBackgroundJobStatus(args: { jobId: string }): Promise<string> {
  const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : '';
  if (!jobId) {
    return JSON.stringify({
      status: 'error',
      error: 'ssh_background_job_status requires a jobId.',
    });
  }

  const job = getBackgroundJob(jobId);
  if (!job) {
    return JSON.stringify({
      jobId,
      status: 'not_found',
      error: 'Background SSH job not found.',
    });
  }

  return buildSshBackgroundJobResult(jobId, {
    status: job.status,
    command: job.command,
    targetId: job.targetId,
    startedAt: job.startedAt,
    output: job.output,
    error: job.error,
  });
}

export async function executeSshBackgroundJobWait(args: {
  jobId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<string> {
  const jobId = typeof args.jobId === 'string' ? args.jobId.trim() : '';
  if (!jobId) {
    return JSON.stringify({ status: 'error', error: 'ssh_background_job_wait requires a jobId.' });
  }

  const timeoutMs = Number.isFinite(args.timeoutMs)
    ? Math.max(100, Number(args.timeoutMs))
    : 30_000;
  const pollIntervalMs = Number.isFinite(args.pollIntervalMs)
    ? Math.max(100, Number(args.pollIntervalMs))
    : 2_000;
  const deadline = Date.now() + timeoutMs;
  let job = getBackgroundJob(jobId);

  if (!job) {
    return JSON.stringify({
      jobId,
      status: 'not_found',
      error: 'Background SSH job not found.',
    });
  }

  job = await runAsyncPollLoop<ReturnType<typeof getBackgroundJob>>({
    initialValue: job,
    shouldContinue: (currentJob) => currentJob?.status === 'running',
    poll: () => Promise.resolve(getBackgroundJob(jobId)),
    pollIntervalMs,
    deadlineMs: deadline,
  });

  if (!job) {
    return JSON.stringify({
      jobId,
      status: 'not_found',
      error: 'Background SSH job not found.',
    });
  }

  return buildSshBackgroundJobResult(jobId, {
    status: job.status,
    command: job.command,
    targetId: job.targetId,
    startedAt: job.startedAt,
    output: job.output,
    error: job.error,
    timedOut: job.status === 'running',
  });
}

export async function executeSshListDirectory(args: {
  targetId?: string;
  path?: string;
}): Promise<string> {
  const target = await resolveSshTarget(args.targetId);
  const entries = await listSshDirectory(target, args.path);
  return normalizeSshListResult({
    targetId: target.id,
    path: args.path || target.remoteRoot || '.',
    entries: entries.map((entry) => ({
      name: entry.filename,
      isDirectory: entry.isDirectory,
      size: entry.fileSize,
      modifiedAt: entry.modificationDate,
    })),
  });
}

export async function executeSshReadFile(args: {
  targetId?: string;
  path: string;
}): Promise<string> {
  const target = await resolveSshTarget(args.targetId);
  const content = await readSshTextFile(target, args.path);
  return normalizeSshReadResult({
    targetId: target.id,
    path: args.path,
    content,
  });
}

export async function executeSshWriteFile(args: {
  targetId?: string;
  path: string;
  content: string;
}): Promise<string> {
  const target = await resolveSshTarget(args.targetId);
  await writeSshTextFile(target, args.path, args.content);
  return normalizeSshMutationResult({
    targetId: target.id,
    action: 'written',
    path: args.path,
    size: args.content.length,
  });
}

export async function executeSshRenamePath(args: {
  targetId?: string;
  oldPath: string;
  newPath: string;
}): Promise<string> {
  const target = await resolveSshTarget(args.targetId);
  await renameSshPath(target, args.oldPath, args.newPath);
  return normalizeSshMutationResult({
    targetId: target.id,
    action: 'renamed',
    oldPath: args.oldPath,
    newPath: args.newPath,
  });
}

export async function executeSshDeletePath(args: {
  targetId?: string;
  path: string;
  recursive?: boolean;
}): Promise<string> {
  const target = await resolveSshTarget(args.targetId);
  await deleteSshPath(target, args.path, args.recursive);
  return normalizeSshMutationResult({
    targetId: target.id,
    action: 'deleted',
    path: args.path,
  });
}

export async function executeSshMakeDirectory(args: {
  targetId?: string;
  path: string;
}): Promise<string> {
  const target = await resolveSshTarget(args.targetId);
  await makeSshDirectory(target, args.path);
  return normalizeSshMutationResult({
    targetId: target.id,
    action: 'created',
    path: args.path,
  });
}
