import { formatJavaScriptResult } from './javascript';
import type { JsBridgeContext } from './jsBridgeTypes';

type JsProcessApi = {
  argv: string[];
  env: Record<string, string>;
  platform: 'react-native';
  cwd: () => string;
};

type JsFsApi = ReturnType<typeof createFsApi>;

type JsBridgeBuiltins = {
  console: ReturnType<typeof createFakeConsole>;
  fs: JsFsApi;
  data: typeof dataUtils;
  env: ReturnType<typeof createEnvApi>;
  process: JsProcessApi;
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

function splitPathSegments(path: string): string[] {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function normalizeWorkspacePath(inputPath: string, baseDirectory = ''): string {
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

export function dirnameOfPath(path: string): string {
  const segments = splitPathSegments(path);
  segments.pop();
  return segments.join('/');
}

export function resolveFilePath(inputPath: string, baseDirectory = ''): string {
  const resolved = normalizeWorkspacePath(inputPath, baseDirectory);
  if (!resolved) {
    throw new Error('Workspace file path must not resolve to the workspace root.');
  }
  return resolved;
}

function resolveDirectoryPath(inputPath: string | undefined, baseDirectory = ''): string {
  if (!inputPath || inputPath.trim() === '' || inputPath.trim() === '.') {
    return normalizeWorkspacePath(baseDirectory);
  }
  return normalizeWorkspacePath(inputPath, baseDirectory);
}

export function resolveModulePath(
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

export function formatExecutionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createProcessApi(context: {
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

function validateTextEncoding(encoding: unknown): void {
  if (encoding == null) {
    return;
  }

  const normalized = String(encoding).trim().toLowerCase();
  if (normalized && normalized !== 'utf8' && normalized !== 'utf-8') {
    throw new Error(`Unsupported encoding "${String(encoding)}". Only utf8 text is supported.`);
  }
}

function listDirectoryEntries(
  cache: Map<string, string>,
  directoryPath: string,
): string[] {
  const prefix = directoryPath ? `${directoryPath}/` : '';
  const entries = new Set<string>();

  for (const filePath of cache.keys()) {
    if (prefix && !filePath.startsWith(prefix)) {
      continue;
    }

    const relativePath = prefix ? filePath.slice(prefix.length) : filePath;
    if (!relativePath) {
      continue;
    }

    const head = relativePath.split('/')[0];
    if (head) {
      entries.add(head);
    }
  }

  return Array.from(entries).sort((left, right) => left.localeCompare(right));
}

export function createFsApi(cache: Map<string, string>, getBaseDirectory: () => string) {
  const readFile = (path: string): string => {
    const resolvedPath = resolveFilePath(path, getBaseDirectory());
    const content = cache.get(resolvedPath);
    if (content === undefined) {
      throw new Error(`File not found in bridge cache: ${resolvedPath}.`);
    }
    return content;
  };

  const writeFile = (path: string, content: string): void => {
    if (typeof content !== 'string') {
      throw new Error('Content must be a string');
    }
    const resolvedPath = resolveFilePath(path, getBaseDirectory());
    cache.set(resolvedPath, content);
  };

  const exists = (path: string): boolean => {
    const resolvedPath = resolveFilePath(path, getBaseDirectory());
    return cache.has(resolvedPath);
  };

  const deleteFile = (path: string): boolean => {
    const resolvedPath = resolveFilePath(path, getBaseDirectory());
    return cache.delete(resolvedPath);
  };

  return {
    readFile,
    readFileSync: (path: string, encoding?: string): string => {
      validateTextEncoding(encoding);
      return readFile(path);
    },
    writeFile,
    writeFileSync: (path: string, content: string): void => {
      writeFile(path, content);
    },
    exists,
    existsSync: (path: string): boolean => exists(path),
    listFiles: (): string[] =>
      Array.from(cache.keys()).sort((left, right) => left.localeCompare(right)),
    readdirSync: (path = '.'): string[] =>
      listDirectoryEntries(cache, resolveDirectoryPath(path, getBaseDirectory())),
    deleteFile,
    unlinkSync: (path: string): void => {
      deleteFile(path);
    },
    rmSync: (path: string): void => {
      deleteFile(path);
    },
    mkdirSync: (path = '.'): void => {
      resolveDirectoryPath(path, getBaseDirectory());
    },
  };
}

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
      for (let index = 0; index < line.length; index++) {
        const character = line[index];
        if (character === '"') {
          if (inQuotes && line[index + 1] === '"') {
            current += '"';
            index++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (character === delimiter && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else {
          current += character;
        }
      }
      cells.push(current.trim());
      rows.push(cells);
    }
    return rows;
  },
  parseYAML: (text: string): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    const lines = text.split('\n');
    let currentKey = '';

    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
      if (match) {
        const [, , key, value] = match;
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
          result[key.trim()] = trimmedValue.replace(/^["'](.*)["']$/, '$1');
        }
      } else if (currentKey && line.startsWith('  ')) {
        const existing = result[currentKey];
        result[currentKey] = (existing ? `${existing}\n` : '') + line.trim();
      }
    }
    return result;
  },
  toJSON: (value: unknown, indent = 2): string => JSON.stringify(value, null, indent),
  toCSV: (rows: string[][]): string =>
    rows
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
      .join('\n'),
};

export function createEnvApi(env?: Record<string, string>) {
  return {
    get: (key: string): string | undefined => env?.[key],
    platform: 'react-native' as const,
    now: (): number => Date.now(),
    timestamp: (): string => new Date().toISOString(),
  };
}

export function createFakeConsole(logs: string[]) {
  return {
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
}

export function createBridgeBuiltins(params: {
  env?: JsBridgeContext['env'];
  fileCache: Map<string, string>;
  entryPath: string;
  argv?: JsBridgeContext['argv'];
  getBaseDirectory: () => string;
  getCwd: () => string;
  logs: string[];
}): JsBridgeBuiltins {
  return {
    console: createFakeConsole(params.logs),
    fs: createFsApi(params.fileCache, params.getBaseDirectory),
    data: dataUtils,
    env: createEnvApi(params.env),
    process: createProcessApi({
      entryPath: params.entryPath,
      argv: params.argv,
      env: params.env,
      getCwd: params.getCwd,
    }),
  };
}

export function resolveBridgeBuiltinModule(
  specifier: string,
  builtins: JsBridgeBuiltins,
): unknown | undefined {
  switch (specifier) {
    case 'fs':
    case 'node:fs':
      return builtins.fs;
    case 'data':
      return builtins.data;
    case 'env':
      return builtins.env;
    case 'process':
    case 'node:process':
      return builtins.process;
    case 'console':
    case 'node:console':
      return builtins.console;
    default:
      return undefined;
  }
}

export function createBridgeGlobal(bindings: {
  console: JsBridgeBuiltins['console'];
  fs: JsBridgeBuiltins['fs'];
  data: JsBridgeBuiltins['data'];
  env: JsBridgeBuiltins['env'];
  require: (specifier: string) => unknown;
  module: { exports: unknown };
  exports: unknown;
  __dirname: string;
  __filename: string;
  process: JsBridgeBuiltins['process'];
}): Record<string, unknown> {
  const runtimeGlobal: Record<string, unknown> = {
    console: bindings.console,
    fs: bindings.fs,
    data: bindings.data,
    env: bindings.env,
    require: bindings.require,
    module: bindings.module,
    exports: bindings.exports,
    __dirname: bindings.__dirname,
    __filename: bindings.__filename,
    process: bindings.process,
  };
  runtimeGlobal.global = runtimeGlobal;
  runtimeGlobal.globalThis = runtimeGlobal;
  runtimeGlobal.self = runtimeGlobal;
  return runtimeGlobal;
}
