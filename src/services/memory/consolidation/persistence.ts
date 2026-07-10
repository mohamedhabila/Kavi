import type { Message } from '../../../types/message';
import { createLogger } from '../../../utils/logger';
import { runMemoryTransaction } from '../access/transaction';
import { upsertEntity } from '../entities';
import { addFactEvidence, recordEpisode } from '../episodes/mutations';
import { recordFact, replaceCurrentFact } from '../facts/mutations';
import { composeActiveFocusContent } from '../focus';
import { ensureFactSchema } from '../schema';
import { editWorkingBlock } from '../workingBlocks';
import type { ConsolidatorFact, ConsolidatorResult } from '../consolidator';

const logger = createLogger('memory.consolidation.persistence');

export interface ApplyConsolidatorResultOptions {
  conversationId: string;
  threadId: string;
  now?: number;
  taskId?: string;
  sourceRunId?: string;
  threadTitle?: string;
  sourceUserMessageId?: string;
  sourceAssistantMessageId?: string;
  messages?: Message[];
  skipWorkingMemoryWrites?: boolean;
  /** Evaluated inside the SQLite write transaction to fence stale queue owners. */
  canPersist?: () => boolean;
  /** Commits the source-bound queue receipt in the same transaction as memory writes. */
  commitReceipt?: () => boolean;
}

export interface ApplyConsolidatorResultResult {
  recordedFactIds: string[];
  invalidatedFactIds: string[];
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  episodeId: string | null;
}

/** Persist one validated consolidation result atomically. */
export function applyConsolidatorResult(
  result: ConsolidatorResult,
  options: ApplyConsolidatorResultOptions,
): ApplyConsolidatorResultResult {
  return runMemoryTransaction(() => {
    if (options.canPersist && !options.canPersist()) {
      throw new Error('Memory persistence claim lost');
    }
    const persisted = applyConsolidatorResultInTransaction(result, options);
    if (options.commitReceipt && !options.commitReceipt()) {
      throw new Error('Memory persistence receipt rejected');
    }
    return persisted;
  });
}

function applyConsolidatorResultInTransaction(
  result: ConsolidatorResult,
  options: ApplyConsolidatorResultOptions,
): ApplyConsolidatorResultResult {
  ensureFactSchema();
  const now = options.now ?? Date.now();

  const messageIds = (options.messages ?? [])
    .map((message) => message.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const toolNames = (options.messages ?? [])
    .flatMap((message) => message.toolCalls?.map((toolCall) => toolCall.name) ?? [])
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
  const timestamps = (options.messages ?? [])
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === 'number');
  const episodeSummary = result.episodeSummary ?? null;
  const episode = episodeSummary
    ? recordEpisode({
        conversationId: options.conversationId,
        threadId: options.threadId,
        taskId: options.taskId,
        startedAt: timestamps.length ? Math.min(...timestamps) : now,
        endedAt: timestamps.length ? Math.max(...timestamps) : now,
        summary: episodeSummary,
        messageIds,
        sourceStartMessageId: options.sourceUserMessageId ?? messageIds[0] ?? null,
        sourceEndMessageId:
          options.sourceAssistantMessageId ?? messageIds[messageIds.length - 1] ?? null,
        toolNames,
        importance: Math.max(0.5, ...result.newFacts.map((fact) => fact.importance ?? 0.5)),
        now,
      })
    : null;

  const recordedFactIds: string[] = [];
  const invalidatedFactIds: string[] = [];
  for (const fact of result.newFacts) {
    const subjectType = fact.subject.toLowerCase() === 'user' ? 'self' : 'concept';
    const subject = upsertEntity({ type: subjectType, name: fact.subject, now });
    const sourceMessageId =
      fact.evidenceMessageIds?.[0] ??
      options.sourceUserMessageId ??
      options.sourceAssistantMessageId ??
      null;
    const memoryWrite = fact.admittedWrite
      ? {
          operation: fact.admittedWrite.operation,
          authority: fact.admittedWrite.authority,
          evidenceMessageId: fact.admittedWrite.evidenceMessageId,
          expectedCurrentFactId: fact.admittedWrite.expectedCurrentFactId,
          assertionClass: fact.assertionClass ?? null,
          evidenceQuote: fact.evidenceQuote ?? null,
        }
      : undefined;
    const attributes = {
      ...(fact.reason ? { reason: fact.reason } : {}),
      ...(memoryWrite ? { memoryWrite } : {}),
    };
    const factInput = {
      subjectId: subject.id,
      predicate: fact.predicate,
      objectText: fact.value,
      confidence: confidenceToScore(fact.confidence),
      scope: fact.scope ?? 'conversation',
      originConversationId: options.conversationId,
      originThreadId: options.threadId,
      originTaskId: options.taskId ?? null,
      sourceRunId: options.sourceRunId ?? null,
      sourceMessageId: fact.admittedWrite?.evidenceMessageId ?? sourceMessageId,
      sourceTurnId: options.sourceAssistantMessageId ?? options.sourceUserMessageId ?? null,
      sourceSummary: fact.reason ?? episodeSummary ?? null,
      importance: fact.importance ?? inferFactImportance(fact),
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      now,
    };
    const recorded = fact.admittedWrite
      ? replaceCurrentFact({
          ...factInput,
          expectedCurrentFactId: fact.admittedWrite.expectedCurrentFactId,
        })
      : recordFact({ ...factInput, supersedePrior: false });
    if (recorded.status === 'conflict') {
      logger.devWarn(`Grounded replacement rejected at persistence: ${recorded.conflict}`);
      continue;
    }
    if (recorded.status === 'created') recordedFactIds.push(recorded.fact.id);
    invalidatedFactIds.push(...recorded.superseded.map((superseded) => superseded.id));
    const evidenceIds = fact.admittedWrite
      ? [fact.admittedWrite.evidenceMessageId]
      : fact.evidenceMessageIds?.length
        ? fact.evidenceMessageIds
        : [sourceMessageId].filter((id): id is string => typeof id === 'string');
    for (const messageId of evidenceIds) {
      addFactEvidence({
        factId: recorded.fact.id,
        episodeId: episode?.id ?? null,
        messageId,
        quote: fact.evidenceQuote ?? fact.reason ?? fact.value,
        now,
      });
    }
  }

  let activeFocusUpdated = false;
  const taskId = options.taskId?.trim();
  if (!options.skipWorkingMemoryWrites && result.activeFocus !== null && !taskId) {
    try {
      const activeFocus = composeActiveFocusContent({
        threadTitle: options.threadTitle,
        activeFocus: result.activeFocus,
      });
      editWorkingBlock(
        'active_focus',
        activeFocus,
        {
          conversationId: options.conversationId,
          threadId: options.threadId,
        },
        { now },
      );
      activeFocusUpdated = true;
    } catch {
      // Working-memory overflow must never fail durable turn persistence.
    }
  }

  let openThreadsUpdated = false;
  if (!options.skipWorkingMemoryWrites) {
    try {
      editWorkingBlock(
        'open_threads',
        fitBlockLines(result.openThreads, 800),
        {
          conversationId: options.conversationId,
          threadId: options.threadId,
          taskId: options.taskId,
        },
        { now },
      );
      openThreadsUpdated = true;
    } catch {
      // Working-memory overflow must never fail durable turn persistence.
    }
  }

  return {
    recordedFactIds,
    invalidatedFactIds,
    activeFocusUpdated,
    openThreadsUpdated,
    episodeId: episode?.id ?? null,
  };
}

function confidenceToScore(confidence: ConsolidatorFact['confidence']): number {
  return typeof confidence === 'number' ? clamp01(confidence) : 0.7;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function inferFactImportance(fact: ConsolidatorFact): number {
  if (fact.scope === 'global') return 0.75;
  if (fact.scope === 'project') return 0.65;
  return 0.55;
}

function fitBlockLines(lines: string[], maxChars: number): string {
  const out: string[] = [];
  for (const line of lines) {
    const next = [...out, line].join('\n');
    if (next.length > maxChars) break;
    out.push(line);
  }
  return out.join('\n');
}
