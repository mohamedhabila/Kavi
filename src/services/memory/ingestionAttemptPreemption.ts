type ActiveIngestionAttempt = {
  jobId: string;
  controller: AbortController;
  completion: Promise<void>;
  resolveCompletion: () => void;
};

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

export function preemptActiveIngestionAttempt(): void {
  activeAttempt?.controller.abort();
}

export async function preemptActiveIngestionAttemptAndWait(): Promise<void> {
  while (activeAttempt) {
    const attempt = activeAttempt;
    attempt.controller.abort();
    await attempt.completion;
  }
}
