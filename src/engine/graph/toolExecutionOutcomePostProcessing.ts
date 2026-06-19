import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import type { Message } from '../../types/message';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import {
  buildPendingAsyncOperationSignature,
  buildPendingAsyncOperationJoinNote,
  getPendingTrackedAsyncOperations,
  type TrackedAsyncOperation,
} from '../pendingAsyncOperations';
import { compactToolResults, isApproachingContextOverflow } from '../toolResultGuard';
import { repairModelVisibleToolResultTranscript } from '../orchestratorToolTranscript';
import {
  estimateWorkingMessageTokens,
  type OrchestratorCompactionEvent,
} from '../orchestratorCompaction';
import {
  compactAgentTurnWorkingMessages,
  type AgentTurnCompactionEngine,
} from './agentTurnRequestBudget';
import type { AgentControlGraphEvent, AgentControlTurnDirectives } from './agentControlGraph';
import { buildAgentControlGraphSessionsYieldCompletionNote } from './sessionsYield';

export async function finalizeAgentControlGraphToolExecutionOutcomes(params: {
  iteration: number;
  trackedAsyncOperations: ReadonlyMap<string, TrackedAsyncOperation>;
  lastPendingAsyncSignature: string;
  contextWindow: number;
  conversationId: string;
  compactionEngine: AgentTurnCompactionEngine;
  livingMemory?: LivingMemoryBridgeOutput | null;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  warn: (message: string, error: unknown) => void;
  onStateChange: (state: 'thinking') => void;
  applyGraphEvents: (events: ReadonlyArray<AgentControlGraphEvent>) => void;
  syncPendingAsyncOperationsToGraph: () => void;
  recordTurnDirectives: (
    directives: Partial<AgentControlTurnDirectives>,
    reason: string,
  ) => unknown;
  recordPostToolFinalTextDirective: (params: {
    pendingAsyncCount: number;
    hasAsyncTerminalResolution?: boolean;
    hasActivePersistentGoal?: boolean;
    hasCompletedBlockingGoal?: boolean;
    hasIncompleteBlockingGoal?: boolean;
  }) => boolean;
  finishWithGraphTerminalEvent: (params: {
    graphEvent: Extract<AgentControlGraphEvent, { type: 'YIELDED' }>;
    content: string;
    assistantMetadata: ReturnType<typeof buildAssistantMessageMetadata>;
    sessionEndReason?: string;
  }) => Promise<void>;
  yieldedTurnMessage?: string;
  forceFinalTextFromYieldThisTurn: boolean;
  yieldCompletionNoteMessage?: string;
  hasAsyncTerminalResolution: boolean;
  hasActivePersistentGoal?: boolean;
  hasCompletedBlockingGoal?: boolean;
  hasIncompleteBlockingGoal?: boolean;
  workingMessages: Message[];
}): Promise<{
  status: 'continued' | 'finalized';
  lastPendingAsyncSignature: string;
  workingMessages: Message[];
}> {
  let workingMessages = params.workingMessages;

  if (params.forceFinalTextFromYieldThisTurn) {
    params.recordTurnDirectives(
      {
        forceFinalText: true,
        forcedTextReason: 'yield_finalization',
      },
      'yield_finalization',
    );
    workingMessages.push({
      id: `msg_${Date.now()}_sessions_yield_complete_${params.iteration}`,
      role: 'system',
      content: buildAgentControlGraphSessionsYieldCompletionNote(params.yieldCompletionNoteMessage),
      timestamp: Date.now(),
    });
  }

  let lastPendingAsyncSignature = params.lastPendingAsyncSignature;
  const pendingAsyncSignature = buildPendingAsyncOperationSignature(params.trackedAsyncOperations);
  if (pendingAsyncSignature !== lastPendingAsyncSignature) {
    lastPendingAsyncSignature = pendingAsyncSignature;
    params.syncPendingAsyncOperationsToGraph();
    if (!params.forceFinalTextFromYieldThisTurn) {
      const joinNote = buildPendingAsyncOperationJoinNote(params.trackedAsyncOperations);
      if (joinNote) {
        workingMessages.push({
          id: `msg_${Date.now()}_async_join_${params.iteration}`,
          role: 'system',
          content: joinNote,
          timestamp: Date.now(),
        });
      }
    }
  }

  if (!params.forceFinalTextFromYieldThisTurn) {
    const pendingAsyncCountAfterTools = getPendingTrackedAsyncOperations(
      params.trackedAsyncOperations,
    ).length;
    params.recordPostToolFinalTextDirective({
      pendingAsyncCount: pendingAsyncCountAfterTools,
      hasAsyncTerminalResolution: params.hasAsyncTerminalResolution,
      hasActivePersistentGoal: params.hasActivePersistentGoal,
      hasCompletedBlockingGoal: params.hasCompletedBlockingGoal,
      hasIncompleteBlockingGoal: params.hasIncompleteBlockingGoal,
    });
  }

  workingMessages = repairModelVisibleToolResultTranscript(workingMessages);
  workingMessages = repairModelVisibleToolResultTranscript(
    compactToolResults(workingMessages, params.contextWindow),
  );

  if (
    params.compactionEngine &&
    isApproachingContextOverflow(workingMessages, params.contextWindow)
  ) {
    for (const forceTier of ['tool_clearing', 'selective', 'aggressive'] as const) {
      if (!isApproachingContextOverflow(workingMessages, params.contextWindow)) {
        break;
      }

      const overflowCompaction = await compactAgentTurnWorkingMessages({
        compactionEngine: params.compactionEngine,
        conversationId: params.conversationId,
        currentMessages: workingMessages,
        livingMemory: params.livingMemory,
        onCompaction: params.onCompaction,
        currentTokenCount: estimateWorkingMessageTokens(workingMessages),
        forceTier,
        failureLabel: 'Preemptive compaction failed',
        warn: params.warn,
      });
      if (!overflowCompaction.compacted) {
        continue;
      }

      workingMessages = overflowCompaction.messages;
    }
  }

  if (params.yieldedTurnMessage) {
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'YIELDED',
        reason: 'tool_yielded',
      },
      content: params.yieldedTurnMessage,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'yielded',
      }),
      sessionEndReason: 'yielded',
    });
    return {
      status: 'finalized',
      lastPendingAsyncSignature,
      workingMessages,
    };
  }

  params.onStateChange('thinking');
  return {
    status: 'continued',
    lastPendingAsyncSignature,
    workingMessages,
  };
}
