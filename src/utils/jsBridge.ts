// ---------------------------------------------------------------------------
// Kavi — Structured JS Bridge
// ---------------------------------------------------------------------------
// Enhanced JavaScript execution context that provides structured APIs for
// file access, data parsing, HTTP requests, and environment info.
// Extends the base executeJavaScriptWithResult with workspace-aware globals.

import { buildJavaScriptCandidates, formatJavaScriptResult } from './javascript';

// ── Types ────────────────────────────────────────────────────────────────

export interface JsBridgeContext {
  /** Active conversation workspace ID */
  workspaceId?: string;
  /** Available environment variables */
  env?: Record<string, string>;
  /** File content cache for the session */
  fileCache?: Map<string, string>;
  /** Workspace-relative execution directory */
  workingDirectory?: string;
  /** Command-line style arguments exposed through process.argv */
  argv?: string[];
  /** Workspace-relative entry path for path-based execution */
  entryPath?: string;
}

export interface JavaScriptWorkspaceExecutionResult {
  result: unknown;
  fileCache: Map<string, string>;
  hadError: boolean;
}

type JsModuleRecord = {
  exports: unknown;
  loaded: boolean;
};

type JsModuleLike = {
  exports: unknown;
};

type JsProcessApi = {
  argv: string[];
  env: Record<string, string>;
  platform: 'react-native';
  cwd: () => string;
};

const MODULE_CANDIDATE_SUFFIXES = [
  '',
  '.js',
  '.json',
  '.cjs',
  '/index.js',
  '/index.json',
  '/index.cjs',
];

function normalizeWorkspacePath(inputPath: string, baseDirectory = ''): string {
  let normalized = typeof inputPath === 'string' ? inputPath : '';
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    normalized = inputPath;
  }

  normalized = normalized.replace(/\\/g, '/').replace(/\0/g, '').trim();
  const isAbsolute = normalized.startsWith('/');
  const resolvedSegments = (isAbsolute ? [] : splitPathSegments(baseDirectory)).slice();

  for (const segment of normalized.split('/')) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed === '.') {
      continue;
    }

    if (trimmed === '..') {
      if (resolvedSegments.length === 0) {
        throw new Error(`Workspace path escapes the conversation workspace: ${inputPath}`);
      }
      resolvedSegments.pop();
      continue;
    }

    resolvedSegments.push(trimmed);
  }

  return resolvedSegments.join('/');
}

function splitPathSegments(path: string): string[] {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function dirnameOfPath(path: string): string {
  const segments = splitPathSegments(path);
  segments.pop();
  return segments.join('/');
}

function resolveFilePath(inputPath: string, baseDirectory = ''): string {
  const resolved = normalizeWorkspacePath(inputPath, baseDirectory);
  if (!resolved) {
    throw new Error('Workspace file path must not resolve to the workspace root.');
  }
  return resolved;
}

function resolveModulePath(
  specifier: string,
  baseDirectory: string,
  cache: Map<string, string>,
): string {
  if (typeof specifier !== 'string' || !specifier.trim()) {
    throw new Error('Module specifier must be a non-empty string.');
  }

  const fromDirectory = specifier.startsWith('.') ? baseDirectory : '';
  const resolvedBasePath = normalizeWorkspacePath(specifier, fromDirectory);
  const candidates = MODULE_CANDIDATE_SUFFIXES.map((suffix) => `${resolvedBasePath}${suffix}`);

  for (const candidate of candidates) {
    if (cache.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to resolve workspace module "${specifier}" from ${baseDirectory || '.'}.`,
  );
}

function formatExecutionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createProcessApi(context: {
  entryPath: string;
  argv?: string[];
  env?: Record<string, string>;
  getCwd: () => string;
}): JsProcessApi {
  return {
    argv: [context.entryPath, ...(context.argv || [])],
    env: { ...(context.env || {}) },
    platform: 'react-native',
    cwd: () => context.getCwd(),
  };
}

// ── File system helpers (sync, from pre-loaded cache) ────────────────────

function createFsApi(cache: Map<string, string>, getBaseDirectory: () => string) {
  return {
    readFile: (path: string): string => {
      const resolvedPath = resolveFilePath(path, getBaseDirectory());
      const content = cache.get(resolvedPath);
      if (content === undefined) {
        throw new Error(`File not found in bridge cache: ${resolvedPath}.`);
      }
      return content;
    },
    writeFile: (path: string, content: string): void => {
      if (typeof content !== 'string') {
        throw new Error('Content must be a string');
      }
      const resolvedPath = resolveFilePath(path, getBaseDirectory());
      cache.set(resolvedPath, content);
    },
    exists: (path: string): boolean => {
      const resolvedPath = resolveFilePath(path, getBaseDirectory());
      return cache.has(resolvedPath);
    },
    listFiles: (): string[] =>
      Array.from(cache.keys()).sort((left, right) => left.localeCompare(right)),
    deleteFile: (path: string): boolean => {
      const resolvedPath = resolveFilePath(path, getBaseDirectory());
      return cache.delete(resolvedPath);
    },
  };
}

// ── Data parsing utilities ──────────────────────────────────────────────

const dataUtils = {
  parseJSON: (text: string): unknown => JSON.parse(text),
  parseCSV: (text: string, delimiter = ','): string[][] => {
    const rows: string[][] = [];
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === delimiter && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      cells.push(current.trim());
      rows.push(cells);
    }
    return rows;
  },
  parseYAML: (text: string): Record<string, unknown> => {
    // Simple YAML parser for flat key-value pairs and basic nesting
    const result: Record<string, unknown> = {};
    const lines = text.split('\n');
    let currentKey = '';

    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
      if (match) {
        const [, indent, key, value] = match;
        const trimmedValue = value.trim();
        if (trimmedValue === '' || trimmedValue === '|' || trimmedValue === '>') {
          currentKey = key.trim();
          result[currentKey] = '';
        } else if (trimmedValue === 'true') {
          result[key.trim()] = true;
        } else if (trimmedValue === 'false') {
          result[key.trim()] = false;
        } else if (trimmedValue === 'null') {
          result[key.trim()] = null;
        } else if (/^-?\d+(\.\d+)?$/.test(trimmedValue)) {
          result[key.trim()] = Number(trimmedValue);
        } else {
          // Remove surrounding quotes if present
          const unquoted = trimmedValue.replace(/^["'](.*)["']$/, '$1');
          result[key.trim()] = unquoted;
        }
      } else if (currentKey && line.startsWith('  ')) {
        // Continuation of a multiline string
        const existing = result[currentKey];
        result[currentKey] = (existing ? existing + '\n' : '') + line.trim();
      }
    }
    return result;
  },
  toJSON: (value: unknown, indent = 2): string => JSON.stringify(value, null, indent),
  toCSV: (rows: string[][]): string => {
    return rows
      .map((row) =>
        row
          .map((cell) => {
            if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
              return `"${cell.replace(/"/g, '""')}"`;
            }
            return cell;
          })
          .join(','),
      )
      .join('\n');
  },
};

// ── Environment info ────────────────────────────────────────────────────

function createEnvApi(env?: Record<string, string>) {
  return {
    get: (key: string): string | undefined => env?.[key],
    platform: 'react-native' as const,
    now: (): number => Date.now(),
    timestamp: (): string => new Date().toISOString(),
  };
}

// ── Main execution ──────────────────────────────────────────────────────

function hasMeaningfulExports(value: unknown): boolean {
  if (value == null) {
    return false;
  }

  if (typeof value !== 'object') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value instanceof Map || value instanceof Set) {
    return value.size > 0;
  }

  return Object.keys(value as Record<string, unknown>).length > 0;
}

function finalizeExecutionResult(result: unknown, logs: string[]): unknown {
  if (result !== undefined) {
    if (logs.length > 0) {
      return `${logs.join('\n')}\n${formatJavaScriptResult(result)}`;
    }
    return result;
  }

  if (logs.length > 0) {
    return logs.join('\n');
  }

  return undefined;
}

function resolveModuleExports(moduleObject: JsModuleLike, returnedValue: unknown): unknown {
  if (hasMeaningfulExports(moduleObject.exports)) {
    return moduleObject.exports;
  }

  if (returnedValue !== undefined) {
    return returnedValue;
  }

  return undefined;
}

export function executeWorkspaceJavaScript(
  context: JsBridgeContext & {
    code?: string;
    path?: string;
  },
): JavaScriptWorkspaceExecutionResult {
  const fileCache = context.fileCache ?? new Map<string, string>();
  const envApi = createEnvApi(context.env);
  const entryPath = context.path
    ? resolveFilePath(context.path)
    : context.entryPath
      ? resolveFilePath(context.entryPath)
      : '<inline>';
  const workingDirectory = context.workingDirectory
    ? normalizeWorkspacePath(context.workingDirectory)
    : context.path
      ? dirnameOfPath(entryPath)
      : '';

  const logs: string[] = [];
  const fakeConsole = {
    log: (...args: unknown[]) => {
      logs.push(args.map((arg) => formatJavaScriptResult(arg)).join(' '));
    },
    warn: (...args: unknown[]) => {
      logs.push(`[warn] ${args.map((arg) => formatJavaScriptResult(arg)).join(' ')}`);
    },
    error: (...args: unknown[]) => {
      logs.push(`[error] ${args.map((arg) => formatJavaScriptResult(arg)).join(' ')}`);
    },
    info: (...args: unknown[]) => {
      logs.push(args.map((arg) => formatJavaScriptResult(arg)).join(' '));
    },
    debug: (...args: unknown[]) => {
      logs.push(args.map((arg) => formatJavaScriptResult(arg)).join(' '));
    },
  };

  const moduleCache = new Map<string, JsModuleRecord>();

  const createRequire =
    (baseDirectory: string) =>
    (specifier: string): unknown => {
      const resolvedModulePath = resolveModulePath(specifier, baseDirectory, fileCache);
      return loadModule(resolvedModulePath);
    };

  const loadModule = (modulePath: string): unknown => {
    const existing = moduleCache.get(modulePath);
    if (existing) {
      return existing.exports;
    }

    const record: JsModuleRecord = { exports: {}, loaded: false };
    moduleCache.set(modulePath, record);

    try {
      if (modulePath.endsWith('.json')) {
        const jsonSource = fileCache.get(modulePath);
        if (jsonSource === undefined) {
          throw new Error(`Workspace module not found: ${modulePath}`);
        }
        record.exports = JSON.parse(jsonSource);
        record.loaded = true;
        return record.exports;
      }

      const source = fileCache.get(modulePath);
      if (source === undefined) {
        throw new Error(`Workspace module not found: ${modulePath}`);
      }

      const moduleDirectory = dirnameOfPath(modulePath);
      const moduleObject: JsModuleLike = { exports: record.exports };
      const processApi = createProcessApi({
        entryPath: modulePath,
        argv: context.argv,
        env: context.env,
        getCwd: () => workingDirectory,
      });
      const fsApi = createFsApi(fileCache, () => moduleDirectory);
      const fn = new Function(
        'console',
        'fs',
        'data',
        'env',
        'require',
        'module',
        'exports',
        '__dirname',
        '__filename',
        'process',
        `'use strict';\n${source}`,
      );
      const returnedValue = fn(
        fakeConsole,
        fsApi,
        dataUtils,
        envApi,
        createRequire(moduleDirectory),
        moduleObject,
        moduleObject.exports,
        moduleDirectory,
        modulePath,
        processApi,
      );

      record.exports = resolveModuleExports(moduleObject, returnedValue);
      record.loaded = true;
      return record.exports;
    } catch (error) {
      moduleCache.delete(modulePath);
      throw error;
    }
  };

  const executeInlineCode = (code: string): unknown => {
    const inlineProcess = createProcessApi({
      entryPath,
      argv: context.argv,
      env: context.env,
      getCwd: () => workingDirectory,
    });
    const fsApi = createFsApi(fileCache, () => workingDirectory);
    const moduleObject: JsModuleLike = { exports: {} };
    let lastError: unknown;

    for (const candidate of buildJavaScriptCandidates(code)) {
      try {
        const fn = new Function(
          'console',
          'fs',
          'data',
          'env',
          'require',
          'module',
          'exports',
          '__dirname',
          '__filename',
          'process',
          candidate,
        );
        const returnedValue = fn(
          fakeConsole,
          fsApi,
          dataUtils,
          envApi,
          createRequire(workingDirectory),
          moduleObject,
          moduleObject.exports,
          workingDirectory,
          entryPath,
          inlineProcess,
        );
        return resolveModuleExports(moduleObject, returnedValue);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Unable to execute JavaScript');
  };

  try {
    const result = context.path ? loadModule(entryPath) : executeInlineCode(context.code || '');
    return {
      result: finalizeExecutionResult(result, logs),
      fileCache,
      hadError: false,
    };
  } catch (error) {
    if (logs.length > 0) {
      return {
        result: `${logs.join('\n')}\n[Error: ${formatExecutionError(error)}]`,
        fileCache,
        hadError: true,
      };
    }
    throw error;
  }
}

/**
 * Execute JavaScript code with an enriched bridge context.
 * The code has access to: fs, data, env globals.
 */
export function executeWithBridge(code: string, context: JsBridgeContext = {}): unknown {
  return executeWorkspaceJavaScript({
    ...context,
    code,
    entryPath: context.entryPath || '<inline>',
  }).result;
}

/**
 * Pre-populate the file cache from workspace files so bridge code can access them.
 */
export function buildFileCache(
  files: Array<{ path: string; content: string }>,
): Map<string, string> {
  const cache = new Map<string, string>();
  for (const f of files) {
    const normalizedPath = resolveFilePath(f.path);
    cache.set(normalizedPath, f.content);
  }
  return cache;
}
