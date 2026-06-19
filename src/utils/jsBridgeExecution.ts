import { buildJavaScriptCandidates, formatJavaScriptResult } from './javascript';
import {
  createBridgeBuiltins,
  createBridgeGlobal,
  dirnameOfPath,
  formatExecutionError,
  normalizeWorkspacePath,
  resolveBridgeBuiltinModule,
  resolveFilePath,
  resolveModulePath,
} from './jsBridgeBindings';
import type {
  JavaScriptWorkspaceExecutionResult,
  JsBridgeContext,
} from './jsBridgeTypes';

type JsModuleRecord = {
  exports: unknown;
  loaded: boolean;
};

type JsModuleLike = {
  exports: unknown;
};

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

function createRuntimeExecutor(source: string): (runtime: Record<string, unknown>) => unknown {
  // Workspace JavaScript uses dynamic execution to provide a small CommonJS-like
  // runtime over the conversation file cache. The runtime limits require/fs to
  // bridge-provided APIs, but it is not an isolation boundary for hostile code.
  return new Function(
    'runtime',
    `const {
      console,
      fs,
      data,
      env,
      require,
      module,
      exports,
      __dirname,
      __filename,
      process,
      global,
      globalThis,
      self,
    } = runtime;
    return (function() {
      'use strict';
      ${source}
    })();`,
  ) as (runtime: Record<string, unknown>) => unknown;
}

export function executeWorkspaceJavaScript(
  context: JsBridgeContext & {
    code?: string;
    path?: string;
  },
): JavaScriptWorkspaceExecutionResult {
  const fileCache = context.fileCache ?? new Map<string, string>();
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
  const moduleCache = new Map<string, JsModuleRecord>();

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
      let requireForModule: (specifier: string) => unknown = () => {
        throw new Error('Module require invoked before initialization.');
      };
      const builtins = createBridgeBuiltins({
        env: context.env,
        fileCache,
        entryPath: modulePath,
        argv: context.argv,
        getBaseDirectory: () => moduleDirectory,
        getCwd: () => workingDirectory,
        logs,
      });
      requireForModule = (specifier: string): unknown => {
        const bridgeBuiltin = resolveBridgeBuiltinModule(specifier, builtins);
        if (bridgeBuiltin !== undefined) {
          return bridgeBuiltin;
        }
        const resolvedModulePath = resolveModulePath(specifier, moduleDirectory, fileCache);
        return loadModule(resolvedModulePath);
      };
      const runtimeGlobal = createBridgeGlobal({
        console: builtins.console,
        fs: builtins.fs,
        data: builtins.data,
        env: builtins.env,
        require: requireForModule,
        module: moduleObject,
        exports: moduleObject.exports,
        __dirname: moduleDirectory,
        __filename: modulePath,
        process: builtins.process,
      });
      const returnedValue = createRuntimeExecutor(source)({
        console: builtins.console,
        fs: builtins.fs,
        data: builtins.data,
        env: builtins.env,
        require: requireForModule,
        module: moduleObject,
        exports: moduleObject.exports,
        __dirname: moduleDirectory,
        __filename: modulePath,
        process: builtins.process,
        global: runtimeGlobal,
        globalThis: runtimeGlobal,
        self: runtimeGlobal,
      });

      record.exports = resolveModuleExports(moduleObject, returnedValue);
      record.loaded = true;
      return record.exports;
    } catch (error) {
      moduleCache.delete(modulePath);
      throw error;
    }
  };

  const executeInlineCode = (code: string): unknown => {
    const moduleObject: JsModuleLike = { exports: {} };
    let requireForInline: (specifier: string) => unknown = () => {
      throw new Error('Inline require invoked before initialization.');
    };
    const builtins = createBridgeBuiltins({
      env: context.env,
      fileCache,
      entryPath,
      argv: context.argv,
      getBaseDirectory: () => workingDirectory,
      getCwd: () => workingDirectory,
      logs,
    });
    requireForInline = (specifier: string): unknown => {
      const bridgeBuiltin = resolveBridgeBuiltinModule(specifier, builtins);
      if (bridgeBuiltin !== undefined) {
        return bridgeBuiltin;
      }
      const resolvedModulePath = resolveModulePath(specifier, workingDirectory, fileCache);
      return loadModule(resolvedModulePath);
    };
    const runtimeGlobal = createBridgeGlobal({
      console: builtins.console,
      fs: builtins.fs,
      data: builtins.data,
      env: builtins.env,
      require: requireForInline,
      module: moduleObject,
      exports: moduleObject.exports,
      __dirname: workingDirectory,
      __filename: entryPath,
      process: builtins.process,
    });
    let lastError: unknown;

    for (const candidate of buildJavaScriptCandidates(code)) {
      try {
        const returnedValue = createRuntimeExecutor(candidate)({
          console: builtins.console,
          fs: builtins.fs,
          data: builtins.data,
          env: builtins.env,
          require: requireForInline,
          module: moduleObject,
          exports: moduleObject.exports,
          __dirname: workingDirectory,
          __filename: entryPath,
          process: builtins.process,
          global: runtimeGlobal,
          globalThis: runtimeGlobal,
          self: runtimeGlobal,
        });
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

export function executeWithBridge(code: string, context: JsBridgeContext = {}): unknown {
  return executeWorkspaceJavaScript({
    ...context,
    code,
    entryPath: context.entryPath || '<inline>',
  }).result;
}

export function buildFileCache(
  files: Array<{ path: string; content: string }>,
): Map<string, string> {
  const cache = new Map<string, string>();
  for (const file of files) {
    const normalizedPath = resolveFilePath(file.path);
    cache.set(normalizedPath, file.content);
  }
  return cache;
}
