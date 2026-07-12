export class SchedulerExecutionError extends Error {
  readonly sourceError: Error;
  readonly conversationId?: string;
  readonly warnings: string[];
  conversationDurable: boolean;

  constructor(
    sourceError: Error,
    conversationId?: string,
    warnings: string[] = [],
    conversationDurable = true,
  ) {
    super(sourceError.message);
    this.name = 'SchedulerExecutionError';
    this.sourceError = sourceError;
    this.conversationId = conversationId;
    this.warnings = [...warnings];
    this.conversationDurable = conversationDurable;
  }

  addWarnings(warnings: string[]): void {
    this.warnings.push(...warnings);
  }

  markConversationNotDurable(): void {
    this.conversationDurable = false;
  }
}

export class NonRetryableSchedulerExecutionError extends SchedulerExecutionError {
  constructor(
    sourceError: Error,
    conversationId?: string,
    warnings: string[] = [],
    conversationDurable = true,
  ) {
    super(sourceError, conversationId, warnings, conversationDurable);
    this.name = 'NonRetryableSchedulerExecutionError';
  }
}

export class SchedulerAppBackgroundAbortError extends SchedulerExecutionError {
  constructor(
    sourceError: Error,
    conversationId?: string,
    warnings: string[] = [],
    conversationDurable = true,
  ) {
    super(sourceError, conversationId, warnings, conversationDurable);
    this.name = 'SchedulerAppBackgroundAbortError';
  }
}

export class SchedulerCompletionCheckpointError extends SchedulerExecutionError {
  constructor(sourceError: Error, conversationId?: string, conversationDurable = true) {
    super(sourceError, conversationId, [], conversationDurable);
    this.name = 'SchedulerCompletionCheckpointError';
  }
}

export type SchedulerProjectionBusyReason =
  | 'model_projection_intent'
  | 'owner_conflict'
  | 'unsettled_conversation_tail';

export class SchedulerProjectionBusyError extends SchedulerExecutionError {
  constructor(
    readonly reason: SchedulerProjectionBusyReason,
    conversationId: string,
  ) {
    super(new Error(`Scheduled conversation projection is busy (${reason}).`), conversationId);
    this.name = 'SchedulerProjectionBusyError';
  }
}

export class SchedulerProjectionReleaseError extends SchedulerExecutionError {
  constructor(
    sourceError: Error,
    conversationId: string,
    readonly completionPreserved: boolean,
  ) {
    super(sourceError, conversationId);
    this.name = 'SchedulerProjectionReleaseError';
  }
}

export function isSchedulerExecutionError(error: unknown): error is SchedulerExecutionError {
  return error instanceof SchedulerExecutionError;
}

export function resolveSchedulerExecutionConversationId(error: unknown): string | undefined {
  return isSchedulerExecutionError(error) && error.conversationDurable
    ? error.conversationId
    : undefined;
}

export function resolveSchedulerExecutionWarnings(error: unknown): string[] {
  return isSchedulerExecutionError(error) ? [...error.warnings] : [];
}

export function isNonRetryableSchedulerExecutionError(
  error: unknown,
): error is NonRetryableSchedulerExecutionError {
  return error instanceof NonRetryableSchedulerExecutionError;
}

export function isSchedulerAppBackgroundAbortError(
  error: unknown,
): error is SchedulerAppBackgroundAbortError {
  return error instanceof SchedulerAppBackgroundAbortError;
}

export function isSchedulerCompletionCheckpointError(
  error: unknown,
): error is SchedulerCompletionCheckpointError {
  return error instanceof SchedulerCompletionCheckpointError;
}

export function isSchedulerProjectionBusyError(
  error: unknown,
): error is SchedulerProjectionBusyError {
  return error instanceof SchedulerProjectionBusyError;
}

export function isSchedulerProjectionReleaseError(
  error: unknown,
): error is SchedulerProjectionReleaseError {
  return error instanceof SchedulerProjectionReleaseError;
}
