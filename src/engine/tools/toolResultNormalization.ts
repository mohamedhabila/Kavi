type JsonRecord = Record<string, unknown>;

export type TextSearchMatch = {
  path: string;
  line: number;
  text: string;
};

type RemoteListEntry = {
  name: string;
  isDirectory?: boolean;
  size?: number;
  modifiedAt?: number | string | null;
};

const ERROR_LINE_PATTERN =
  /(error|failed|failure|unable|not found|exception|traceback|fatal|panic|permission denied|npm err!|err!|exit code)/i;
const MAX_BROWSER_SNAPSHOT_CHARS = 8_000;
const MAX_FILE_CONTENT_CHARS = 12_000;
const MAX_EXEC_OUTPUT_CHARS = 8_000;
const MAX_LIST_ENTRIES = 40;
const MAX_BROWSER_MESSAGES = 12;
const MAX_SEARCH_MATCHES = 40;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const omittedChars = value.length - maxChars;
  const suffix = `... (${omittedChars} chars omitted)`;
  return `${value.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}

function buildHeadTailExcerpt(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const notice = `\n... [truncated ${value.length - maxChars} chars] ...\n`;
  const available = Math.max(0, maxChars - notice.length);
  const headChars = Math.max(0, Math.floor(available * 0.65));
  const tailChars = Math.max(0, available - headChars);
  return `${value.slice(0, headChars)}${notice}${value.slice(value.length - tailChars)}`;
}

function countLines(value: string): number {
  if (!value) {
    return 0;
  }
  return value.split(/\r?\n/).length;
}

function selectRelevantLines(value: string, maxLines: number): string[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= maxLines) {
    return lines.map((line) => truncateText(line, 240));
  }

  const selectedIndexes = new Set<number>();
  for (let index = 0; index < Math.min(4, lines.length); index += 1) {
    selectedIndexes.add(index);
  }
  for (let index = Math.max(0, lines.length - 3); index < lines.length; index += 1) {
    selectedIndexes.add(index);
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (ERROR_LINE_PATTERN.test(lines[index])) {
      selectedIndexes.add(index);
    }
  }

  return Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .slice(0, maxLines)
    .map((index) => truncateText(lines[index], 240));
}

function buildRelevantOutputExcerpt(value: string): string {
  const relevantLines = selectRelevantLines(value, 12);
  const candidate = relevantLines.join('\n');
  return candidate.length > 0
    ? truncateText(candidate, MAX_EXEC_OUTPUT_CHARS)
    : buildHeadTailExcerpt(value, MAX_EXEC_OUTPUT_CHARS);
}

function limitArray<T>(items: T[], maxItems: number): { items: T[]; omitted: number } {
  if (items.length <= maxItems) {
    return { items, omitted: 0 };
  }

  return {
    items: items.slice(0, maxItems),
    omitted: items.length - maxItems,
  };
}

function previewUnknown(value: unknown, maxChars: number): string {
  if (typeof value === 'string') {
    return truncateText(value, maxChars);
  }

  try {
    return truncateText(JSON.stringify(value), maxChars);
  } catch {
    return truncateText(String(value), maxChars);
  }
}

function approxBinaryBytes(base64: string): number {
  const normalized = base64.replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function normalizeRemoteListEntries(entries: RemoteListEntry[]): Array<JsonRecord> {
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory === true,
    ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
    ...(entry.modifiedAt != null ? { modifiedAt: entry.modifiedAt } : {}),
  }));
}

function normalizeRemoteListResult(params: {
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

function normalizeRemoteReadResult(params: {
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

function normalizeRemoteMutationResult(params: {
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

function normalizeBrowserSummary(name: string, payload: JsonRecord): string {
  switch (name) {
    case 'browser_launch':
      return typeof payload.sessionId === 'string'
        ? `Browser session launched: ${payload.sessionId}.`
        : 'Browser session launched.';
    case 'browser_stop':
      return 'Browser session stopped.';
    case 'browser_status':
      return `Browser session ${typeof payload.sessionId === 'string' ? payload.sessionId : ''} is ${typeof payload.status === 'string' ? payload.status : 'unknown'}.`.trim();
    case 'browser_navigate':
      return `Navigated browser target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}${typeof payload.url === 'string' ? ` to ${payload.url}` : ''}.`;
    case 'browser_snapshot':
      return `Captured browser snapshot for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_console':
      return `Captured browser console output for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_errors':
      return `Captured browser page errors for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_network':
      return `Captured browser network activity for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_cookies':
      return `Captured browser cookies for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_storage':
      return `Captured browser storage for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_screenshot':
      return `Captured browser screenshot for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    case 'browser_pdf':
      return `Captured browser PDF for target ${typeof payload.targetId === 'string' ? payload.targetId : 'current'}.`;
    default:
      return `Browser ${name.replace(/^browser_/, '')} completed.`;
  }
}

function compactBrowserConsoleMessages(messages: unknown[]): Array<JsonRecord> {
  return messages
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      type: typeof entry.type === 'string' ? entry.type : 'log',
      text: truncateText(typeof entry.text === 'string' ? entry.text : '', 240),
      ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
      ...(typeof entry.lineNumber === 'number' ? { lineNumber: entry.lineNumber } : {}),
    }))
    .sort((left, right) => {
      const leftImportant =
        ERROR_LINE_PATTERN.test(String(left.type)) || ERROR_LINE_PATTERN.test(String(left.text));
      const rightImportant =
        ERROR_LINE_PATTERN.test(String(right.type)) || ERROR_LINE_PATTERN.test(String(right.text));
      return Number(rightImportant) - Number(leftImportant);
    });
}

function compactBrowserPageErrors(errors: unknown[]): Array<JsonRecord> {
  return errors
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      message: truncateText(typeof entry.message === 'string' ? entry.message : '', 240),
      ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
      ...(typeof entry.lineNumber === 'number' ? { lineNumber: entry.lineNumber } : {}),
    }));
}

function compactBrowserRequests(requests: unknown[]): Array<JsonRecord> {
  return requests
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      method: typeof entry.method === 'string' ? entry.method : 'GET',
      url: truncateText(typeof entry.url === 'string' ? entry.url : '', 220),
      ...(typeof entry.status === 'number' ? { status: entry.status } : {}),
      ...(typeof entry.resourceType === 'string' ? { resourceType: entry.resourceType } : {}),
    }))
    .sort((left, right) => {
      const leftFailed = typeof left.status === 'number' && left.status >= 400;
      const rightFailed = typeof right.status === 'number' && right.status >= 400;
      return Number(rightFailed) - Number(leftFailed);
    });
}

function compactBrowserCookies(cookies: unknown[]): Array<JsonRecord> {
  return cookies
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
      ...(typeof entry.domain === 'string' ? { domain: entry.domain } : {}),
      ...(typeof entry.path === 'string' ? { path: entry.path } : {}),
      ...(typeof entry.sameSite === 'string' ? { sameSite: entry.sameSite } : {}),
      ...(typeof entry.secure === 'boolean' ? { secure: entry.secure } : {}),
      ...(typeof entry.httpOnly === 'boolean' ? { httpOnly: entry.httpOnly } : {}),
      ...(typeof entry.expires === 'number' ? { expires: entry.expires } : {}),
    }));
}

function compactBrowserStorageValues(values: JsonRecord): Array<JsonRecord> {
  return Object.entries(values).map(([key, value]) => ({
    key,
    valuePreview: previewUnknown(value, 180),
  }));
}

export function normalizeBrowserToolResult(name: string, rawResult: string): string {
  const trimmed = rawResult.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return rawResult;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return rawResult;
  }

  if (!isRecord(parsed)) {
    return rawResult;
  }

  if (name === 'browser_screenshot' && typeof parsed.imageBase64 === 'string') {
    return JSON.stringify({
      summary: `Captured browser screenshot for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}. Binary image omitted from tool context.`,
      ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
      ...(typeof parsed.url === 'string' ? { url: parsed.url } : {}),
      imageBytes: approxBinaryBytes(parsed.imageBase64),
      note: 'Use browser_snapshot for text inspection. Screenshot base64 is omitted to preserve context.',
    });
  }

  if (name === 'browser_pdf' && typeof parsed.base64 === 'string') {
    return JSON.stringify({
      summary: `Captured browser PDF for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}. Binary PDF omitted from tool context.`,
      ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
      ...(typeof parsed.pages === 'number' ? { pages: parsed.pages } : {}),
      ...(typeof parsed.size === 'number' ? { size: parsed.size } : {}),
      pdfBytes: approxBinaryBytes(parsed.base64),
      note: 'PDF base64 is omitted to preserve context.',
    });
  }

  if (name === 'browser_snapshot' && typeof parsed.snapshot === 'string') {
    const snapshot = parsed.snapshot;
    const truncated = parsed.truncated === true || snapshot.length > MAX_BROWSER_SNAPSHOT_CHARS;
    return JSON.stringify({
      summary: `Captured browser snapshot for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}${truncated ? ' (trimmed for context).' : '.'}`,
      ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
      snapshot: truncated ? buildHeadTailExcerpt(snapshot, MAX_BROWSER_SNAPSHOT_CHARS) : snapshot,
      snapshotChars: snapshot.length,
      truncated,
    });
  }

  if (name === 'browser_console' && Array.isArray(parsed.messages)) {
    const normalizedMessages = compactBrowserConsoleMessages(parsed.messages);
    const { items, omitted } = limitArray(normalizedMessages, MAX_BROWSER_MESSAGES);
    const importantCount = normalizedMessages.filter(
      (entry) =>
        ERROR_LINE_PATTERN.test(String(entry.type)) || ERROR_LINE_PATTERN.test(String(entry.text)),
    ).length;
    return JSON.stringify({
      summary: `Captured ${normalizedMessages.length} browser console messages for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}${importantCount > 0 ? ` (${importantCount} important).` : '.'}`,
      ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
      count: normalizedMessages.length,
      importantCount,
      messages: items,
      ...(omitted > 0 ? { omittedMessages: omitted } : {}),
    });
  }

  if (name === 'browser_errors' && Array.isArray(parsed.errors)) {
    const normalizedErrors = compactBrowserPageErrors(parsed.errors);
    const { items, omitted } = limitArray(normalizedErrors, MAX_BROWSER_MESSAGES);
    return JSON.stringify({
      summary: `Captured ${normalizedErrors.length} browser page errors for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}.`,
      ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
      count: normalizedErrors.length,
      errors: items,
      ...(omitted > 0 ? { omittedErrors: omitted } : {}),
    });
  }

  if (name === 'browser_network' && Array.isArray(parsed.requests)) {
    const normalizedRequests = compactBrowserRequests(parsed.requests);
    const { items, omitted } = limitArray(normalizedRequests, MAX_BROWSER_MESSAGES);
    const failedCount = normalizedRequests.filter(
      (entry) => typeof entry.status === 'number' && entry.status >= 400,
    ).length;
    return JSON.stringify({
      summary: `Captured ${normalizedRequests.length} browser network requests for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}${failedCount > 0 ? ` (${failedCount} failed).` : '.'}`,
      ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
      count: normalizedRequests.length,
      failedCount,
      requests: items,
      ...(omitted > 0 ? { omittedRequests: omitted } : {}),
    });
  }

  if (name === 'browser_cookies' && Array.isArray(parsed.cookies)) {
    const normalizedCookies = compactBrowserCookies(parsed.cookies);
    const { items, omitted } = limitArray(normalizedCookies, MAX_BROWSER_MESSAGES);
    return JSON.stringify({
      summary: `Captured ${normalizedCookies.length} browser cookies for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}. Cookie values omitted from tool context.`,
      ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
      count: normalizedCookies.length,
      cookies: items,
      ...(omitted > 0 ? { omittedCookies: omitted } : {}),
    });
  }

  if (name === 'browser_storage' && isRecord(parsed.values)) {
    const items = compactBrowserStorageValues(parsed.values);
    const limitedItems = limitArray(items, MAX_BROWSER_MESSAGES);
    return JSON.stringify({
      summary: `Captured ${items.length} browser storage values for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}.`,
      ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
      count: items.length,
      values: limitedItems.items,
      ...(limitedItems.omitted > 0 ? { omittedValues: limitedItems.omitted } : {}),
    });
  }

  if (name === 'browser_download' && Array.isArray(parsed.downloads)) {
    const normalizedDownloads = parsed.downloads
      .filter((entry) => isRecord(entry))
      .map((entry) => ({
        ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
        ...(typeof entry.suggestedFilename === 'string'
          ? { suggestedFilename: entry.suggestedFilename }
          : {}),
        ...(typeof entry.path === 'string' ? { path: entry.path } : {}),
      }));
    const { items, omitted } = limitArray(normalizedDownloads, MAX_BROWSER_MESSAGES);
    return JSON.stringify({
      summary: `Captured ${normalizedDownloads.length} browser downloads for target ${typeof parsed.targetId === 'string' ? parsed.targetId : 'current'}.`,
      ...(typeof parsed.targetId === 'string' ? { targetId: parsed.targetId } : {}),
      count: normalizedDownloads.length,
      downloads: items,
      ...(omitted > 0 ? { omittedDownloads: omitted } : {}),
    });
  }

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
      ? parsed.summary
      : normalizeBrowserSummary(name, parsed);

  if (typeof parsed.result === 'string' && parsed.result.length > MAX_EXEC_OUTPUT_CHARS) {
    const { result, ...rest } = parsed;
    return JSON.stringify({
      summary,
      ...rest,
      resultPreview: buildHeadTailExcerpt(result, MAX_EXEC_OUTPUT_CHARS),
      resultChars: result.length,
      truncated: true,
    });
  }

  return JSON.stringify({
    summary,
    ...parsed,
  });
}

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

export function normalizePythonToolResult(result: {
  success: boolean;
  output?: string;
  error?: string;
  files?: Array<{ path: string; contentBase64?: string }>;
  workflowEvidenceCount?: number;
}): string {
  const output = result.output || '';
  const outputLines = countLines(output);
  const hasErrorSignals = ERROR_LINE_PATTERN.test(output);
  const hasLargeOutput = output.length > MAX_EXEC_OUTPUT_CHARS || outputLines > 80;
  const workflowEvidenceCount = Number.isFinite(result.workflowEvidenceCount)
    ? Math.max(0, Math.trunc(result.workflowEvidenceCount || 0))
    : 0;

  if (!result.success) {
    const message = result.error || 'Python execution failed.';
    if (!output.trim()) {
      return message;
    }

    const excerpt = hasLargeOutput || hasErrorSignals ? buildRelevantOutputExcerpt(output) : output;
    return `${message}\n\n${excerpt}`.trim();
  }

  const normalizedFiles = (result.files ?? []).map((file) => ({
    path: file.path,
    ...(typeof file.contentBase64 === 'string'
      ? { size: approxBinaryBytes(file.contentBase64) }
      : {}),
  }));
  const { items: files, omitted: omittedFiles } = limitArray(
    normalizedFiles,
    Math.min(MAX_LIST_ENTRIES, 20),
  );

  if (!normalizedFiles.length && !hasLargeOutput && !hasErrorSignals) {
    if (workflowEvidenceCount > 0) {
      return JSON.stringify({
        summary: `Python execution completed and recorded ${workflowEvidenceCount} workflow evidence entr${workflowEvidenceCount === 1 ? 'y' : 'ies'}.`,
        status: 'completed',
        ...(output.trim() ? { output } : {}),
        workflowEvidenceCount,
      });
    }

    return output || '(no output)';
  }

  const summary =
    normalizedFiles.length > 0 && workflowEvidenceCount > 0
      ? `Python execution completed, recorded ${workflowEvidenceCount} workflow evidence entr${workflowEvidenceCount === 1 ? 'y' : 'ies'}, and wrote ${normalizedFiles.length} workspace file${normalizedFiles.length === 1 ? '' : 's'}.`
      : normalizedFiles.length > 0
        ? `Python execution completed and wrote ${normalizedFiles.length} workspace file${normalizedFiles.length === 1 ? '' : 's'}.`
        : workflowEvidenceCount > 0
          ? `Python execution completed and recorded ${workflowEvidenceCount} workflow evidence entr${workflowEvidenceCount === 1 ? 'y' : 'ies'}.`
          : hasLargeOutput || hasErrorSignals
            ? 'Python execution completed with trimmed output for context.'
            : 'Python execution completed.';

  return JSON.stringify({
    summary,
    status: 'completed',
    ...(output.trim()
      ? hasLargeOutput || hasErrorSignals
        ? {
            outputExcerpt: buildRelevantOutputExcerpt(output),
            outputChars: output.length,
            outputLines,
            hadErrorSignals: hasErrorSignals,
            truncated: hasLargeOutput,
          }
        : { output }
      : {}),
    ...(normalizedFiles.length > 0
      ? {
          fileCount: normalizedFiles.length,
          files,
          ...(omittedFiles > 0 ? { omittedFiles } : {}),
        }
      : {}),
    ...(workflowEvidenceCount > 0 ? { workflowEvidenceCount } : {}),
  });
}

export function normalizeJavaScriptToolResult(result: {
  output?: string;
  files?: Array<{ path: string; content?: string }>;
  deletedPaths?: string[];
}): string {
  const output = result.output || '';
  const outputLines = countLines(output);
  const hasErrorSignals = ERROR_LINE_PATTERN.test(output);
  const hasLargeOutput = output.length > MAX_EXEC_OUTPUT_CHARS || outputLines > 80;

  const normalizedFiles = (result.files ?? []).map((file) => ({
    path: file.path,
    ...(typeof file.content === 'string' ? { size: file.content.length } : {}),
  }));
  const deletedPaths = (result.deletedPaths ?? []).filter(
    (path) => typeof path === 'string' && path.trim(),
  );

  if (!normalizedFiles.length && !deletedPaths.length && !hasLargeOutput && !hasErrorSignals) {
    return output || '(no return value)';
  }

  const { items: files, omitted: omittedFiles } = limitArray(
    normalizedFiles,
    Math.min(MAX_LIST_ENTRIES, 20),
  );
  const { items: deleted, omitted: omittedDeletedPaths } = limitArray(
    deletedPaths,
    Math.min(MAX_LIST_ENTRIES, 20),
  );

  const summary =
    normalizedFiles.length > 0 || deletedPaths.length > 0
      ? `JavaScript execution completed and changed ${normalizedFiles.length} workspace file${normalizedFiles.length === 1 ? '' : 's'}${deletedPaths.length > 0 ? `, deleted ${deletedPaths.length} path${deletedPaths.length === 1 ? '' : 's'}` : ''}.`
      : hasLargeOutput || hasErrorSignals
        ? 'JavaScript execution completed with trimmed output for context.'
        : 'JavaScript execution completed.';

  return JSON.stringify({
    summary,
    status: 'completed',
    ...(output.trim()
      ? hasLargeOutput || hasErrorSignals
        ? {
            outputExcerpt: buildRelevantOutputExcerpt(output),
            outputChars: output.length,
            outputLines,
            hadErrorSignals: hasErrorSignals,
            truncated: hasLargeOutput,
          }
        : { output }
      : {}),
    ...(normalizedFiles.length > 0
      ? {
          fileCount: normalizedFiles.length,
          files,
          ...(omittedFiles > 0 ? { omittedFiles } : {}),
        }
      : {}),
    ...(deletedPaths.length > 0
      ? {
          deletedCount: deletedPaths.length,
          deletedPaths: deleted,
          ...(omittedDeletedPaths > 0 ? { omittedDeletedPaths } : {}),
        }
      : {}),
  });
}

export function normalizeSshExecResult(result: {
  targetId: string;
  command: string;
  cwd: string | null;
  output: string;
}): string {
  const output = result.output || '';
  const lineCountValue = countLines(output);
  const hasErrorSignals = ERROR_LINE_PATTERN.test(output);
  const summary = hasErrorSignals
    ? `SSH command "${truncateText(result.command, 80)}" on ${result.targetId} produced error-like output.`
    : `SSH command "${truncateText(result.command, 80)}" completed on ${result.targetId}.`;

  if (output.length > MAX_EXEC_OUTPUT_CHARS || lineCountValue > 80 || hasErrorSignals) {
    return JSON.stringify({
      summary,
      status: 'executed',
      targetId: result.targetId,
      command: result.command,
      cwd: result.cwd,
      outputExcerpt: buildRelevantOutputExcerpt(output),
      outputChars: output.length,
      outputLines: lineCountValue,
      hadErrorSignals: hasErrorSignals,
      truncated: output.length > MAX_EXEC_OUTPUT_CHARS || lineCountValue > 80,
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

export function normalizeGlobSearchResult(result: {
  pattern: string;
  path: string;
  matches: string[];
}): string {
  const normalizedMatches = result.matches.map((match) => truncateText(match, 240));
  const { items, omitted } = limitArray(normalizedMatches, MAX_LIST_ENTRIES);
  return JSON.stringify({
    summary:
      normalizedMatches.length > 0
        ? `Found ${normalizedMatches.length} files matching "${result.pattern}" under ${result.path}.`
        : `No files matched "${result.pattern}" under ${result.path}.`,
    pattern: result.pattern,
    path: result.path,
    count: normalizedMatches.length,
    matches: items,
    ...(omitted > 0 ? { omittedMatches: omitted } : {}),
  });
}

export function normalizeTextSearchResult(result: {
  query: string;
  path: string;
  isRegex: boolean;
  matches: TextSearchMatch[];
  truncated: boolean;
}): string {
  const normalizedMatches = result.matches.map((match) => ({
    path: match.path,
    line: match.line,
    text: truncateText(match.text.trim(), 240),
  }));
  const { items, omitted } = limitArray(normalizedMatches, MAX_SEARCH_MATCHES);
  return JSON.stringify({
    summary:
      normalizedMatches.length > 0
        ? `Found ${normalizedMatches.length} ${result.isRegex ? 'regex' : 'text'} matches for "${result.query}" under ${result.path}.${result.truncated ? ' Results were truncated.' : ''}`
        : `No ${result.isRegex ? 'regex' : 'text'} matches for "${result.query}" under ${result.path}.`,
    query: result.query,
    path: result.path,
    isRegex: result.isRegex,
    count: normalizedMatches.length,
    matches: items,
    truncated: result.truncated,
    ...(omitted > 0 ? { omittedMatches: omitted } : {}),
  });
}
