// ---------------------------------------------------------------------------
// Kavi — Turn Processor (Always-On Memory Ingestion)
// ---------------------------------------------------------------------------
// Two-phase ingestion aligned with human memory:
//   1. syncWorkingMemoryFromTurn — immediate Layer-1 update (focus, threads)
//   2. processIngestionTurn — durable consolidation via ingestion queue
//
// Structural signals only in the sync path; provider enrichment runs async.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import { createLogger } from '../../utils/logger';
import type {
  ConsolidatorExtractor,
  ConsolidatorOutcome,
  ConsolidatorResult,
  ConsolidatorTurnInput,
} from './consolidator';
import { extractStructuralMemory } from './deterministicExtractor';
import { extractProviderEnrichment } from './providerExtractor';
import { ensureFactSchema } from './schema';
import { editWorkingBlock } from './workingBlocks';
import { composeActiveFocusContent } from './focus';
import { findEntityByName } from './entities';
import { listCurrentFactsForReplacement } from './facts/exactReplacementQueries';
import { hasCurrentFactForSubjectPredicate } from './facts/queries';
import type { MemoryFact } from './facts/types';
import { evaluateGroundedReplacement } from './groundedFactReplacement';
import { canWriteLongTermMemory } from './policy';
import { finalizeProviderTurn, persistStructuralTurn } from './turnPersistence';

const logger = createLogger('memory.turnProcessor');

export interface ProcessTurnInput {
  threadId: string;
  memoryConversationId?: string;
  messages: Message[];
  threadTitle?: string;
  personaSummary?: string;
  taskId?: string;
  graphGoalEvidence?: string[];
  sourceRunId?: string;
  now?: number;
  extractor?: ConsolidatorExtractor;
  skipWorkingMemorySync?: boolean;
  /** Queue ownership fence checked after async enrichment and before any durable write. */
  canPersist?: () => boolean;
  /** Queue receipt committed atomically with the source-bound memory transaction. */
  commitPersistenceReceipt?: (receipt: TurnPersistenceReceipt) => void;
  /** Queue structural checkpoint committed atomically before optional provider work. */
  commitStructuralCheckpoint?: () => boolean;
}

function resolveMemoryConversationId(
  input: Pick<ProcessTurnInput, 'threadId' | 'memoryConversationId'>,
): string {
  return input.memoryConversationId?.trim() || input.threadId.trim();
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
  skipped?: 'opt_out' | 'no_closed_turn' | 'claim_lost';
}

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
  skipped: 'opt_out' | 'no_closed_turn' | 'claim_lost',
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

export interface SyncWorkingMemoryResult {
  processed: boolean;
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  sourceEndMessageId: string | null;
  sourceStartMessageId: string | null;
  skipped?: 'opt_out' | 'no_closed_turn';
}

export function findLastClosedTurn(messages: Message[]): {
  user: Message | undefined;
  assistant: Message | undefined;
} {
  const normalized = normalizeTerminalClosedTurnMessages(messages);
  const assistant = findLastClosedAssistant(normalized);
  if (!assistant) return { user: undefined, assistant: undefined };
  const user = findLastUserBefore(normalized, assistant.id);
  return { user, assistant };
}

/**
 * Promote a tool-only terminal assistant in the latest user turn slice to final
 * metadata so turn closure is structural (graph-owned turn boundary), not NL-based.
 */
export function normalizeTerminalClosedTurnMessages(messages: Message[]): Message[] {
  const lastUserIndex = findLastMessageIndex(messages, 'user');
  if (lastUserIndex < 0) {
    return messages;
  }

  let lastAssistantIndex = -1;
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex < 0) {
    return messages;
  }

  const assistant = messages[lastAssistantIndex]!;
  const hasContent = Boolean(assistant.content?.trim());
  const hasToolCalls = (assistant.toolCalls?.length ?? 0) > 0;
  if (isClosedAssistantMessage(assistant)) {
    return messages;
  }

  if (hasToolCalls && !hasContent) {
    const updated = [...messages];
    updated[lastAssistantIndex] = {
      ...assistant,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: assistant.assistantMetadata?.finishReason ?? 'stop',
      }),
    };
    return updated;
  }

  if (!hasToolCalls && !hasContent) {
    const updated = [...messages];
    updated[lastAssistantIndex] = {
      ...assistant,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: assistant.assistantMetadata?.finishReason ?? 'stop',
      }),
    };
    return updated;
  }

  return messages;
}

function findLastMessageIndex(messages: Message[], role: Message['role']): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) {
      return index;
    }
  }
  return -1;
}

function findLastClosedAssistant(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isClosedAssistantMessage(message)) {
      return message;
    }
  }
  return undefined;
}

function isClosedAssistantMessage(message: Message | undefined): boolean {
  if (!message || message.role !== 'assistant') {
    return false;
  }
  if (!isTerminalAssistantMessage(message)) {
    return false;
  }
  const hasContent = Boolean(message.content?.trim());
  const hasToolCalls = (message.toolCalls?.length ?? 0) > 0;
  if (hasContent || hasToolCalls) {
    return true;
  }
  return (
    message.assistantMetadata?.kind === 'final' &&
    message.assistantMetadata.completionStatus === 'complete'
  );
}

function isTerminalAssistantMessage(message: Message): boolean {
  if (!message.assistantMetadata) {
    return true;
  }
  if (message.assistantMetadata.finishReason === 'yielded') {
    return false;
  }
  return (
    message.assistantMetadata.kind === 'final' &&
    message.assistantMetadata.completionStatus === 'complete'
  );
}

function findLastUserBefore(
  messages: Message[],
  beforeId: string | undefined,
): Message | undefined {
  if (!beforeId) return undefined;
  const idx = messages.findIndex((message) => message.id === beforeId);
  for (let i = Math.max(idx, 0); i >= 0; i--) {
    if (messages[i]?.role === 'user') return messages[i];
  }
  return undefined;
}

function buildTurnInput(
  user: Message | undefined,
  assistant: Message | undefined,
  input: ProcessTurnInput,
): ConsolidatorTurnInput {
  return {
    userMessage: user?.content ?? '',
    assistantMessage: assistant?.content ?? '',
    conversationId: resolveMemoryConversationId(input),
    threadId: input.threadId,
    taskId: input.taskId,
    sourceRunId: input.sourceRunId,
    threadTitle: input.threadTitle,
    sourceUserMessageId: user?.id,
    sourceAssistantMessageId: assistant?.id,
    messages: input.messages,
    personaSummary: input.personaSummary,
    now: input.now,
  };
}

function fitBlockLines(lines: string[], maxChars: number): string {
  const joined = lines.filter((line) => line.trim().length > 0).join('\n');
  return joined.length <= maxChars ? joined : joined.slice(0, maxChars);
}

function applyWorkingMemoryFromStructural(
  structural: ReturnType<typeof extractStructuralMemory>,
  input: ProcessTurnInput,
  now: number,
): { activeFocusUpdated: boolean; openThreadsUpdated: boolean } {
  let activeFocusUpdated = false;
  let openThreadsUpdated = false;
  const scope = {
    conversationId: resolveMemoryConversationId(input),
    threadId: resolveMemoryConversationId(input),
    taskId: input.taskId,
  };

  const taskId = input.taskId?.trim();
  if (structural.activeFocus && !taskId) {
    try {
      const activeFocus = composeActiveFocusContent({
        threadTitle: input.threadTitle,
        activeFocus: structural.activeFocus,
      });
      editWorkingBlock('active_focus', activeFocus, scope, { now });
      activeFocusUpdated = true;
    } catch (error) {
      logger.devWarn(
        'Working memory focus update failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (structural.openThreads.length > 0) {
    try {
      editWorkingBlock('open_threads', fitBlockLines(structural.openThreads, 800), scope, { now });
      openThreadsUpdated = true;
    } catch (error) {
      logger.devWarn(
        'Working memory open-threads update failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { activeFocusUpdated, openThreadsUpdated };
}

function mergeProviderIntoStructural(
  structural: ReturnType<typeof extractStructuralMemory>,
  provider: ConsolidatorResult,
  context: {
    currentUserMessageId?: string;
    currentUserMessage: string;
    memoryConversationId: string;
    threadId: string;
    taskId?: string;
  },
): ConsolidatorResult {
  const episodeSummary = provider.episodeSummary ?? structural.episodeSummary;
  const keyPart = (value: string) => value.normalize('NFKC').trim().toLowerCase();
  const factKey = (fact: ConsolidatorResult['newFacts'][number]) =>
    `${keyPart(fact.subject)}:${keyPart(fact.predicate)}:${keyPart(fact.value)}`;
  const subjectPredicateKey = (fact: ConsolidatorResult['newFacts'][number]) =>
    `${keyPart(fact.subject)}:${keyPart(fact.predicate)}`;
  const seen = new Set(structural.facts.map(factKey));
  const structuralSubjectsAndPredicates = new Set(structural.facts.map(subjectPredicateKey));
  const replacementGroups = new Map<string, ConsolidatorResult['newFacts']>();
  for (const fact of provider.newFacts) {
    const groupKey = subjectPredicateKey(fact);
    const group = replacementGroups.get(groupKey) ?? [];
    group.push(fact);
    replacementGroups.set(groupKey, group);
  }
  const ambiguousReplacementKeys = new Set<string>();
  for (const [groupKey, facts] of replacementGroups) {
    if (!facts.some((fact) => fact.operation === 'replace_current')) continue;
    const signatures = new Set(
      facts.map((fact) =>
        JSON.stringify([
          fact.value.normalize('NFKC').trim(),
          fact.scope ?? 'conversation',
          fact.operation ?? 'insert',
        ]),
      ),
    );
    if (signatures.size > 1) ambiguousReplacementKeys.add(groupKey);
  }
  const mergedFacts = [...structural.facts];
  for (const fact of provider.newFacts) {
    const key = factKey(fact);
    const currentKey = subjectPredicateKey(fact);
    if (
      structuralSubjectsAndPredicates.has(currentKey) ||
      ambiguousReplacementKeys.has(currentKey)
    ) {
      continue;
    }
    if (seen.has(key)) continue;

    const resolution = resolveCurrentFactsForReplacement(fact, context);
    if (!resolution.hasAnyCurrentFact && fact.operation !== 'replace_current') {
      mergedFacts.push(fact);
      seen.add(key);
      continue;
    }

    const decision = evaluateGroundedReplacement(fact, {
      ...context,
      currentFacts: resolution.currentFacts,
      hasAnyCurrentFact: resolution.hasAnyCurrentFact,
    });
    if (!decision.accepted) continue;
    mergedFacts.push(decision.fact);
    seen.add(key);
  }
  const threadSet = new Set(structural.openThreads);
  for (const thread of provider.openThreads) threadSet.add(thread);

  return {
    episodeSummary: episodeSummary || null,
    newFacts: mergedFacts,
    activeFocus: provider.activeFocus ?? structural.activeFocus,
    openThreads: Array.from(threadSet).slice(0, 5),
    notable: provider.notable ?? [],
  };
}

function resolveCurrentFactsForReplacement(
  fact: ConsolidatorResult['newFacts'][number],
  context: {
    memoryConversationId: string;
    threadId: string;
    taskId?: string;
  },
): { currentFacts: MemoryFact[]; hasAnyCurrentFact: boolean } {
  const subject = fact.subject.trim();
  const predicate = fact.predicate.trim();
  if (!subject || !predicate) return { currentFacts: [], hasAnyCurrentFact: false };

  const entity = findEntityByName(subject);
  if (!entity) return { currentFacts: [], hasAnyCurrentFact: false };

  const scope = fact.scope ?? 'conversation';
  if (scope === 'persona' || (scope === 'session' && !context.taskId)) {
    return {
      currentFacts: [],
      hasAnyCurrentFact: true,
    };
  }
  const currentFacts = listCurrentFactsForReplacement({
    subjectId: entity.id,
    predicate,
    scope,
    ...(scope === 'project' || scope === 'conversation' || scope === 'session'
      ? {
          originConversationId: context.memoryConversationId,
          originThreadId: context.threadId,
        }
      : {}),
    ...(scope === 'session' ? { originTaskId: context.taskId } : {}),
  });
  return {
    currentFacts,
    hasAnyCurrentFact:
      currentFacts.length > 0 || hasCurrentFactForSubjectPredicate(entity.id, predicate),
  };
}

/**
 * Synchronous Layer-1 working-memory update. Never throws into the chat path.
 */
export function syncWorkingMemoryFromTurn(input: ProcessTurnInput): SyncWorkingMemoryResult {
  ensureFactSchema();
  if (!canWriteLongTermMemory()) {
    return {
      processed: false,
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      sourceEndMessageId: null,
      sourceStartMessageId: null,
      skipped: 'opt_out',
    };
  }
  const now = input.now ?? Date.now();
  const { user, assistant } = findLastClosedTurn(input.messages);
  if (!assistant) {
    return {
      processed: false,
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      sourceEndMessageId: null,
      sourceStartMessageId: null,
      skipped: 'no_closed_turn',
    };
  }

  const structural = extractStructuralMemory(buildTurnInput(user, assistant, input));
  const working = applyWorkingMemoryFromStructural(structural, input, now);

  return {
    processed: true,
    activeFocusUpdated: working.activeFocusUpdated,
    openThreadsUpdated: working.openThreadsUpdated,
    sourceEndMessageId: assistant.id ?? null,
    sourceStartMessageId: user?.id ?? null,
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
  const { user, assistant } = findLastClosedTurn(input.messages);
  if (!assistant) {
    return skippedProcessTurnResult('no_closed_turn');
  }

  const turnInput = buildTurnInput(user, assistant, input);
  const structural = extractStructuralMemory(turnInput);
  const memoryConversationId = resolveMemoryConversationId(input);

  if (!input.skipWorkingMemorySync) {
    applyWorkingMemoryFromStructural(structural, input, now);
  }

  const structuralResult: ConsolidatorResult = {
    episodeSummary: structural.episodeSummary || null,
    newFacts: structural.facts,
    activeFocus: structural.activeFocus,
    openThreads: structural.openThreads,
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
    finalize: !input.extractor,
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
    canPersist: input.canPersist,
    commitStructuralCheckpoint: input.commitStructuralCheckpoint,
    commitPersistenceReceipt: input.commitPersistenceReceipt,
  };
  const structuralReceipt = persistStructuralTurn(persistenceContext);
  if (!input.extractor) {
    return completedProcessTurnResult(structuralReceipt, false);
  }

  const outcome = await extractProviderEnrichment(turnInput, {
    extractor: input.extractor,
    now: () => now,
  });
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
    canPersist: input.canPersist,
    commitPersistenceReceipt: input.commitPersistenceReceipt,
  });
  return completedProcessTurnResult(receipt, enriched);
}
