import {
  resolveExternalToolResultDurability,
  type ExternalToolRemoteIdentity,
  type ExternalToolResultDurabilityResolution,
} from '../../engine/durability/externalToolResult';
import { scheduleDurableRecoveryRunImmediately } from './durableRecoveryLifecycle';
import type { DurableRecoveryScheduleOutcome } from './durableRecoverySchedulingTypes';
import {
  persistExternalToolObservation,
  type PersistExternalToolObservationResult,
} from './externalToolObservationStore';

export interface ObserveExternalToolResultInput {
  toolName: string;
  toolCallId: string;
  argumentsText: string;
  resultText: string;
  conversationId: string;
  parentAgentRunId?: string;
  observedAt: number;
}

type ExternalResolution = Extract<ExternalToolResultDurabilityResolution, { kind: 'external' }>;

interface ExternalToolDurabilityLifecycleDependencies {
  resolve(input: {
    toolName: string;
    argumentsText: string;
    resultText: string;
  }): ExternalToolResultDurabilityResolution;
  persist(
    input: ObserveExternalToolResultInput & {
      handle: ExternalResolution['handle'];
      observedStatus: ExternalResolution['observedStatus'];
    },
  ): Promise<PersistExternalToolObservationResult>;
  schedule(runId: string): Promise<DurableRecoveryScheduleOutcome>;
}

const DEFAULT_DEPENDENCIES: ExternalToolDurabilityLifecycleDependencies = {
  resolve: resolveExternalToolResultDurability,
  persist: persistExternalToolObservation,
  schedule: scheduleDurableRecoveryRunImmediately,
};

export type ObserveExternalToolResultOutcome =
  | { kind: 'not_external' }
  | Extract<ExternalToolResultDurabilityResolution, { kind: 'untracked_external' }>
  | {
      kind: 'persistence_failed';
      reason: 'journal_unavailable';
      remote: ExternalToolRemoteIdentity;
    }
  | {
      kind: 'persisted';
      observation: PersistExternalToolObservationResult;
      scheduling: DurableRecoveryScheduleOutcome | { kind: 'not_required' };
      remote: ExternalToolRemoteIdentity;
    };

/** Persist and activate recovery while the exact raw tool result is still in memory. */
export async function observeExternalToolResultDurability(
  input: ObserveExternalToolResultInput,
  dependencies: ExternalToolDurabilityLifecycleDependencies = DEFAULT_DEPENDENCIES,
): Promise<ObserveExternalToolResultOutcome> {
  const resolution = dependencies.resolve(input);
  if (resolution.kind !== 'external') return resolution;

  let observation: PersistExternalToolObservationResult;
  try {
    observation = await dependencies.persist({
      ...input,
      handle: resolution.handle,
      observedStatus: resolution.observedStatus,
    });
  } catch {
    return {
      kind: 'persistence_failed',
      reason: 'journal_unavailable',
      remote: resolution.remote,
    };
  }

  if (observation.terminal) {
    return {
      kind: 'persisted',
      observation,
      scheduling: { kind: 'not_required' },
      remote: resolution.remote,
    };
  }

  let scheduling: DurableRecoveryScheduleOutcome;
  try {
    scheduling = await dependencies.schedule(observation.runId);
  } catch {
    scheduling = {
      kind: 'deferred',
      runId: observation.runId,
      reason: 'native_bridge_unavailable',
    };
  }
  return { kind: 'persisted', observation, scheduling, remote: resolution.remote };
}

export function buildUntrackedExternalToolResult(
  outcome: Extract<
    ObserveExternalToolResultOutcome,
    { kind: 'untracked_external' | 'persistence_failed' }
  >,
): string {
  const remote = outcome.remote;
  const identity = remote
    ? `${remote.provider} workflow ${remote.workflowRunId} on ${remote.target}`
    : 'remote workflow';
  return (
    `Error: The ${identity} may already be running, but durable monitoring could not be ` +
    `activated (${outcome.reason}). Do not retry this launch automatically. Inspect the exact ` +
    'remote workflow before dispatching another run.'
  );
}
