import { buildHeadTailExcerpt } from '../../../utils/headTailExcerpt';
import { limitArray, type JsonRecord } from './resultNormalizer';
import { MAX_FILE_CONTENT_CHARS, MAX_LIST_ENTRIES } from './transformers';

export type RemoteListEntry = {
  name: string;
  isDirectory?: boolean;
  size?: number;
  modifiedAt?: number | string | null;
};

function normalizeRemoteListEntries(entries: RemoteListEntry[]): Array<JsonRecord> {
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory === true,
    ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
    ...(entry.modifiedAt != null ? { modifiedAt: entry.modifiedAt } : {}),
  }));
}

export function normalizeRemoteListResult(params: {
  kind: 'workspace' | 'ssh';
  targetId?: string;
  path: string;
  entries: RemoteListEntry[];
  status?: string;
}): string {
  const normalizedEntries = normalizeRemoteListEntries(params.entries);
  const { items, omitted } = limitArray(normalizedEntries, MAX_LIST_ENTRIES);
  const directoryCount = normalizedEntries.filter((entry) => entry.isDirectory === true).length;
  const fileCount = normalizedEntries.length - directoryCount;
  const label = params.kind === 'workspace' ? 'Workspace' : 'SSH';

  return JSON.stringify({
    summary: `${label} directory listing for ${params.path}: ${normalizedEntries.length} entries (${directoryCount} directories, ${fileCount} files).`,
    status: params.status || 'listed',
    ...(params.targetId ? { targetId: params.targetId } : {}),
    path: params.path,
    count: normalizedEntries.length,
    directoryCount,
    fileCount,
    entries: items,
    ...(omitted > 0 ? { omittedEntries: omitted } : {}),
  });
}

export function normalizeRemoteReadResult(params: {
  kind: 'workspace' | 'ssh';
  targetId?: string;
  path: string;
  content: string;
  size?: number;
  status?: string;
}): string {
  const content = params.content || '';
  const size = typeof params.size === 'number' ? params.size : content.length;
  const label = params.kind === 'workspace' ? 'Workspace' : 'SSH';

  if (content.length > MAX_FILE_CONTENT_CHARS) {
    return JSON.stringify({
      summary: `Read ${params.kind} file ${params.path} (${size} chars, trimmed for context).`,
      status: params.status || 'read',
      ...(params.targetId ? { targetId: params.targetId } : {}),
      path: params.path,
      size,
      contentChars: content.length,
      truncated: true,
      contentExcerpt: buildHeadTailExcerpt(content, MAX_FILE_CONTENT_CHARS),
      note: `${label} file content was trimmed to preserve context budget.`,
    });
  }

  return JSON.stringify({
    summary: `Read ${params.kind} file ${params.path} (${size} chars).`,
    ...(params.targetId ? { targetId: params.targetId } : {}),
    path: params.path,
    size,
    content,
    status: params.status || 'read',
  });
}

export function normalizeRemoteMutationResult(params: {
  kind: 'workspace' | 'ssh';
  action: 'written' | 'created' | 'renamed' | 'deleted';
  targetId?: string;
  path?: string;
  oldPath?: string;
  newPath?: string;
  size?: number;
  status?: string;
}): string {
  const label = params.kind === 'workspace' ? 'Workspace' : 'SSH';
  const summary =
    params.action === 'written'
      ? `${label} file written: ${params.path}.`
      : params.action === 'created'
        ? `${label} directory created: ${params.path}.`
        : params.action === 'renamed'
          ? `${label} path renamed from ${params.oldPath} to ${params.newPath}.`
          : `${label} path deleted: ${params.path}.`;

  return JSON.stringify({
    summary,
    ...(params.targetId ? { targetId: params.targetId } : {}),
    ...(params.path ? { path: params.path } : {}),
    ...(params.oldPath ? { oldPath: params.oldPath } : {}),
    ...(params.newPath ? { newPath: params.newPath } : {}),
    ...(typeof params.size === 'number' ? { size: params.size } : {}),
    status: params.status || params.action,
    action: params.action,
  });
}
