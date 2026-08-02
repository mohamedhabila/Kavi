import { limitArray } from './resultNormalizer';
import type { PythonExecutionFailureKind } from '../../../services/python/types';
import type {
  PythonNetworkAccessState,
  PythonNetworkMutationState,
} from '../../../services/python/types';
import {
  approxBinaryBytes,
  buildRelevantOutputExcerpt,
  countLines,
  MAX_EXEC_OUTPUT_CHARS,
  MAX_LIST_ENTRIES,
} from './transformers';

function buildExecutionOutputFields(output: string): Record<string, unknown> {
  const outputLines = countLines(output);
  const hasLargeOutput = output.length > MAX_EXEC_OUTPUT_CHARS || outputLines > 80;
  if (!output.trim()) {
    return {};
  }
  return hasLargeOutput
    ? {
        outputExcerpt: buildRelevantOutputExcerpt(output),
        outputChars: output.length,
        outputLines,
        truncated: true,
      }
    : { output };
}

type PythonToolResult =
  | {
      success: true;
      output?: string;
      files?: Array<{ path: string; contentBase64?: string }>;
      networkAccessState: PythonNetworkAccessState;
      networkMutationState: PythonNetworkMutationState;
      networkRequestCount: number;
    }
  | {
      success: false;
      output?: string;
      error: string;
      failureKind: PythonExecutionFailureKind;
      files?: Array<{ path: string; contentBase64?: string }>;
      networkAccessState: PythonNetworkAccessState;
      networkMutationState: PythonNetworkMutationState;
      networkRequestCount: number;
    };

export function normalizePythonToolResult(result: PythonToolResult): string {
  const output = result.output || '';
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

  if (!result.success) {
    const error = result.error;
    const status =
      result.failureKind === 'timed_out'
        ? 'timed_out'
        : result.failureKind === 'workspace_persistence_failed'
          ? 'effect_failed'
          : 'failed';
    return JSON.stringify({
      status,
      isError: true,
      summary:
        status === 'timed_out'
          ? 'Python execution timed out.'
          : status === 'effect_failed'
            ? 'Python execution completed but workspace persistence failed.'
            : 'Python execution failed.',
      error,
      failureKind: result.failureKind,
      workspaceMutationState:
        result.failureKind === 'workspace_persistence_failed'
          ? 'unknown'
          : normalizedFiles.length > 0
            ? 'applied'
            : 'none_observed',
      networkAccessState: result.networkAccessState,
      networkMutationState: result.networkMutationState,
      networkRequestCount: result.networkRequestCount,
      executionEffectState:
        result.failureKind !== 'workspace_persistence_failed' &&
        normalizedFiles.length === 0 &&
        result.networkMutationState === 'none_observed'
          ? 'none_observed'
          : 'unknown',
      ...buildExecutionOutputFields(output),
      ...(normalizedFiles.length > 0
        ? {
            fileCount: normalizedFiles.length,
            files,
            ...(omittedFiles > 0 ? { omittedFiles } : {}),
          }
        : {}),
    });
  }

  const summary =
    normalizedFiles.length > 0
      ? `Python execution completed and wrote ${normalizedFiles.length} workspace file${normalizedFiles.length === 1 ? '' : 's'}.`
      : output.length > MAX_EXEC_OUTPUT_CHARS || countLines(output) > 80
        ? 'Python execution completed with trimmed output for context.'
        : 'Python execution completed.';

  return JSON.stringify({
    summary,
    status: 'completed',
    workspaceMutationState: normalizedFiles.length > 0 ? 'applied' : 'none_observed',
    networkAccessState: result.networkAccessState,
    networkMutationState: result.networkMutationState,
    networkRequestCount: result.networkRequestCount,
    executionEffectState:
      normalizedFiles.length === 0 && result.networkMutationState === 'none_observed'
        ? 'none_observed'
        : 'unknown',
    ...buildExecutionOutputFields(output || '(no output)'),
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
  success: boolean;
  output?: string;
  error?: string;
  failureKind?: 'execution_failed' | 'workspace_persistence_failed';
  files?: Array<{ path: string; content?: string }>;
  deletedPaths?: string[];
}): string {
  const output = result.output || '';

  if (!result.success) {
    const failureKind = result.failureKind ?? 'execution_failed';
    const status = failureKind === 'workspace_persistence_failed' ? 'effect_failed' : 'failed';
    return JSON.stringify({
      status,
      isError: true,
      summary:
        status === 'effect_failed'
          ? 'JavaScript execution completed but workspace persistence failed.'
          : 'JavaScript execution failed.',
      error: result.error || 'JavaScript execution failed.',
      failureKind,
      workspaceMutationState:
        failureKind === 'workspace_persistence_failed' ? 'unknown' : 'none_observed',
      ...buildExecutionOutputFields(output),
    });
  }

  const normalizedFiles = (result.files ?? []).map((file) => ({
    path: file.path,
    ...(typeof file.content === 'string' ? { size: file.content.length } : {}),
  }));
  const deletedPaths = (result.deletedPaths ?? []).filter(
    (path) => typeof path === 'string' && path.trim(),
  );

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
      : output.length > MAX_EXEC_OUTPUT_CHARS || countLines(output) > 80
        ? 'JavaScript execution completed with trimmed output for context.'
        : 'JavaScript execution completed.';

  return JSON.stringify({
    summary,
    status: 'completed',
    workspaceMutationState:
      normalizedFiles.length > 0 || deletedPaths.length > 0 ? 'applied' : 'none_observed',
    ...buildExecutionOutputFields(output || '(no return value)'),
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
