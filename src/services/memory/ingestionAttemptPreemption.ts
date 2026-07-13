import { unrefTimerIfSupported } from '../../utils/timers';

type ActiveIngestionAttempt = {
  jobId: string;
  controller: AbortController;
  completion: Promise<void>;
  foregroundPreemptible: boolean;
  resolveCompletion: () => void;
};

export type ActiveIngestionPreemptionReason = 'foreground_inference' | 'memory_pressure';

export type ExactActiveIngestionPreemptionResult =
  | 'not_active'
  | 'released'
  | 'timed_out';

export const MAX_EXACT_INGESTION_PREEMPTION_WAIT_MS = 30_000;

let activeAttempt: ActiveIngestionAttempt | null = null;

export function beginActiveIngestionAttempt(jobId: string): ActiveIngestionAttempt {
  let resolveCompletion: () => void = () => undefined;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const attempt = {
    jobId,
    controller: new AbortController(),
    completion,
    foregroundPreemptible: true,
    resolveCompletion,
  };
  activeAttempt = attempt;
  return attempt;
}

export function finishActiveIngestionAttempt(attempt: ActiveIngestionAttempt): void {
  if (activeAttempt === attempt) {
    activeAttempt = null;
  }
  attempt.resolveCompletion();
}

export function protectActiveRemoteIngestionAttemptFromForeground(
  attempt: ActiveIngestionAttempt,
): boolean {
  if (activeAttempt !== attempt || attempt.controller.signal.aborted) return false;
  attempt.foregroundPreemptible = false;
  return true;
}

export function preemptActiveIngestionAttempt(reason: ActiveIngestionPreemptionReason): boolean {
  const attempt = activeAttempt;
  if (!attempt) return false;
  if (reason === 'foreground_inference' && !attempt.foregroundPreemptible) return false;
  attempt.controller.abort();
  return true;
}

export async function preemptActiveIngestionAttemptAndWait(): Promise<void> {
  while (activeAttempt) {
    const attempt = activeAttempt;
    attempt.controller.abort();
    await attempt.completion;
  }
}

/** Abort only the exact local ingestion owner and bound the release wait. */
export async function preemptActiveIngestionAttemptForJobAndWait(input: {
  jobId: string;
  timeoutMs: number;
}): Promise<ExactActiveIngestionPreemptionResult> {
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > MAX_EXACT_INGESTION_PREEMPTION_WAIT_MS
  ) {
    throw new Error('memory_ingestion_preemption_wait_invalid');
  }
  const attempt = activeAttempt;
  if (!attempt || attempt.jobId !== input.jobId) return 'not_active';

  attempt.controller.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      attempt.completion.then(() => 'released' as const),
      new Promise<'timed_out'>((resolve) => {
        timeout = setTimeout(() => resolve('timed_out'), input.timeoutMs);
        unrefTimerIfSupported(timeout);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
