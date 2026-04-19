import type { NormalizedPythonExecutionRequest, PythonWorkspaceFile } from './types';
import type { PythonWorkflowBridgeResult, PythonWorkflowBridgeState } from './workflowBridge';

export const DEFAULT_PYTHON_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_PYODIDE_STARTUP_TIMEOUT_MS = 2 * 60 * 1000;
export const DEFAULT_PYODIDE_DISPATCH_ACK_TIMEOUT_MS = 5 * 1000;
export const MAX_PYODIDE_DISPATCH_RETRIES = 1;
export const PYODIDE_RESULT_CACHE_LIMIT = 32;
export const PYODIDE_WEBVIEW_BASE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/';
export const PYODIDE_WEBVIEW_BRIDGE_NAME = '__KAVI_PYODIDE_BRIDGE';

export type PythonRuntimeReadyMessage = {
  type: 'pyodide-ready';
  runtimeId: string;
  error?: string;
};

export type PythonBridgeReadyMessage = {
  type: 'bridge-ready';
  runtimeId: string;
};

export type PythonDispatchAckMessage = {
  type: 'python-dispatch-ack';
  runtimeId: string;
  id: string;
  duplicate?: boolean;
};

export type PythonResultMessage = {
  type: 'python-result';
  runtimeId: string;
  id: string;
  output?: string;
  error?: string;
  durationMs?: number;
  files?: PythonWorkspaceFile[];
  workflowBridge?: PythonWorkflowBridgeResult;
};

export type PythonRuntimeErrorMessage = {
  type: 'python-runtime-error';
  runtimeId: string;
  error: string;
};

export type PythonHttpRequestMessage = {
  type: 'python-http-request';
  runtimeId: string;
  requestId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
  timeoutMs?: number;
};

export type PythonHttpAbortMessage = {
  type: 'python-http-abort';
  runtimeId: string;
  requestId: string;
  reason?: string;
};

export type PythonHttpResponseMessage = {
  type: 'python-http-response';
  runtimeId: string;
  requestId: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
  url?: string;
  redirected?: boolean;
  error?: string;
};

export type PythonRuntimeMessage =
  | PythonBridgeReadyMessage
  | PythonRuntimeReadyMessage
  | PythonDispatchAckMessage
  | PythonResultMessage
  | PythonRuntimeErrorMessage
  | PythonHttpRequestMessage
  | PythonHttpAbortMessage;

export type PythonBridgeMessage = PythonDispatchMessage | PythonHttpResponseMessage;

export type PythonDispatchMessage = {
  type: 'run-python';
  id: string;
  code: NormalizedPythonExecutionRequest['code'];
  scriptPath?: NormalizedPythonExecutionRequest['scriptPath'];
  argv: NormalizedPythonExecutionRequest['argv'];
  files: NormalizedPythonExecutionRequest['files'];
  workingDirectory: NormalizedPythonExecutionRequest['workingDirectory'];
  packages: NormalizedPythonExecutionRequest['packages'];
  indexUrls: NormalizedPythonExecutionRequest['indexUrls'];
  env: NormalizedPythonExecutionRequest['env'];
  workflowBridge?: PythonWorkflowBridgeState;
};
