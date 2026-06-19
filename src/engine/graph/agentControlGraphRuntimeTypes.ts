import type { AgentRunControlGraphState } from '../../types/agentRun';
import type {
  AssistantMessageMetadata,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import type { AgentControlGraphEvent } from './agentControlGraph';

export type TerminalGraphEvent = Extract<
  AgentControlGraphEvent,
  | { type: 'BLOCKED' }
  | { type: 'FINALIZED' }
  | { type: 'YIELDED' }
  | { type: 'CANCELLED' }
  | { type: 'FAILED' }
>;

export type RuntimeCallbacks = {
  onAgentControlGraphStateChange?: (state: AgentRunControlGraphState) => void;
  onAssistantMessage: (
    content: string,
    toolCalls?: ToolCall[],
    providerReplay?: MessageProviderReplay,
    assistantCompletion?: AssistantMessageMetadata,
  ) => void;
  onStateChange: (state: 'idle' | 'error') => void;
  onError: (error: Error) => void;
  onDone: () => void;
};
