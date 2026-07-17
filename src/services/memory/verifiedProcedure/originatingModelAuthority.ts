import type { DurableModelEffectAuthority } from '../../../engine/authority/modelTurnMemoryPolicyBinding';
import { getMemoryDb } from '../database';
import {
  readDurableMemoryPolicyState,
  readMemoryAuthorityRevisions,
} from '../memoryAuthorityState';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { isMemoryValidityDeadlineCurrent } from '../memoryValidityDeadline';
import { readVerifiedProcedureAuthorityRevisions } from './observationAuthorityState';

/** Exact durable check used before and inside a terminal observation transaction. */
export function areVerifiedProcedureOriginAuthoritiesDurablyCurrent(
  authorities: readonly DurableModelEffectAuthority[],
  observedAt = Date.now(),
): boolean {
  if (!Array.isArray(authorities) || authorities.length === 0) return false;
  try {
    const db = getMemoryDb();
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    const memoryRevisions = readMemoryAuthorityRevisions(db, memoryOwnerId);
    const memoryPolicy = readDurableMemoryPolicyState(db, memoryOwnerId);
    const procedureRevision = readVerifiedProcedureAuthorityRevisions(db, memoryOwnerId).restrictive
      .value;
    return authorities.every(
      (authority) =>
        authority.kind === 'memory_epoch' &&
        authority.memoryOwnerId === memoryOwnerId &&
        authority.restrictiveRevision === memoryRevisions.restrictive.value &&
        authority.memoryPolicyRevision === memoryPolicy.revision &&
        memoryPolicy.enabled &&
        isMemoryValidityDeadlineCurrent(authority.validUntil, observedAt) &&
        (authority.verifiedProcedureRestrictiveRevision === null ||
          authority.verifiedProcedureRestrictiveRevision === procedureRevision),
    );
  } catch {
    return false;
  }
}
