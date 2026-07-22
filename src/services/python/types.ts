import type { PythonWorkflowBridgeResult, PythonWorkflowBridgeState } from './workflowBridge';

/* istanbul ignore file */

export interface PythonWorkspaceFile {
  path: string;
  contentBase64: string;
}

export type PythonExecutionFailureKind =
  | 'invalid_request'
  | 'runtime_unavailable'
  | 'runtime_failed'
  | 'execution_failed'
  | 'workspace_persistence_failed'
  | 'timed_out';

export type PythonNetworkAccessState = 'blocked' | 'enabled' | 'unknown';
export type PythonNetworkMutationState = 'none_observed' | 'possible' | 'unknown';

interface PythonExecutionResultBase {
  output: string;
  networkAccessState: PythonNetworkAccessState;
  networkMutationState: PythonNetworkMutationState;
  networkRequestCount: number;
  durationMs?: number;
  files?: PythonWorkspaceFile[];
  workflowBridge?: PythonWorkflowBridgeResult;
}

export type PythonExecutionResult = PythonExecutionResultBase &
  (
    | { success: true; error?: never; failureKind?: never }
    | { success: false; error: string; failureKind: PythonExecutionFailureKind }
  );

export interface PythonExecutionRequest {
  code?: string;
  scriptPath?: string;
  argv?: string[];
  files?: PythonWorkspaceFile[];
  workingDirectory?: string;
  packages?: string[];
  indexUrls?: string[];
  env?: Record<string, string>;
  allowNetwork?: boolean;
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
  allowNetwork: boolean;
  timeoutMs: number;
  workflowBridge?: PythonWorkflowBridgeState;
}

export type {
  PythonWorkflowBridgeEvidenceEntry,
  PythonWorkflowBridgeResult,
  PythonWorkflowBridgeState,
} from './workflowBridge';
