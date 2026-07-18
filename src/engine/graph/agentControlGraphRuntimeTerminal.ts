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
  const emitSessionEnd = async (reason?: string): Promise<void> => {
    try {
      await emitSessionEvent('end', {
        conversationId: params.conversationId,
        ...(reason ? { reason } : {}),
        agentRunId: params.agentRunId,
        executionSignal: params.signal,
      });
    } catch (error: unknown) {
      params.warn?.('Agent control graph session end event failed', error);
    }
  };

  const publishStagedAssistant = (args: {
    content: string;
    metadata: AssistantMessageMetadata;
    stageEvent: Extract<AgentControlGraphEvent, { type: 'FINAL_CANDIDATE_READY' }>;
    toolCalls?: ToolCall[];
    providerReplay?: MessageProviderReplay;
    beforeAssistantDelivery?: () => void;
  }): void => {
    args.beforeAssistantDelivery?.();
    let candidatePublicationStarted = false;
    try {
      candidatePublicationStarted = true;
      params.applyEvents([args.stageEvent]);
      args.beforeAssistantDelivery?.();
      params.callbacks.onAssistantMessage(
        args.content,
        args.toolCalls ?? [],
        args.providerReplay,
        args.metadata,
      );
    } catch (error: unknown) {
      if (candidatePublicationStarted) {
        try {
          params.applyEvents([
            {
              type: 'FINAL_CANDIDATE_INVALIDATED',
              reason: 'delivery_boundary_failed',
            },
          ]);
        } catch (rollbackError: unknown) {
          params.warn?.('Agent control graph final candidate rollback failed', rollbackError);
        }
      }
      throw error;
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
    beforeAssistantDelivery?: () => void;
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
    if (args.assistant) {
      publishStagedAssistant({
        content: args.assistant.content,
        metadata: args.assistant.metadata,
        stageEvent: {
          type: 'FINAL_CANDIDATE_READY',
          reason: args.graphEvent.reason,
        },
        toolCalls: args.assistant.toolCalls,
        providerReplay: args.assistant.providerReplay,
        beforeAssistantDelivery: args.beforeAssistantDelivery,
      });
    }
    if (acknowledgesConstraintDelivery) {
      params.applyEvents([{ type: 'USER_CONSTRAINT_DELIVERY_ACKNOWLEDGED' }, args.graphEvent]);
    } else {
      params.applyEvents([args.graphEvent]);
    }
    params.callbacks.onStateChange(args.state);
    await emitSessionEnd(args.sessionEndReason);
    if (args.error) {
      params.callbacks.onError(args.error);
    }
    params.callbacks.onDone();
  };

  return {
    async finishWithGraphTerminalEvent(args: {
      graphEvent: Extract<
        AgentControlGraphEvent,
        | { type: 'BLOCKED' }
        | { type: 'FINALIZED' }
        | { type: 'YIELDED' }
        | { type: 'CANCELLED' }
      >;
      content: string;
      toolCalls?: ToolCall[];
      providerReplay?: MessageProviderReplay;
      assistantMetadata: AssistantMessageMetadata;
      sessionEndReason?: string;
      beforeAssistantDelivery?: () => void;
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
        beforeAssistantDelivery: args.beforeAssistantDelivery,
      });
    },
    async finishWithGraphFinalCandidateEvent(args: {
      graphEvent: Extract<AgentControlGraphEvent, { type: 'FINAL_CANDIDATE_READY' }>;
      content: string;
      providerReplay?: MessageProviderReplay;
      assistantMetadata: AssistantMessageMetadata;
      sessionEndReason?: string;
      beforeAssistantDelivery?: () => void;
    }): Promise<void> {
      publishStagedAssistant({
        content: args.content,
        metadata: args.assistantMetadata,
        stageEvent: args.graphEvent,
        providerReplay: args.providerReplay,
        beforeAssistantDelivery: args.beforeAssistantDelivery,
      });
      params.callbacks.onStateChange('idle');
      await emitSessionEnd(args.sessionEndReason);
      params.callbacks.onDone();
    },
    async finishWaitingForUserInput(args: {
      graphEvent: Extract<AgentControlGraphEvent, { type: 'USER_INPUT_REQUIRED' }>;
      content: string;
      assistantMetadata: AssistantMessageMetadata;
      sessionEndReason?: string;
      beforeAssistantDelivery?: () => void;
    }): Promise<void> {
      let waitStaged = false;
      try {
        args.beforeAssistantDelivery?.();
        const waitingState = params.applyEvents([args.graphEvent]);
        if (waitingState.status !== 'awaiting_user') {
          throw new Error('agent_control_graph_user_input_wait_transition_failed');
        }
        waitStaged = true;
        args.beforeAssistantDelivery?.();
        params.callbacks.onAssistantMessage(args.content, [], undefined, args.assistantMetadata);
      } catch (error: unknown) {
        if (waitStaged) {
          try {
            params.applyEvents([
              {
                type: 'USER_INPUT_WAIT_CANCELLED',
                reason: 'delivery_boundary_failed',
              },
            ]);
          } catch (rollbackError: unknown) {
            params.warn?.('Agent control graph user-input wait rollback failed', rollbackError);
          }
        }
        throw error;
      }
      params.callbacks.onStateChange('idle');
      await emitSessionEnd(args.sessionEndReason);
      params.callbacks.onDone();
    },
    async finishExistingTerminalSession(sessionEndReason?: string): Promise<void> {
      params.callbacks.onStateChange('idle');
      await emitSessionEnd(sessionEndReason);
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
