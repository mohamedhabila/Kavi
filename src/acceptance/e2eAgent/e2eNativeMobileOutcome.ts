import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';

export type E2ENativeMobileOutcome = ToolRuntimeOutcome;

function serializeFixtureContent(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function completedE2ENativeOutcome(value: unknown): E2ENativeMobileOutcome {
  return completedToolOutcome(serializeFixtureContent(value));
}

export function failedE2ENativeOutcome(value: unknown): E2ENativeMobileOutcome {
  return failedToolOutcome(serializeFixtureContent(value));
}
