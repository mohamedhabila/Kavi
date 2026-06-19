import { parseJsonRecord } from './support';
import { applyTrackedExpoToolResult } from './expoAdapter';
import { applyTrackedSessionToolResult } from './sessionAdapter';
import { applyTrackedSshToolResult } from './sshAdapter';
import type { TrackedAsyncOperation } from './types';

export function applyTrackedAsyncToolResult(
  trackedOperations: Map<string, TrackedAsyncOperation>,
  toolName: string,
  toolArguments: string,
  toolResult: string,
): void {
  const parsedResult = parseJsonRecord(toolResult);

  if (
    applyTrackedSessionToolResult(
      trackedOperations,
      toolName,
      toolArguments,
      toolResult,
      parsedResult,
    )
  ) {
    return;
  }

  if (applyTrackedExpoToolResult(trackedOperations, toolName, toolArguments, parsedResult)) {
    return;
  }

  applyTrackedSshToolResult(trackedOperations, toolName, toolArguments, parsedResult);
}
