import { SUPER_AGENT_PERSONA_ID } from '../agents/personas';

const MEMORY_SCOPE_ID_PATTERN = /^[^\p{Z}\p{C}]{1,160}$/u;

export const DEFAULT_MEMORY_PERSONA_ID = 'default';

export interface MemoryAccessScopeIdentity {
  /** Durable owner of the local memory vault. */
  memoryOwnerId: string;
  /** Root/workspace conversation. This is the cross-thread session boundary. */
  memoryConversationId: string;
  /** Actual chat or side-thread that produced or consumes the memory. */
  sourceThreadId: string;
  /** Code-owned active persona identity. */
  personaId: string;
  /** Active graph task. Task-owned memory never crosses threads. */
  taskId: string | null;
}

export interface RequiredMemoryAccessScopeIdentity {
  memoryOwnerId: string;
  memoryConversationId: string;
  sourceThreadId: string;
  personaId: string;
  taskId: string | null;
}

export function isExactMemoryScopeId(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && MEMORY_SCOPE_ID_PATTERN.test(value);
}

export function requireExactMemoryScopeId(value: unknown, code: string): string {
  if (!isExactMemoryScopeId(value)) throw new Error(code);
  return value;
}

export function resolveCodeOwnedMemoryConversationId(
  value: string | null | undefined,
  fallback: string,
): string {
  const exactFallback = requireExactMemoryScopeId(fallback, 'memory_scope_conversation_id_invalid');
  return value === null || value === undefined
    ? exactFallback
    : requireExactMemoryScopeId(value, 'memory_scope_conversation_id_invalid');
}

export function resolveCodeOwnedMemoryTaskId(value: string | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : requireExactMemoryScopeId(value, 'memory_scope_task_id_invalid');
}

export function resolveCodeOwnedMemoryPersonaId(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return DEFAULT_MEMORY_PERSONA_ID;
  }
  if (!isExactMemoryScopeId(value)) throw new Error('memory_scope_persona_id_invalid');
  // Chitchat and agentic are execution modes of the same primary assistant,
  // not separate people. Keep their persona-scoped memory in one continuity
  // domain while preserving isolation for genuinely distinct custom personas.
  return value === SUPER_AGENT_PERSONA_ID ? DEFAULT_MEMORY_PERSONA_ID : value;
}

function requireScopeId(value: unknown, field: string): string {
  return requireExactMemoryScopeId(value, `memory_scope_${field}_invalid`);
}

export function requireMemoryAccessScopeIdentity(
  input: MemoryAccessScopeIdentity,
): RequiredMemoryAccessScopeIdentity {
  if (!input || typeof input !== 'object') {
    throw new Error('memory_scope_context_invalid');
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'taskId')) {
    throw new Error('memory_scope_task_id_invalid');
  }
  const taskId = input.taskId;
  if (taskId !== null && !isExactMemoryScopeId(taskId)) {
    throw new Error('memory_scope_task_id_invalid');
  }
  return {
    memoryOwnerId: requireScopeId(input.memoryOwnerId, 'owner_id'),
    memoryConversationId: requireScopeId(input.memoryConversationId, 'conversation_id'),
    sourceThreadId: requireScopeId(input.sourceThreadId, 'thread_id'),
    personaId: requireScopeId(input.personaId, 'persona_id'),
    taskId,
  };
}
