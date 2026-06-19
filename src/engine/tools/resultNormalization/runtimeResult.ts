import { limitArray } from './resultNormalizer';
import {
  approxBinaryBytes,
  buildRelevantOutputExcerpt,
  countLines,
  MAX_EXEC_OUTPUT_CHARS,
  MAX_LIST_ENTRIES,
} from './transformers';

export function normalizePythonToolResult(result: {
  success: boolean;
  output?: string;
  error?: string;
  files?: Array<{ path: string; contentBase64?: string }>;
}): string {
  const output = result.output || '';
  const outputLines = countLines(output);
  const hasLargeOutput = output.length > MAX_EXEC_OUTPUT_CHARS || outputLines > 80;

  if (!result.success) {
    const message = result.error || 'Python execution failed.';
    if (!output.trim()) {
      return message;
    }

    const excerpt = hasLargeOutput ? buildRelevantOutputExcerpt(output) : output;
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

  if (!normalizedFiles.length && !hasLargeOutput) {
    return output || '(no output)';
  }

  const summary =
    normalizedFiles.length > 0
      ? `Python execution completed and wrote ${normalizedFiles.length} workspace file${normalizedFiles.length === 1 ? '' : 's'}.`
      : hasLargeOutput
        ? 'Python execution completed with trimmed output for context.'
        : 'Python execution completed.';

  return JSON.stringify({
    summary,
    status: 'completed',
    ...(output.trim()
      ? hasLargeOutput
        ? {
            outputExcerpt: buildRelevantOutputExcerpt(output),
            outputChars: output.length,
            outputLines,
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
  });
}

export function normalizeJavaScriptToolResult(result: {
  output?: string;
  files?: Array<{ path: string; content?: string }>;
  deletedPaths?: string[];
}): string {
  const output = result.output || '';
  const outputLines = countLines(output);
  const hasLargeOutput = output.length > MAX_EXEC_OUTPUT_CHARS || outputLines > 80;

  const normalizedFiles = (result.files ?? []).map((file) => ({
    path: file.path,
    ...(typeof file.content === 'string' ? { size: file.content.length } : {}),
  }));
  const deletedPaths = (result.deletedPaths ?? []).filter(
    (path) => typeof path === 'string' && path.trim(),
  );

  if (!normalizedFiles.length && !deletedPaths.length && !hasLargeOutput) {
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
      : hasLargeOutput
        ? 'JavaScript execution completed with trimmed output for context.'
        : 'JavaScript execution completed.';

  return JSON.stringify({
    summary,
    status: 'completed',
    ...(output.trim()
      ? hasLargeOutput
        ? {
            outputExcerpt: buildRelevantOutputExcerpt(output),
            outputChars: output.length,
            outputLines,
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
