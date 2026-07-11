export class NonRetryableSchedulerExecutionError extends Error {
  readonly sourceError: Error;

  constructor(sourceError: Error) {
    super(sourceError.message);
    this.name = 'NonRetryableSchedulerExecutionError';
    this.sourceError = sourceError;
  }
}

export function isNonRetryableSchedulerExecutionError(
  error: unknown,
): error is NonRetryableSchedulerExecutionError {
  return error instanceof NonRetryableSchedulerExecutionError;
}
