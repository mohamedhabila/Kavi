import { executePython } from '../../services/python/pyodideBridge';
import { getOptionalToolStringArg } from './fileArgumentUtils';
import { normalizePythonToolResult } from './resultNormalization/runtimeResult';
import type { ToolExecutionContext } from './toolExecutionContext';
import {
  persistPythonWorkspaceFiles,
  preparePythonWorkspaceExecution,
} from './toolWorkspaceSnapshots';
import { sanitizeToolWorkspacePath } from './toolWorkspaceFiles';

const MAX_PYTHON_TOOL_TIMEOUT_MS = 15 * 60 * 1000;
const PYTHON_HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;

function normalizePythonPackages(value: unknown): { packages?: string[]; error?: string } {
  if (value == null) {
    return { packages: undefined };
  }

  if (!Array.isArray(value)) {
    return { error: 'Error: "packages" for python must be an array of strings when provided' };
  }

  const packages: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return { error: 'Error: "packages" for python must be an array of strings when provided' };
    }

    const normalized = entry.trim();
    if (normalized) {
      packages.push(normalized);
    }
  }

  return { packages: Array.from(new Set(packages)) };
}

function normalizePythonIndexUrls(value: unknown): { indexUrls?: string[]; error?: string } {
  if (value == null) {
    return { indexUrls: undefined };
  }

  if (!Array.isArray(value)) {
    return {
      error: 'Error: "indexUrls" for python must be an array of HTTP(S) URLs when provided',
    };
  }

  const indexUrls: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return {
        error: 'Error: "indexUrls" for python must be an array of HTTP(S) URLs when provided',
      };
    }

    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }

    if (!PYTHON_HTTP_URL_PATTERN.test(normalized)) {
      return { error: 'Error: "indexUrls" for python must contain only HTTP(S) URLs' };
    }

    indexUrls.push(normalized);
  }

  return { indexUrls: Array.from(new Set(indexUrls)) };
}

function normalizePythonArgv(value: unknown): { argv?: string[]; error?: string } {
  if (value == null) {
    return { argv: undefined };
  }

  if (!Array.isArray(value)) {
    return { error: 'Error: "argv" for python must be an array of strings when provided' };
  }

  const argv: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return { error: 'Error: "argv" for python must be an array of strings when provided' };
    }
    argv.push(entry);
  }

  return { argv };
}

function normalizePythonEnv(value: unknown): { env?: Record<string, string>; error?: string } {
  if (value == null) {
    return { env: undefined };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Error: "env" for python must be an object of string values when provided' };
  }

  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      return { error: 'Error: "env" for python must be an object of string values when provided' };
    }
    env[key] = entry;
  }

  return { env };
}

function normalizePythonTimeoutMs(value: unknown): { timeoutMs?: number; error?: string } {
  if (value == null) {
    return { timeoutMs: undefined };
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { error: 'Error: "timeoutMs" for python must be a finite number when provided' };
  }

  const normalized = Math.trunc(value);
  if (normalized < 1000 || normalized > MAX_PYTHON_TOOL_TIMEOUT_MS) {
    return {
      error: `Error: "timeoutMs" for python must be between 1000 and ${MAX_PYTHON_TOOL_TIMEOUT_MS} milliseconds`,
    };
  }

  return { timeoutMs: normalized };
}

export async function executePythonTool(
  args: {
    code?: string;
    path?: string;
    scriptPath?: string;
    packages?: string[];
    indexUrls?: string[];
    argv?: string[];
    env?: Record<string, string>;
    timeoutMs?: number;
  },
  _conversationId: string,
  workspaceConversationId: string,
  context?: ToolExecutionContext,
): Promise<string> {
  try {
    const rawArgs = args as Record<string, unknown>;
    const codeArg = getOptionalToolStringArg(rawArgs, 'code', 'python');
    if (codeArg.error) {
      return codeArg.error;
    }

    const pathArg = getOptionalToolStringArg(rawArgs, 'path', 'python');
    if (pathArg.error) {
      return pathArg.error;
    }

    const scriptPathArg =
      pathArg.value == null
        ? getOptionalToolStringArg(rawArgs, 'scriptPath', 'python')
        : { value: undefined as string | undefined };
    if (scriptPathArg.error) {
      return scriptPathArg.error;
    }

    const selectedPath = pathArg.value ?? scriptPathArg.value;
    if (!codeArg.value && !selectedPath) {
      return 'Error: python requires either "code" or "path".';
    }

    if (codeArg.value && selectedPath) {
      return 'Error: python accepts either "code" or "path", not both.';
    }

    const packagesArg = normalizePythonPackages(rawArgs?.packages);
    if (packagesArg.error) {
      return packagesArg.error;
    }

    const indexUrlsArg = normalizePythonIndexUrls(rawArgs?.indexUrls);
    if (indexUrlsArg.error) {
      return indexUrlsArg.error;
    }

    const argvArg = normalizePythonArgv(rawArgs?.argv);
    if (argvArg.error) {
      return argvArg.error;
    }

    const envArg = normalizePythonEnv(rawArgs?.env);
    if (envArg.error) {
      return envArg.error;
    }

    const timeoutArg = normalizePythonTimeoutMs(rawArgs?.timeoutMs);
    if (timeoutArg.error) {
      return timeoutArg.error;
    }

    if (codeArg.value && argvArg.argv?.length) {
      return 'Error: "argv" for python can only be used with "path".';
    }

    let result;
    if (selectedPath) {
      const safePath = sanitizeToolWorkspacePath(selectedPath);
      if (!safePath) {
        return 'Error: "path" is required for python and must not be empty.';
      }

      const prepared = await preparePythonWorkspaceExecution(
        workspaceConversationId,
        safePath,
        context?.workspaceReadFallbackConversationId,
      );
      result = await executePython({
        scriptPath: safePath,
        argv: argvArg.argv,
        files: prepared.files,
        workingDirectory: '',
        packages: Array.from(new Set([...(packagesArg.packages || []), ...prepared.packages])),
        ...(indexUrlsArg.indexUrls ? { indexUrls: indexUrlsArg.indexUrls } : {}),
        env: envArg.env,
        ...(timeoutArg.timeoutMs != null ? { timeoutMs: timeoutArg.timeoutMs } : {}),
      });
    } else {
      const prepared = await preparePythonWorkspaceExecution(
        workspaceConversationId,
        undefined,
        context?.workspaceReadFallbackConversationId,
      );
      result = await executePython({
        code: codeArg.value!,
        files: prepared.files,
        workingDirectory: '',
        packages: Array.from(new Set([...(packagesArg.packages || []), ...prepared.packages])),
        ...(indexUrlsArg.indexUrls ? { indexUrls: indexUrlsArg.indexUrls } : {}),
        env: envArg.env,
        ...(timeoutArg.timeoutMs != null ? { timeoutMs: timeoutArg.timeoutMs } : {}),
      });
    }

    if (result.files?.length) {
      await persistPythonWorkspaceFiles(workspaceConversationId, result.files);
    }

    const normalizedResult = normalizePythonToolResult(result);
    if (!result.success) {
      return `Error: ${normalizedResult}`;
    }

    return normalizedResult;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}
