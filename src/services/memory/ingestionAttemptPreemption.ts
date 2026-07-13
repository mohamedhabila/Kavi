type ActiveIngestionAttempt = {
  jobId: string;
  controller: AbortController;
  completion: Promise<void>;
  foregroundPreemptible: boolean;
  resolveCompletion: () => void;
};

export type ActiveIngestionPreemptionReason = 'foreground_inference' | 'memory_pressure';

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
