import {
  DEFAULT_PYODIDE_DISPATCH_ACK_TIMEOUT_MS,
  DEFAULT_PYTHON_EXECUTION_TIMEOUT_MS,
} from './runtimeProtocol';
import { normalizePythonWorkflowBridgeState } from './workflowBridge';
import type {
  NormalizedPythonExecutionRequest,
  PythonExecutionRequest,
  PythonWorkspaceFile,
} from './types';

const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;

export function normalizeWorkspaceRelativePath(path: unknown): string | undefined {
  if (typeof path !== 'string') {
    return undefined;
  }

  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    return undefined;
  }

  return segments.join('/');
}

export function normalizeWorkspaceFiles(files: unknown): PythonWorkspaceFile[] {
  if (!Array.isArray(files)) {
    return [];
  }

  const normalizedFiles: PythonWorkspaceFile[] = [];
  for (const file of files) {
    const normalizedPath = normalizeWorkspaceRelativePath((file as PythonWorkspaceFile)?.path);
    const contentBase64 = (file as PythonWorkspaceFile)?.contentBase64;
    if (!normalizedPath || typeof contentBase64 !== 'string') {
      continue;
    }

    normalizedFiles.push({
      path: normalizedPath,
      contentBase64,
    });
  }

  return normalizedFiles;
}

export function normalizePackageSpecs(packages: unknown): string[] {
  if (!Array.isArray(packages)) {
    return [];
  }

  const normalized = new Set<string>();
  for (const entry of packages) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = entry.trim();
    if (trimmed) {
      normalized.add(trimmed);
    }
  }

  return Array.from(normalized);
}

export function normalizeIndexUrls(indexUrls: unknown): string[] {
  if (!Array.isArray(indexUrls)) {
    return [];
  }

  const normalized = new Set<string>();
  for (const entry of indexUrls) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = entry.trim();
    if (trimmed && HTTP_URL_PATTERN.test(trimmed)) {
      normalized.add(trimmed);
    }
  }

  return Array.from(normalized);
}

export function normalizePythonEnv(env: unknown): Record<string, string> {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof key === 'string' && typeof value === 'string') {
      normalized[key] = value;
    }
  }

  return normalized;
}

export function normalizePythonArgv(argv: unknown): string[] {
  if (!Array.isArray(argv)) {
    return [];
  }

  return argv.filter((value): value is string => typeof value === 'string');
}

export function normalizePythonExecutionRequest(request: PythonExecutionRequest): {
  request?: NormalizedPythonExecutionRequest;
  error?: string;
} {
  if (!request.code && !request.scriptPath) {
    return {
      error: 'Python execution requires either inline code or a scriptPath.',
    };
  }

  if (request.code && request.scriptPath) {
    return {
      error: 'Python execution accepts either inline code or a scriptPath, not both.',
    };
  }

  const safeScriptPath =
    request.scriptPath == null ? undefined : normalizeWorkspaceRelativePath(request.scriptPath);
  if (request.scriptPath != null && !safeScriptPath) {
    return {
      error: 'Python execution requires a safe workspace-relative scriptPath.',
    };
  }

  const normalizedWorkingDirectory =
    request.workingDirectory == null || request.workingDirectory === ''
      ? ''
      : normalizeWorkspaceRelativePath(request.workingDirectory);
  if (request.workingDirectory && !normalizedWorkingDirectory) {
    return {
      error: 'Python execution requires a safe workspace-relative workingDirectory.',
    };
  }

  const timeoutMs =
    typeof request.timeoutMs === 'number' &&
    Number.isFinite(request.timeoutMs) &&
    request.timeoutMs > 0
      ? request.timeoutMs
      : DEFAULT_PYTHON_EXECUTION_TIMEOUT_MS;

  return {
    request: {
      code: typeof request.code === 'string' ? request.code : '',
      scriptPath: safeScriptPath,
      argv: normalizePythonArgv(request.argv),
      files: normalizeWorkspaceFiles(request.files),
      workingDirectory: normalizedWorkingDirectory || '',
      packages: normalizePackageSpecs(request.packages),
      indexUrls: normalizeIndexUrls(request.indexUrls),
      env: normalizePythonEnv(request.env),
      timeoutMs,
      ...(normalizePythonWorkflowBridgeState(request.workflowBridge)
        ? { workflowBridge: normalizePythonWorkflowBridgeState(request.workflowBridge) }
        : {}),
    },
  };
}

export function getDispatchAcknowledgementTimeoutMs(executionTimeoutMs: number): number {
  if (!Number.isFinite(executionTimeoutMs) || executionTimeoutMs <= 0) {
    return DEFAULT_PYODIDE_DISPATCH_ACK_TIMEOUT_MS;
  }

  return Math.max(
    250,
    Math.min(DEFAULT_PYODIDE_DISPATCH_ACK_TIMEOUT_MS, Math.trunc(executionTimeoutMs)),
  );
}

export function unrefTimerIfSupported(timer: ReturnType<typeof setTimeout>): void {
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}
