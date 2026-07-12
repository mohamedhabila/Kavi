import type {
  AssistantMessageMetadata,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import { emitSessionEvent } from '../../services/events/bus';
import { hasSettledFinalAssistantMetadata } from '../../utils/assistantMessageMetadata';
import type { AgentControlGraphEvent, AgentControlGraphSnapshot } from './agentControlGraph';
import type { RuntimeCallbacks, TerminalGraphEvent } from './agentControlGraphRuntimeTypes';

type ApplyEvents = (events: ReadonlyArray<AgentControlGraphEvent>) => AgentControlGraphSnapshot;

export function createAgentControlGraphRuntimeTerminal(params: {
  callbacks: RuntimeCallbacks;
  conversationId: string;
  applyEvents: ApplyEvents;
  agentRunId?: string;
  signal?: AbortController;
  warn?: (message: string, error: unknown) => void;
}) {
  const emitTerminalSessionEnd = async (reason?: string): Promise<void> => {
    try {
      await emitSessionEvent('end', {
        conversationId: params.conversationId,
        ...(reason ? { reason } : {}),
        agentRunId: params.agentRunId,
        executionSignal: params.signal,
      });
    } catch (error: unknown) {
      params.warn?.('Agent control graph terminal session end event failed', error);
    }
  };

  const finishTerminalRunWithGraphEvent = async (args: {
    graphEvent: TerminalGraphEvent;
    state: 'idle' | 'error';
    sessionEndReason?: string;
    assistant?: {
      content: string;
      toolCalls?: ToolCall[];
      providerReplay?: MessageProviderReplay;
      metadata: AssistantMessageMetadata;
    };
    error?: Error;
  }): Promise<void> => {
    const deliveredAssistant = args.assistant
      ? {
          id: 'agent-control-terminal-delivery',
          role: 'assistant' as const,
          content: args.assistant.content,
          timestamp: Date.now(),
          toolCalls: args.assistant.toolCalls,
          assistantMetadata: args.assistant.metadata,
        }
      : undefined;
    const acknowledgesConstraintDelivery =
      args.graphEvent.type === 'FINALIZED' &&
      args.graphEvent.reason !== 'max_iterations' &&
      deliveredAssistant?.assistantMetadata?.completionStatus === 'complete' &&
      deliveredAssistant.assistantMetadata.terminalReason !== 'max_iterations' &&
      hasSettledFinalAssistantMetadata(deliveredAssistant);
    if (acknowledgesConstraintDelivery && args.assistant) {
      params.callbacks.onAssistantMessage(
        args.assistant.content,
        args.assistant.toolCalls ?? [],
        args.assistant.providerReplay,
        args.assistant.metadata,
      );
      params.applyEvents([{ type: 'USER_CONSTRAINT_DELIVERY_ACKNOWLEDGED' }, args.graphEvent]);
    } else {
      params.applyEvents([args.graphEvent]);
      if (args.assistant) {
        params.callbacks.onAssistantMessage(
          args.assistant.content,
          args.assistant.toolCalls ?? [],
          args.assistant.providerReplay,
          args.assistant.metadata,
        );
      }
    }
    params.callbacks.onStateChange(args.state);
    await emitTerminalSessionEnd(args.sessionEndReason);
    if (args.error) {
      params.callbacks.onError(args.error);
    }
    params.callbacks.onDone();
  };

  return {
    async finishWithGraphTerminalEvent(args: {
      graphEvent: Extract<
        AgentControlGraphEvent,
        { type: 'BLOCKED' } | { type: 'FINALIZED' } | { type: 'YIELDED' }
      >;
      content: string;
      toolCalls?: ToolCall[];
      providerReplay?: MessageProviderReplay;
      assistantMetadata: AssistantMessageMetadata;
      sessionEndReason?: string;
    }): Promise<void> {
      await finishTerminalRunWithGraphEvent({
        graphEvent: args.graphEvent,
        state: 'idle',
        sessionEndReason: args.sessionEndReason,
        assistant: {
          content: args.content,
          toolCalls: args.toolCalls,
          providerReplay: args.providerReplay,
          metadata: args.assistantMetadata,
        },
      });
    },
    async finishWithGraphFinalCandidateEvent(args: {
      graphEvent: Extract<AgentControlGraphEvent, { type: 'FINAL_CANDIDATE_READY' }>;
      content: string;
      providerReplay?: MessageProviderReplay;
      assistantMetadata: AssistantMessageMetadata;
      sessionEndReason?: string;
    }): Promise<void> {
      params.applyEvents([args.graphEvent]);
      params.callbacks.onAssistantMessage(
        args.content,
        [],
        args.providerReplay,
        args.assistantMetadata,
      );
      params.callbacks.onStateChange('idle');
      await emitTerminalSessionEnd(args.sessionEndReason);
      params.callbacks.onDone();
    },
    async finishExistingTerminalSession(sessionEndReason?: string): Promise<void> {
      params.callbacks.onStateChange('idle');
      await emitTerminalSessionEnd(sessionEndReason);
      params.callbacks.onDone();
    },
    async finishFailure(error: Error): Promise<void> {
      await finishTerminalRunWithGraphEvent({
        graphEvent: {
          type: 'FAILED',
          reason: error.message || 'error',
        },
        state: 'error',
        sessionEndReason: 'error',
        error,
      });
    },
    async finishCancelled(): Promise<void> {
      await finishTerminalRunWithGraphEvent({
        graphEvent: { type: 'CANCELLED', reason: 'cancelled' },
        state: 'idle',
        sessionEndReason: 'cancelled',
      });
    },
  };
}
