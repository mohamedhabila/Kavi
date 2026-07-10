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
  activeMainInferenceLeases.set(token, normalizedOwnerId);
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
  memoryPressureAbort = active;
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
