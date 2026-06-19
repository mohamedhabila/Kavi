import {
  normalizeRemoteListResult,
  normalizeRemoteMutationResult,
  normalizeRemoteReadResult,
  type RemoteListEntry,
} from './remoteResult';

export function normalizeWorkspaceReadResult(result: {
  targetId: string;
  path: string;
  content: string;
  size?: number;
}): string {
  return normalizeRemoteReadResult({
    kind: 'workspace',
    targetId: result.targetId,
    path: result.path,
    content: result.content,
    size: result.size,
    status: 'read',
  });
}

export function normalizeWorkspaceListResult(result: {
  targetId: string;
  path: string;
  entries: RemoteListEntry[];
}): string {
  return normalizeRemoteListResult({
    kind: 'workspace',
    targetId: result.targetId,
    path: result.path,
    entries: result.entries,
    status: 'listed',
  });
}

export function normalizeWorkspaceMutationResult(result: {
  targetId: string;
  action: 'written' | 'created' | 'renamed' | 'deleted';
  path?: string;
  oldPath?: string;
  newPath?: string;
  size?: number;
}): string {
  return normalizeRemoteMutationResult({
    kind: 'workspace',
    targetId: result.targetId,
    action: result.action,
    path: result.path,
    oldPath: result.oldPath,
    newPath: result.newPath,
    size: result.size,
    status: 'ok',
  });
}
