import { getSchemaReadyMemoryDb } from './access/schemaGuard';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import {
  requireMemoryAccessScopeIdentity,
  type RequiredMemoryAccessScopeIdentity,
} from './memoryScopeIdentity';

/** Build the exact local-vault scope only after memory access has been authorized. */
export function resolveLocalMemoryAccessScope(input: {
  memoryConversationId: string;
  sourceThreadId: string;
  personaId: string;
  taskId: string | null;
}): RequiredMemoryAccessScopeIdentity {
  const db = getSchemaReadyMemoryDb();
  return requireMemoryAccessScopeIdentity({
    memoryOwnerId: getLocalMemoryVaultOwnerId(db),
    memoryConversationId: input.memoryConversationId,
    sourceThreadId: input.sourceThreadId,
    personaId: input.personaId,
    taskId: input.taskId,
  });
}
