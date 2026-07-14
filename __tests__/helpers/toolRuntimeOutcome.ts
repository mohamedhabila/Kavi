import type { ToolRuntimeOutcome } from '../../src/types/toolRuntimeOutcome';

export function completedToolContent(outcome: ToolRuntimeOutcome): string {
  expect(outcome.status).toBe('completed');
  return outcome.content;
}

export function failedToolContent(outcome: ToolRuntimeOutcome): string {
  expect(outcome.status).toBe('failed');
  return outcome.content;
}

export function parseCompletedToolOutcome(outcome: ToolRuntimeOutcome) {
  return JSON.parse(completedToolContent(outcome));
}

export function parseFailedToolOutcome(outcome: ToolRuntimeOutcome) {
  return JSON.parse(failedToolContent(outcome));
}
