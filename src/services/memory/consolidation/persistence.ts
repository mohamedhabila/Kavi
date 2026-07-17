import type { Message } from '../../../types/message';
import { createLogger } from '../../../utils/logger';
import { runMemoryTransaction } from '../access/transaction';
import { upsertEntity } from '../entities';
import { addFactEvidence, recordEpisode, recordThreadLocalEpisode } from '../episodes/mutations';
import type { EpisodeShareability } from '../episodes/accessPolicyTypes';
import { replaceCurrentFactWithContribution } from '../facts/exactReplacement';
import { recordFactWithContribution } from '../facts/mutations';
import { composeActiveFocusContent } from '../focus';
import { ensureFactSchema } from '../schema';
import { editWorkingBlock } from '../workingBlocks';
import type { ConsolidatorFact, ConsolidatorResult } from '../consolidator';
import { assertMemoryPersistenceSourcesAreWritable } from '../withdrawalFence';
import { resolveCodeOwnedMemoryTaskId } from '../memoryScopeIdentity';
import { classifyMemoryFactSensitivity } from '../memorySensitivityPolicy';
import type { MemorySensitivityInput } from '../memorySensitivityPolicy';
import { requireMemorySensitivityDeclaration } from '../memorySensitivityPolicy';
import type { MemoryFactContributionSourceAlias } from '../factContributionCodec';
import type { MemoryFactContributionWriteContext } from '../factContributionStore';
import {
  buildConsolidationFactProducerEventId,
  type ConsolidationFactProducerId,
} from './factContributionIdentity';

const logger = createLogger('memory.consolidation.persistence');

interface ApplyConsolidatorResultBaseOptions {
  conversationId: string;
  threadId: string;
  /** Sealed source time; replaying the same producer event must reuse it exactly. */
  now: number;
  taskId?: string;
  sourceRunId?: string;
  threadTitle?: string;
  sourceUserMessageId?: string;
  sourceAssistantMessageId: string;
  factContributionProducerId: ConsolidationFactProducerId;
  messages?: Message[];
  skipWorkingMemoryWrites?: boolean;
  /** Evaluated inside the SQLite write transaction to fence stale queue owners. */
  canPersist?: () => boolean;
  /** Commits the source-bound queue receipt in the same transaction as memory writes. */
  commitReceipt?: () => boolean;
}

export interface ApplyConsolidatorResultOptions extends ApplyConsolidatorResultBaseOptions {
  episodeAccess: {
    personaId: string;
    shareability: EpisodeShareability;
  };
}

export interface ApplyConsolidatorResultResult {
  recordedFacts: Array<{ inputIndex: number; factId: string }>;
  /** Every input fact resolved to its durable row, including idempotent replays. */
  resolvedFacts: Array<{ inputIndex: number; factId: string }>;
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
  return applyConsolidatorResultWithPolicy(result, options);
}

/**
 * Low-level current-thread persistence for isolated tests and import tooling.
 * Episodes written here have no access-policy row and can never enter cross-thread recall.
 */
export function applyThreadLocalConsolidatorResult(
  result: ConsolidatorResult,
  options: ApplyConsolidatorResultBaseOptions,
): ApplyConsolidatorResultResult {
  return applyConsolidatorResultWithPolicy(result, options);
}

function applyConsolidatorResultWithPolicy(
  result: ConsolidatorResult,
  options: ApplyConsolidatorResultBaseOptions &
    Partial<Pick<ApplyConsolidatorResultOptions, 'episodeAccess'>>,
): ApplyConsolidatorResultResult {
  return runMemoryTransaction(() => {
    if (options.canPersist && !options.canPersist()) {
      throw new Error('Memory persistence claim lost');
    }
    const sources = [
      { sourceKind: 'message' as const, sourceId: options.sourceUserMessageId },
      { sourceKind: 'turn' as const, sourceId: options.sourceAssistantMessageId },
      { sourceKind: 'run' as const, sourceId: options.sourceRunId },
      ...result.newFacts.flatMap((fact) =>
        (fact.evidenceMessageIds ?? []).map((sourceId) => ({
          sourceKind: 'message' as const,
          sourceId,
        })),
      ),
      ...result.newFacts
        .map((fact) => fact.admittedWrite?.evidenceMessageId)
        .filter((sourceId): sourceId is string => Boolean(sourceId))
        .map((sourceId) => ({ sourceKind: 'message' as const, sourceId })),
    ];
    assertMemoryPersistenceSourcesAreWritable(
      {
        memoryConversationId: options.conversationId,
        sourceThreadId: options.threadId,
        taskId: options.taskId,
      },
      sources,
    );
    const persisted = applyConsolidatorResultInTransaction(result, options);
    if (options.commitReceipt && !options.commitReceipt()) {
      throw new Error('Memory persistence receipt rejected');
    }
    return persisted;
  });
}

function applyConsolidatorResultInTransaction(
  result: ConsolidatorResult,
  options: ApplyConsolidatorResultBaseOptions &
    Partial<Pick<ApplyConsolidatorResultOptions, 'episodeAccess'>>,
): ApplyConsolidatorResultResult {
  ensureFactSchema();
  const now = options.now;

  const closedTurnMessages = selectClosedTurnMessages(
    options.messages ?? [],
    options.sourceUserMessageId,
    options.sourceAssistantMessageId,
  );
  const messageIds = closedTurnMessages
    .map((message) => message.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const toolNames = closedTurnMessages
    .flatMap((message) => message.toolCalls?.map((toolCall) => toolCall.name) ?? [])
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
  const timestamps = closedTurnMessages
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === 'number');
  const episodeSummary = result.episodeSummary ?? null;
  const episodeSensitivityDeclaration = requireMemorySensitivityDeclaration(
    result.episodeSensitivityDeclaration,
    'memory_episode_sensitivity_declaration_invalid',
  );
  const factSensitivityInputs = result.newFacts.map((fact) =>
    buildFactSensitivityInput(fact, episodeSummary),
  );
  const episodeInput = episodeSummary
    ? {
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
        sensitivityEvidence: {
          declaredSensitivity: episodeSensitivityDeclaration.sensitivity,
          sourceMessages: closedTurnMessages.map((message) => ({
            id: message.id,
            role: message.role,
            ...buildEpisodeSensitivityMessageText(message),
          })),
          facts: factSensitivityInputs,
        },
        now,
      }
    : null;
  const episode = episodeInput
    ? options.episodeAccess
      ? recordEpisode({
          ...episodeInput,
          accessPolicy: {
            memoryConversationId: options.conversationId,
            sourceThreadId: options.threadId,
            personaId: options.episodeAccess.personaId,
            taskId: resolveCodeOwnedMemoryTaskId(options.taskId),
            shareability: options.episodeAccess.shareability,
          },
        })
      : recordThreadLocalEpisode(episodeInput)
    : null;

  const recordedFacts: ApplyConsolidatorResultResult['recordedFacts'] = [];
  const resolvedFacts: ApplyConsolidatorResultResult['resolvedFacts'] = [];
  const invalidatedFactIds: string[] = [];
  for (const [inputIndex, fact] of result.newFacts.entries()) {
    const sensitivityInput = factSensitivityInputs[inputIndex]!;
    const subjectType = fact.subject === 'user' ? 'self' : 'concept';
    const sourceMessageId =
      fact.evidenceMessageIds?.[0] ??
      options.sourceUserMessageId ??
      options.sourceAssistantMessageId ??
      null;
    const attributes = sensitivityInput.attributes ?? {};
    const sourceSummary = sensitivityInput.sourceSummary ?? null;
    if (classifyMemoryFactSensitivity(sensitivityInput) === 'restricted') {
      continue;
    }
    const subject = upsertEntity({ type: subjectType, name: fact.subject, now });
    const scope = fact.scope ?? 'conversation';
    const factInput = {
      subjectId: subject.id,
      predicate: fact.predicate,
      objectText: fact.value,
      confidence: confidenceToScore(fact.confidence),
      scope,
      ...(scope === 'project' || scope === 'conversation' || scope === 'session'
        ? {
            originConversationId: options.conversationId,
            originThreadId: options.threadId,
          }
        : {}),
      ...(scope === 'session' ? { originTaskId: options.taskId } : {}),
      sourceRunId: options.sourceRunId ?? null,
      sourceMessageId: fact.admittedWrite?.evidenceMessageId ?? sourceMessageId,
      sourceTurnId: options.sourceAssistantMessageId ?? options.sourceUserMessageId ?? null,
      sourceSummary,
      importance: fact.importance ?? inferFactImportance(fact),
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      now,
    };
    const sealedApplicability =
      fact.admittedWrite !== undefined
        ? {
            factClass: 'subjective_user' as const,
            sourceAuthority: 'grounded_user' as const,
          }
        : (fact.sealedApplicability ?? {
            factClass: subjectType === 'self' ? ('subjective_user' as const) : ('unknown' as const),
            sourceAuthority: 'assistant_inferred' as const,
          });
    const contributionContext = buildFactContributionContext(fact, factInput, inputIndex, options);
    const recorded =
      fact.admittedWrite?.operation === 'replace_current'
        ? replaceCurrentFactWithContribution(
            {
              ...factInput,
              expectedCurrentFactId: fact.admittedWrite.expectedCurrentFactId,
            },
            sealedApplicability,
            contributionContext,
            fact.sensitivityDeclaration,
          )
        : recordFactWithContribution(
            { ...factInput, supersedePrior: false },
            sealedApplicability,
            contributionContext,
            fact.sensitivityDeclaration,
          );
    if (recorded.status === 'conflict') {
      logger.devWarn(`Grounded replacement rejected at persistence: ${recorded.conflict}`);
      continue;
    }
    if (recorded.status === 'created') {
      recordedFacts.push({ inputIndex, factId: recorded.fact.id });
    }
    resolvedFacts.push({ inputIndex, factId: recorded.fact.id });
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
  const taskId = resolveCodeOwnedMemoryTaskId(options.taskId);
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
    recordedFacts,
    resolvedFacts,
    invalidatedFactIds,
    activeFocusUpdated,
    openThreadsUpdated,
    episodeId: episode?.id ?? null,
  };
}

function buildFactContributionContext(
  fact: ConsolidatorFact,
  factInput: {
    sourceMessageId: string | null;
    sourceTurnId: string | null;
    sourceRunId: string | null;
  },
  inputIndex: number,
  options: ApplyConsolidatorResultBaseOptions,
): MemoryFactContributionWriteContext {
  const sourceAliases: MemoryFactContributionSourceAlias[] = [];
  const addAlias = (
    sourceKind: MemoryFactContributionSourceAlias['sourceKind'],
    sourceId: string | null | undefined,
  ) => {
    if (sourceId) sourceAliases.push({ sourceKind, sourceId });
  };
  addAlias('message', factInput.sourceMessageId);
  addAlias('turn', factInput.sourceTurnId);
  addAlias('run', factInput.sourceRunId);
  addAlias('message', options.sourceUserMessageId);
  for (const evidenceMessageId of fact.evidenceMessageIds ?? []) {
    addAlias('message', evidenceMessageId);
  }
  addAlias('message', fact.admittedWrite?.evidenceMessageId);

  return {
    memoryConversationId: options.conversationId,
    sourceThreadId: options.threadId,
    taskId: options.taskId,
    producer: {
      producerId: options.factContributionProducerId,
      producerEventId: buildConsolidationFactProducerEventId({
        producerId: options.factContributionProducerId,
        sourceAssistantMessageId: options.sourceAssistantMessageId,
        inputIndex,
      }),
    },
    sourceAliases,
  };
}

function selectClosedTurnMessages(
  messages: ReadonlyArray<Message>,
  sourceUserMessageId: string | undefined,
  sourceAssistantMessageId: string | undefined,
): Message[] {
  if (!sourceUserMessageId || !sourceAssistantMessageId) return [...messages];
  const start = messages.findIndex(
    (message) => message.id === sourceUserMessageId && message.role === 'user',
  );
  const end = messages.findIndex(
    (message, index) =>
      index >= start && message.id === sourceAssistantMessageId && message.role === 'assistant',
  );
  return start >= 0 && end >= start ? messages.slice(start, end + 1) : [];
}

function buildFactSensitivityInput(
  fact: ConsolidatorFact,
  episodeSummary: string | null,
): MemorySensitivityInput {
  const sensitivityDeclaration = requireMemorySensitivityDeclaration(
    fact.sensitivityDeclaration,
    'memory_fact_sensitivity_declaration_invalid',
  );
  const memoryWrite = fact.admittedWrite
    ? {
        operation: fact.admittedWrite.operation,
        authority: fact.admittedWrite.authority,
        evidenceMessageId: fact.admittedWrite.evidenceMessageId,
        ...(fact.admittedWrite.operation === 'replace_current'
          ? { expectedCurrentFactId: fact.admittedWrite.expectedCurrentFactId }
          : {}),
        assertionClass: fact.assertionClass ?? null,
        evidenceQuote: fact.evidenceQuote ?? null,
      }
    : undefined;
  return {
    declaredSensitivity: sensitivityDeclaration.sensitivity,
    subject: fact.subject,
    predicate: fact.predicate,
    objectText: fact.value,
    attributes: {
      ...(fact.reason ? { reason: fact.reason } : {}),
      ...(memoryWrite ? { memoryWrite } : {}),
    },
    sourceSummary: fact.reason ?? episodeSummary ?? null,
  };
}

const EPISODE_SENSITIVITY_FIELD_LIMIT = 16_000;

function boundedEpisodeSensitivityField(value: string | undefined): {
  content: string;
  truncated: boolean;
} {
  if (!value) return { content: '', truncated: false };
  if (value.length <= EPISODE_SENSITIVITY_FIELD_LIMIT) {
    return { content: value, truncated: false };
  }
  const side = Math.floor(EPISODE_SENSITIVITY_FIELD_LIMIT / 2);
  return {
    content: `${value.slice(0, side)}\n${value.slice(-side)}`,
    truncated: true,
  };
}

function buildEpisodeSensitivityMessageText(message: Message): {
  content: string;
  truncated: boolean;
} {
  const fields = [message.content, message.enrichedContent, message.reasoning];
  for (const toolCall of message.toolCalls ?? []) {
    fields.push(
      toolCall.name,
      toolCall.arguments,
      toolCall.result,
      toolCall.error,
      toolCall.progressText,
    );
  }
  const bounded = fields.map(boundedEpisodeSensitivityField);
  return {
    content: bounded
      .map((field) => field.content)
      .filter(Boolean)
      .join('\n'),
    truncated: bounded.some((field) => field.truncated),
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
