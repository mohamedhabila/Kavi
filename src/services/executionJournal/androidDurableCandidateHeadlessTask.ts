import { acknowledgeAndroidDurableCandidateWake } from './androidDurableExecutionNative';
import type { AndroidDurableCandidateHeadlessPayload } from './androidDurableExecutionTypes';
import {
  ANDROID_DURABLE_BRIDGE_SCHEMA,
  ANDROID_DURABLE_CANDIDATE_TASK_KEY,
} from './androidDurableExecutionTypes';
import { continuePersistedAndroidExternalRecoveryRun } from './androidDurableRecoveryScheduling';

interface AndroidDurableCandidateHeadlessDependencies {
  continueRun: typeof continuePersistedAndroidExternalRecoveryRun;
  acknowledge: typeof acknowledgeAndroidDurableCandidateWake;
}

const DEFAULT_DEPENDENCIES: AndroidDurableCandidateHeadlessDependencies = {
  continueRun: continuePersistedAndroidExternalRecoveryRun,
  acknowledge: acknowledgeAndroidDurableCandidateWake,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value)
  );
}

export function decodeAndroidDurableCandidateHeadlessPayload(
  value: unknown,
): AndroidDurableCandidateHeadlessPayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'wakeWorkId', 'predecessorWorkId', 'runId']) ||
    value.schema !== ANDROID_DURABLE_BRIDGE_SCHEMA ||
    !validUuid(value.wakeWorkId) ||
    !validUuid(value.predecessorWorkId) ||
    !validId(value.runId)
  ) {
    throw new Error('android-durable-candidate-payload-invalid');
  }
  return value as unknown as AndroidDurableCandidateHeadlessPayload;
}

export async function runAndroidDurableCandidateHeadlessTask(
  rawPayload: unknown,
  dependencies: AndroidDurableCandidateHeadlessDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const payload = decodeAndroidDurableCandidateHeadlessPayload(rawPayload);
  let acknowledgement: 'completed' | 'retry' = 'retry';
  try {
    const result = await dependencies.continueRun(
      payload.runId,
      payload.predecessorWorkId,
    );
    acknowledgement = result.kind === 'deferred' ? 'retry' : 'completed';
  } catch {
    acknowledgement = 'retry';
  }
  await dependencies.acknowledge(
    payload.wakeWorkId,
    payload.predecessorWorkId,
    payload.runId,
    acknowledgement,
  );
}

export function registerAndroidDurableCandidateHeadlessTask(): void {
  const reactNative = require('react-native') as typeof import('react-native');
  if (reactNative.Platform.OS !== 'android') return;
  reactNative.AppRegistry.registerHeadlessTask(
    ANDROID_DURABLE_CANDIDATE_TASK_KEY,
    () => runAndroidDurableCandidateHeadlessTask,
  );
}
