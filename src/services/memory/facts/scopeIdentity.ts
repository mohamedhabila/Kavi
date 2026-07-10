import { isExactMemoryScopeId } from '../memoryScopeIdentity';
import type { MemoryFactScope, RecordFactInput } from './types';

function hasIdentityValue(value: string | null | undefined): boolean {
  return value !== null && value !== undefined;
}

export function requireFactScopeIdentity(
  input: Pick<RecordFactInput, 'originConversationId' | 'originThreadId' | 'originTaskId'>,
  scope: MemoryFactScope,
): void {
  const hasConversation = hasIdentityValue(input.originConversationId);
  const hasThread = hasIdentityValue(input.originThreadId);
  const hasTask = hasIdentityValue(input.originTaskId);
  if (scope === 'global' || scope === 'persona') {
    if (hasConversation || hasThread || hasTask) {
      throw new Error('memory_fact_scope_identity_forbidden');
    }
    return;
  }
  if (!isExactMemoryScopeId(input.originConversationId)) {
    throw new Error('memory_fact_origin_conversation_id_required');
  }
  if (scope === 'conversation' || scope === 'project') {
    if (hasTask) throw new Error('memory_fact_origin_task_id_forbidden');
    if (hasThread && !isExactMemoryScopeId(input.originThreadId)) {
      throw new Error('memory_fact_origin_thread_id_invalid');
    }
    return;
  }
  if (!isExactMemoryScopeId(input.originThreadId)) {
    throw new Error('memory_fact_origin_thread_id_required');
  }
  if (!isExactMemoryScopeId(input.originTaskId)) {
    throw new Error('memory_fact_origin_task_id_required');
  }
}
