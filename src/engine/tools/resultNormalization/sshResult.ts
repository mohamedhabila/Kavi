import {
  normalizeRemoteListResult,
  normalizeRemoteMutationResult,
  normalizeRemoteReadResult,
  type RemoteListEntry,
} from './remoteResult';
import {
  buildRelevantOutputExcerpt,
  countLines,
  MAX_EXEC_OUTPUT_CHARS,
  truncateText,
} from './transformers';

export function normalizeSshExecResult(result: {
  targetId: string;
  command: string;
  cwd: string | null;
  output: string;
}): string {
  const output = result.output || '';
  const lineCountValue = countLines(output);
  const truncated = output.length > MAX_EXEC_OUTPUT_CHARS || lineCountValue > 80;
  const summary = `SSH command "${truncateText(result.command, 80)}" completed on ${result.targetId}.`;

  if (truncated) {
    return JSON.stringify({
      summary,
      status: 'executed',
      targetId: result.targetId,
      command: result.command,
      cwd: result.cwd,
      outputExcerpt: buildRelevantOutputExcerpt(output),
      outputChars: output.length,
      outputLines: lineCountValue,
      truncated,
    });
  }

  return JSON.stringify({
    summary,
    status: 'executed',
    targetId: result.targetId,
    command: result.command,
    cwd: result.cwd,
    output,
  });
}

export function normalizeSshListResult(result: {
  targetId: string;
  path: string;
  entries: RemoteListEntry[];
}): string {
  return normalizeRemoteListResult({
    kind: 'ssh',
    targetId: result.targetId,
    path: result.path,
    entries: result.entries,
    status: 'listed',
  });
}

export function normalizeSshReadResult(result: {
  targetId: string;
  path: string;
  content: string;
}): string {
  return normalizeRemoteReadResult({
    kind: 'ssh',
    targetId: result.targetId,
    path: result.path,
    content: result.content,
    status: 'read',
  });
}

export function normalizeSshMutationResult(result: {
  targetId: string;
  action: 'written' | 'created' | 'renamed' | 'deleted';
  path?: string;
  oldPath?: string;
  newPath?: string;
  size?: number;
}): string {
  return normalizeRemoteMutationResult({
    kind: 'ssh',
    targetId: result.targetId,
    action: result.action,
    path: result.path,
    oldPath: result.oldPath,
    newPath: result.newPath,
    size: result.size,
    status: result.action,
  });
}
