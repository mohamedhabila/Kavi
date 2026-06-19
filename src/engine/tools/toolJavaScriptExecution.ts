import { formatJavaScriptResult } from '../../utils/javascript';
import { buildFileCache, executeWorkspaceJavaScript } from '../../utils/jsBridgeExecution';
import { getOptionalToolStringArg } from './fileArgumentUtils';
import { normalizeJavaScriptToolResult } from './resultNormalization/runtimeResult';
import {
  persistJavaScriptWorkspaceChanges,
  prepareJavaScriptWorkspaceExecution,
} from './toolWorkspaceSnapshots';
import { sanitizeToolWorkspacePath } from './toolWorkspaceFiles';

function diffJavaScriptWorkspaceFiles(
  initialFiles: Map<string, string>,
  nextFiles: Map<string, string>,
): {
  changedFiles: Array<{ path: string; content: string }>;
  deletedPaths: string[];
} {
  const changedFiles: Array<{ path: string; content: string }> = [];
  for (const [path, content] of nextFiles.entries()) {
    if (initialFiles.get(path) !== content) {
      changedFiles.push({ path, content });
    }
  }

  const deletedPaths = Array.from(initialFiles.keys())
    .filter((path) => !nextFiles.has(path))
    .sort((left, right) => left.localeCompare(right));

  changedFiles.sort((left, right) => left.path.localeCompare(right.path));
  return { changedFiles, deletedPaths };
}

function normalizeJavaScriptArgv(value: unknown): { argv?: string[]; error?: string } {
  if (value == null) {
    return { argv: undefined };
  }

  if (!Array.isArray(value)) {
    return { error: 'Error: "argv" for javascript must be an array of strings when provided' };
  }

  const argv: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return { error: 'Error: "argv" for javascript must be an array of strings when provided' };
    }
    argv.push(entry);
  }

  return { argv };
}

function normalizeJavaScriptEnv(value: unknown): { env?: Record<string, string>; error?: string } {
  if (value == null) {
    return { env: undefined };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      error: 'Error: "env" for javascript must be an object of string values when provided',
    };
  }

  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      return {
        error: 'Error: "env" for javascript must be an object of string values when provided',
      };
    }
    env[key] = entry;
  }

  return { env };
}

export async function executeJavascript(
  args: {
    code?: string;
    path?: string;
    scriptPath?: string;
    argv?: string[];
    env?: Record<string, string>;
  },
  conversationId: string,
  fallbackConversationId?: string,
): Promise<string> {
  try {
    const rawArgs = args as Record<string, unknown>;
    const codeArg = getOptionalToolStringArg(rawArgs, 'code', 'javascript');
    if (codeArg.error) {
      return codeArg.error;
    }

    const pathArg = getOptionalToolStringArg(rawArgs, 'path', 'javascript');
    if (pathArg.error) {
      return pathArg.error;
    }

    const scriptPathArg =
      pathArg.value == null
        ? getOptionalToolStringArg(rawArgs, 'scriptPath', 'javascript')
        : { value: undefined as string | undefined };
    if (scriptPathArg.error) {
      return scriptPathArg.error;
    }

    const argvArg = normalizeJavaScriptArgv(rawArgs.argv);
    if (argvArg.error) {
      return argvArg.error;
    }

    const envArg = normalizeJavaScriptEnv(rawArgs.env);
    if (envArg.error) {
      return envArg.error;
    }

    const selectedPath = pathArg.value ?? scriptPathArg.value;
    if (!codeArg.value && !selectedPath) {
      return 'Error: javascript requires either "code" or "path".';
    }

    if (codeArg.value && selectedPath) {
      return 'Error: javascript accepts either "code" or "path", not both.';
    }

    const safePath = selectedPath ? sanitizeToolWorkspacePath(selectedPath) : undefined;
    if (selectedPath && !safePath) {
      return 'Error: "path" is required for javascript and must not be empty.';
    }

    const workspaceFiles = await prepareJavaScriptWorkspaceExecution(
      conversationId,
      fallbackConversationId,
    );
    const initialCache = buildFileCache(workspaceFiles);
    const nextCache = new Map(initialCache);
    const execution = executeWorkspaceJavaScript({
      ...(safePath ? { path: safePath } : { code: codeArg.value! }),
      fileCache: nextCache,
      workingDirectory: '',
      argv: argvArg.argv,
      env: envArg.env,
    });

    const output =
      execution.result !== undefined
        ? formatJavaScriptResult(execution.result)
        : '(no return value)';

    if (execution.hadError) {
      return output;
    }

    const { changedFiles, deletedPaths } = diffJavaScriptWorkspaceFiles(
      initialCache,
      execution.fileCache,
    );
    if (changedFiles.length > 0 || deletedPaths.length > 0) {
      await persistJavaScriptWorkspaceChanges(conversationId, changedFiles, deletedPaths);
    }

    return normalizeJavaScriptToolResult({
      output,
      files: changedFiles,
      deletedPaths,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error: ${message}`;
  }
}
