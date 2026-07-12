import type { ToolExecutionContext } from '../../src/engine/tools/toolExecutionContext';

export type CanonicalToolExecutor = (
  name: string,
  argsString: string,
  conversationId: string,
  context?: ToolExecutionContext,
) => Promise<string>;

let executionSequence = 0;

function canonicalExecutionContext(context?: ToolExecutionContext): ToolExecutionContext {
  executionSequence += 1;
  return {
    ...context,
    toolCallId: context?.toolCallId ?? `test-tool-call-${executionSequence}`,
    executionRunId: context?.executionRunId ?? `test-execution-run-${executionSequence}`,
  };
}

export function withCanonicalToolExecution<T extends CanonicalToolExecutor>(executor: T): T {
  return ((name, argsString, conversationId, context) =>
    executor(name, argsString, conversationId, canonicalExecutionContext(context))) as T;
}
