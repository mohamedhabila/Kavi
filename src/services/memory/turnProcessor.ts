// ---------------------------------------------------------------------------
// Kavi — Turn Processor (Always-On Memory Ingestion)
// ---------------------------------------------------------------------------
// Two-phase ingestion aligned with durable authority:
//   1. validateMemoryTurnPublication — validate the exact closed publication window
//   2. processIngestionTurn — durable consolidation via ingestion queue
//
// Semantic working-memory updates require valid provider enrichment and run async.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import type {
  ConsolidatorExtractor,
  ConsolidatorOutcome,
  ConsolidatorResult,
  ConsolidatorSourceMessage,
  ConsolidatorTurnInput,
} from './consolidator';
import { extractStructuralMemory } from './deterministicExtractor';
import { extractProviderEnrichment } from './providerExtractor';
import { ensureFactSchema } from './schema';
import { canWriteLongTermMemory } from './policy';
import { finalizeProviderTurn, persistStructuralTurn } from './turnPersistence';
import type { EpisodeShareability } from './episodes/accessPolicyTypes';
import { resolveCodeOwnedMemoryConversationId } from './memoryScopeIdentity';
import { mergeProviderIntoStructural } from './providerFactReconciliation';
import {
  resolveSealedPriorUserMessageIdentity,
  type MemoryMessageIdentity,
} from './priorUserMessageIdentity';
import {
  skippedMemoryTurnPublicationValidation,
  type MemoryTurnPublicationValidation,
} from './turnPublicationValidation';
import {
  resolveClosedTurnEndingAt,
  type ExactClosedTurnFailureReason,
  type ExactClosedTurnResolution,
} from './closedTurn';

export type { MemoryTurnPublicationValidation } from './turnPublicationValidation';

export interface ProcessTurnInput {
  threadId: string;
  memoryConversationId?: string;
  sourceEndMessageId: string;
  messages: ConsolidatorSourceMessage[];
  threadTitle?: string;
  personaSummary?: string;
  taskId?: string;
  graphGoalEvidence?: string[];
  sourceRunId?: string;
  now?: number;
  extractor?: ConsolidatorExtractor;
  providerSignal?: AbortSignal;
  /** Queue-sealed user message immediately preceding this turn-local window. */
  sealedPriorUserMessageId?: string;
  /** Code-owned provenance context used only to verify the sealed prior identity. */
  priorIdentityMessages?: MemoryMessageIdentity[];
  episodeAccess?: {
    personaId: string;
    shareability: EpisodeShareability;
  };
  /** Queue ownership fence checked after async enrichment and before any durable write. */
  canPersist?: () => boolean;
  /** Queue receipt committed atomically with the source-bound memory transaction. */
  commitPersistenceReceipt?: (receipt: TurnPersistenceReceipt) => void;
  /** Queue structural checkpoint committed atomically before optional provider work. */
  commitStructuralCheckpoint?: () => boolean;
  /** Persist a readable structural checkpoint without finalizing the source cursor or receipt. */
  deferStructuralFinalization?: boolean;
}

function exactClosedTurnSkipReason(
  reason: ExactClosedTurnFailureReason,
): 'no_closed_turn' | 'source_identity_invalid' {
  return reason === 'source_end_not_closed' ? 'no_closed_turn' : 'source_identity_invalid';
}

function resolveExactClosedTurn(
  input: Pick<ProcessTurnInput, 'messages' | 'sourceEndMessageId'>,
): ExactClosedTurnResolution {
  return resolveClosedTurnEndingAt(input.messages, input.sourceEndMessageId);
}

function resolveMemoryConversationId(
  input: Pick<ProcessTurnInput, 'threadId' | 'memoryConversationId'>,
): string {
  return resolveCodeOwnedMemoryConversationId(input.memoryConversationId, input.threadId);
}

export interface ProcessTurnResult {
  processed: boolean;
  episodeId: string | null;
  deterministicFactIds: string[];
  providerFactIds: string[];
  invalidatedFactIds: string[];
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  enriched: boolean;
  providerOutcome: TurnProviderOutcome;
  bridgedEvidenceFactIds: string[];
  agentRunMemoryFactIds: string[];
  skipped?: ProcessTurnSkipReason;
}

export type ProcessTurnSkipReason =
  | 'opt_out'
  | 'no_closed_turn'
  | 'claim_lost'
  | 'provider_preempted'
  | 'source_identity_invalid';

export type TurnProviderOutcome =
  | { status: 'not_requested' }
  | { status: 'valid' }
  | { status: 'empty_valid' }
  | Exclude<ConsolidatorOutcome, { status: 'valid' | 'empty_valid' }>;

export interface TurnPersistenceReceipt {
  episodeId: string | null;
  deterministicFactIds: string[];
  providerFactIds: string[];
  invalidatedFactIds: string[];
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  providerOutcome: TurnProviderOutcome;
  bridgedEvidenceFactIds: string[];
  agentRunMemoryFactIds: string[];
}

function skippedProcessTurnResult(
  skipped: ProcessTurnSkipReason,
  providerOutcome: TurnProviderOutcome = { status: 'not_requested' },
): ProcessTurnResult {
  return {
    processed: false,
    skipped,
    episodeId: null,
    deterministicFactIds: [],
    providerFactIds: [],
    invalidatedFactIds: [],
    activeFocusUpdated: false,
    openThreadsUpdated: false,
    enriched: false,
    providerOutcome,
    bridgedEvidenceFactIds: [],
    agentRunMemoryFactIds: [],
  };
}

function completedProcessTurnResult(
  receipt: TurnPersistenceReceipt,
  enriched: boolean,
): ProcessTurnResult {
  return {
    processed: true,
    episodeId: receipt.episodeId,
    deterministicFactIds: receipt.deterministicFactIds,
    providerFactIds: receipt.providerFactIds,
    invalidatedFactIds: receipt.invalidatedFactIds,
    activeFocusUpdated: receipt.activeFocusUpdated,
    openThreadsUpdated: receipt.openThreadsUpdated,
    enriched,
    providerOutcome: receipt.providerOutcome,
    bridgedEvidenceFactIds: receipt.bridgedEvidenceFactIds,
    agentRunMemoryFactIds: receipt.agentRunMemoryFactIds,
  };
}

function ownsPersistenceFence(canPersist: (() => boolean) | undefined): boolean {
  if (!canPersist) return true;
  try {
    return canPersist();
  } catch {
    return false;
  }
}

function summarizeProviderOutcome(outcome: ConsolidatorOutcome): TurnProviderOutcome {
  if (outcome.status === 'valid' || outcome.status === 'empty_valid') {
    return { status: outcome.status };
  }
  return outcome;
}

function buildTurnInput(
  user: Message | undefined,
  assistant: Message | undefined,
  input: ProcessTurnInput,
): ConsolidatorTurnInput {
  return {
    userMessage: user?.content ?? '',
    assistantMessage: assistant?.content ?? '',
    threadTitle: input.threadTitle,
    sourceUserMessageId: user?.id,
    sourceAssistantMessageId: assistant?.id,
    messages: input.messages,
    personaSummary: input.personaSummary,
    now: input.now,
  };
}

/**
 * Synchronous source-bound publication validation. Semantic state is provider-owned.
 */
export function validateMemoryTurnPublication(
  input: ProcessTurnInput,
): MemoryTurnPublicationValidation {
  ensureFactSchema();
  if (!canWriteLongTermMemory()) {
    return skippedMemoryTurnPublicationValidation('opt_out');
  }
  const closedTurn = resolveExactClosedTurn(input);
  if (closedTurn.status === 'invalid') {
    return skippedMemoryTurnPublicationValidation(exactClosedTurnSkipReason(closedTurn.reason));
  }
  return {
    processed: true,
    sourceEndMessageId: closedTurn.sourceEndMessageId,
    sourceStartMessageId: closedTurn.sourceStartMessageId,
    priorUserMessageId: closedTurn.priorUserMessageId,
  };
}

/**
 * Durable consolidation for a queued ingestion job.
 */
export async function processIngestionTurn(input: ProcessTurnInput): Promise<ProcessTurnResult> {
  ensureFactSchema();
  if (!canWriteLongTermMemory()) {
    return skippedProcessTurnResult('opt_out');
  }
  const now = input.now ?? Date.now();
  const closedTurn = resolveExactClosedTurn(input);
  if (closedTurn.status === 'invalid') {
    return skippedProcessTurnResult(exactClosedTurnSkipReason(closedTurn.reason));
  }
  const { user, assistant } = closedTurn;
  if (!input.episodeAccess) {
    throw new Error('episode_access_policy_required');
  }

  const turnInput = buildTurnInput(user, assistant, input);
  const structural = extractStructuralMemory(turnInput);
  const memoryConversationId = resolveMemoryConversationId(input);
  const priorUserIdentity = resolveSealedPriorUserMessageIdentity(
    input.priorIdentityMessages ?? input.messages,
    user?.id,
    input.sealedPriorUserMessageId,
  );
  if (priorUserIdentity.status === 'invalid') {
    return skippedProcessTurnResult('source_identity_invalid');
  }
  const priorUserMessageId = priorUserIdentity.priorUserMessageId;
  const structuralResult: ConsolidatorResult = {
    episodeSummary: structural.episodeSummary || null,
    newFacts: structural.facts,
    activeFocus: null,
    openThreads: [],
    notable: [],
  };
  if (!canWriteLongTermMemory()) {
    return skippedProcessTurnResult('opt_out');
  }
  if (!ownsPersistenceFence(input.canPersist)) {
    return skippedProcessTurnResult('claim_lost');
  }

  const persistenceContext = {
    result: structuralResult,
    finalize: !input.extractor && !input.deferStructuralFinalization,
    now,
    conversationId: memoryConversationId,
    threadId: input.threadId,
    taskId: input.taskId,
    sourceRunId: input.sourceRunId,
    threadTitle: input.threadTitle,
    sourceUserMessageId: user?.id,
    sourceAssistantMessageId: assistant.id,
    messages: input.messages,
    graphGoalEvidence: input.graphGoalEvidence,
    episodeAccess: input.episodeAccess,
    canPersist: input.canPersist,
    commitStructuralCheckpoint: input.commitStructuralCheckpoint,
    commitPersistenceReceipt: input.commitPersistenceReceipt,
  };
  const structuralReceipt = persistStructuralTurn(persistenceContext);
  if (!input.extractor) {
    return completedProcessTurnResult(structuralReceipt, false);
  }
  if (input.providerSignal?.aborted) {
    return skippedProcessTurnResult('provider_preempted');
  }

  const outcome = await extractProviderEnrichment(turnInput, {
    extractor: input.extractor,
    signal: input.providerSignal,
  });
  if (input.providerSignal?.aborted) {
    return skippedProcessTurnResult('provider_preempted');
  }
  const providerOutcome = summarizeProviderOutcome(outcome);
  if (!canWriteLongTermMemory()) {
    return skippedProcessTurnResult('opt_out', providerOutcome);
  }
  if (!ownsPersistenceFence(input.canPersist)) {
    return skippedProcessTurnResult('claim_lost', providerOutcome);
  }

  let providerResult: ConsolidatorResult | null = null;
  let enriched = false;
  if (outcome.status === 'valid' || outcome.status === 'empty_valid') {
    enriched = outcome.status === 'valid';
    const mergedResult = mergeProviderIntoStructural(structural, outcome.result, {
      currentUserMessageId: user?.id,
      currentUserMessage: user?.content ?? '',
      priorUserMessageId,
      memoryConversationId,
      threadId: input.threadId,
      taskId: input.taskId,
    });
    providerResult = {
      ...mergedResult,
      newFacts: mergedResult.newFacts.slice(structural.facts.length),
    };
  }

  const receipt = finalizeProviderTurn({
    structuralReceipt,
    providerResult,
    providerOutcome,
    now,
    conversationId: memoryConversationId,
    threadId: input.threadId,
    taskId: input.taskId,
    sourceRunId: input.sourceRunId,
    threadTitle: input.threadTitle,
    sourceUserMessageId: user?.id,
    sourceAssistantMessageId: assistant.id,
    messages: input.messages,
    graphGoalEvidence: input.graphGoalEvidence,
    episodeAccess: input.episodeAccess,
    canPersist: input.canPersist,
    commitPersistenceReceipt: input.commitPersistenceReceipt,
  });
  return completedProcessTurnResult(receipt, enriched);
}
