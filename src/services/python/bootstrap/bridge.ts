import { PYTHON_HTTP_BRIDGE_HELPER_SOURCE } from './source/pythonHttpBridge';
import {
  PYTHON_RUNTIME_ENVIRONMENT_HELPER_SOURCE,
  PYTHON_RUNTIME_EXECUTION_HELPER_SOURCE,
} from './source/pythonEnvironment';
import { NATIVE_HTTP_BRIDGE_WORKER_SOURCE } from './source/nativeHttpBridge';
import { WORKFLOW_BRIDGE_WORKER_SOURCE } from './source/workflowBridge';

export const PYODIDE_RUNTIME_HELPERS = [
  ...PYTHON_RUNTIME_ENVIRONMENT_HELPER_SOURCE,
  ...PYTHON_HTTP_BRIDGE_HELPER_SOURCE,
  ...PYTHON_RUNTIME_EXECUTION_HELPER_SOURCE,
].join('\n');

export function buildWorkflowBridgeWorkerSource(): string[] {
  return WORKFLOW_BRIDGE_WORKER_SOURCE.slice();
}

export function buildNativeHttpBridgeWorkerSource(): string[] {
  return NATIVE_HTTP_BRIDGE_WORKER_SOURCE.slice();
}
