import { invalidateFact, setFactPinned } from './facts/mutations';
import { getFactById } from './facts/queries';
import type { MemoryFact } from './facts/types';
import { canManageMemoryFactFromScope } from './memoryFactActionAuthorization';
import { serializeMemoryFact } from './memoryFactSerialization';
import type {
  MemoryForgetResult,
  MemoryInvalidateResult,
  MemoryPinResult,
} from './memoryToolResultTypes';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { resolveLocalMemoryAccessScope } from './memoryScopeStore';
import { canWriteLongTermMemory } from './policy';
import { ensureFactSchema } from './schema';
import { withdrawMemoryFact } from './withdrawal';

export interface MemoryPinArgs {
  factId: string;
}

export interface MemoryInvalidateArgs {
  factId: string;
}

export interface MemoryForgetArgs {
  factId: string;
}

export interface MemoryFactActionExecutionContext {
  memoryConversationId: string;
  sourceThreadId: string;
  personaId: string;
  taskId: string | null;
}

export interface MemoryFactActionError {
  ok: false;
  error: string;
  code: 'invalid_args' | 'not_found' | 'memory_disabled' | 'permission_denied' | 'internal';
}

function error(code: MemoryFactActionError['code'], message: string): MemoryFactActionError {
  return { ok: false, code, error: message };
}

function exactFactId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= 64 ? id : null;
}

function validateFactActionArgs(
  args: MemoryPinArgs,
  actionLabel: string,
): string | MemoryFactActionError {
  if (!args || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'factId')) {
    return error('invalid_args', `${actionLabel} accepts only factId.`);
  }
  const id = exactFactId(args.factId);
  return id ?? error('invalid_args', 'factId is required and must be at most 64 characters.');
}

function resolveAuthorizedFactForAction(
  factId: string,
  execution: MemoryFactActionExecutionContext,
): MemoryFact | MemoryFactActionError {
  if (
    !execution ||
    !isExactMemoryScopeId(execution.memoryConversationId) ||
    !isExactMemoryScopeId(execution.sourceThreadId) ||
    !isExactMemoryScopeId(execution.personaId) ||
    (execution.taskId !== null && !isExactMemoryScopeId(execution.taskId))
  ) {
    return error('invalid_args', 'memory fact action execution scope is invalid.');
  }
  const fact = getFactById(factId);
  if (!fact || fact.deletedAt !== null) return error('not_found', `fact ${factId} not found`);
  const currentScope = resolveLocalMemoryAccessScope({
    memoryConversationId: execution.memoryConversationId,
    sourceThreadId: execution.sourceThreadId,
    personaId: execution.personaId,
    taskId: execution.taskId,
  });
  return canManageMemoryFactFromScope(fact, currentScope)
    ? fact
    : error('permission_denied', 'Fact is outside the current memory scope.');
}

function setPin(
  args: MemoryPinArgs,
  pinned: boolean,
  execution: MemoryFactActionExecutionContext,
): MemoryPinResult | MemoryFactActionError {
  if (!canWriteLongTermMemory()) {
    return error('memory_disabled', 'Long-term memory is disabled.');
  }
  if (!args || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'factId')) {
    return error('invalid_args', `${pinned ? 'memory_pin' : 'memory_unpin'} accepts only factId.`);
  }
  ensureFactSchema();
  const id = exactFactId(args.factId);
  if (!id) return error('invalid_args', 'factId is required and must be at most 64 characters.');
  try {
    const authorized = resolveAuthorizedFactForAction(id, execution);
    if ('ok' in authorized) return authorized;
    if (!setFactPinned(id, pinned)) return error('not_found', `fact ${id} not found or deleted`);
    const fact = getFactById(id);
    if (!fact) return error('not_found', `fact ${id} not found after update`);
    return { ok: true, status: pinned ? 'pinned' : 'unpinned', fact: serializeMemoryFact(fact) };
  } catch (cause) {
    return error('internal', cause instanceof Error ? cause.message : 'pin update failed');
  }
}

export function executeMemoryPin(
  args: MemoryPinArgs,
  execution: MemoryFactActionExecutionContext,
): MemoryPinResult | MemoryFactActionError {
  return setPin(args, true, execution);
}

export function executeMemoryUnpin(
  args: MemoryPinArgs,
  execution: MemoryFactActionExecutionContext,
): MemoryPinResult | MemoryFactActionError {
  return setPin(args, false, execution);
}

function withdrawFact(factId: string): MemoryForgetResult | MemoryFactActionError {
  try {
    const result = withdrawMemoryFact(factId);
    if (result.status === 'not_found') return error('not_found', `fact ${factId} not found`);
    return {
      ok: true,
      action: 'withdrawal',
      status: result.status,
      factId,
      receipt: result.receipt,
    };
  } catch {
    return error('internal', 'Memory withdrawal failed.');
  }
}

/** Privacy withdrawal for provider execution, authorized against exact code-owned scope. */
export function executeMemoryForget(
  args: MemoryForgetArgs,
  execution: MemoryFactActionExecutionContext,
): MemoryForgetResult | MemoryFactActionError {
  const id = validateFactActionArgs(args, 'memory_forget');
  if (typeof id !== 'string') return id;
  ensureFactSchema();
  try {
    const authorized = resolveAuthorizedFactForAction(id, execution);
    if ('ok' in authorized) return authorized;
    return withdrawFact(id);
  } catch {
    return error('internal', 'Memory withdrawal failed.');
  }
}

/** Explicit whole-vault UI withdrawal; never use this from provider tool execution. */
export function forgetMemoryFactForManagement(
  args: MemoryForgetArgs,
): MemoryForgetResult | MemoryFactActionError {
  const id = validateFactActionArgs(args, 'Memory management withdrawal');
  if (typeof id !== 'string') return id;
  ensureFactSchema();
  return withdrawFact(id);
}

/** Explicit whole-vault UI management; never use this from provider tool execution. */
export function setMemoryFactPinnedForManagement(
  args: MemoryPinArgs,
  pinned: boolean,
): MemoryPinResult | MemoryFactActionError {
  if (!canWriteLongTermMemory()) {
    return error('memory_disabled', 'Long-term memory is disabled.');
  }
  if (!args || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'factId')) {
    return error('invalid_args', 'Memory management accepts only factId.');
  }
  ensureFactSchema();
  const id = exactFactId(args.factId);
  if (!id) return error('invalid_args', 'factId is required and must be at most 64 characters.');
  try {
    if (!setFactPinned(id, pinned)) return error('not_found', `fact ${id} not found or deleted`);
    const fact = getFactById(id);
    if (!fact) return error('not_found', `fact ${id} not found after update`);
    return { ok: true, status: pinned ? 'pinned' : 'unpinned', fact: serializeMemoryFact(fact) };
  } catch (cause) {
    return error('internal', cause instanceof Error ? cause.message : 'pin update failed');
  }
}

export function executeMemoryInvalidate(
  args: MemoryInvalidateArgs,
  execution: MemoryFactActionExecutionContext,
): MemoryInvalidateResult | MemoryFactActionError {
  if (!args || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'factId')) {
    return error('invalid_args', 'memory_manage action=invalidate accepts only factId.');
  }
  if (!canWriteLongTermMemory()) {
    return error('memory_disabled', 'Long-term memory is disabled.');
  }
  ensureFactSchema();
  const id = exactFactId(args.factId);
  if (!id) return error('invalid_args', 'factId is required and must be at most 64 characters.');
  try {
    const authorized = resolveAuthorizedFactForAction(id, execution);
    if ('ok' in authorized) return authorized;
    const invalidatedAt = Date.now();
    if (!invalidateFact(id, invalidatedAt)) {
      return error('not_found', `fact ${id} not found or already invalidated`);
    }
    return { ok: true, action: 'invalidation', factId: id, invalidatedAt, status: 'invalidated' };
  } catch {
    return error('internal', 'Memory invalidation failed.');
  }
}
