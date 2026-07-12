import type { ToolEffectDigest } from '../../../types/toolEffectReceipt';
import { isExactDurableScopeId } from '../../../utils/durableScopeIdentity';
import { calendarVerifiedProcedureApplicablePreconditionIds } from './calendarPreconditionContract';
import { listCurrentVerifiedProcedureDescriptors } from './descriptorRegistry';

const SCOPE_KEYS = [
  'contractVersion',
  'platform',
  'preconditionIds',
  'procedureContractDigest',
  'procedureId',
] as const;
const CODE_OWNED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_PRECONDITION_COUNT = 16;

export type VerifiedProcedureObservationScope = Readonly<{
  contractVersion: 1;
  procedureId: string;
  procedureContractDigest: ToolEffectDigest;
  platform: 'android' | 'ios';
  preconditionIds: readonly string[];
}>;

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCodeOwnedId(value: unknown): value is string {
  return (
    typeof value === 'string' && isExactDurableScopeId(value) && CODE_OWNED_ID_PATTERN.test(value)
  );
}

export function validVerifiedProcedurePreconditions(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_PRECONDITION_COUNT &&
    value.every(isCodeOwnedId) &&
    value.every((item, index) => index === 0 || value[index - 1]! < item)
  );
}

export function isValidVerifiedProcedureObservationScope(
  value: unknown,
): value is VerifiedProcedureObservationScope {
  if (!isPlainRecord(value) || !hasExactKeys(value, SCOPE_KEYS)) return false;
  return (
    value.contractVersion === 1 &&
    isCodeOwnedId(value.procedureId) &&
    typeof value.procedureContractDigest === 'string' &&
    SHA256_PATTERN.test(value.procedureContractDigest) &&
    (value.platform === 'android' || value.platform === 'ios') &&
    validVerifiedProcedurePreconditions(value.preconditionIds)
  );
}

export async function matchesCurrentVerifiedProcedureScope(
  scope: VerifiedProcedureObservationScope,
): Promise<boolean> {
  const descriptors = await listCurrentVerifiedProcedureDescriptors();
  const descriptor = descriptors.find(
    (candidate) =>
      candidate.procedureId === scope.procedureId &&
      candidate.contractDigest === scope.procedureContractDigest,
  );
  if (!descriptor || descriptor.registryKey !== 'calendar-list-to-create-event') return false;
  const expected = calendarVerifiedProcedureApplicablePreconditionIds(scope.platform);
  return (
    scope.preconditionIds.length === expected.length &&
    scope.preconditionIds.every((value, index) => value === expected[index])
  );
}
