import { isAllowedUrl } from '../security/ssrf';
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
// Matches the URL half of a PEP 508 direct reference, e.g. "pkg @ https://host/pkg.whl" or
// "pkg @ https://host/pkg.whl ; python_version >= '3.8'". Stops at the first whitespace or
// `;` so a trailing environment marker cannot hide inside the captured URL.
const PACKAGE_DIRECT_REFERENCE_URL_PATTERN = /@\s*(https?:\/\/[^\s;]+)/i;

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

/**
 * The URL a `packages` entry would fetch, or undefined for a plain name or version pin
 * ("numpy", "numpy==1.26.0"), which resolve through Pyodide's own package index and are
 * never fetched from a model-chosen host. Shared with approval-risk assessment so the
 * network gate and the confirmation tier agree on what counts as a URL.
 */
export function extractPackageSpecUrl(spec: string): string | undefined {
  if (HTTP_URL_PATTERN.test(spec)) {
    return spec;
  }
  const directReference = spec.match(PACKAGE_DIRECT_REFERENCE_URL_PATTERN);
  return directReference ? directReference[1] : undefined;
}

// `packages` wheel URLs and `indexUrls` are fetched by Pyodide's package
// loader on the WebView's raw `fetch`, not the native HTTP bridge — the same
// path used to resolve `import numpy` automatically. That path runs before
// `allowNetwork` is ever evaluated, so it is not gated by it, and it never
// passes through the native SSRF check that guards `kavi.http` requests.
// This is the last point before the execute message reaches the worker, so
// every model-supplied URL is checked here against the same allowlist.
function findDisallowedPackageUrl(packages: string[], indexUrls: string[]): string | undefined {
  for (const indexUrl of indexUrls) {
    if (!isAllowedUrl(indexUrl)) {
      return indexUrl;
    }
  }

  for (const spec of packages) {
    const url = extractPackageSpecUrl(spec);
    if (url && !isAllowedUrl(url)) {
      return url;
    }
  }

  return undefined;
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

  const packages = normalizePackageSpecs(request.packages);
  const indexUrls = normalizeIndexUrls(request.indexUrls);

  const disallowedUrl = findDisallowedPackageUrl(packages, indexUrls);
  if (disallowedUrl) {
    return {
      error: `Python execution rejected the package URL "${disallowedUrl}": it is outside the permitted network policy.`,
    };
  }

  return {
    request: {
      code: typeof request.code === 'string' ? request.code : '',
      scriptPath: safeScriptPath,
      argv: normalizePythonArgv(request.argv),
      files: normalizeWorkspaceFiles(request.files),
      workingDirectory: normalizedWorkingDirectory || '',
      packages,
      indexUrls,
      env: normalizePythonEnv(request.env),
      allowNetwork: request.allowNetwork === true,
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
