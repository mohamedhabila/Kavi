import type { PythonExecutionFailureKind, PythonExecutionResult } from './types';

export function createPythonFailureResult(
  error: string,
  failureKind: PythonExecutionFailureKind,
): PythonExecutionResult {
  return {
    success: false,
    output: '',
    error,
    failureKind,
    networkAccessState: 'unknown',
    networkMutationState: 'unknown',
    networkRequestCount: 0,
  };
}
