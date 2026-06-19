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
let mainInferenceActive = false;
let memoryPressureAbort = false;

export function setMainInferenceActive(active: boolean): void {
  mainInferenceActive = active;
}

export function setMemoryPressureAbort(active: boolean): void {
  memoryPressureAbort = active;
}

export function isMainInferenceActive(): boolean {
  return mainInferenceActive;
}

export function shouldAbortIngestionDueToMemoryPressure(): boolean {
  return memoryPressureAbort;
}

export function canStartIngestionJob(): boolean {
  if (memoryPressureAbort) return false;
  if (mainInferenceActive) return false;
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
  mainInferenceActive = false;
  memoryPressureAbort = false;
}