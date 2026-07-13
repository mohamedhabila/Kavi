import type { Message } from '../../types/message';
import { applyConsolidatorResult, type ConsolidatorResult } from './consolidator';
import { upsertState } from './consolidation/schedulerState';
import { bridgeGraphGoalEvidence } from './evidenceBridge';
import { recordAgentRunEvidenceMemory } from './agentRunEvidenceMemory';
import { runMemoryTransaction } from './access/transaction';
import type { TurnPersistenceReceipt, TurnProviderOutcome } from './turnProcessor';
import type { EpisodeShareability } from './episodes/accessPolicyTypes';
import {
  CONSOLIDATION_FACT_PRODUCER_IDS,
  type ConsolidationFactProducerId,
} from './consolidation/factContributionIdentity';

interface TurnPersistenceContext {
  now: number;
  conversationId: string;
  threadId: string;
  taskId?: string;
  sourceRunId?: string;
  threadTitle?: string;
  sourceUserMessageId?: string;
  sourceAssistantMessageId: string;
  messages: Message[];
  graphGoalEvidence?: string[];
  episodeAccess: {
    personaId: string;
    shareability: EpisodeShareability;
  };
  canPersist?: () => boolean;
}

export interface PersistStructuralTurnInput extends TurnPersistenceContext {
  result: ConsolidatorResult;
  finalize: boolean;
  commitStructuralCheckpoint?: () => boolean;
  commitPersistenceReceipt?: (receipt: TurnPersistenceReceipt) => void;
}

export interface FinalizeProviderTurnInput extends TurnPersistenceContext {
  structuralReceipt: TurnPersistenceReceipt;
  providerResult: ConsolidatorResult | null;
  providerOutcome: TurnProviderOutcome;
  commitPersistenceReceipt?: (receipt: TurnPersistenceReceipt) => void;
}

function unique(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values));
}

function isJsonEvidenceCandidate(evidence: string): boolean {
  const trimmed = evidence.trim();
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex <= 0) return false;
  const payload = trimmed.slice(colonIndex + 1).trimStart();
  return payload.startsWith('{') || payload.startsWith('[');
}

function assertPersistenceFence(canPersist: (() => boolean) | undefined): void {
  if (!canPersist) return;
  let owned = false;
  try {
    owned = canPersist();
  } catch {
    owned = false;
  }
  if (!owned) throw new Error('Memory persistence claim lost');
}

function persistenceOptions(
  context: TurnPersistenceContext,
  factContributionProducerId: ConsolidationFactProducerId,
) {
  return {
    now: context.now,
    conversationId: context.conversationId,
    threadId: context.threadId,
    taskId: context.taskId,
    sourceRunId: context.sourceRunId,
    threadTitle: context.threadTitle,
    sourceUserMessageId: context.sourceUserMessageId,
    sourceAssistantMessageId: context.sourceAssistantMessageId,
    factContributionProducerId,
    messages: context.messages,
    skipWorkingMemoryWrites: true,
    episodeAccess: context.episodeAccess,
    canPersist: context.canPersist,
  };
}

function advanceCursor(context: TurnPersistenceContext): void {
  upsertState({
    threadId: context.threadId,
    lastConsolidatedMessageId: context.sourceAssistantMessageId,
    lastConsolidatedAt: context.now,
    turnsSinceLast: 0,
    now: context.now,
  });
}

export function persistStructuralTurn(input: PersistStructuralTurnInput): TurnPersistenceReceipt {
  return runMemoryTransaction(() => {
    assertPersistenceFence(input.canPersist);
    const persisted = applyConsolidatorResult(
      input.result,
      persistenceOptions(input, CONSOLIDATION_FACT_PRODUCER_IDS.structuralTurn),
    );
    const agentRunMemory = recordAgentRunEvidenceMemory({
      messages: input.messages,
      evidence: input.graphGoalEvidence ?? [],
      conversationId: input.conversationId,
      threadId: input.threadId,
      taskId: input.taskId ?? null,
      sourceRunId: input.sourceRunId,
      sourceTurnId: input.sourceAssistantMessageId,
      now: input.now,
    });
    const consumedAgentRunEvidence = new Set(agentRunMemory.consumedEvidence);
    let bridgedEvidenceFactIds: string[] = [];
    if (input.graphGoalEvidence?.length) {
      const bridgeableEvidence = input.graphGoalEvidence.filter(
        (evidence) => !consumedAgentRunEvidence.has(evidence) && !isJsonEvidenceCandidate(evidence),
      );
      bridgedEvidenceFactIds = bridgeGraphGoalEvidence(bridgeableEvidence, {
        subjectName: input.taskId ?? input.threadId,
        subjectType: 'project',
        sourceRunId: input.sourceRunId,
        sourceTurnId: input.sourceAssistantMessageId,
        memoryConversationId: input.conversationId,
        sourceThreadId: input.threadId,
        taskId: input.taskId ?? null,
        originConversationId: input.conversationId,
        originThreadId: input.threadId,
        originTaskId: input.taskId,
        scope: input.taskId ? 'session' : 'conversation',
        now: input.now,
      }).bridged.map((entry) => entry.fact.id);
    }
    const receipt: TurnPersistenceReceipt = {
      episodeId: persisted.episodeId,
      deterministicFactIds: unique(persisted.resolvedFacts.map((fact) => fact.factId)),
      providerFactIds: [],
      invalidatedFactIds: unique(persisted.invalidatedFactIds),
      activeFocusUpdated: persisted.activeFocusUpdated,
      openThreadsUpdated: persisted.openThreadsUpdated,
      providerOutcome: { status: 'not_requested' },
      bridgedEvidenceFactIds: unique(bridgedEvidenceFactIds),
      agentRunMemoryFactIds: unique(agentRunMemory.factIds),
    };

    if (input.finalize) {
      advanceCursor(input);
      input.commitPersistenceReceipt?.(receipt);
    } else if (input.commitStructuralCheckpoint && !input.commitStructuralCheckpoint()) {
      throw new Error('Memory structural checkpoint rejected');
    }
    return receipt;
  });
}

export function finalizeProviderTurn(input: FinalizeProviderTurnInput): TurnPersistenceReceipt {
  return runMemoryTransaction(() => {
    assertPersistenceFence(input.canPersist);
    const providerPersistence = input.providerResult
      ? applyConsolidatorResult(
          input.providerResult,
          persistenceOptions(input, CONSOLIDATION_FACT_PRODUCER_IDS.providerTurn),
        )
      : null;
    if (
      input.providerOutcome.status === 'valid' ||
      input.providerOutcome.status === 'empty_valid'
    ) {
      advanceCursor(input);
    }
    const receipt: TurnPersistenceReceipt = {
      episodeId: providerPersistence?.episodeId ?? input.structuralReceipt.episodeId,
      deterministicFactIds: unique(input.structuralReceipt.deterministicFactIds),
      providerFactIds: unique(providerPersistence?.resolvedFacts.map((fact) => fact.factId) ?? []),
      invalidatedFactIds: unique([
        ...input.structuralReceipt.invalidatedFactIds,
        ...(providerPersistence?.invalidatedFactIds ?? []),
      ]),
      activeFocusUpdated:
        input.structuralReceipt.activeFocusUpdated ||
        Boolean(providerPersistence?.activeFocusUpdated),
      openThreadsUpdated:
        input.structuralReceipt.openThreadsUpdated ||
        Boolean(providerPersistence?.openThreadsUpdated),
      providerOutcome: input.providerOutcome,
      bridgedEvidenceFactIds: unique(input.structuralReceipt.bridgedEvidenceFactIds),
      agentRunMemoryFactIds: unique(input.structuralReceipt.agentRunMemoryFactIds),
    };
    input.commitPersistenceReceipt?.(receipt);
    return receipt;
  });
}
