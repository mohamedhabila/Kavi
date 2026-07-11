// ---------------------------------------------------------------------------
// Kavi — memory_* tool executors
// ---------------------------------------------------------------------------
// Self-contained handlers for the agent-facing memory tools. Each handler
// takes a strongly-typed args object, performs validation, and returns a
// stringifiable JSON-compatible result. Handlers never throw out of the tool
// loop — they wrap parse / store errors into a tagged error response so the
// orchestrator can surface a sensible message to the user.
//
// Tool surface:
//   • memory_recall      — list facts about a subject (entity name).
//   • memory_remember    — record a single fact (with supersession optional).
//   • memory_pin         — pin an existing fact so retrieval always shows it.
//   • memory_unpin       — opposite of memory_pin.
//   • memory_forget      — withdraw a fact and its derived memory.
//   • memory_block_edit  — replace/append a memory block's content.
//   • memory_block_read  — read one or all memory blocks (no args = all).
//
// `memory_search` is implemented in `builtin-memory.ts` over the same
// structured living-memory fact store.
// ---------------------------------------------------------------------------

import { findEntityByName, getEntityById, type EntityType } from './entities';
import {
  invalidateFact,
  markFactsRecalled,
  setFactPinned,
} from './facts/mutations';
import { requireFactScopeIdentity } from './facts/scopeIdentity';
import { getFactById, listFacts, listFactsForRecallEligibleScan } from './facts/queries';
import { requireMemoryFactScope, type MemoryFact, type MemoryFactScope } from './facts/types';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { resolveLocalMemoryAccessScope } from './memoryScopeStore';
import { canManageMemoryFactFromScope } from './memoryFactActionAuthorization';
import { editBlock, ensureDefaultBlocks, getBlock, listBlocks, BlockOverflowError } from './blocks';
import { ensureFactSchema } from './schema';
import { canReadLongTermMemory, canWriteLongTermMemory } from './policy';
import { withdrawMemoryFact } from './withdrawal';
import type {
  MemoryBlockEditResult,
  MemoryBlockReadResult,
  MemoryForgetResult,
  MemoryInvalidateResult,
  MemoryPinResult,
  MemoryRememberResult,
  SerializedMemoryFact,
} from './memoryToolResultTypes';
export type {
  MemoryBlockEditResult,
  MemoryBlockReadResult,
  MemoryForgetResult,
  MemoryInvalidateResult,
  MemoryPinResult,
  MemoryRememberResult,
  SerializedMemoryFact,
} from './memoryToolResultTypes';
import { loadActiveMemoryFactConflictSignals } from './facts/observations';
import {
  applyMemoryApplicabilityPolicy,
  emptyMemoryApplicabilitySummary,
} from './memoryApplicabilityPolicy';
import { selectMemoryApplicabilityResolutionFactIds } from './memoryApplicabilityPrompt';
import type {
  MemoryApplicabilityAnnotation,
  MemoryApplicabilitySummary,
} from './memoryApplicabilityTypes';
import {
  persistMemoryRemember,
  type MemoryRememberRequestEvidence,
} from './memoryRememberPersistence';

// ── Common types ─────────────────────────────────────────────────────────

export interface MemoryToolError {
  ok: false;
  error: string;
  code:
    | 'invalid_args'
    | 'not_found'
    | 'memory_disabled'
    | 'block_overflow'
    | 'unknown_block'
    | 'grounding_required'
    | 'conflict'
    | 'permission_denied'
    | 'internal';
}

function err(code: MemoryToolError['code'], message: string): MemoryToolError {
  return { ok: false, code, error: message };
}

function trimNonEmpty(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function serializeFact(fact: MemoryFact): SerializedMemoryFact {
  const subject = getEntityById(fact.subjectId)?.canonicalName ?? fact.subjectId;
  return {
    id: fact.id,
    subject,
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    value: fact.objectText,
    confidence: fact.confidence,
    pinned: fact.pinned,
    validAt: fact.validAt,
    invalidAt: fact.invalidAt,
    createdAt: fact.createdAt,
    updatedAt: fact.updatedAt,
    deletedAt: fact.deletedAt,
    scope: fact.scope,
    personaId: fact.personaId,
    originConversationId: fact.originConversationId,
    originThreadId: fact.originThreadId,
    originTaskId: fact.originTaskId,
    sourceMessageId: fact.sourceMessageId,
    sourceTurnId: fact.sourceTurnId,
    sourceSummary: fact.sourceSummary,
    importance: fact.importance,
    accessCount: fact.accessCount,
    lastRecalledAt: fact.lastRecalledAt,
    lastAccessedAt: fact.lastAccessedAt,
    decayPolicy: fact.decayPolicy,
  };
}

// ── memory_recall ────────────────────────────────────────────────────────

export interface MemoryFactManagementQueryArgs {
  subject?: string;
  predicate?: string;
  scope?: MemoryFactScope;
  originConversationId?: string;
  originTaskId?: string;
  all?: boolean;
  pinnedOnly?: boolean;
  limit?: number;
  /** When true, include invalidated/historical rows. */
  includeHistory?: boolean;
}

export interface MemoryFactManagementQueryResult {
  ok: true;
  subject: string | null;
  facts: ReturnType<typeof serializeFact>[];
}

export function queryMemoryFactsForManagement(
  args: MemoryFactManagementQueryArgs,
): MemoryFactManagementQueryResult | MemoryToolError {
  ensureFactSchema();
  const subject = trimNonEmpty(args.subject, 80);
  const predicate = trimNonEmpty(args.predicate, 80);

  if (
    !subject &&
    !predicate &&
    !args.scope &&
    !args.originConversationId &&
    !args.originTaskId &&
    !args.pinnedOnly &&
    args.all !== true
  ) {
    return err('invalid_args', 'Provide a filter or set all=true to list all facts.');
  }

  let subjectId: string | undefined;
  if (subject) {
    const entity = findEntityByName(subject);
    if (!entity) {
      return { ok: true, subject, facts: [] };
    }
    subjectId = entity.id;
  }

  const facts = listFacts({
    ...(subjectId ? { subjectId } : {}),
    ...(predicate ? { predicate } : {}),
    ...(args.scope ? { scope: args.scope } : {}),
    ...(args.originConversationId ? { originConversationId: args.originConversationId } : {}),
    ...(args.originTaskId ? { originTaskId: args.originTaskId } : {}),
    ...(args.pinnedOnly ? { pinnedOnly: true } : {}),
    ...(typeof args.limit === 'number' && args.limit > 0
      ? { limit: Math.min(args.limit, 100) }
      : {}),
    ...(args.includeHistory ? { includeInvalidated: true } : {}),
  });

  return {
    ok: true,
    subject,
    facts: facts.map(serializeFact),
  };
}

export interface MemoryRecallArgs {
  subject?: string;
  predicate?: string;
  scope?: MemoryFactScope;
  all?: boolean;
  pinnedOnly?: boolean;
  limit?: number;
}

export interface MemoryRecallExecutionContext {
  memoryConversationId: string;
  sourceThreadId: string;
  personaId: string;
  taskId: string | null;
  now?: number;
}

export interface SerializedApplicableMemoryFact extends SerializedMemoryFact {
  policy: MemoryApplicabilityAnnotation;
}

export interface MemoryRecallResult {
  ok: true;
  subject: string | null;
  facts: SerializedApplicableMemoryFact[];
  policyInstruction: string;
  applicabilityPolicy: MemoryApplicabilitySummary;
  degraded?: true;
}

const MEMORY_RECALL_DIRECT_LIMIT = 50;
const MEMORY_RECALL_RESOLUTION_LIMIT = 14;
const MEMORY_RECALL_ARG_KEYS = new Set([
  'subject',
  'predicate',
  'scope',
  'all',
  'pinnedOnly',
  'limit',
]);
const MEMORY_RECALL_POLICY_INSTRUCTION =
  'Memory fact policy is binding: use only action=use; ask the user before relying on action=ask; never assert or act on action=abstain.';

function recallLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isFinite(value) || value < 1) throw new Error('memory_recall_limit_invalid');
  return Math.min(Math.floor(value), MEMORY_RECALL_DIRECT_LIMIT);
}

/** Agent-facing exact recall. Management/UI reads use queryMemoryFactsForManagement. */
export function executeMemoryRecall(
  args: MemoryRecallArgs,
  execution: MemoryRecallExecutionContext,
): MemoryRecallResult | MemoryToolError {
  if (!canReadLongTermMemory()) return err('memory_disabled', 'Long-term memory is disabled.');
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).some((key) => !MEMORY_RECALL_ARG_KEYS.has(key))
  ) {
    return err('invalid_args', 'memory_recall received unsupported arguments.');
  }
  if (
    !execution ||
    !isExactMemoryScopeId(execution.memoryConversationId) ||
    !isExactMemoryScopeId(execution.sourceThreadId) ||
    !isExactMemoryScopeId(execution.personaId) ||
    (execution.taskId !== null && !isExactMemoryScopeId(execution.taskId))
  ) {
    return err('invalid_args', 'memory_recall execution scope is invalid.');
  }
  const now = execution.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    return err('invalid_args', 'memory_recall timestamp is invalid.');
  }
  let limit: number;
  try {
    limit = recallLimit(args.limit);
    if (args.scope !== undefined) requireMemoryFactScope(args.scope);
  } catch {
    return err('invalid_args', 'memory_recall limit or scope is invalid.');
  }
  const subject = trimNonEmpty(args.subject, 80);
  const predicate = trimNonEmpty(args.predicate, 80);
  if (!subject && !predicate && !args.scope && !args.pinnedOnly && args.all !== true) {
    return err('invalid_args', 'Provide a filter or set all=true to list all facts.');
  }

  try {
    ensureFactSchema();
    let subjectId: string | undefined;
    if (subject) {
      const entity = findEntityByName(subject);
      if (!entity) {
        return {
          ok: true,
          subject,
          facts: [],
          policyInstruction: MEMORY_RECALL_POLICY_INSTRUCTION,
          applicabilityPolicy: emptyMemoryApplicabilitySummary('applied'),
        };
      }
      subjectId = entity.id;
    }
    const memoryScope = resolveLocalMemoryAccessScope({
      memoryConversationId: execution.memoryConversationId,
      sourceThreadId: execution.sourceThreadId,
      personaId: execution.personaId,
      taskId: execution.taskId,
    });
    const queryOptions = {
      ...(subjectId ? { subjectId } : {}),
      ...(predicate ? { predicate } : {}),
      ...(args.scope ? { scope: args.scope } : {}),
      ...(args.pinnedOnly ? { pinnedOnly: true } : {}),
      asOf: now,
    };
    const directFacts = listFactsForRecallEligibleScan({
      ...queryOptions,
      recallScopeIdentity: {
        ...memoryScope,
        useIntent: 'explicit_user_request',
        candidateLane: 'direct_use',
      },
      limit,
    });
    const resolutionFacts = listFactsForRecallEligibleScan({
      ...queryOptions,
      recallScopeIdentity: {
        ...memoryScope,
        useIntent: 'explicit_user_request',
        candidateLane: 'resolution',
      },
      limit: MEMORY_RECALL_RESOLUTION_LIMIT,
    });
    const candidates = [...directFacts, ...resolutionFacts];
    let conflictObservationReadState: 'available' | 'failed' = 'available';
    let persistedConflicts: ReturnType<typeof loadActiveMemoryFactConflictSignals> = [];
    try {
      persistedConflicts = loadActiveMemoryFactConflictSignals({
        factIds: candidates.map((fact) => fact.id),
        currentScope: memoryScope,
        asOf: now,
      });
    } catch {
      conflictObservationReadState = 'failed';
    }
    const applicability = applyMemoryApplicabilityPolicy({
      facts: candidates,
      context: {
        enabled: true,
        now,
        useIntent: 'explicit_user_request',
        scope: memoryScope,
        conflictObservationReadState,
        ...(persistedConflicts.length > 0 ? { externalEvidence: persistedConflicts } : {}),
      },
    });
    const factById = new Map(candidates.map((fact) => [fact.id, fact] as const));
    const annotated = applicability.factDecisions.flatMap((decision) => {
      const fact = factById.get(decision.factId);
      if (!fact || decision.action === 'silent') return [];
      return [
        {
          id: fact.id,
          fact,
          applicability: { action: decision.action, reason: decision.reason },
        },
      ];
    });
    const resolutionIds = selectMemoryApplicabilityResolutionFactIds(annotated);
    const selected = [
      ...annotated.filter((entry) => resolutionIds.has(entry.id)),
      ...annotated.filter(
        (entry) => entry.applicability.action === 'use' && !resolutionIds.has(entry.id),
      ),
    ].slice(0, limit);
    const facts = selected.map(
      (entry): SerializedApplicableMemoryFact => ({
        ...serializeFact(entry.fact),
        policy: entry.applicability,
      }),
    );
    const applicabilityPolicy: MemoryApplicabilitySummary = {
      ...applicability.summary,
      promptVisibleFactCount: facts.length,
      promptBudgetDroppedFactCount: applicability.summary.promptVisibleFactCount - facts.length,
    };
    markFactsRecalled(
      selected.map((entry) => entry.id),
      now,
    );
    return {
      ok: true,
      subject,
      facts,
      policyInstruction: MEMORY_RECALL_POLICY_INSTRUCTION,
      applicabilityPolicy,
      ...(applicabilityPolicy.state === 'degraded' ? { degraded: true } : {}),
    };
  } catch {
    return err('internal', 'memory_recall failed.');
  }
}

// ── memory_remember ──────────────────────────────────────────────────────

export interface MemoryRememberArgs {
  subject: string;
  /** Defaults to 'concept'; use 'self' for the user, 'project'/'person'/etc. for entities. */
  subjectType?: EntityType;
  predicate: string;
  value: string;
  confidence?: number;
  pinned?: boolean;
  scope: MemoryFactScope;
  originConversationId?: string | null;
  originThreadId?: string | null;
  originTaskId?: string | null;
  sourceRunId?: string | null;
  sourceSummary?: string | null;
  importance?: number;
}

export interface MemoryRememberExecutionContext {
  /** Code-owned persona identity; never accepted from provider tool arguments. */
  personaId?: string;
  /** Exact code-owned request evidence; never accepted from provider tool arguments. */
  requestEvidence?: MemoryRememberRequestEvidence;
}

export function executeMemoryRemember(
  args: MemoryRememberArgs,
  context: MemoryRememberExecutionContext = {},
): MemoryRememberResult | MemoryToolError {
  if (!canWriteLongTermMemory()) return err('memory_disabled', 'Long-term memory is disabled.');
  ensureFactSchema();
  const subject = trimNonEmpty(args.subject, 80);
  const predicate = trimNonEmpty(args.predicate, 80);
  const value = trimNonEmpty(args.value, 200);
  if (!subject) return err('invalid_args', 'subject is required');
  if (!predicate) return err('invalid_args', 'predicate is required');
  if (!value) return err('invalid_args', 'value is required');
  if (typeof args.subject === 'string' && args.subject.trim().length > 80) {
    return err('invalid_args', 'subject must be at most 80 characters');
  }
  if (typeof args.predicate === 'string' && args.predicate.trim().length > 80) {
    return err('invalid_args', 'predicate must be at most 80 characters');
  }
  if (typeof args.value === 'string' && args.value.trim().length > 200) {
    return err('invalid_args', 'value must be at most 200 characters');
  }

  const canonicalSelfSubject = subject.normalize('NFKC').trim() === 'user';
  const subjectType: EntityType = canonicalSelfSubject
    ? 'self'
    : args.subjectType === 'self'
      ? 'concept'
      : (args.subjectType ?? 'concept');

  let scope: MemoryFactScope;
  try {
    scope = requireMemoryFactScope(args.scope);
    requireFactScopeIdentity(args, scope);
    if (scope === 'persona' && !isExactMemoryScopeId(context.personaId)) {
      throw new Error('memory_fact_persona_id_required');
    }
  } catch (error) {
    return err('invalid_args', error instanceof Error ? error.message : 'invalid memory scope');
  }

  try {
    const persisted = persistMemoryRemember(
      {
        subject,
        subjectType,
        predicate,
        value,
        confidence: typeof args.confidence === 'number' ? args.confidence : undefined,
        pinned: args.pinned === true,
        scope,
        ...(args.originConversationId !== undefined
          ? { originConversationId: args.originConversationId }
          : {}),
        ...(args.originThreadId !== undefined ? { originThreadId: args.originThreadId } : {}),
        ...(args.originTaskId !== undefined ? { originTaskId: args.originTaskId } : {}),
        ...(args.sourceRunId !== undefined ? { sourceRunId: args.sourceRunId } : {}),
        ...(args.sourceSummary !== undefined ? { sourceSummary: args.sourceSummary } : {}),
        ...(typeof args.importance === 'number' ? { importance: args.importance } : {}),
      },
      context,
    );
    if (persisted.status === 'grounding_required') {
      return err(
        'grounding_required',
        `memory_remember requires exact current-user grounding before changing this fact (${persisted.reason}).`,
      );
    }
    if (persisted.status === 'conflict') {
      return err('conflict', `memory_remember current fact changed (${persisted.conflict}); retry.`);
    }
    const result = persisted.result;
    return {
      ok: true,
      fact: serializeFact(result.fact),
      status: result.status,
      superseded: result.superseded.map(serializeFact),
    };
  } catch (e) {
    return err('internal', e instanceof Error ? e.message : 'memory_remember failed');
  }
}

// ── memory_pin / memory_unpin ────────────────────────────────────────────

export interface MemoryPinArgs {
  factId: string;
}

export type MemoryFactActionExecutionContext = MemoryRecallExecutionContext;

function resolveAuthorizedFactForAction(
  factId: string,
  execution: MemoryFactActionExecutionContext,
): MemoryFact | MemoryToolError {
  if (
    !execution ||
    !isExactMemoryScopeId(execution.memoryConversationId) ||
    !isExactMemoryScopeId(execution.sourceThreadId) ||
    !isExactMemoryScopeId(execution.personaId) ||
    (execution.taskId !== null && !isExactMemoryScopeId(execution.taskId))
  ) {
    return err('invalid_args', 'memory fact action execution scope is invalid.');
  }
  const fact = getFactById(factId);
  if (!fact || fact.deletedAt !== null) return err('not_found', `fact ${factId} not found`);
  const currentScope = resolveLocalMemoryAccessScope({
    memoryConversationId: execution.memoryConversationId,
    sourceThreadId: execution.sourceThreadId,
    personaId: execution.personaId,
    taskId: execution.taskId,
  });
  return canManageMemoryFactFromScope(fact, currentScope)
    ? fact
    : err('permission_denied', 'Fact is outside the current memory scope.');
}

function setPin(
  args: MemoryPinArgs,
  pinned: boolean,
  execution: MemoryFactActionExecutionContext,
): MemoryPinResult | MemoryToolError {
  if (!canWriteLongTermMemory()) return err('memory_disabled', 'Long-term memory is disabled.');
  if (!args || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'factId')) {
    return err('invalid_args', `${pinned ? 'memory_pin' : 'memory_unpin'} accepts only factId.`);
  }
  ensureFactSchema();
  const id = trimNonEmpty(args.factId, 64);
  if (!id) return err('invalid_args', 'factId is required');
  try {
    const authorized = resolveAuthorizedFactForAction(id, execution);
    if ('ok' in authorized) return authorized;
    const updated = setFactPinned(id, pinned);
    if (!updated) return err('not_found', `fact ${id} not found or deleted`);
    const fact = getFactById(id);
    if (!fact) return err('not_found', `fact ${id} not found after update`);
    return { ok: true, status: pinned ? 'pinned' : 'unpinned', fact: serializeFact(fact) };
  } catch (e) {
    return err('internal', e instanceof Error ? e.message : 'pin update failed');
  }
}

export function executeMemoryPin(
  args: MemoryPinArgs,
  execution: MemoryFactActionExecutionContext,
): MemoryPinResult | MemoryToolError {
  return setPin(args, true, execution);
}

export function executeMemoryUnpin(
  args: MemoryPinArgs,
  execution: MemoryFactActionExecutionContext,
): MemoryPinResult | MemoryToolError {
  return setPin(args, false, execution);
}

/** Explicit whole-vault UI management; never use this from provider tool execution. */
export function setMemoryFactPinnedForManagement(
  args: MemoryPinArgs,
  pinned: boolean,
): MemoryPinResult | MemoryToolError {
  if (!canWriteLongTermMemory()) return err('memory_disabled', 'Long-term memory is disabled.');
  if (!args || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'factId')) {
    return err('invalid_args', 'Memory management accepts only factId.');
  }
  ensureFactSchema();
  const id = trimNonEmpty(args.factId, 64);
  if (!id) return err('invalid_args', 'factId is required');
  try {
    if (!setFactPinned(id, pinned)) return err('not_found', `fact ${id} not found or deleted`);
    const fact = getFactById(id);
    if (!fact) return err('not_found', `fact ${id} not found after update`);
    return { ok: true, status: pinned ? 'pinned' : 'unpinned', fact: serializeFact(fact) };
  } catch (error) {
    return err('internal', error instanceof Error ? error.message : 'pin update failed');
  }
}

// ── memory_forget ────────────────────────────────────────────────────────

export interface MemoryForgetArgs {
  factId: string;
}

export function executeMemoryForget(args: MemoryForgetArgs): MemoryForgetResult | MemoryToolError {
  if (!args || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'factId')) {
    return err('invalid_args', 'memory_forget accepts only factId.');
  }
  const id = trimNonEmpty(args.factId, 64);
  if (!id) return err('invalid_args', 'factId is required');
  try {
    const result = withdrawMemoryFact(id);
    if (result.status === 'not_found') return err('not_found', `fact ${id} not found`);
    return {
      ok: true,
      action: 'withdrawal',
      status: result.status,
      factId: id,
      receipt: result.receipt,
    };
  } catch {
    return err('internal', 'Memory withdrawal failed.');
  }
}

export interface MemoryInvalidateArgs {
  factId: string;
}

export function executeMemoryInvalidate(
  args: MemoryInvalidateArgs,
  execution: MemoryFactActionExecutionContext,
): MemoryInvalidateResult | MemoryToolError {
  if (!args || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'factId')) {
    return err('invalid_args', 'memory_manage action=invalidate accepts only factId.');
  }
  if (!canWriteLongTermMemory()) return err('memory_disabled', 'Long-term memory is disabled.');
  ensureFactSchema();
  const id = trimNonEmpty(args.factId, 64);
  if (!id) return err('invalid_args', 'factId is required');
  try {
    const authorized = resolveAuthorizedFactForAction(id, execution);
    if ('ok' in authorized) return authorized;
    const invalidatedAt = Date.now();
    if (!invalidateFact(id, invalidatedAt)) {
      return err('not_found', `fact ${id} not found or already invalidated`);
    }
    return { ok: true, action: 'invalidation', factId: id, invalidatedAt, status: 'invalidated' };
  } catch {
    return err('internal', 'Memory invalidation failed.');
  }
}

// ── memory_block_read ────────────────────────────────────────────────────

export interface MemoryBlockReadArgs {
  /** Omit to return all blocks. */
  label?: string;
}

export function executeMemoryBlockRead(
  args: MemoryBlockReadArgs = {},
): MemoryBlockReadResult | MemoryToolError {
  ensureFactSchema();
  ensureDefaultBlocks();
  const label = trimNonEmpty(args.label, 64);
  const blocks = label
    ? [getBlock(label)].filter((b): b is NonNullable<typeof b> => !!b)
    : listBlocks();
  if (label && blocks.length === 0) {
    return err('unknown_block', `block "${label}" not found`);
  }
  return {
    ok: true,
    status: 'read',
    resourceId: label ?? '*',
    blocks: blocks.map((b) => ({
      label: b.label,
      content: b.content,
      description: b.description,
      pinned: b.pinned,
      charLimit: b.charLimit,
      charsUsed: b.content.length,
    })),
  };
}

// ── memory_block_edit ────────────────────────────────────────────────────

export interface MemoryBlockEditArgs {
  label: string;
  content: string;
  /** When true (default), content replaces the block. When false, appended with newline. */
  replace?: boolean;
}

export function executeMemoryBlockEdit(
  args: MemoryBlockEditArgs,
): MemoryBlockEditResult | MemoryToolError {
  ensureFactSchema();
  ensureDefaultBlocks();
  const label = trimNonEmpty(args.label, 64);
  if (!label) return err('invalid_args', 'label is required');
  if (typeof args.content !== 'string') {
    return err('invalid_args', 'content is required');
  }
  const replace = args.replace !== false;
  try {
    const updated = editBlock(label, args.content, { replace });
    return {
      ok: true,
      status: 'edited',
      resourceId: updated.label,
      block: {
        label: updated.label,
        content: updated.content,
        charLimit: updated.charLimit,
        charsUsed: updated.content.length,
      },
    };
  } catch (e) {
    if (e instanceof BlockOverflowError) {
      return err(
        'block_overflow',
        `block "${e.label}" overflow: tried ${e.attemptedLength} chars, limit is ${e.charLimit}`,
      );
    }
    if (e instanceof Error && e.message.includes('not found')) {
      return err('unknown_block', e.message);
    }
    return err('internal', e instanceof Error ? e.message : 'block edit failed');
  }
}
