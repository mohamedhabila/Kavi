package com.kavi.mobile.durability

internal enum class AndroidDurableExecutionState {
  SCHEDULING,
  ENQUEUED,
  RUNNING,
  RETRY_WAITING,
  CANCEL_REQUESTED,
  CANCELLED,
  COMPLETED,
  BLOCKED,
}

internal enum class AndroidDurableFailureReason {
  TRANSIENT_UNAVAILABLE,
  GENERATION_CHANGED,
  AUTHORITY_CHANGED,
  HANDLER_REJECTED,
  HANDLER_FAILED,
  RETRY_EXHAUSTED,
}

internal data class AndroidDurableExecutionRecord(
  val request: AndroidDurableExecutionRequest,
  val schedulerKind: AndroidDurableSchedulerKind,
  val uniqueWorkName: String,
  val state: AndroidDurableExecutionState,
  val attempt: Int,
  val nextAttemptAtMillis: Long?,
  val failureReason: AndroidDurableFailureReason?,
  val receiptDigest: String?,
  val revision: Long,
  val updatedAtMillis: Long,
)

internal data class AndroidDurableExecutionPointer(
  val runId: String,
  val controlEpoch: Long,
  val snapshotDigest: String,
  val commandDigest: String,
)

internal sealed interface AndroidDurableStoreReadResult {
  data class Found(val record: AndroidDurableExecutionRecord) : AndroidDurableStoreReadResult
  data object Missing : AndroidDurableStoreReadResult
  data object Unavailable : AndroidDurableStoreReadResult
}

internal enum class AndroidDurableStoreWriteResult {
  STORED,
  CONFLICT,
  UNAVAILABLE,
}

/** The implementation must atomically compare and persist one complete record. */
internal interface AndroidDurableExecutionStore {
  fun read(runId: String): AndroidDurableStoreReadResult

  fun compareAndSet(
    runId: String,
    expectedRevision: Long?,
    next: AndroidDurableExecutionRecord,
  ): AndroidDurableStoreWriteResult
}

internal data class AndroidDurableWorkSpec(
  val schedulerKind: AndroidDurableSchedulerKind,
  val uniqueWorkName: String,
  val request: AndroidDurableExecutionRequest,
)

internal enum class AndroidDurableScheduleResult {
  ACCEPTED,
  UNAVAILABLE,
}

internal enum class AndroidDurableCancellationResult {
  CANCELLED,
  NOT_FOUND,
  UNAVAILABLE,
}

/**
 * The concrete scheduler must make enqueue idempotent for an exact work name and must not execute
 * a command before re-reading its journal generation, authority, cancellation state, and fence.
 */
internal interface AndroidDurablePlatformScheduler {
  fun enqueue(spec: AndroidDurableWorkSpec): AndroidDurableScheduleResult

  fun cancel(uniqueWorkName: String): AndroidDurableCancellationResult
}

internal enum class AndroidDurableRejectionReason {
  STALE_CONTROL_EPOCH,
  COMMAND_IDENTITY_CONFLICT,
  REQUEST_CONTRACT_CONFLICT,
  ACTIVE_OLDER_GENERATION,
  TERMINAL_GENERATION,
  RECORD_NOT_FOUND,
  INVALID_PROGRESS_TRANSITION,
  INVALID_PROGRESS,
}

internal enum class AndroidDurableDeferReason {
  STORE_UNAVAILABLE,
  STORE_CONFLICT,
  SCHEDULER_UNAVAILABLE,
}

internal sealed interface AndroidDurableAdapterResult {
  data class Accepted(val record: AndroidDurableExecutionRecord) : AndroidDurableAdapterResult
  data class NoOp(val record: AndroidDurableExecutionRecord) : AndroidDurableAdapterResult
  data class Unsupported(
    val reason: AndroidDurableUnsupportedReason,
  ) : AndroidDurableAdapterResult
  data class Rejected(val reason: AndroidDurableRejectionReason) : AndroidDurableAdapterResult
  data class Deferred(val reason: AndroidDurableDeferReason) : AndroidDurableAdapterResult
}
