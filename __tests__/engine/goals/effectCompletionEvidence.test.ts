import {
  buildEffectCompletionCriterion,
  buildToolEffectReceiptEvidence,
  parseEffectCompletionCriterion,
  parseToolEffectReceiptEvidence,
} from '../../../src/engine/goals/effectCompletionEvidence';
import { isSuccessCriterionMet } from '../../../src/engine/goals/completionEvidence';
import { routeToolEvidenceToActiveGoals } from '../../../src/engine/goals/evidenceRouting';
import { createGoal } from '../../../src/engine/goals/types';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';

const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}` as const;
const RESULT_DIGEST = `sha256:${'2'.repeat(64)}` as const;
const RESOURCE_DIGEST = `sha256:${'3'.repeat(64)}` as const;
const CONTRACT_DIGEST = `sha256:${'4'.repeat(64)}` as const;

function buildReceipt(patch: Partial<ToolEffectReceipt> = {}): ToolEffectReceipt {
  return {
    version: 2,
    receiptId: `ter_${'a'.repeat(32)}`,
    toolCallId: 'call-1',
    toolName: 'write_file',
    executionRunId: 'execution-run-1',
    contractIdentity: {
      kind: 'code_owned',
      version: 1,
      toolName: 'write_file',
      schemaDigest: CONTRACT_DIGEST,
      capabilityContractDigest: CONTRACT_DIGEST,
      workflowContractDigest: CONTRACT_DIGEST,
      effectContractDigest: CONTRACT_DIGEST,
      executionPolicyDigest: CONTRACT_DIGEST,
    },
    transportState: 'returned',
    effectKind: 'artifact.write',
    effectState: 'applied',
    verificationState: 'verified',
    requestDigest: REQUEST_DIGEST,
    resultDigest: RESULT_DIGEST,
    resource: {
      kind: 'workspace_file',
      id: 'artifacts/out.txt',
      digest: RESOURCE_DIGEST,
    },
    recordedAt: 1,
    ...patch,
  };
}

const criterion = buildEffectCompletionCriterion({
  effectKind: 'artifact.write',
  requestDigest: REQUEST_DIGEST,
  resource: {
    kind: 'workspace_file',
    id: 'artifacts/out.txt',
    digest: RESOURCE_DIGEST,
  },
  verificationState: 'verified',
});

function goalWithReceipt(receipt: ToolEffectReceipt) {
  return createGoal({
    id: 'write-artifact',
    title: 'Write artifact',
    status: 'active',
    successCriteria: [criterion],
    evidence: [buildToolEffectReceiptEvidence(receipt)],
  });
}

describe('effect completion evidence', () => {
  it('round-trips exact execution and optional dispatch identity', () => {
    const evidence = buildToolEffectReceiptEvidence(
      buildReceipt({ dispatchRunId: 'effect-run-1' }),
    );

    expect(parseToolEffectReceiptEvidence(evidence)).toEqual(
      expect.objectContaining({
        receiptVersion: 2,
        executionRunId: 'execution-run-1',
        dispatchRunId: 'effect-run-1',
      }),
    );
  });

  it('rejects the retired pre-v2 flattened receipt evidence format', () => {
    const receipt = buildReceipt();
    const legacyEvidence = `effect_receipt:${JSON.stringify({
      receiptId: receipt.receiptId,
      toolName: receipt.toolName,
      transportState: receipt.transportState,
      effectKind: receipt.effectKind,
      effectState: receipt.effectState,
      verificationState: receipt.verificationState,
      requestDigest: receipt.requestDigest,
      resultDigest: receipt.resultDigest,
      resource: receipt.resource,
    })}`;

    expect(parseToolEffectReceiptEvidence(legacyEvidence)).toBeNull();
    expect(
      isSuccessCriterionMet(
        createGoal({
          id: 'legacy-evidence',
          title: 'Legacy evidence',
          status: 'active',
          successCriteria: [criterion],
          evidence: [legacyEvidence],
        }),
        criterion,
      ),
    ).toBe(false);
  });

  it('accepts only the closed resource-specific criterion schema', () => {
    expect(parseEffectCompletionCriterion(criterion)).toEqual({
      effectKind: 'artifact.write',
      requestDigest: REQUEST_DIGEST,
      resource: {
        kind: 'workspace_file',
        id: 'artifacts/out.txt',
        digest: RESOURCE_DIGEST,
      },
      verificationState: 'verified',
    });
    expect(
      parseEffectCompletionCriterion(`${criterion.slice(0, -1)},"unexpected":true}`),
    ).toBeNull();
  });

  it('requires the exact verified resource and digest', () => {
    expect(isSuccessCriterionMet(goalWithReceipt(buildReceipt()), criterion)).toBe(true);
    expect(
      isSuccessCriterionMet(
        goalWithReceipt(
          buildReceipt({
            resource: {
              kind: 'workspace_file',
              id: 'artifacts/other.txt',
              digest: RESOURCE_DIGEST,
            },
          }),
        ),
        criterion,
      ),
    ).toBe(false);
    expect(
      isSuccessCriterionMet(
        goalWithReceipt(
          buildReceipt({
            resource: {
              kind: 'workspace_file',
              id: 'artifacts/out.txt',
              digest: `sha256:${'4'.repeat(64)}`,
            },
          }),
        ),
        criterion,
      ),
    ).toBe(false);
  });

  it.each([
    {
      label: 'acknowledged',
      patch: { verificationState: 'acknowledged' as const },
    },
    {
      label: 'failed',
      patch: {
        transportState: 'threw' as const,
        effectState: 'failed' as const,
        verificationState: 'unverified' as const,
        resource: undefined,
      },
    },
    {
      label: 'cancelled',
      patch: {
        transportState: 'rejected' as const,
        effectState: 'cancelled' as const,
        verificationState: 'unverified' as const,
        resource: undefined,
      },
    },
  ])('does not satisfy completion with a $label receipt', ({ patch }) => {
    expect(isSuccessCriterionMet(goalWithReceipt(buildReceipt(patch)), criterion)).toBe(false);
  });

  it('routes non-success receipt state to its request-bound goal without satisfying it', () => {
    const receiptEvidence = buildToolEffectReceiptEvidence(
      buildReceipt({ verificationState: 'acknowledged' }),
    );
    const goal = createGoal({
      id: 'write-artifact',
      title: 'Write artifact',
      status: 'active',
      successCriteria: [criterion],
    });

    expect(
      routeToolEvidenceToActiveGoals({
        toolName: 'write_file',
        toolDefinitions: [],
        goals: [goal],
        evidenceStrings: [receiptEvidence],
      }),
    ).toEqual([{ goalId: goal.id, evidence: receiptEvidence }]);
    expect(isSuccessCriterionMet({ ...goal, evidence: [receiptEvidence] }, criterion)).toBe(false);
  });
});
