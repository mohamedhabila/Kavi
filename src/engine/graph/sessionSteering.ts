import type { Message } from '../../types/message';
import type {
  AgentControlGraphIterationRuntimeState,
  ToolRuntimeBindings,
} from './iterationExecutionTypes';

/**
 * Give the next model step the messages that steered the run since its last step. They
 * join the model-visible messages after the tool results they followed, and the latest
 * becomes the current user message: what the run grounds user-stated facts, goal
 * constraints and clarification requests in from here on.
 */
export function deliverSteeringMessages(params: {
  takeSteeringMessages?: () => ReadonlyArray<Message>;
  runtime: AgentControlGraphIterationRuntimeState;
  toolRuntime: ToolRuntimeBindings;
  recordDelivery: (count: number) => void;
}): { runtime: AgentControlGraphIterationRuntimeState; toolRuntime: ToolRuntimeBindings } {
  const steering = params.takeSteeringMessages?.() ?? [];
  const latest = steering.at(-1);
  if (!latest) return { runtime: params.runtime, toolRuntime: params.toolRuntime };
  params.recordDelivery(steering.length);
  return {
    runtime: {
      ...params.runtime,
      workingMessages: [...params.runtime.workingMessages, ...steering],
    },
    toolRuntime: {
      ...params.toolRuntime,
      currentUserMessage: { id: latest.id, text: latest.content },
    },
  };
}
