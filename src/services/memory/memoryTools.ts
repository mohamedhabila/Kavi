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
//   • memory_forget      — soft-delete a fact (or invalidate, see args).
//   • memory_block_edit  — replace/append a memory block's content.
//   • memory_block_read  — read one or all memory blocks (no args = all).
//
// `memory_search` already exists in `parity-memory.ts` and is unchanged.
// ---------------------------------------------------------------------------

import {
  upsertEntity,
  findEntityByName,
  type EntityType,
} from './entities';
import {
  recordFact,
  listFacts,
  invalidateFact,
  softDeleteFact,
  setFactPinned,
  getFactById,
  type MemoryFact,
} from './facts';
import {
  editBlock,
  ensureDefaultBlocks,
  getBlock,
  listBlocks,
  BlockOverflowError,
} from './blocks';
import { ensureFactSchema } from './schema';

// ── Common types ─────────────────────────────────────────────────────────

export interface MemoryToolError {
  ok: false;
  error: string;
  code:
    | 'invalid_args'
    | 'not_found'
    | 'block_overflow'
    | 'unknown_block'
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

function serializeFact(fact: MemoryFact): Record<string, unknown> {
  return {
    id: fact.id,
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    value: fact.objectText,
    confidence: fact.confidence,
    pinned: fact.pinned,
    validAt: fact.validAt,
    invalidAt: fact.invalidAt,
    createdAt: fact.createdAt,
    deletedAt: fact.deletedAt,
  };
}

// ── memory_recall ────────────────────────────────────────────────────────

export interface MemoryRecallArgs {
  subject?: string;
  predicate?: string;
  pinnedOnly?: boolean;
  limit?: number;
  /** When true, include invalidated/historical rows. */
  includeHistory?: boolean;
}

export interface MemoryRecallResult {
  ok: true;
  subject: string | null;
  facts: ReturnType<typeof serializeFact>[];
}

export function executeMemoryRecall(
  args: MemoryRecallArgs,
): MemoryRecallResult | MemoryToolError {
  ensureFactSchema();
  const subject = trimNonEmpty(args.subject, 80);
  const predicate = trimNonEmpty(args.predicate, 80);

  if (!subject && !predicate && !args.pinnedOnly) {
    return err('invalid_args', 'Provide at least one of: subject, predicate, pinnedOnly.');
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

// ── memory_remember ──────────────────────────────────────────────────────

export interface MemoryRememberArgs {
  subject: string;
  /** Defaults to 'concept'; use 'self' for the user, 'project'/'person'/etc. for entities. */
  subjectType?: EntityType;
  predicate: string;
  value: string;
  confidence?: number;
  /** When true, any currently-valid fact for (subject, predicate) is invalidated first. */
  supersedePrior?: boolean;
  pinned?: boolean;
}

export interface MemoryRememberResult {
  ok: true;
  fact: ReturnType<typeof serializeFact>;
  status: 'created' | 'duplicate';
  superseded: ReturnType<typeof serializeFact>[];
}

export function executeMemoryRemember(
  args: MemoryRememberArgs,
): MemoryRememberResult | MemoryToolError {
  ensureFactSchema();
  const subject = trimNonEmpty(args.subject, 80);
  const predicate = trimNonEmpty(args.predicate, 80);
  const value = trimNonEmpty(args.value, 200);
  if (!subject) return err('invalid_args', 'subject is required');
  if (!predicate) return err('invalid_args', 'predicate is required');
  if (!value) return err('invalid_args', 'value is required');

  const subjectType: EntityType =
    args.subjectType ?? (subject.toLowerCase() === 'user' ? 'self' : 'concept');

  try {
    const entity = upsertEntity({ name: subject, type: subjectType });
    const result = recordFact({
      subjectId: entity.id,
      predicate,
      objectText: value,
      confidence: typeof args.confidence === 'number' ? args.confidence : undefined,
      supersedePrior: args.supersedePrior === true,
      pinned: args.pinned === true,
    });
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

export interface MemoryPinResult {
  ok: true;
  fact: ReturnType<typeof serializeFact>;
}

function setPin(factId: string, pinned: boolean): MemoryPinResult | MemoryToolError {
  ensureFactSchema();
  const id = trimNonEmpty(factId, 64);
  if (!id) return err('invalid_args', 'factId is required');
  try {
    const updated = setFactPinned(id, pinned);
    if (!updated) return err('not_found', `fact ${id} not found or deleted`);
    const fact = getFactById(id);
    if (!fact) return err('not_found', `fact ${id} not found after update`);
    return { ok: true, fact: serializeFact(fact) };
  } catch (e) {
    return err('internal', e instanceof Error ? e.message : 'pin update failed');
  }
}

export function executeMemoryPin(args: MemoryPinArgs): MemoryPinResult | MemoryToolError {
  return setPin(args.factId, true);
}

export function executeMemoryUnpin(args: MemoryPinArgs): MemoryPinResult | MemoryToolError {
  return setPin(args.factId, false);
}

// ── memory_forget ────────────────────────────────────────────────────────

export interface MemoryForgetArgs {
  factId: string;
  /** When 'invalidate', the fact is closed at `now` but not deleted. Default 'delete'. */
  mode?: 'invalidate' | 'delete';
}

export interface MemoryForgetResult {
  ok: true;
  fact: ReturnType<typeof serializeFact>;
  mode: 'invalidate' | 'delete';
}

export function executeMemoryForget(
  args: MemoryForgetArgs,
): MemoryForgetResult | MemoryToolError {
  ensureFactSchema();
  const id = trimNonEmpty(args.factId, 64);
  if (!id) return err('invalid_args', 'factId is required');
  const mode: 'invalidate' | 'delete' = args.mode === 'invalidate' ? 'invalidate' : 'delete';
  try {
    const updated = mode === 'invalidate' ? invalidateFact(id) : softDeleteFact(id);
    if (!updated) return err('not_found', `fact ${id} not found or already ${mode}d`);
    const fact = getFactById(id);
    if (!fact) return err('not_found', `fact ${id} not found after ${mode}`);
    return { ok: true, fact: serializeFact(fact), mode };
  } catch (e) {
    return err('internal', e instanceof Error ? e.message : 'forget failed');
  }
}

// ── memory_block_read ────────────────────────────────────────────────────

export interface MemoryBlockReadArgs {
  /** Omit to return all blocks. */
  label?: string;
}

export interface MemoryBlockReadResult {
  ok: true;
  blocks: Array<{
    label: string;
    content: string;
    description: string;
    pinned: boolean;
    charLimit: number;
    charsUsed: number;
  }>;
}

export function executeMemoryBlockRead(
  args: MemoryBlockReadArgs = {},
): MemoryBlockReadResult | MemoryToolError {
  ensureFactSchema();
  ensureDefaultBlocks();
  const label = trimNonEmpty(args.label, 64);
  const blocks = label ? [getBlock(label)].filter((b): b is NonNullable<typeof b> => !!b) : listBlocks();
  if (label && blocks.length === 0) {
    return err('unknown_block', `block "${label}" not found`);
  }
  return {
    ok: true,
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

export interface MemoryBlockEditResult {
  ok: true;
  block: {
    label: string;
    content: string;
    charLimit: number;
    charsUsed: number;
  };
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
