import {
  buildCodeOwnedToolContractIdentity,
  matchesCurrentCodeOwnedToolContractIdentity,
} from '../../../src/engine/toolExecution/toolContractIdentity';
import {
  digestVerifiedProcedureIdentity,
  getCurrentVerifiedProcedureDescriptor,
  listCurrentVerifiedProcedureDescriptors,
  verifiedProcedureDescriptorMatches,
} from '../../../src/services/memory/verifiedProcedure/descriptorRegistry';

describe('verified procedure descriptor registry', () => {
  it('exposes one frozen code-owned calendar procedure with current ordered identities', async () => {
    const descriptor = await getCurrentVerifiedProcedureDescriptor('calendar-list-to-create-event');

    expect(descriptor.procedureId).toMatch(
      /^verified-procedure\.calendar-list-to-create-event\.v1\.[a-f0-9]{64}$/u,
    );
    expect(descriptor.procedureId.length).toBeLessThanOrEqual(160);
    expect(descriptor.contractDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(descriptor.sourceObservationPreconditionId).toBe(
      'calendar.list.returned-writable-id.v1',
    );
    expect(descriptor.learningPolicy).toMatchObject({
      applicabilityScope: 'memory-owner-procedure-contract-platform-exact-preconditions',
      provenanceScope: 'memory-conversation-thread-execution-run-source-message-turn-run',
      promotion: { requiredDistinctVerifiedRuns: 3 },
      invalidation: {
        authority: 'explicit-code-owned-reconciliation-or-withdrawal-only',
        effect: 'withdraw-derived-observations',
      },
      evidenceManifestVersion: 1,
      maximumEvidenceManifestLength: 4096,
    });
    expect(descriptor.steps.map((step) => [step.stepKey, step.toolName])).toEqual([
      ['calendar-list', 'calendar_list'],
      ['calendar-create-event', 'calendar_create_event'],
    ]);
    await expect(
      matchesCurrentCodeOwnedToolContractIdentity(descriptor.steps[0].contractIdentity),
    ).resolves.toBe(true);
    await expect(
      matchesCurrentCodeOwnedToolContractIdentity(descriptor.steps[1].contractIdentity),
    ).resolves.toBe(true);
    expect(descriptor.linkage).toEqual({
      sourceStepKey: 'calendar-list',
      sourceResultSelector: 'literal-writable-calendar-id',
      targetStepKey: 'calendar-create-event',
      targetArgumentKey: 'calendarId',
      cardinality: 'exactly-one-explicit-link',
    });
    expect(descriptor.verifier).toEqual({
      stepKey: 'calendar-create-event',
      resultStatus: 'created_verified',
      receiptEffectKind: 'calendar.create',
      receiptEffectState: 'applied',
      receiptVerificationState: 'verified',
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.steps)).toBe(true);
  });

  it('is deterministic and has no runtime registration surface', async () => {
    const first = await getCurrentVerifiedProcedureDescriptor('calendar-list-to-create-event');
    const second = await getCurrentVerifiedProcedureDescriptor('calendar-list-to-create-event');
    const listed = await listCurrentVerifiedProcedureDescriptors();

    expect(verifiedProcedureDescriptorMatches(first, second)).toBe(true);
    expect(listed).toHaveLength(1);
    expect(verifiedProcedureDescriptorMatches(listed[0], first)).toBe(true);
    expect(Object.isFrozen(listed)).toBe(true);
    await expect(
      getCurrentVerifiedProcedureDescriptor('invented-procedure' as never),
    ).rejects.toThrow('verified_procedure_registry_key_unknown');
  });

  it('fences descriptor, linkage, verifier, and ordered tool-contract drift', async () => {
    const descriptor = await getCurrentVerifiedProcedureDescriptor('calendar-list-to-create-event');
    const base = {
      registryKey: descriptor.registryKey,
      descriptorVersion: descriptor.descriptorVersion,
      linkageVersion: descriptor.linkageVersion,
      verifierVersion: descriptor.verifierVersion,
      preconditionResolverId: descriptor.preconditionResolverId,
      sourceObservationPreconditionId: descriptor.sourceObservationPreconditionId,
      learningPolicy: descriptor.learningPolicy,
      orderedContractIdentities: descriptor.steps.map((step) => step.contractIdentity),
      linkage: descriptor.linkage,
      verifier: descriptor.verifier,
    };

    await expect(digestVerifiedProcedureIdentity(base)).resolves.toBe(descriptor.contractDigest);
    await expect(
      digestVerifiedProcedureIdentity({ ...base, descriptorVersion: 2 }),
    ).resolves.not.toBe(descriptor.contractDigest);
    await expect(digestVerifiedProcedureIdentity({ ...base, linkageVersion: 2 })).resolves.not.toBe(
      descriptor.contractDigest,
    );
    await expect(
      digestVerifiedProcedureIdentity({ ...base, verifierVersion: 2 }),
    ).resolves.not.toBe(descriptor.contractDigest);
    await expect(
      digestVerifiedProcedureIdentity({
        ...base,
        sourceObservationPreconditionId: 'invented-source-observation',
      }),
    ).resolves.not.toBe(descriptor.contractDigest);
    await expect(
      digestVerifiedProcedureIdentity({
        ...base,
        learningPolicy: {
          ...descriptor.learningPolicy,
          maximumObservationsPerScope: 65,
        } as never,
      }),
    ).resolves.not.toBe(descriptor.contractDigest);
    await expect(
      digestVerifiedProcedureIdentity({
        ...base,
        orderedContractIdentities: [...base.orderedContractIdentities].reverse(),
      }),
    ).resolves.not.toBe(descriptor.contractDigest);

    const currentList = await buildCodeOwnedToolContractIdentity('calendar_list');
    expect(currentList).toEqual(descriptor.steps[0].contractIdentity);
    expect(
      verifiedProcedureDescriptorMatches(descriptor, {
        ...descriptor,
        linkage: { ...descriptor.linkage, targetArgumentKey: 'invented' as never },
      }),
    ).toBe(false);
    expect(
      verifiedProcedureDescriptorMatches(descriptor, {
        ...descriptor,
        learningPolicy: {
          ...descriptor.learningPolicy,
          maximumObservationsPerScope: 65,
        } as never,
      }),
    ).toBe(false);
  });
});
