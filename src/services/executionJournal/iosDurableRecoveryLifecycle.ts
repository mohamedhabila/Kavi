import { Platform } from 'react-native';
import {
  getDurablePlatformExecutionBridge,
  subscribeToIOSDurableWakeEvents,
} from './durablePlatformBridge';
import type {
  DurablePlatformExecutionBridge,
  IOSDurableWakeEvent,
} from './durablePlatformBridgeTypes';
import {
  schedulePersistedIOSExternalRecoveryCandidateSlice,
  type SchedulePersistedIOSExternalRecoveryCandidateSliceResult,
} from './iosDurableRecoveryScheduling';
import { runIOSDurableWakeEvent, type IOSDurableWakeRunnerOutcome } from './iosDurableWakeRunner';

export type IOSDurableRecoveryLifecycleSource = 'startup' | 'foreground';

export interface IOSDurableRecoveryLifecycleDependencies {
  platform: string;
  getBridge(): DurablePlatformExecutionBridge | null;
  subscribe(
    onEvent: (event: IOSDurableWakeEvent) => void,
    onInvalidEvent: (error: Error) => void,
  ): { remove(): void } | null;
  runEvent(event: IOSDurableWakeEvent): Promise<IOSDurableWakeRunnerOutcome>;
  scheduleSlice(input: {
    limit: number;
    after?: string;
  }): Promise<SchedulePersistedIOSExternalRecoveryCandidateSliceResult>;
  yieldToRuntime(): Promise<void>;
  warn(message: string, error?: unknown): void;
}

const DEFAULT_DEPENDENCIES: IOSDurableRecoveryLifecycleDependencies = {
  platform: Platform.OS,
  getBridge: getDurablePlatformExecutionBridge,
  subscribe: subscribeToIOSDurableWakeEvents,
  runEvent: runIOSDurableWakeEvent,
  scheduleSlice: schedulePersistedIOSExternalRecoveryCandidateSlice,
  yieldToRuntime: () => new Promise((resolve) => setTimeout(resolve, 0)),
  warn: (message, error) => console.warn(message, error ?? ''),
};

const REPAIR_SLICE_SIZE = 25;

function eventKey(event: IOSDurableWakeEvent): string {
  const record = event.record;
  const identity = record.request.identity;
  return JSON.stringify([
    event.trigger,
    event.disposition,
    identity.runId,
    identity.controlEpoch,
    identity.snapshotUpdatedAtMillis,
    identity.snapshotDigest,
    identity.commandDigest,
    record.state,
    record.attempt,
    record.revision,
  ]);
}

export class IOSDurableRecoveryLifecycle {
  private subscription: { remove(): void } | null = null;
  private started = false;
  private drainPromise: Promise<void> | null = null;
  private repairPromise: Promise<void> | null = null;
  private readonly inFlightKeys = new Set<string>();
  private readonly runQueues = new Map<string, Promise<IOSDurableWakeRunnerOutcome>>();

  constructor(
    private readonly dependencies: IOSDurableRecoveryLifecycleDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  start(): void {
    if (this.dependencies.platform !== 'ios' || this.started) return;
    this.started = true;
    this.subscription = this.dependencies.subscribe(
      (event) => {
        void this.enqueue(event).catch((error) => {
          this.dependencies.warn('[durability] iOS durable wake execution failed', error);
        });
      },
      (error) => {
        this.dependencies.warn('[durability] Invalid iOS durable wake event', error);
      },
    );
  }

  async reconcile(source: IOSDurableRecoveryLifecycleSource): Promise<void> {
    if (this.dependencies.platform !== 'ios') return;
    this.start();
    await Promise.all([this.drainPending(source), this.repairCandidates(source)]);
  }

  dispose(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.started = false;
    this.drainPromise = null;
    this.repairPromise = null;
    this.inFlightKeys.clear();
    this.runQueues.clear();
  }

  private drainPending(source: IOSDurableRecoveryLifecycleSource): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    const operation = this.performDrain(source).finally(() => {
      if (this.drainPromise === operation) this.drainPromise = null;
    });
    this.drainPromise = operation;
    return operation;
  }

  private async performDrain(source: IOSDurableRecoveryLifecycleSource): Promise<void> {
    const bridge = this.dependencies.getBridge();
    if (!bridge?.getPendingLaunches) {
      this.dependencies.warn(`[durability] iOS ${source} pending-wake bridge unavailable`);
      return;
    }
    try {
      const pending = await bridge.getPendingLaunches(1_000);
      if (pending.status === 'unavailable') {
        this.dependencies.warn(`[durability] iOS ${source} pending-wake store unavailable`);
        return;
      }
      await Promise.all(pending.events.map((event) => this.enqueue(event)));
    } catch (error) {
      this.dependencies.warn(`[durability] iOS ${source} pending-wake replay failed`, error);
    }
  }

  private repairCandidates(source: IOSDurableRecoveryLifecycleSource): Promise<void> {
    if (this.repairPromise) return this.repairPromise;
    const operation = this.performRepair(source).finally(() => {
      if (this.repairPromise === operation) this.repairPromise = null;
    });
    this.repairPromise = operation;
    return operation;
  }

  private async performRepair(source: IOSDurableRecoveryLifecycleSource): Promise<void> {
    let after: string | undefined;
    try {
      do {
        const slice = await this.dependencies.scheduleSlice({
          limit: REPAIR_SLICE_SIZE,
          ...(after === undefined ? {} : { after }),
        });
        if (
          slice.outcomes.some(
            (outcome) => outcome.kind === 'deferred' || outcome.kind === 'blocked',
          )
        ) {
          this.dependencies.warn(`[durability] iOS ${source} recovery scan needs attention`);
        }
        if (slice.nextAfter === null) return;
        if (slice.nextAfter === after) throw new Error('ios-durable-scan-cursor-stalled');
        after = slice.nextAfter;
        await this.dependencies.yieldToRuntime();
      } while (after !== undefined);
    } catch (error) {
      this.dependencies.warn(`[durability] iOS ${source} recovery scan failed`, error);
    }
  }

  private enqueue(event: IOSDurableWakeEvent): Promise<IOSDurableWakeRunnerOutcome> {
    const key = eventKey(event);
    const runId = event.record.request.identity.runId;
    if (this.inFlightKeys.has(key)) {
      return this.runQueues.get(runId) ?? this.dependencies.runEvent(event);
    }
    this.inFlightKeys.add(key);
    const previous = this.runQueues.get(runId);
    const operation = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(() => this.dependencies.runEvent(event))
      .finally(() => {
        this.inFlightKeys.delete(key);
        if (this.runQueues.get(runId) === operation) this.runQueues.delete(runId);
      });
    this.runQueues.set(runId, operation);
    return operation;
  }
}

let productionLifecycle: IOSDurableRecoveryLifecycle | null = null;

function lifecycle(): IOSDurableRecoveryLifecycle {
  productionLifecycle ??= new IOSDurableRecoveryLifecycle();
  return productionLifecycle;
}

export function initializeIOSDurableRecoveryLifecycle(): void {
  lifecycle().start();
}

export function reconcileIOSDurableRecoveryLifecycle(
  source: IOSDurableRecoveryLifecycleSource,
): Promise<void> {
  return lifecycle().reconcile(source);
}

export function __resetIOSDurableRecoveryLifecycleForTests(): void {
  productionLifecycle?.dispose();
  productionLifecycle = null;
}
