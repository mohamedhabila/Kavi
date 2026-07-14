/**
 * Terminal status is owned by the executor. Result content is opaque and must
 * never be inspected to infer whether execution succeeded.
 */
export type ToolRuntimeOutcome = Readonly<{
  status: 'completed' | 'failed';
  content: string;
}>;

export function completedToolOutcome(content: string): ToolRuntimeOutcome {
  return Object.freeze({ status: 'completed', content });
}

export function failedToolOutcome(content: string): ToolRuntimeOutcome {
  return Object.freeze({ status: 'failed', content });
}
