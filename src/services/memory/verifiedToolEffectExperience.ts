import { Platform } from 'react-native';
import { digestToolEffectText } from '../../engine/toolExecution/toolEffectReceipt';
import {
  getCodeOwnedToolEffectContract,
  type CodeOwnedToolEffectContract,
} from '../../engine/toolExecution/toolEffectReceiptContracts';
import type {
  ToolEffectReceipt,
  ToolEffectResultOutcome,
} from '../../types/toolEffectReceipt';
import { decodeToolEffectReceipt } from '../../utils/toolEffectReceipt';
import {
  recordProductExperienceObservation,
  type RecordProductExperienceObservationResult,
} from './productExperienceObservationStore';

const PROCEDURE_CONTRACT_VERSION = 1;

export type VerifiedToolEffectExperienceSkipReason =
  | 'invalid_identity'
  | 'invalid_receipt'
  | 'unsupported_platform'
  | 'unsupported_contract'
  | 'non_terminal_outcome';

export type RecordVerifiedToolEffectExperienceResult =
  | RecordProductExperienceObservationResult
  | { status: 'skipped'; reason: VerifiedToolEffectExperienceSkipReason }
  | { status: 'failed'; code: 'procedure_identity_error' | 'storage_error' };

export type VerifiedToolEffectExperienceInput = Readonly<{
  memoryConversationId: string;
  sourceThreadId: string;
  sourceRunId?: string;
  toolCallId: string;
  toolName: string;
  receipt: ToolEffectReceipt;
}>;

type RecordableOutcome = Readonly<{
  outcome: 'success' | 'failure';
  authority: 'tool_observed' | 'verified';
}>;

function canonicalizeContractValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeContractValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalizeContractValue((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

function declaredOutcomeMatches(params: {
  contract: CodeOwnedToolEffectContract;
  declared: ToolEffectResultOutcome;
  receipt: ToolEffectReceipt;
}): boolean {
  return (
    (params.declared.effectKind ?? params.contract.effectKind) === params.receipt.effectKind &&
    params.declared.effectState === params.receipt.effectState &&
    params.declared.verificationState === params.receipt.verificationState &&
    params.declared.executionState === params.receipt.executionState
  );
}

function resolveRecordableOutcome(
  contract: CodeOwnedToolEffectContract,
  receipt: ToolEffectReceipt,
): RecordableOutcome | null {
  if (
    contract.effectMode !== 'effectful' ||
    contract.completionMode === 'operational' ||
    !contract.result ||
    receipt.transportState !== 'returned' ||
    !Object.values(contract.result.outcomes).some((declared) =>
      declaredOutcomeMatches({ contract, declared, receipt }),
    )
  ) {
    return null;
  }

  if (receipt.effectState === 'applied' && receipt.verificationState === 'verified') {
    return { outcome: 'success', authority: 'verified' };
  }
  if (receipt.effectState === 'failed' && receipt.verificationState === 'unverified') {
    return { outcome: 'failure', authority: 'tool_observed' };
  }
  return null;
}

function resolveMobilePlatform(): 'android' | 'ios' | null {
  return Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null;
}

async function buildProcedureId(
  toolName: string,
  contract: CodeOwnedToolEffectContract,
): Promise<string> {
  const canonicalContract = JSON.stringify(
    canonicalizeContractValue({
      contractVersion: PROCEDURE_CONTRACT_VERSION,
      toolName,
      contract,
    }),
  );
  const digest = await digestToolEffectText(canonicalContract);
  return `registered-tool.${toolName}.effect-contract.v${PROCEDURE_CONTRACT_VERSION}.${digest.slice(
    'sha256:'.length,
    'sha256:'.length + 24,
  )}`;
}

/**
 * Records only code-owned, directly observed terminal effect outcomes. The
 * input deliberately excludes arguments, result content, transcript text, and
 * model-authored labels. Storage is collection-only and has no planner or
 * prompt consumer.
 */
export async function recordVerifiedToolEffectExperience(
  input: VerifiedToolEffectExperienceInput,
): Promise<RecordVerifiedToolEffectExperienceResult> {
  const receipt = decodeToolEffectReceipt(input.receipt);
  if (!receipt) {
    return { status: 'skipped', reason: 'invalid_receipt' };
  }
  if (
    !input.sourceRunId ||
    receipt.runId !== input.sourceRunId ||
    receipt.toolCallId !== input.toolCallId ||
    receipt.toolName !== input.toolName
  ) {
    return { status: 'skipped', reason: 'invalid_identity' };
  }

  const platform = resolveMobilePlatform();
  if (!platform) {
    return { status: 'skipped', reason: 'unsupported_platform' };
  }

  const contract = getCodeOwnedToolEffectContract(input.toolName);
  if (!contract) {
    return { status: 'skipped', reason: 'unsupported_contract' };
  }
  const recordable = resolveRecordableOutcome(contract, receipt);
  if (!recordable) {
    return { status: 'skipped', reason: 'non_terminal_outcome' };
  }

  const observedAt = receipt.recordedAt;
  const recordedAt = Date.now();
  if (observedAt > recordedAt) {
    return { status: 'skipped', reason: 'invalid_receipt' };
  }

  let procedureId: string;
  try {
    procedureId = await buildProcedureId(input.toolName, contract);
  } catch {
    return { status: 'failed', code: 'procedure_identity_error' };
  }

  try {
    return await recordProductExperienceObservation(
      {
        contractVersion: 1,
        memoryConversationId: input.memoryConversationId,
        sourceThreadId: input.sourceThreadId,
        sourceRunId: input.sourceRunId,
        domainId: `mobile-assistant.effect.${receipt.effectKind}`,
        environmentId: `kavi.react-native.${platform}.registered-tool.${input.toolName}.v1`,
        procedureId,
        // This runtime boundary does not yet expose exact permission/configuration
        // preconditions. Empty therefore means "not observed", not "universally
        // applicable". These rows stay collection-only until a future reader can
        // require code-owned preconditions; exact platform, tool, and contract
        // identities still prevent cross-tool or cross-platform aggregation.
        preconditionIds: [],
        outcome: recordable.outcome,
        authority: recordable.authority,
        evidenceKind: 'effect_receipt',
        evidenceId: receipt.receiptId,
        observedAt,
      },
      recordedAt,
    );
  } catch {
    return { status: 'failed', code: 'storage_error' };
  }
}
