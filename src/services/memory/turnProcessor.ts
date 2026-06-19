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
  ConsolidatorResult,
  ConsolidatorTurnInput,
} from './consolidator';
import { applyConsolidatorResult } from './consolidator';
import { extractStructuralMemory } from './deterministicExtractor';
import { extractProviderEnrichment } from './providerExtractor';
import { upsertState } from './consolidation/schedulerState';
import { ensureFactSchema } from './schema';
import { bridgeGraphGoalEvidence } from './evidenceBridge';
import { editWorkingBlock } from './workingBlocks';
import { composeActiveFocusContent } from './focus';
import { findEntityByName } from './entities';
import { listFacts } from './facts/queries';

const logger = createLogger('memory.turnProcessor');

export interface ProcessTurnInput {
  threadId: string;
  messages: Message[];
  threadTitle?: string;
  personaSummary?: string;
  taskId?: string;
  graphGoalEvidence?: string[];
  sourceRunId?: string;
  now?: number;
  extractor?: ConsolidatorExtractor;
  skipWorkingMemorySync?: boolean;
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
  bridgedEvidenceFactIds: string[];
  skipped?: 'opt_out' | 'no_closed_turn';
}

export interface SyncWorkingMemoryResult {
  processed: boolean;
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  sourceEndMessageId: string | null;
  sourceStartMessageId: string | null;
  skipped?: 'no_closed_turn';
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
    conversationId: input.threadId,
    threadId: input.threadId,
    taskId: input.taskId,
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
    conversationId: input.threadId,
    threadId: input.threadId,
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
): ConsolidatorResult {
  const episodeSummary = provider.episodeSummary ?? structural.episodeSummary;
  const seen = new Set(
    structural.facts.map((fact) => `${fact.subject}:${fact.predicate}:${fact.value}`),
  );
  const structuralSubjectsAndPredicates = new Set(
    structural.facts.map((fact) => `${fact.subject}:${fact.predicate}`),
  );
  const mergedFacts = [...structural.facts];
  for (const fact of provider.newFacts) {
    const key = `${fact.subject}:${fact.predicate}:${fact.value}`;
    const subjectPredicateKey = `${fact.subject}:${fact.predicate}`;
    if (structuralSubjectsAndPredicates.has(subjectPredicateKey)) {
      continue;
    }
    if (hasCurrentFactForSubjectPredicate(fact.subject, fact.predicate)) {
      continue;
    }
    if (!seen.has(key)) {
      mergedFacts.push(fact);
      seen.add(key);
    }
  }
  const threadSet = new Set(structural.openThreads);
  for (const thread of provider.openThreads) threadSet.add(thread);

  return {
    episodeSummary: episodeSummary || null,
    newFacts: mergedFacts,
    invalidatedFacts: [],
    activeFocus: provider.activeFocus ?? structural.activeFocus,
    openThreads: Array.from(threadSet).slice(0, 5),
    notable: provider.notable ?? [],
  };
}

function hasCurrentFactForSubjectPredicate(subject: string, predicate: string): boolean {
  const normalizedSubject = subject.trim();
  const normalizedPredicate = predicate.trim();
  if (!normalizedSubject || !normalizedPredicate) {
    return false;
  }

  const entity = findEntityByName(normalizedSubject);
  if (!entity) {
    return false;
  }

  return (
    listFacts({
      subjectId: entity.id,
      predicate: normalizedPredicate,
      includeInvalidated: false,
      limit: 1,
    }).length > 0
  );
}

/**
 * Synchronous Layer-1 working-memory update. Never throws into the chat path.
 */
export function syncWorkingMemoryFromTurn(input: ProcessTurnInput): SyncWorkingMemoryResult {
  ensureFactSchema();
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
  const now = input.now ?? Date.now();
  const { user, assistant } = findLastClosedTurn(input.messages);
  if (!assistant) {
    return {
      processed: false,
      skipped: 'no_closed_turn',
      episodeId: null,
      deterministicFactIds: [],
      providerFactIds: [],
      invalidatedFactIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      enriched: false,
      bridgedEvidenceFactIds: [],
    };
  }

  const turnInput = buildTurnInput(user, assistant, input);
  const structural = extractStructuralMemory(turnInput);

  if (!input.skipWorkingMemorySync) {
    applyWorkingMemoryFromStructural(structural, input, now);
  }

  let enriched = false;
  let mergedResult: ConsolidatorResult = {
    episodeSummary: structural.episodeSummary || null,
    newFacts: structural.facts,
    invalidatedFacts: [],
    activeFocus: structural.activeFocus,
    openThreads: structural.openThreads,
    notable: [],
  };

  if (input.extractor) {
    try {
      const providerResult = await extractProviderEnrichment(turnInput, {
        extractor: input.extractor,
        now: () => now,
      });
      enriched =
        providerResult.newFacts.length > 0 ||
        providerResult.episodeSummary !== null ||
        !!providerResult.activeFocus ||
        providerResult.openThreads.length > 0;
      mergedResult = mergeProviderIntoStructural(structural, providerResult);
    } catch (error) {
      logger.devWarn(
        'Provider enrichment failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const persistResult = applyConsolidatorResult(mergedResult, {
    now,
    conversationId: input.threadId,
    threadId: input.threadId,
    taskId: input.taskId,
    sourceUserMessageId: user?.id,
    sourceAssistantMessageId: assistant?.id,
    messages: input.messages,
  });

  let bridgedEvidenceFactIds: string[] = [];
  if (input.graphGoalEvidence?.length) {
    try {
      const bridgeResult = bridgeGraphGoalEvidence(input.graphGoalEvidence, {
        subjectName: input.taskId ?? input.threadId,
        subjectType: 'project',
        sourceRunId: input.sourceRunId,
        originConversationId: input.threadId,
        originThreadId: input.threadId,
        originTaskId: input.taskId,
        now,
      });
      bridgedEvidenceFactIds = bridgeResult.bridged.map((entry) => entry.fact.id);
    } catch (error) {
      logger.devWarn(
        'Graph evidence bridge failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  try {
    upsertState({
      threadId: input.threadId,
      lastConsolidatedMessageId: assistant.id,
      lastConsolidatedAt: now,
      turnsSinceLast: 0,
      now,
    });
  } catch (error) {
    logger.devWarn('Cursor update failed:', error instanceof Error ? error.message : String(error));
  }

  return {
    processed: true,
    episodeId: persistResult.episodeId,
    deterministicFactIds: persistResult.recordedFactIds,
    providerFactIds: enriched ? persistResult.recordedFactIds : [],
    invalidatedFactIds: persistResult.invalidatedFactIds,
    activeFocusUpdated: persistResult.activeFocusUpdated,
    openThreadsUpdated: persistResult.openThreadsUpdated,
    enriched,
    bridgedEvidenceFactIds,
  };
}

/** Backward-compatible entry: sync + full ingestion in one call. */
export async function processCompletedTurn(input: ProcessTurnInput): Promise<ProcessTurnResult> {
  syncWorkingMemoryFromTurn(input);
  return processIngestionTurn({ ...input, skipWorkingMemorySync: true });
}
