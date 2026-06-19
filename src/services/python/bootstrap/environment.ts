import { buildPyodideHtml as buildHtml } from './source/html';
import { RUNTIME_ENVIRONMENT_WORKER_SOURCE } from './source/runtimeEnvironment';
import {
  WORKSPACE_ENVIRONMENT_WORKER_SOURCE,
  WORKSPACE_MOUNT_WORKER_SOURCE,
} from './source/workspaceEnvironment';
import { PYODIDE_WEBVIEW_BASE_URL } from '../runtimeProtocol';

export function buildRuntimeEnvironmentWorkerSource(): string[] {
  return RUNTIME_ENVIRONMENT_WORKER_SOURCE.slice();
}

export function buildWorkspaceEnvironmentWorkerSource(): string[] {
  return WORKSPACE_ENVIRONMENT_WORKER_SOURCE.slice();
}

export function buildWorkspaceMountWorkerSource(): string[] {
  return WORKSPACE_MOUNT_WORKER_SOURCE.slice();
}

export function buildPyodideBootWorkerSource(): string[] {
  return [
    'async function bootPyodide() {',
    '  try {',
    `    importScripts(${JSON.stringify(`${PYODIDE_WEBVIEW_BASE_URL}pyodide.js`)});`,
    `    pyodide = await loadPyodide({ indexURL: ${JSON.stringify(PYODIDE_WEBVIEW_BASE_URL)} });`,
    '    pyodide.setStdout({ batched: onStdout });',
    '    pyodide.setStderr({ batched: onStderr });',
    '    await pyodide.loadPackage("micropip");',
    '    await pyodide.runPythonAsync(PYODIDE_RUNTIME_HELPERS);',
    '    installedPackageSpecs = Object.create(null);',
    '    self.postMessage({ type: "pyodide-ready" });',
    '  } catch (error) {',
    '    bootError = error;',
    '    self.postMessage({ type: "pyodide-ready", error: formatError(error) });',
    '    throw error;',
    '  }',
    '}',
    '',
    'var pyodideReadyPromise = bootPyodide();',
    '',
  ];
}

export function buildPyodideHtml(workerSource: string): string {
  return buildHtml(workerSource);
}
