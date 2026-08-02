import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export const ANDROID_LONG_HORIZON_BRIDGE_SCHEMA = 1 as const;
export const ANDROID_LONG_HORIZON_KEEP_ALIVE_TASK_KEY =
  'KaviLongHorizonExecutionKeepAlive' as const;

export type AndroidLongHorizonTaskKind = 'chat' | 'sub_agent';

type AndroidLongHorizonUnavailableReason =
  | 'foreground_service_start_not_allowed'
  | 'foreground_service_permission_missing'
  | 'foreground_service_start_failed';

type AndroidLongHorizonCancellationReason =
  | 'user_requested'
  | 'background_continuity_unavailable'
  | 'service_stopped_unexpectedly';

type AndroidLongHorizonLeaseResult = {
  schema: typeof ANDROID_LONG_HORIZON_BRIDGE_SCHEMA;
  status: 'accepted' | 'no_op' | 'released' | 'missing' | 'unavailable';
  reason: AndroidLongHorizonUnavailableReason | null;
  activeLeaseCount: number;
};

type AndroidLongHorizonIdleResult = {
  schema: typeof ANDROID_LONG_HORIZON_BRIDGE_SCHEMA;
  status: 'idle';
  activeLeaseCount: 0;
};

interface KaviLongHorizonExecutionNativeModule {
  bridgeSchema: unknown;
  cancelEventName: unknown;
  keepAliveTaskKey: unknown;
  acquire(leaseId: string, taskKind: AndroidLongHorizonTaskKind): Promise<unknown>;
  release(leaseId: string): Promise<unknown>;
  getStatus(): Promise<unknown>;
  awaitIdle(): Promise<unknown>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

type AndroidLongHorizonExecutionDependencies = {
  platform: string;
  getNativeModule(): KaviLongHorizonExecutionNativeModule | null;
  warn(message: string, error?: unknown): void;
};

const UNAVAILABLE_REASONS = new Set<AndroidLongHorizonUnavailableReason>([
  'foreground_service_start_not_allowed',
  'foreground_service_permission_missing',
  'foreground_service_start_failed',
]);

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

function getNativeModule(): KaviLongHorizonExecutionNativeModule | null {
  if (Platform.OS !== 'android') return null;
  const native = NativeModules.KaviLongHorizonExecution as
    | KaviLongHorizonExecutionNativeModule
    | undefined;
  if (
    !native ||
    native.bridgeSchema !== ANDROID_LONG_HORIZON_BRIDGE_SCHEMA ||
    typeof native.cancelEventName !== 'string' ||
    !native.cancelEventName ||
    native.keepAliveTaskKey !== ANDROID_LONG_HORIZON_KEEP_ALIVE_TASK_KEY ||
    typeof native.acquire !== 'function' ||
    typeof native.release !== 'function' ||
    typeof native.getStatus !== 'function' ||
    typeof native.awaitIdle !== 'function' ||
    typeof native.addListener !== 'function' ||
    typeof native.removeListeners !== 'function'
  ) {
    return null;
  }
  return native;
}

function decodeKeepAlivePayload(value: unknown): void {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema']) ||
    value.schema !== ANDROID_LONG_HORIZON_BRIDGE_SCHEMA
  ) {
    throw new Error('android-long-horizon-keep-alive-payload-invalid');
  }
}

function decodeIdleResult(value: unknown): AndroidLongHorizonIdleResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'status', 'activeLeaseCount']) ||
    value.schema !== ANDROID_LONG_HORIZON_BRIDGE_SCHEMA ||
    value.status !== 'idle' ||
    value.activeLeaseCount !== 0
  ) {
    throw new Error('android-long-horizon-idle-contract-violation');
  }
  return value as AndroidLongHorizonIdleResult;
}

/** Keeps React Native's Android timer scheduler active for the native lease lifetime. */
export async function runAndroidLongHorizonKeepAliveTask(
  rawPayload: unknown,
  dependencies: AndroidLongHorizonExecutionDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (dependencies.platform !== 'android') return;
  decodeKeepAlivePayload(rawPayload);
  const native = dependencies.getNativeModule();
  if (!native) {
    throw new Error('android-long-horizon-native-bridge-unavailable');
  }
  decodeIdleResult(await native.awaitIdle());
}

export function registerAndroidLongHorizonKeepAliveTask(): void {
  if (Platform.OS !== 'android') return;
  const { AppRegistry } = require('react-native') as typeof import('react-native');
  AppRegistry.registerHeadlessTask(
    ANDROID_LONG_HORIZON_KEEP_ALIVE_TASK_KEY,
    () => runAndroidLongHorizonKeepAliveTask,
  );
}

const DEFAULT_DEPENDENCIES: AndroidLongHorizonExecutionDependencies = {
  platform: Platform.OS,
  getNativeModule,
  warn: (message, error) => console.warn(message, error),
};

function decodeLeaseResult(value: unknown): AndroidLongHorizonLeaseResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schema', 'status', 'reason', 'activeLeaseCount']) ||
    value.schema !== ANDROID_LONG_HORIZON_BRIDGE_SCHEMA ||
    !Number.isSafeInteger(value.activeLeaseCount) ||
    (value.activeLeaseCount as number) < 0
  ) {
    throw new Error('android-long-horizon-native-contract-violation');
  }
  const status = value.status;
  if (
    (status === 'accepted' ||
      status === 'no_op' ||
      status === 'released' ||
      status === 'missing') &&
    value.reason === null
  ) {
    return value as AndroidLongHorizonLeaseResult;
  }
  if (
    status === 'unavailable' &&
    typeof value.reason === 'string' &&
    UNAVAILABLE_REASONS.has(value.reason as AndroidLongHorizonUnavailableReason)
  ) {
    return value as AndroidLongHorizonLeaseResult;
  }
  throw new Error('android-long-horizon-native-contract-violation');
}

/**
 * Keeps user-started assistant work process-resident on Android while it is actively executing.
 * Persistence and restart recovery remain authoritative if Android still terminates the process.
 */
export async function withAndroidLongHorizonExecutionLease<T>(
  input: { leaseId: string; taskKind: AndroidLongHorizonTaskKind },
  operation: () => Promise<T>,
  dependencies: AndroidLongHorizonExecutionDependencies = DEFAULT_DEPENDENCIES,
): Promise<T> {
  if (dependencies.platform !== 'android') return operation();
  const native = dependencies.getNativeModule();
  if (!native) return operation();

  let ownsLease = false;
  try {
    const acquired = decodeLeaseResult(await native.acquire(input.leaseId, input.taskKind));
    ownsLease = acquired.status === 'accepted';
    if (acquired.status === 'unavailable') {
      dependencies.warn(
        `[android-long-horizon] Background continuity unavailable: ${acquired.reason}`,
      );
    }
  } catch (error) {
    dependencies.warn('[android-long-horizon] Failed to acquire execution continuity.', error);
  }

  try {
    return await operation();
  } finally {
    if (ownsLease) {
      try {
        decodeLeaseResult(await native.release(input.leaseId));
      } catch (error) {
        dependencies.warn('[android-long-horizon] Failed to release execution continuity.', error);
      }
    }
  }
}

type AndroidLongHorizonCancellationDependencies = {
  activeForegroundConversationIds(): readonly string[];
  abortForegroundConversation(conversationId: string, reason: string): boolean;
  clearForegroundConversation(conversationId: string): boolean;
  terminalizeForegroundConversation(conversationId: string): void;
  activeSubAgentIds(): readonly string[];
  cancelSubAgent(sessionId: string, reason: string): unknown;
  flushSubAgentState?(): Promise<void>;
};

function getCancellationDependencies(): AndroidLongHorizonCancellationDependencies {
  const { appForegroundRequestRegistry } =
    require('../engine/graph/foregroundRun/requestRegistry') as typeof import('../engine/graph/foregroundRun/requestRegistry');
  const { cancelSubAgent, flushSubAgentRegistryPersistence, listActiveSubAgents } =
    require('./agents/subAgent') as typeof import('./agents/subAgent');
  return {
    activeForegroundConversationIds: () => [
      ...appForegroundRequestRegistry.getActiveConversationIds(),
    ],
    abortForegroundConversation: (conversationId, reason) =>
      appForegroundRequestRegistry.abortForConversation(conversationId, reason),
    clearForegroundConversation: (conversationId) =>
      appForegroundRequestRegistry.clearForConversation(conversationId),
    terminalizeForegroundConversation: (conversationId) => {
      const { terminalizeAndroidLongHorizonConversation } =
        require('./androidLongHorizonRunCancellation') as typeof import('./androidLongHorizonRunCancellation');
      void terminalizeAndroidLongHorizonConversation(conversationId).catch((error: unknown) => {
        console.warn('[android-long-horizon] Failed to persist notification cancellation.', error);
      });
    },
    activeSubAgentIds: () =>
      listActiveSubAgents()
        .filter((agent) => agent.status === 'running')
        .map((agent) => agent.sessionId),
    cancelSubAgent,
    flushSubAgentState: flushSubAgentRegistryPersistence,
  };
}

export function cancelActiveAndroidLongHorizonWork(
  dependencies: AndroidLongHorizonCancellationDependencies = getCancellationDependencies(),
  cancellationReason: AndroidLongHorizonCancellationReason = 'user_requested',
): { foregroundRequests: number; subAgents: number } {
  const reason =
    cancellationReason === 'user_requested'
      ? 'Stopped from the Android background-task notification.'
      : cancellationReason === 'background_continuity_unavailable'
        ? 'Android could not keep this task running reliably in the background.'
        : 'Android stopped the background execution service unexpectedly.';
  let foregroundRequests = 0;
  for (const conversationId of dependencies.activeForegroundConversationIds()) {
    if (dependencies.abortForegroundConversation(conversationId, reason)) {
      foregroundRequests += 1;
    }
    dependencies.clearForegroundConversation(conversationId);
    dependencies.terminalizeForegroundConversation(conversationId);
  }
  let subAgents = 0;
  for (const sessionId of dependencies.activeSubAgentIds()) {
    if (dependencies.cancelSubAgent(sessionId, reason)) {
      subAgents += 1;
    }
  }
  if (subAgents > 0 && dependencies.flushSubAgentState) {
    void dependencies.flushSubAgentState().catch((error: unknown) => {
      console.warn(
        '[android-long-horizon] Failed to persist notification worker cancellation.',
        error,
      );
    });
  }
  return { foregroundRequests, subAgents };
}

let cancellationSubscription: { remove(): void } | null = null;

export function initializeAndroidLongHorizonCancellationHandler(
  dependencies: AndroidLongHorizonExecutionDependencies = DEFAULT_DEPENDENCIES,
): void {
  if (cancellationSubscription || dependencies.platform !== 'android') return;
  const native = dependencies.getNativeModule();
  if (!native) return;
  try {
    const emitter = new NativeEventEmitter(native as never);
    cancellationSubscription = emitter.addListener(native.cancelEventName as string, (value) => {
      if (
        !isRecord(value) ||
        !hasExactKeys(value, ['schema', 'reason']) ||
        value.schema !== ANDROID_LONG_HORIZON_BRIDGE_SCHEMA ||
        (value.reason !== 'user_requested' &&
          value.reason !== 'background_continuity_unavailable' &&
          value.reason !== 'service_stopped_unexpectedly')
      ) {
        return;
      }
      cancelActiveAndroidLongHorizonWork(undefined, value.reason);
    });
  } catch (error) {
    dependencies.warn('[android-long-horizon] Failed to install cancellation handler.', error);
  }
}

export function resetAndroidLongHorizonExecutionForTests(): void {
  cancellationSubscription?.remove();
  cancellationSubscription = null;
}
