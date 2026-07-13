import { MAX_INGESTION_ATTEMPTS } from './onDeviceGuards';

export const INGESTION_RETRY_BASE_DELAY_MS = 15_000;
export const INGESTION_RETRY_MAX_DELAY_MS = 5 * 60_000;

export function computeNextIngestionAttemptAt(now: number, attemptCount: number): number {
  const exponent = Math.max(0, Math.min(MAX_INGESTION_ATTEMPTS - 1, attemptCount - 1));
  const delay = Math.min(
    INGESTION_RETRY_MAX_DELAY_MS,
    INGESTION_RETRY_BASE_DELAY_MS * 2 ** exponent,
  );
  return now + delay;
}
