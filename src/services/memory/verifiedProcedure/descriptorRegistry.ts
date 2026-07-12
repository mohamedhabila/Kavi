import { digestToolEffectText } from '../../../engine/toolExecution/toolEffectReceipt';
import {
  buildCodeOwnedToolContractIdentity,
  codeOwnedToolContractIdentitiesEqual,
} from '../../../engine/toolExecution/toolContractIdentity';
import type {
  CodeOwnedToolContractIdentity,
  ToolEffectDigest,
} from '../../../types/toolEffectReceipt';
import { VERIFIED_PROCEDURE_POLICY_CONTRACT } from './policyContract';

export const VERIFIED_PROCEDURE_DESCRIPTOR_VERSION = 1 as const;
export const VERIFIED_PROCEDURE_LINKAGE_VERSION = 1 as const;
export const VERIFIED_PROCEDURE_VERIFIER_VERSION = 1 as const;

export type VerifiedProcedureDescriptorKey = 'calendar-list-to-create-event';
export type VerifiedProcedureStepKey = 'calendar-list' | 'calendar-create-event';

export type VerifiedProcedureStepDescriptor = Readonly<{
  stepKey: VerifiedProcedureStepKey;
  toolName: string;
  contractIdentity: CodeOwnedToolContractIdentity;
}>;

export type VerifiedProcedureDescriptor = Readonly<{
  registryKey: VerifiedProcedureDescriptorKey;
  descriptorVersion: typeof VERIFIED_PROCEDURE_DESCRIPTOR_VERSION;
  linkageVersion: typeof VERIFIED_PROCEDURE_LINKAGE_VERSION;
  verifierVersion: typeof VERIFIED_PROCEDURE_VERIFIER_VERSION;
  procedureId: string;
  contractDigest: ToolEffectDigest;
  preconditionResolverId: 'calendar-mobile-permission-and-tool-policy.v1';
  sourceObservationPreconditionId: 'calendar.list.returned-writable-id.v1';
  learningPolicy: typeof VERIFIED_PROCEDURE_POLICY_CONTRACT;
  steps: readonly [VerifiedProcedureStepDescriptor, VerifiedProcedureStepDescriptor];
  linkage: Readonly<{
    sourceStepKey: 'calendar-list';
    sourceResultSelector: 'literal-writable-calendar-id';
    targetStepKey: 'calendar-create-event';
    targetArgumentKey: 'calendarId';
    cardinality: 'exactly-one-explicit-link';
  }>;
  verifier: Readonly<{
    stepKey: 'calendar-create-event';
    resultStatus: 'created_verified';
    receiptEffectKind: 'calendar.create';
    receiptEffectState: 'applied';
    receiptVerificationState: 'verified';
  }>;
}>;

type VerifiedProcedureIdentityMaterial = Readonly<{
  registryKey: VerifiedProcedureDescriptorKey;
  descriptorVersion: number;
  linkageVersion: number;
  verifierVersion: number;
  preconditionResolverId: string;
  sourceObservationPreconditionId: string;
  learningPolicy: typeof VERIFIED_PROCEDURE_POLICY_CONTRACT;
  orderedContractIdentities: readonly CodeOwnedToolContractIdentity[];
  linkage: VerifiedProcedureDescriptor['linkage'];
  verifier: VerifiedProcedureDescriptor['verifier'];
}>;

const CALENDAR_LINKAGE = Object.freeze({
  sourceStepKey: 'calendar-list' as const,
  sourceResultSelector: 'literal-writable-calendar-id' as const,
  targetStepKey: 'calendar-create-event' as const,
  targetArgumentKey: 'calendarId' as const,
  cardinality: 'exactly-one-explicit-link' as const,
});

const CALENDAR_VERIFIER = Object.freeze({
  stepKey: 'calendar-create-event' as const,
  resultStatus: 'created_verified' as const,
  receiptEffectKind: 'calendar.create' as const,
  receiptEffectState: 'applied' as const,
  receiptVerificationState: 'verified' as const,
});

const PROCEDURE_ID_PREFIX = 'verified-procedure.calendar-list-to-create-event.v1.';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * Produces the immutable procedure identity from ordered, current code-owned
 * contracts and all code-owned linkage/verifier versions. This helper cannot
 * register a procedure; the registry below remains closed.
 */
export async function digestVerifiedProcedureIdentity(
  material: VerifiedProcedureIdentityMaterial,
): Promise<ToolEffectDigest> {
  const canonical = JSON.stringify(
    canonicalize({
      domain: 'kavi.verified-procedure.identity.v1',
      ...material,
    }),
  );
  return digestToolEffectText(canonical);
}

async function buildCalendarDescriptor(): Promise<VerifiedProcedureDescriptor> {
  const [listIdentity, createIdentity] = await Promise.all([
    buildCodeOwnedToolContractIdentity('calendar_list'),
    buildCodeOwnedToolContractIdentity('calendar_create_event'),
  ]);
  if (
    !listIdentity ||
    !createIdentity ||
    listIdentity.toolName !== 'calendar_list' ||
    createIdentity.toolName !== 'calendar_create_event'
  ) {
    throw new Error('verified_procedure_calendar_contract_unavailable');
  }

  const preconditionResolverId = 'calendar-mobile-permission-and-tool-policy.v1' as const;
  const sourceObservationPreconditionId = 'calendar.list.returned-writable-id.v1' as const;
  const contractDigest = await digestVerifiedProcedureIdentity({
    registryKey: 'calendar-list-to-create-event',
    descriptorVersion: VERIFIED_PROCEDURE_DESCRIPTOR_VERSION,
    linkageVersion: VERIFIED_PROCEDURE_LINKAGE_VERSION,
    verifierVersion: VERIFIED_PROCEDURE_VERIFIER_VERSION,
    preconditionResolverId,
    sourceObservationPreconditionId,
    learningPolicy: VERIFIED_PROCEDURE_POLICY_CONTRACT,
    orderedContractIdentities: [listIdentity, createIdentity],
    linkage: CALENDAR_LINKAGE,
    verifier: CALENDAR_VERIFIER,
  });
  const procedureId = `${PROCEDURE_ID_PREFIX}${contractDigest.slice('sha256:'.length)}`;

  return Object.freeze({
    registryKey: 'calendar-list-to-create-event',
    descriptorVersion: VERIFIED_PROCEDURE_DESCRIPTOR_VERSION,
    linkageVersion: VERIFIED_PROCEDURE_LINKAGE_VERSION,
    verifierVersion: VERIFIED_PROCEDURE_VERIFIER_VERSION,
    procedureId,
    contractDigest,
    preconditionResolverId,
    sourceObservationPreconditionId,
    learningPolicy: VERIFIED_PROCEDURE_POLICY_CONTRACT,
    steps: Object.freeze([
      Object.freeze({
        stepKey: 'calendar-list' as const,
        toolName: 'calendar_list',
        contractIdentity: listIdentity,
      }),
      Object.freeze({
        stepKey: 'calendar-create-event' as const,
        toolName: 'calendar_create_event',
        contractIdentity: createIdentity,
      }),
    ]) as unknown as VerifiedProcedureDescriptor['steps'],
    linkage: CALENDAR_LINKAGE,
    verifier: CALENDAR_VERIFIER,
  });
}

/** Resolves only descriptors owned by this source registry. */
export async function getCurrentVerifiedProcedureDescriptor(
  registryKey: VerifiedProcedureDescriptorKey,
): Promise<VerifiedProcedureDescriptor> {
  switch (registryKey) {
    case 'calendar-list-to-create-event':
      return buildCalendarDescriptor();
    default:
      throw new Error('verified_procedure_registry_key_unknown');
  }
}

export async function listCurrentVerifiedProcedureDescriptors(): Promise<
  readonly VerifiedProcedureDescriptor[]
> {
  return Object.freeze([
    await getCurrentVerifiedProcedureDescriptor('calendar-list-to-create-event'),
  ]);
}

export function verifiedProcedureDescriptorMatches(
  left: VerifiedProcedureDescriptor,
  right: VerifiedProcedureDescriptor,
): boolean {
  return (
    left.registryKey === right.registryKey &&
    left.descriptorVersion === right.descriptorVersion &&
    left.linkageVersion === right.linkageVersion &&
    left.verifierVersion === right.verifierVersion &&
    left.procedureId === right.procedureId &&
    left.contractDigest === right.contractDigest &&
    left.preconditionResolverId === right.preconditionResolverId &&
    left.sourceObservationPreconditionId === right.sourceObservationPreconditionId &&
    left.learningPolicy.version === right.learningPolicy.version &&
    left.learningPolicy.applicabilityScope === right.learningPolicy.applicabilityScope &&
    left.learningPolicy.provenanceScope === right.learningPolicy.provenanceScope &&
    left.learningPolicy.retentionMs === right.learningPolicy.retentionMs &&
    left.learningPolicy.maximumObservationsPerScope ===
      right.learningPolicy.maximumObservationsPerScope &&
    left.learningPolicy.maximumObservationsPerOwner ===
      right.learningPolicy.maximumObservationsPerOwner &&
    left.learningPolicy.promotion.requiredDistinctVerifiedRuns ===
      right.learningPolicy.promotion.requiredDistinctVerifiedRuns &&
    left.learningPolicy.promotion.duplicateRunEvidence ===
      right.learningPolicy.promotion.duplicateRunEvidence &&
    left.learningPolicy.invalidation.authority === right.learningPolicy.invalidation.authority &&
    left.learningPolicy.invalidation.effect === right.learningPolicy.invalidation.effect &&
    left.learningPolicy.evidenceManifestVersion === right.learningPolicy.evidenceManifestVersion &&
    left.learningPolicy.maximumEvidenceManifestLength ===
      right.learningPolicy.maximumEvidenceManifestLength &&
    left.linkage.sourceStepKey === right.linkage.sourceStepKey &&
    left.linkage.sourceResultSelector === right.linkage.sourceResultSelector &&
    left.linkage.targetStepKey === right.linkage.targetStepKey &&
    left.linkage.targetArgumentKey === right.linkage.targetArgumentKey &&
    left.linkage.cardinality === right.linkage.cardinality &&
    left.verifier.stepKey === right.verifier.stepKey &&
    left.verifier.resultStatus === right.verifier.resultStatus &&
    left.verifier.receiptEffectKind === right.verifier.receiptEffectKind &&
    left.verifier.receiptEffectState === right.verifier.receiptEffectState &&
    left.verifier.receiptVerificationState === right.verifier.receiptVerificationState &&
    left.steps.length === right.steps.length &&
    left.steps.every(
      (step, index) =>
        step.stepKey === right.steps[index]?.stepKey &&
        step.toolName === right.steps[index]?.toolName &&
        codeOwnedToolContractIdentitiesEqual(
          step.contractIdentity,
          right.steps[index]!.contractIdentity,
        ),
    )
  );
}
