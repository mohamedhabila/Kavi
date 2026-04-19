import type { PythonWorkflowBridgeResult, PythonWorkflowBridgeState } from './workflowBridge';

/* istanbul ignore file */

export interface PythonWorkspaceFile {
  path: string;
  contentBase64: string;
}

export interface PythonExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs?: number;
  files?: PythonWorkspaceFile[];
  workflowBridge?: PythonWorkflowBridgeResult;
}

export interface PythonExecutionRequest {
  code?: string;
  scriptPath?: string;
  argv?: string[];
  files?: PythonWorkspaceFile[];
  workingDirectory?: string;
  packages?: string[];
  indexUrls?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  workflowBridge?: PythonWorkflowBridgeState;
}

export interface NormalizedPythonExecutionRequest {
  code: string;
  scriptPath?: string;
  argv: string[];
  files: PythonWorkspaceFile[];
  workingDirectory: string;
  packages: string[];
  indexUrls: string[];
  env: Record<string, string>;
  timeoutMs: number;
  workflowBridge?: PythonWorkflowBridgeState;
}

export type {
  PythonWorkflowBridgeEvidenceEntry,
  PythonWorkflowBridgeResult,
  PythonWorkflowBridgeState,
} from './workflowBridge';
