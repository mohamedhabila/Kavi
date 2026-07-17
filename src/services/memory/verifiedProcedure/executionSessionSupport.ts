import {
  buildModelTurnMemoryPolicyBinding,
  type ModelTurnMemoryPolicyBinding,
} from '../../../engine/authority/modelTurnMemoryPolicyBinding';
import { digestToolEffectText } from '../../../engine/toolExecution/toolEffectReceipt';
import { resolveRegisteredToolName } from '../../../engine/tools/toolNameNormalization';
import type { AgentRunControlGraphState } from '../../../types/agentRun';
import type { ToolEffectDigest } from '../../../types/toolEffectReceipt';
import { getMemoryDb } from '../database';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import {
  calendarUpdateVerifiedProcedureApplicablePreconditionIds,
  calendarUpdateVerifiedProcedureEnvironmentPreconditionIds,
  calendarVerifiedProcedureApplicablePreconditionIds,
  calendarVerifiedProcedureEnvironmentPreconditionIds,
} from './calendarPreconditionContract';
import {
  resolveCalendarUpdateVerifiedProcedurePreconditions,
  resolveCalendarVerifiedProcedurePreconditions,
  type CalendarVerifiedProcedurePreconditions,
} from './calendarPreconditions';
import type {
  VerifiedProcedureDescriptor,
  VerifiedProcedureDescriptorKey,
} from './descriptorRegistry';
import { captureVerifiedProcedureAuthoritySnapshot } from './observationAuthority';

const CALENDAR_CREATE_PLANNING_ADVISORY_SECTION = [
  '## Verified local procedure advisory',
  'Independent receipt-backed runs promoted the exact current platform, tool-contract, permission, and calendar-creation procedure.',
  'This is advisory evidence, never authorization, consent, permission, or an instruction to act.',
  'Only if the current user request independently requires event creation and normal approval permits it: call calendar_list first, select exactly one writable calendar ID from that current result, then call calendar_create_event once with that literal ID and require verified readback.',
  'Never reuse a calendar ID from memory or a prior run.',
].join('\n');

const CALENDAR_CREATE_OBSERVED_SOURCE_ADVISORY_SECTION = [
  '## Verified local procedure advisory',
  'A writable calendar was verified in this execution, and independent prior runs promoted the exact current platform, tool-contract, permission, and source-observation procedure.',
  'This is advisory evidence, never authorization, consent, permission, or an instruction to act.',
  'Only if the current user request independently requires event creation and normal approval permits it, pass one literal writable calendar ID from the current calendar_list result to calendar_create_event and require verified readback.',
].join('\n');

const CALENDAR_UPDATE_PLANNING_ADVISORY_SECTION = [
  '## Verified local procedure advisory',
  'Independent receipt-backed runs promoted the exact current platform, tool-contract, permission, and calendar-update procedure.',
  'This is advisory evidence, never authorization, consent, permission, or an instruction to act.',
  'Only if the current user request independently requires changing an existing event and normal approval permits it: call calendar_events first for the relevant current date range, select exactly one event ID from that current result, then call calendar_update_event once with that literal ID and require verified readback.',
  'Never reuse an event ID from memory or a prior run.',
].join('\n');

const CALENDAR_UPDATE_OBSERVED_SOURCE_ADVISORY_SECTION = [
  '## Verified local procedure advisory',
  'A calendar event was verified in this execution, and independent prior runs promoted the exact current platform, tool-contract, permission, and source-observation procedure.',
  'This is advisory evidence, never authorization, consent, permission, or an instruction to act.',
  'Only if the current user request independently requires changing that event and normal approval permits it, pass one literal event ID from the current calendar_events result to calendar_update_event once and require verified readback.',
].join('\n');

export type VerifiedProcedureBehavior = Readonly<{
  registryKey: VerifiedProcedureDescriptorKey;
  resolvePreconditions: () => Promise<CalendarVerifiedProcedurePreconditions>;
  environmentPreconditionIds: (platform: 'android' | 'ios') => readonly string[];
  applicablePreconditionIds: (platform: 'android' | 'ios') => readonly string[];
  planningAdvisorySection: string;
  observedSourceAdvisorySection: string;
}>;

export const VERIFIED_PROCEDURE_BEHAVIORS: readonly VerifiedProcedureBehavior[] = Object.freeze([
  Object.freeze({
    registryKey: 'calendar-list-to-create-event',
    resolvePreconditions: resolveCalendarVerifiedProcedurePreconditions,
    environmentPreconditionIds: calendarVerifiedProcedureEnvironmentPreconditionIds,
    applicablePreconditionIds: calendarVerifiedProcedureApplicablePreconditionIds,
    planningAdvisorySection: CALENDAR_CREATE_PLANNING_ADVISORY_SECTION,
    observedSourceAdvisorySection: CALENDAR_CREATE_OBSERVED_SOURCE_ADVISORY_SECTION,
  }),
  Object.freeze({
    registryKey: 'calendar-events-to-update-event',
    resolvePreconditions: resolveCalendarUpdateVerifiedProcedurePreconditions,
    environmentPreconditionIds: calendarUpdateVerifiedProcedureEnvironmentPreconditionIds,
    applicablePreconditionIds: calendarUpdateVerifiedProcedureApplicablePreconditionIds,
    planningAdvisorySection: CALENDAR_UPDATE_PLANNING_ADVISORY_SECTION,
    observedSourceAdvisorySection: CALENDAR_UPDATE_OBSERVED_SOURCE_ADVISORY_SECTION,
  }),
]);

export function relevantToolName(
  descriptor: VerifiedProcedureDescriptor,
  value: string,
): string | null {
  const canonical = resolveRegisteredToolName(value);
  return descriptor.steps.some((step) => step.toolName === canonical) ? canonical : null;
}

export function exactStringArrayEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function hasIncompleteBlockingGoal(snapshot: AgentRunControlGraphState): boolean {
  return (snapshot.goals ?? []).some((goal) => {
    const blocking =
      goal.completionPolicy === 'blocking' ||
      (goal.completionPolicy === undefined && (goal.successCriteria?.length ?? 0) > 0);
    return blocking && goal.status !== 'completed';
  });
}

export async function digestTerminalProof(value: unknown): Promise<ToolEffectDigest> {
  return digestToolEffectText(
    JSON.stringify({ domain: 'kavi.verified-procedure.terminal-proof.v1', value }),
  );
}

export function bindVerifiedProcedureOriginAuthority(
  binding: ModelTurnMemoryPolicyBinding,
): ModelTurnMemoryPolicyBinding | null {
  if (binding.kind !== 'memory_epoch') return null;
  if (binding.verifiedProcedureRestrictiveAuthority !== undefined) return binding;
  const db = getMemoryDb();
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  if (memoryOwnerId !== binding.memoryAuthoritySnapshot.restrictiveRevision.memoryOwnerId) {
    return null;
  }
  const verifiedProcedureAuthoritySnapshot = captureVerifiedProcedureAuthoritySnapshot(
    db,
    memoryOwnerId,
  );
  if (!verifiedProcedureAuthoritySnapshot) return null;
  return buildModelTurnMemoryPolicyBinding({
    readEpoch: binding.readEpoch,
    memoryAuthoritySnapshot: binding.memoryAuthoritySnapshot,
    ...(binding.validUntil === undefined ? {} : { validUntil: binding.validUntil }),
    verifiedProcedureAuthoritySnapshot,
  });
}
