// ---------------------------------------------------------------------------
// Kavi — On-device memory ingestion guards
// ---------------------------------------------------------------------------
// Structural limits for background consolidation on mobile: single concurrent
// job, bounded batch drain, and deferral while main chat inference is active.
// Fail-open: guards never throw; they only defer or skip work.
// ---------------------------------------------------------------------------

export const INGESTION_BATCH_LIMIT = 3;
export const MAX_CONCURRENT_INGESTION_JOBS = 1;
export const MAX_INGESTION_ATTEMPTS = 5;

let activeIngestionJobId: string | null = null;
const activeMainInferenceLeases = new Map<symbol, string>();
let memoryPressureAbort = false;
type IngestionPreemptionReason = 'foreground_inference' | 'memory_pressure';
const ingestionPreemptionHandlers = new Set<(reason: IngestionPreemptionReason) => void>();

function notifyIngestionPreemption(reason: IngestionPreemptionReason): void {
  for (const handler of ingestionPreemptionHandlers) {
    try {
      handler(reason);
    } catch {
      // Resource guards are fail-open; queue ownership still fences persistence.
    }
  }
}

export function registerIngestionPreemptionHandler(
  handler: (reason: IngestionPreemptionReason) => void,
): () => void {
  ingestionPreemptionHandlers.add(handler);
  return () => ingestionPreemptionHandlers.delete(handler);
}

export interface MainInferenceLease {
  readonly ownerId: string;
  release(): boolean;
}

export function acquireMainInferenceLease(ownerId: string): MainInferenceLease {
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId) {
    throw new Error('main_inference_owner_required');
  }

  const token = Symbol(normalizedOwnerId);
  const wasIdle = activeMainInferenceLeases.size === 0;
  activeMainInferenceLeases.set(token, normalizedOwnerId);
  if (wasIdle) notifyIngestionPreemption('foreground_inference');
  let released = false;
  return {
    ownerId: normalizedOwnerId,
    release: () => {
      if (released) return false;
      released = true;
      return activeMainInferenceLeases.delete(token);
    },
  };
}

export function setMemoryPressureAbort(active: boolean): void {
  const shouldPreempt = active && !memoryPressureAbort;
  memoryPressureAbort = active;
  if (shouldPreempt) notifyIngestionPreemption('memory_pressure');
}

export function isMainInferenceActive(): boolean {
  return activeMainInferenceLeases.size > 0;
}

export function shouldAbortIngestionDueToMemoryPressure(): boolean {
  return memoryPressureAbort;
}

export function canStartIngestionJob(): boolean {
  if (memoryPressureAbort) return false;
  if (isMainInferenceActive()) return false;
  if (activeIngestionJobId !== null) return false;
  return true;
}

export function acquireIngestionSlot(jobId: string): boolean {
  if (!canStartIngestionJob()) return false;
  activeIngestionJobId = jobId;
  return true;
}

export function releaseIngestionSlot(jobId: string): void {
  if (activeIngestionJobId === jobId) {
    activeIngestionJobId = null;
  }
}

export function __resetOnDeviceGuardsForTests(): void {
  activeIngestionJobId = null;
  activeMainInferenceLeases.clear();
  memoryPressureAbort = false;
}
