import { ExpoGraphqlRequestError } from '../expo/providers/expoGraphql';
import { fetchExpoWorkflowRunByIdAsync } from '../expo/workflows/expoHostedRuns';
import { GitHubApiError } from '../github/api';
import {
  fetchGitHubWorkflowRunById,
  type GitHubWorkflowRunInspection,
} from '../integrations/github/workflows';
import { requireSecret } from '../integrations/shared/secrets';
import type {
  ExecutionExternalHandleObservation,
  ExecutionExternalHandleReconciliationStore,
} from './externalHandleReconciliationTypes';
import type {
  ExecutionRecoveryHandlerBlockReason,
  ExecutionRecoveryHandlerInput,
  ExecutionRecoveryHandlerResult,
  ExecutionRecoveryPendingReason,
} from './recoveryCoordinatorTypes';
import type { ExecutionExternalHandleRecord, ExecutionExternalHandleStatus } from './types';

const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_INSPECTION_CONCURRENCY = 4;

interface ExpoWorkflowRunInspection {
  id?: unknown;
  status?: unknown;
}

type ClosedProviderInspection =
  | { kind: 'observed'; status: ExecutionExternalHandleStatus }
  | { kind: 'preserved_block'; reason: ExecutionRecoveryHandlerBlockReason }
  | { kind: 'pending'; reason: ExecutionRecoveryPendingReason }
  | { kind: 'blocked'; reason: ExecutionRecoveryHandlerBlockReason };

export interface ExecutionExternalHandleInspectors {
  readSecret(reference: string): Promise<string>;
  inspectExpoWorkflowRun(token: string, workflowRunId: string): Promise<ExpoWorkflowRunInspection>;
  inspectGitHubWorkflowRun(
    token: string,
    repository: string,
    workflowRunId: string,
  ): Promise<GitHubWorkflowRunInspection>;
}

export interface CreateExecutionExternalHandleReconciliationHandlerOptions {
  inspectors?: ExecutionExternalHandleInspectors;
  retryAfterMs?: number;
}

const DEFAULT_INSPECTORS: ExecutionExternalHandleInspectors = {
  readSecret: requireSecret,
  inspectExpoWorkflowRun: fetchExpoWorkflowRunByIdAsync,
  inspectGitHubWorkflowRun: (token, repository, workflowRunId) =>
    fetchGitHubWorkflowRunById(repository, workflowRunId, token),
};

function exactRunId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  return typeof value === 'string' && value === value.trim() && value.length > 0 ? value : null;
}

export function mapExpoWorkflowRunForRecovery(
  value: ExpoWorkflowRunInspection,
  expectedWorkflowRunId: string,
): ClosedProviderInspection {
  if (
    !value ||
    typeof value !== 'object' ||
    exactRunId(value.id) !== expectedWorkflowRunId ||
    typeof value.status !== 'string'
  ) {
    return { kind: 'blocked', reason: 'provider_contract_invalid' };
  }
  switch (value.status) {
    case 'NEW':
      return { kind: 'observed', status: 'pending' };
    case 'IN_PROGRESS':
      return { kind: 'observed', status: 'running' };
    case 'ACTION_REQUIRED':
      return { kind: 'preserved_block', reason: 'remote_action_required' };
    case 'SUCCESS':
      return { kind: 'observed', status: 'succeeded' };
    case 'FAILURE':
      return { kind: 'observed', status: 'failed' };
    case 'CANCELED':
      return { kind: 'observed', status: 'cancelled' };
    default:
      return { kind: 'blocked', reason: 'provider_contract_invalid' };
  }
}

export function mapGitHubWorkflowRunForRecovery(
  value: GitHubWorkflowRunInspection,
  expectedWorkflowRunId: string,
): ClosedProviderInspection {
  if (
    !value ||
    typeof value !== 'object' ||
    exactRunId(value.id) !== expectedWorkflowRunId ||
    typeof value.status !== 'string'
  ) {
    return { kind: 'blocked', reason: 'provider_contract_invalid' };
  }
  switch (value.status) {
    case 'queued':
    case 'requested':
    case 'pending':
      return { kind: 'observed', status: 'pending' };
    case 'in_progress':
      return { kind: 'observed', status: 'running' };
    case 'waiting':
      return { kind: 'preserved_block', reason: 'remote_action_required' };
    case 'completed':
      break;
    default:
      return { kind: 'blocked', reason: 'provider_contract_invalid' };
  }

  if (value.conclusion === 'success') return { kind: 'observed', status: 'succeeded' };
  if (value.conclusion === 'cancelled') return { kind: 'observed', status: 'cancelled' };
  if (value.conclusion === 'action_required') {
    return { kind: 'preserved_block', reason: 'remote_action_required' };
  }
  if (
    ['failure', 'timed_out', 'startup_failure', 'stale', 'neutral', 'skipped'].includes(
      value.conclusion as string,
    )
  ) {
    return { kind: 'observed', status: 'failed' };
  }
  return { kind: 'blocked', reason: 'provider_contract_invalid' };
}

function classifyInspectionError(error: unknown): ClosedProviderInspection {
  if (error instanceof GitHubApiError) {
    if (error.status === 408 || error.status === 429 || error.status >= 500) {
      return { kind: 'pending', reason: 'provider_temporarily_unavailable' };
    }
    return {
      kind: 'blocked',
      reason: error.status === 404 ? 'external_not_found' : 'inspection_unavailable',
    };
  }
  if (error instanceof ExpoGraphqlRequestError) {
    if (
      error.kind === 'http' &&
      error.status !== null &&
      (error.status === 408 || error.status === 429 || error.status >= 500)
    ) {
      return { kind: 'pending', reason: 'provider_temporarily_unavailable' };
    }
    if (error.kind === 'contract' || error.kind === 'graphql') {
      return { kind: 'blocked', reason: 'provider_contract_invalid' };
    }
    return {
      kind: 'blocked',
      reason: error.status === 404 ? 'external_not_found' : 'inspection_unavailable',
    };
  }
  if (error instanceof TypeError) {
    return { kind: 'pending', reason: 'provider_temporarily_unavailable' };
  }
  return { kind: 'blocked', reason: 'inspection_unavailable' };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  work: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await work(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createExecutionExternalHandleReconciliationHandler(
  store: ExecutionExternalHandleReconciliationStore,
  options: CreateExecutionExternalHandleReconciliationHandlerOptions = {},
): (
  input: ExecutionRecoveryHandlerInput<'reconcile_external_handles'>,
) => Promise<ExecutionRecoveryHandlerResult> {
  const inspectors = options.inspectors ?? DEFAULT_INSPECTORS;
  const retryAfterMs = options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
  if (
    !Number.isSafeInteger(retryAfterMs) ||
    retryAfterMs < 1_000 ||
    retryAfterMs > 24 * 60 * 60 * 1_000
  ) {
    throw new Error('execution_recovery_invalid_retry_delay');
  }

  return async (input) => {
    const claim = store.claim(input);
    if (claim.kind === 'rejected') {
      return {
        kind: 'rejected',
        fenceId: input.context.fence.fenceId,
        fenceDigest: input.context.fence.fenceDigest,
        reason: claim.reason,
      };
    }

    const secretCache = new Map<string, Promise<string>>();
    const readSecret = (reference: string): Promise<string> => {
      const cached = secretCache.get(reference);
      if (cached) return cached;
      const pending = inspectors.readSecret(reference);
      secretCache.set(reference, pending);
      return pending;
    };
    const inspect = async (
      handle: ExecutionExternalHandleRecord,
    ): Promise<ClosedProviderInspection> => {
      let token: string;
      try {
        token = await readSecret(handle.locator.credentialRef);
      } catch {
        return { kind: 'blocked', reason: 'inspection_unavailable' };
      }
      try {
        return handle.locator.kind === 'expo_workflow_run'
          ? mapExpoWorkflowRunForRecovery(
              await inspectors.inspectExpoWorkflowRun(token, handle.locator.workflowRunId),
              handle.locator.workflowRunId,
            )
          : mapGitHubWorkflowRunForRecovery(
              await inspectors.inspectGitHubWorkflowRun(
                token,
                handle.locator.repository,
                handle.locator.workflowRunId,
              ),
              handle.locator.workflowRunId,
            );
      } catch (error) {
        return classifyInspectionError(error);
      }
    };

    const orderedHandles = [...claim.handles].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const inspections = await mapWithConcurrency(
      orderedHandles,
      MAX_INSPECTION_CONCURRENCY,
      inspect,
    );
    const observations: ExecutionExternalHandleObservation[] = orderedHandles.map(
      (handle, index) => {
        const inspection = inspections[index];
        return {
          handleId: handle.id,
          expectedStatus: handle.status,
          observedStatus:
            inspection.kind === 'observed'
              ? inspection.status
              : inspection.kind === 'preserved_block'
                ? handle.status
                : null,
        };
      },
    );
    const blocked = inspections.find(
      (inspection) => inspection.kind === 'blocked' || inspection.kind === 'preserved_block',
    );
    if (blocked?.kind === 'blocked' || blocked?.kind === 'preserved_block') {
      return store.complete({
        ...input,
        observations,
        disposition: { kind: 'blocked', reason: blocked.reason },
      });
    }
    const transient = inspections.find((inspection) => inspection.kind === 'pending');
    if (transient?.kind === 'pending') {
      return store.complete({
        ...input,
        observations,
        disposition: {
          kind: 'pending',
          reason: transient.reason,
          retryAfterMs,
        },
      });
    }
    const unresolved = inspections.some(
      (inspection) =>
        inspection.kind === 'observed' &&
        (inspection.status === 'unknown' ||
          inspection.status === 'pending' ||
          inspection.status === 'running'),
    );
    return store.complete({
      ...input,
      observations,
      disposition: unresolved
        ? { kind: 'pending', reason: 'remote_still_pending', retryAfterMs }
        : { kind: 'completed' },
    });
  };
}
