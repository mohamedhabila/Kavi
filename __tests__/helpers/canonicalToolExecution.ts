import type { ToolExecutionContext } from '../../src/engine/tools/toolExecutionContext';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import type { ToolRuntimeOutcome } from '../../src/types/toolRuntimeOutcome';

export type CanonicalToolExecutor = (
  name: string,
  argsString: string,
  conversationId: string,
  context?: ToolExecutionContext,
) => Promise<ToolRuntimeOutcome>;

let executionSequence = 0;

function canonicalExecutionContext(context?: ToolExecutionContext): ToolExecutionContext {
  executionSequence += 1;
  return {
    ...context,
    toolCallId: context?.toolCallId ?? `test-tool-call-${executionSequence}`,
    executionRunId: context?.executionRunId ?? `test-execution-run-${executionSequence}`,
    modelTurnMemoryPolicyBinding:
      context?.modelTurnMemoryPolicyBinding ?? POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
  };
}

export function withCanonicalToolExecution<T extends CanonicalToolExecutor>(executor: T): T {
  return ((name, argsString, conversationId, context) =>
    executor(name, argsString, conversationId, canonicalExecutionContext(context))) as T;
}
