import {
  resolveToolEffectPolicy,
  type ToolEffectPolicy,
} from '../../engine/durability/toolEffectPolicy';
import {
  buildToolEffectReceipt,
  digestToolEffectRequest,
  digestToolEffectText,
} from '../../engine/toolExecution/toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from '../../engine/toolExecution/toolEffectReceiptContracts';
import type { ToolExecutionContext } from '../../engine/tools/toolExecutionContext';
import type {
  ToolContractIdentity,
  ToolEffectResourceRef,
  ToolEffectReceipt,
} from '../../types/toolEffectReceipt';
import {
  buildToolContractIdentity,
  digestToolContractIdentity,
  type RuntimeExternalToolEvidence,
} from '../../engine/toolExecution/toolContractIdentity';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';
import { dispatchEffectExactlyOnce } from './effectDispatchCoordinator';
import type { EffectDispatchIdentity } from './effectDispatchPolicy';
import {
  prepareToolEffectDispatchJournal,
  type ToolEffectDispatchAuthority,
  type ToolEffectDispatchStoreOptions,
} from './toolEffectDispatchStore';
import type {
  ExecutionCapability,
  ExecutionEffectClass,
  ExecutionIdempotencyClass,
  ExecutionRetryPolicy,
  ExecutionSurface,
} from './types';
import {
  inspectExecutionRunEffectBarrier,
  isCodeOwnedExecutionRunId,
  serializeExecutionRunEffectDispatch,
} from './executionRunEffectBarrier';
import { invalidateVerifiedProcedureObservationsForExecutionRun } from '../memory/verifiedProcedure/invalidation';

const SHA256_PREFIX = 'sha256:';
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export type AuthorizedToolEffectDispatchResult =
  | {
      kind: 'executed';
      result: string;
      receipt: ToolEffectReceipt;
      requiresReconciliation: boolean;
      executorThrew: boolean;
    }
  | {
      kind: 'blocked' | 'reconciliation_required';
      result: string;
      executorThrew: false;
    };

export interface AuthorizedToolEffectDispatchInput {
  conversationId: string;
  toolCallId: string;
  toolName: string;
  argumentsText: string;
  context: ToolExecutionContext & { executionRunId: string };
  approvalState: 'granted' | 'not_required';
  authority: ToolEffectDispatchAuthority;
  runtimeExternalEvidence?: RuntimeExternalToolEvidence;
  execute(): Promise<string>;
}

export interface AuthorizedToolEffectDispatchOptions extends ToolEffectDispatchStoreOptions {
  buildReceipt?: typeof buildToolEffectReceipt;
}

function withoutSha256Prefix(digest: `sha256:${string}`): string {
  return digest.slice(SHA256_PREFIX.length);
}

function effectClassFor(policy: ToolEffectPolicy): ExecutionEffectClass {
  const classes = new Set(policy.effects);
  if (classes.has('unknown')) return 'unknown';
  if (classes.has('destructive')) return 'destructive';
  if (classes.has('external_run')) return 'external_run';
  if (classes.has('remote_mutation')) return 'remote_mutation';
  if (classes.has('local_artifact')) return 'local_artifact';
  return 'none';
}

function idempotencyClassFor(policy: ToolEffectPolicy): ExecutionIdempotencyClass {
  return policy.idempotency;
}

function retryPolicyFor(policy: ToolEffectPolicy): ExecutionRetryPolicy {
  if (policy.retryPolicy === 'replay_safe') return 'replay_safe';
  if (policy.retryPolicy === 'reconcile_before_retry') return 'reconcile_before_retry';
  return 'manual';
}

function requestedCapabilityFor(effectClass: ExecutionEffectClass): ExecutionCapability {
  if (effectClass === 'none') return 'read';
  if (effectClass === 'external_run') return 'coordinate';
  return 'write';
}

function executionSurfaceFor(policy: ToolEffectPolicy): ExecutionSurface {
  if (policy.source === 'builtin') return 'builtin_tool';
  if (policy.toolName.startsWith('mcp__')) return 'mcp';
  if (policy.toolName.startsWith('skill__')) return 'delegated_worker';
  return 'external_api';
}

function isIdentityValue(value: unknown): value is string | number {
  return (
    (typeof value === 'string' &&
      value.length >= 1 &&
      value.length <= 1024 &&
      value === value.trim() &&
      !CONTROL_CHARACTER_PATTERN.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  );
}

function readPath(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function expectedResourceFromArguments(
  toolName: string,
  argumentsText: string,
): ToolEffectResourceRef | null {
  const contract = getCodeOwnedToolEffectContract(toolName);
  const selector =
    contract?.result?.resource?.source === 'arguments'
      ? contract.result.resource
      : contract?.completion?.resource?.source === 'arguments'
        ? contract.completion.resource
        : undefined;
  if (!selector) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return null;
  }
  const value = readPath(parsed, selector.path);
  return isIdentityValue(value) ? { kind: selector.kind, id: String(value) } : null;
}

function expectedEffectKind(toolName: string): ToolEffectReceipt['effectKind'] {
  return getCodeOwnedToolEffectContract(toolName)?.effectKind ?? 'unknown';
}

function safeExecutorError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function buildDispatchIdentity(input: {
  conversationId: string;
  toolCallId: string;
  toolName: string;
  argumentsText: string;
  context: ToolExecutionContext & { executionRunId: string };
  policy: ToolEffectPolicy;
  contractIdentity: ToolContractIdentity;
}): Promise<{
  identity: EffectDispatchIdentity;
  inputDigest: string;
  dispatchTargetDigest: string;
  initialStateDigest: string;
  planningStateDigest: string;
  authorityStateDigest: string;
}> {
  const requestDigestWithPrefix = await digestToolEffectRequest(input.argumentsText);
  const requestDigest = withoutSha256Prefix(requestDigestWithPrefix);
  const [toolNameDigestValue, toolContractIdentityDigestValue] = await Promise.all([
    digestToolEffectText(input.toolName),
    digestToolContractIdentity(input.contractIdentity),
  ]);
  const toolNameDigest = withoutSha256Prefix(toolNameDigestValue);
  const toolContractIdentityDigest = withoutSha256Prefix(toolContractIdentityDigestValue);
  const dispatchTargetDigestValue = await digestToolEffectText(
    [
      'tool-effect-dispatch-target-v2',
      input.policy.source,
      input.context?.provider?.id ?? '',
      input.context?.model ?? input.context?.provider?.model ?? '',
      toolContractIdentityDigest,
    ].join('\u0000'),
  );
  const dispatchTargetDigest = withoutSha256Prefix(dispatchTargetDigestValue);
  const idempotencyKeyDigest =
    input.policy.idempotency === 'declared_idempotent'
      ? withoutSha256Prefix(
          await digestToolEffectText(
            [
              'tool-effect-idempotency-v1',
              input.conversationId,
              input.toolCallId,
              input.toolName,
              requestDigest,
            ].join('\u0000'),
          ),
        )
      : null;
  const identityDigest = withoutSha256Prefix(
    await digestToolEffectText(
      [
        'tool-effect-dispatch-identity-v1',
        input.conversationId,
        input.context.executionRunId,
        input.toolCallId,
        input.toolName,
        requestDigest,
      ].join('\u0000'),
    ),
  );
  const suffix = identityDigest.slice(0, 48);
  const identity: EffectDispatchIdentity = {
    runId: `effect-run-${suffix}`,
    effectId: `effect-${suffix}`,
    executionRunId: input.context.executionRunId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    toolNameDigest,
    toolContractIdentityDigest,
    requestDigest,
    idempotencyKeyDigest,
    dispatchTargetDigest,
    expectedEffectKind: expectedEffectKind(input.toolName),
    expectedResource: expectedResourceFromArguments(input.toolName, input.argumentsText),
    attempt: 1,
    controlEpoch: 0,
    authorityCheckpointId: `effect-authority-${suffix}`,
  };
  const expectedResourceIdentity = identity.expectedResource
    ? `${identity.expectedResource.kind}\u0000${identity.expectedResource.id}`
    : '';
  const durableContractIdentity = [
    identity.toolNameDigest,
    identity.toolContractIdentityDigest,
    identity.requestDigest,
    identity.dispatchTargetDigest,
    identity.expectedEffectKind,
    expectedResourceIdentity,
    effectClassFor(input.policy),
    idempotencyClassFor(input.policy),
    retryPolicyFor(input.policy),
  ].join('\u0000');
  const [initialStateDigest, planningStateDigest, authorityStateDigest] = await Promise.all(
    ['created', 'planned', 'authority'].map(async (boundary) =>
      withoutSha256Prefix(
        await digestToolEffectText(
          ['tool-effect-dispatch-state-v1', identity.runId, boundary, durableContractIdentity].join(
            '\u0000',
          ),
        ),
      ),
    ),
  );
  return {
    identity,
    inputDigest: requestDigest,
    dispatchTargetDigest,
    initialStateDigest,
    planningStateDigest,
    authorityStateDigest,
  };
}

export function isCodeOwnedEffectFreeInvocation(toolName: string, argumentsText: string): boolean {
  const policy = resolveToolEffectPolicy(toolName);
  if (policy.source === 'unknown') return false;
  if (effectClassFor(policy) === 'none') return true;
  const condition = getCodeOwnedToolEffectContract(toolName)?.completion?.effectFreeWhen;
  if (!condition) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return false;
  }
  const value = readPath(parsed, condition.argumentPath);
  return typeof value === 'string' && condition.values.includes(value);
}

async function dispatchAuthorizedToolEffectWithinBarrier(
  input: AuthorizedToolEffectDispatchInput,
  options: AuthorizedToolEffectDispatchOptions = {},
): Promise<AuthorizedToolEffectDispatchResult> {
  const policy = resolveToolEffectPolicy(input.toolName);
  const effectClass = effectClassFor(policy);
  if (effectClass === 'none') {
    throw new Error('effect_dispatch_effect_free_tool');
  }

  const receiptContractIdentity = await buildToolContractIdentity(
    input.toolName,
    input.runtimeExternalEvidence,
  ).catch(() => undefined);
  if (!receiptContractIdentity) {
    return {
      kind: 'blocked',
      result:
        'Error: Tool effect was not executed because no trustworthy receipt identity was available.',
      executorThrew: false,
    };
  }

  let preparedIdentity: Awaited<ReturnType<typeof buildDispatchIdentity>>;
  try {
    preparedIdentity = await buildDispatchIdentity({
      ...input,
      policy,
      contractIdentity: receiptContractIdentity,
    });
  } catch {
    return {
      kind: 'blocked',
      result:
        'Error: Tool effect was not executed because its durable identity could not be prepared.',
      executorThrew: false,
    };
  }

  let rawResult: string | undefined;
  let exactReceipt: ToolEffectReceipt | undefined;
  let executorThrew = false;
  const buildReceipt = options.buildReceipt ?? buildToolEffectReceipt;
  let preparedAt: number;
  try {
    preparedAt = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(preparedAt) || preparedAt < 0) {
      throw new Error('effect_dispatch_clock_invalid');
    }
  } catch {
    return {
      kind: 'blocked',
      result:
        'Error: Tool effect was not executed because the durable execution clock is unavailable.',
      executorThrew: false,
    };
  }
  let prepared: ReturnType<typeof prepareToolEffectDispatchJournal>;
  try {
    prepared = prepareToolEffectDispatchJournal(
      {
        identity: preparedIdentity.identity,
        conversationId: input.conversationId,
        inputDigest: preparedIdentity.inputDigest,
        dispatchTargetDigest: preparedIdentity.dispatchTargetDigest,
        effectClass,
        idempotencyClass: idempotencyClassFor(policy),
        retryPolicy: retryPolicyFor(policy),
        requestedCapability: requestedCapabilityFor(effectClass),
        executionSurface: executionSurfaceFor(policy),
        approvalState: input.approvalState,
        permissionState: 'granted',
        preparedAt,
        initialStateDigest: preparedIdentity.initialStateDigest,
        planningStateDigest: preparedIdentity.planningStateDigest,
        authorityStateDigest: preparedIdentity.authorityStateDigest,
      },
      input.authority,
      async (claim) => {
        let transportState: 'returned' | 'threw' = 'returned';
        try {
          rawResult = await input.execute();
        } catch (error) {
          executorThrew = true;
          transportState = 'threw';
          rawResult = `Error: ${safeExecutorError(error)}`;
        }
        exactReceipt = await buildReceipt({
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          argumentsText: input.argumentsText,
          resultText: rawResult,
          transportState,
          resultIsError: transportState === 'returned' && isToolResultErrorLike(rawResult),
          executionRunId: claim.identity.executionRunId,
          dispatchRunId: claim.identity.runId,
          recordedAt: Math.max(claim.claimedAt, (options.now ?? Date.now)()),
          preparedContractIdentity: receiptContractIdentity,
        });
        return exactReceipt;
      },
      options,
    );
  } catch {
    return {
      kind: 'blocked',
      result:
        'Error: Tool effect was not executed because the durable execution journal is unavailable.',
      executorThrew: false,
    };
  }

  const dispatchResult = await dispatchEffectExactlyOnce(prepared.identity, prepared.ports);
  if (
    dispatchResult.kind === 'settled' &&
    rawResult !== undefined &&
    exactReceipt !== undefined &&
    dispatchResult.receipt.receiptId === exactReceipt.receiptId
  ) {
    return {
      kind: 'executed',
      result: rawResult,
      receipt: exactReceipt,
      requiresReconciliation: dispatchResult.requiresReconciliation,
      executorThrew,
    };
  }
  if (dispatchResult.kind === 'blocked') {
    return {
      kind: 'blocked',
      result: `Error: Tool effect was not executed because durable dispatch was blocked (${dispatchResult.reason}).`,
      executorThrew: false,
    };
  }
  const reconciliationReason =
    dispatchResult.kind === 'reconciliation_required' ? dispatchResult.reason : dispatchResult.kind;
  return {
    kind: 'reconciliation_required',
    result: `Error: Tool effect outcome is ambiguous and requires reconciliation; do not retry automatically (${reconciliationReason}).`,
    executorThrew: false,
  };
}

export async function dispatchAuthorizedToolEffect(
  input: AuthorizedToolEffectDispatchInput,
  options: AuthorizedToolEffectDispatchOptions = {},
): Promise<AuthorizedToolEffectDispatchResult> {
  const policy = resolveToolEffectPolicy(input.toolName);
  if (effectClassFor(policy) === 'none') {
    throw new Error('effect_dispatch_effect_free_tool');
  }
  const executionRunId = input.context.executionRunId;
  if (!isCodeOwnedExecutionRunId(executionRunId)) {
    return {
      kind: 'blocked',
      result:
        'Error: Tool effect was not executed because a code-owned execution-run identity is required.',
      executorThrew: false,
    };
  }

  const result = await serializeExecutionRunEffectDispatch(
    input.conversationId,
    executionRunId,
    async () => {
      const barrier = inspectExecutionRunEffectBarrier(
        input.conversationId,
        executionRunId,
        options,
      );
      if (barrier.kind === 'reconciliation_required') {
        return {
          kind: 'reconciliation_required' as const,
          result:
            'Error: A prior tool effect in this execution requires reconciliation; do not retry automatically ' +
            `(${barrier.blockingStatus}).`,
          executorThrew: false as const,
        };
      }
      if (barrier.kind !== 'clear') {
        return {
          kind: 'blocked' as const,
          result:
            barrier.kind === 'identity_conflict'
              ? 'Error: Tool effect was not executed because the execution-run identity conflicts with durable journal state.'
              : 'Error: Tool effect was not executed because the durable execution journal is unavailable.',
          executorThrew: false as const,
        };
      }
      return dispatchAuthorizedToolEffectWithinBarrier(input, options);
    },
  );
  if (result.kind === 'reconciliation_required') {
    invalidateVerifiedProcedureObservationsForExecutionRun(executionRunId);
  }
  return result;
}
