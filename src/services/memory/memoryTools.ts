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
//
// `memory_search` is implemented in `builtin-memory.ts` over the same
// structured living-memory fact store.
// ---------------------------------------------------------------------------

import { findEntityByName, type EntityType } from './entities';
import { markFactsRecalled } from './facts/mutations';
import { requireFactScopeIdentity } from './facts/scopeIdentity';
import { listFacts, listFactsForRecallEligibleScan } from './facts/queries';
import { requireMemoryFactScope, type MemoryFactScope } from './facts/types';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { resolveLocalMemoryAccessScope } from './memoryScopeStore';
import { ensureFactSchema } from './schema';
import {
  canReadLongTermMemory,
  canWriteLongTermMemory,
  captureMemoryReadEpoch,
  isMemoryReadEpochCurrent,
} from './policy';
import type {
  MemoryRememberResult,
  MemorySupersessionReceipt,
  SerializedMemoryFact,
} from './memoryToolResultTypes';
export type {
  MemoryForgetResult,
  MemoryInvalidateResult,
  MemoryPinResult,
  MemoryRememberResult,
  MemorySupersessionReceipt,
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
import { serializeMemoryFact } from './memoryFactSerialization';
import { canonicalizeMemorySubject, isCanonicalSelfMemorySubject } from './memorySubjectIdentity';
import {
  consumeExplicitMemoryRecallGrant,
  discardExplicitMemoryRecallGrant,
  type ExplicitMemoryRecallGrant,
} from './explicitMemoryRecallGrant';
export {
  executeMemoryForget,
  executeMemoryInvalidate,
  executeMemoryPin,
  executeMemoryUnpin,
  forgetMemoryFactForManagement,
  setMemoryFactPinnedForManagement,
} from './memoryFactActions';
export type {
  MemoryFactActionExecutionContext,
  MemoryForgetArgs,
  MemoryInvalidateArgs,
  MemoryPinArgs,
} from './memoryFactActions';

function serializeSupersessionReceipt(fact: {
  id: string;
  invalidAt: number | null;
}): MemorySupersessionReceipt {
  if (!Number.isFinite(fact.invalidAt)) throw new Error('memory_supersession_receipt_invalid');
  return { id: fact.id, invalidAt: fact.invalidAt! };
}

// ── Common types ─────────────────────────────────────────────────────────

export interface MemoryToolError {
  status: 'rejected' | 'failed_unknown';
  ok: false;
  error: string;
  code:
    | 'invalid_args'
    | 'not_found'
    | 'memory_disabled'
    | 'grounding_required'
    | 'conflict'
    | 'permission_denied'
    | 'internal';
}

function err(code: MemoryToolError['code'], message: string): MemoryToolError {
  return {
    status: code === 'internal' ? 'failed_unknown' : 'rejected',
    ok: false,
    code,
    error: message,
  };
}

function trimNonEmpty(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
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
  facts: ReturnType<typeof serializeMemoryFact>[];
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
    facts: facts.map(serializeMemoryFact),
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
  /** Raw request identity supplied by the orchestrator, never provider args. */
  requestIdentity?: {
    currentUserMessageId: string;
    currentUserMessageText: string;
    executionRunId: string;
    agentRunId: string | null;
  };
  /** Ephemeral one-use authority created from requestIdentity by product code. */
  explicitUserRequestGrant?: ExplicitMemoryRecallGrant;
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
  const rejectRecall = (code: MemoryToolError['code'], message: string): MemoryToolError => {
    discardExplicitMemoryRecallGrant(execution?.explicitUserRequestGrant);
    return err(code, message);
  };
  const memoryReadEpoch = captureMemoryReadEpoch();
  if (
    memoryReadEpoch === null ||
    !canReadLongTermMemory() ||
    !isMemoryReadEpochCurrent(memoryReadEpoch)
  ) {
    return rejectRecall('memory_disabled', 'Long-term memory is disabled.');
  }
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).some((key) => !MEMORY_RECALL_ARG_KEYS.has(key))
  ) {
    return rejectRecall('invalid_args', 'memory_recall received unsupported arguments.');
  }
  if (
    !execution ||
    !isExactMemoryScopeId(execution.memoryConversationId) ||
    !isExactMemoryScopeId(execution.sourceThreadId) ||
    !isExactMemoryScopeId(execution.personaId) ||
    (execution.taskId !== null && !isExactMemoryScopeId(execution.taskId))
  ) {
    return rejectRecall('invalid_args', 'memory_recall execution scope is invalid.');
  }
  const now = execution.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    return rejectRecall('invalid_args', 'memory_recall timestamp is invalid.');
  }
  let limit: number;
  try {
    limit = recallLimit(args.limit);
    if (args.scope !== undefined) requireMemoryFactScope(args.scope);
  } catch {
    return rejectRecall('invalid_args', 'memory_recall limit or scope is invalid.');
  }
  const subject = trimNonEmpty(args.subject, 80);
  const predicate = trimNonEmpty(args.predicate, 80);
  if (!subject && !predicate && !args.scope && !args.pinnedOnly && args.all !== true) {
    return rejectRecall('invalid_args', 'Provide a filter or set all=true to list all facts.');
  }

  try {
    ensureFactSchema();
    const memoryScope = resolveLocalMemoryAccessScope({
      memoryConversationId: execution.memoryConversationId,
      sourceThreadId: execution.sourceThreadId,
      personaId: execution.personaId,
      taskId: execution.taskId,
    });
    const useIntent = consumeExplicitMemoryRecallGrant({
      grant: execution.explicitUserRequestGrant,
      currentUserMessageId: execution.requestIdentity?.currentUserMessageId,
      currentUserMessageText: execution.requestIdentity?.currentUserMessageText,
      executionRunId: execution.requestIdentity?.executionRunId,
      agentRunId: execution.requestIdentity?.agentRunId,
      scope: memoryScope,
      subject: args.subject,
      predicate: args.predicate,
      all: args.all,
    })
      ? 'explicit_user_request'
      : 'automatic_prompt';
    let subjectId: string | undefined;
    if (subject) {
      const entity = findEntityByName(subject);
      if (!entity) {
        if (!isMemoryReadEpochCurrent(memoryReadEpoch)) {
          return rejectRecall('memory_disabled', 'Long-term memory is disabled.');
        }
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
        useIntent,
        candidateLane: 'direct_use',
      },
      limit,
    });
    const resolutionFacts = listFactsForRecallEligibleScan({
      ...queryOptions,
      recallScopeIdentity: {
        ...memoryScope,
        useIntent,
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
        useIntent,
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
        ...serializeMemoryFact(entry.fact),
        policy: entry.applicability,
      }),
    );
    const applicabilityPolicy: MemoryApplicabilitySummary = {
      ...applicability.summary,
      promptVisibleFactCount: facts.length,
      promptBudgetDroppedFactCount: applicability.summary.promptVisibleFactCount - facts.length,
    };
    if (!isMemoryReadEpochCurrent(memoryReadEpoch)) {
      return rejectRecall('memory_disabled', 'Long-term memory is disabled.');
    }
    markFactsRecalled(
      selected.map((entry) => entry.id),
      now,
    );
    if (!isMemoryReadEpochCurrent(memoryReadEpoch)) {
      return rejectRecall('memory_disabled', 'Long-term memory is disabled.');
    }
    return {
      ok: true,
      subject,
      facts,
      policyInstruction: MEMORY_RECALL_POLICY_INSTRUCTION,
      applicabilityPolicy,
      ...(applicabilityPolicy.state === 'degraded' ? { degraded: true } : {}),
    };
  } catch {
    return rejectRecall('internal', 'memory_recall failed.');
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
  const rawSubject = trimNonEmpty(args.subject, 80);
  const predicate = trimNonEmpty(args.predicate, 80);
  const value = trimNonEmpty(args.value, 200);
  if (!rawSubject) return err('invalid_args', 'subject is required');
  const normalizedSubject = canonicalizeMemorySubject(rawSubject);
  const selfSubjectCandidate =
    isCanonicalSelfMemorySubject(normalizedSubject) || args.subjectType === 'self';
  const subject = selfSubjectCandidate ? 'user' : normalizedSubject;
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

  const subjectType: EntityType = selfSubjectCandidate ? 'self' : (args.subjectType ?? 'concept');

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
    if (persisted.status === 'restricted_content') {
      return err('permission_denied', 'Credentials and authentication secrets are not stored.');
    }
    if (persisted.status === 'conflict') {
      return err(
        'conflict',
        `memory_remember current fact changed (${persisted.conflict}); retry.`,
      );
    }
    const result = persisted.result;
    return {
      ok: true,
      fact: serializeMemoryFact(result.fact),
      status: result.status,
      superseded: result.superseded.map(serializeSupersessionReceipt),
    };
  } catch (e) {
    return err('internal', e instanceof Error ? e.message : 'memory_remember failed');
  }
}
