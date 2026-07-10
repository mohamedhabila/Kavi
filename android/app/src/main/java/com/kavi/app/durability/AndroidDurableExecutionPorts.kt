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
  val snapshotUpdatedAtMillis: Long,
  val snapshotDigest: String,
  val commandDigest: String,
)

internal data class AndroidDurableExecutionAttemptPointer(
  val generation: AndroidDurableExecutionPointer,
  val attempt: Int,
)

internal sealed interface AndroidDurableStoreReadResult {
  data class Found(val record: AndroidDurableExecutionRecord) : AndroidDurableStoreReadResult
  data object Missing : AndroidDurableStoreReadResult
  data object Unavailable : AndroidDurableStoreReadResult
}

internal sealed interface AndroidDurableStoreListResult {
  data class Records(
    val records: List<AndroidDurableExecutionRecord>,
  ) : AndroidDurableStoreListResult

  data object Unavailable : AndroidDurableStoreListResult
}

internal enum class AndroidDurableStoreWriteResult {
  STORED,
  CONFLICT,
  UNAVAILABLE,
}

/**
 * The implementation must atomically compare and persist one complete record. Terminal records
 * remain deduplication tombstones until the journal retention owner explicitly releases them.
 */
internal interface AndroidDurableExecutionStore {
  fun read(runId: String): AndroidDurableStoreReadResult

  /** Lists persisted outbox rows that may have crashed before platform enqueue. */
  fun listScheduling(limit: Int): AndroidDurableStoreListResult

  /** Lists persisted cancellation rows that may need platform cancellation replay. */
  fun listCancellationRequested(limit: Int): AndroidDurableStoreListResult

  fun compareAndSet(
    runId: String,
    expectedRevision: Long?,
    next: AndroidDurableExecutionRecord,
  ): AndroidDurableStoreWriteResult

  /** Deletes only an exact terminal revision after authoritative journal retention is confirmed. */
  fun deleteTerminal(
    runId: String,
    expectedRevision: Long,
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
  ACCEPTED,
  NOT_FOUND,
  UNAVAILABLE,
}

/**
 * The concrete scheduler must make enqueue idempotent for an exact work name and must not execute
 * a command before re-reading its journal generation, authority, cancellation state, and fence.
 * It must serialize invocations of one unique work request; a later platform rerun advances the
 * persisted attempt before dispatch so an interrupted RUNNING record can be recovered safely. It
 * must map every stored constraint, initial delay, and exponential backoff to one non-expedited,
 * non-periodic WorkManager request. Device-idle requests are rejected by policy because
 * WorkManager cannot combine idle-mode jobs with an explicit backoff policy.
 */
internal interface AndroidDurablePlatformScheduler {
  fun enqueue(spec: AndroidDurableWorkSpec): AndroidDurableScheduleResult

  /** ACCEPTED means the platform recorded cancellation, not that running code has already stopped. */
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
  STALE_ATTEMPT,
}

internal enum class AndroidDurableDeferReason {
  STORE_UNAVAILABLE,
  STORE_CONFLICT,
  SCHEDULER_UNAVAILABLE,
}

internal sealed interface AndroidDurableAdapterResult {
  data class Accepted(val record: AndroidDurableExecutionRecord) : AndroidDurableAdapterResult
  data class NoOp(val record: AndroidDurableExecutionRecord) : AndroidDurableAdapterResult
  data class Released(val terminalRecord: AndroidDurableExecutionRecord) : AndroidDurableAdapterResult
  data class Unsupported(
    val reason: AndroidDurableUnsupportedReason,
  ) : AndroidDurableAdapterResult
  data class Rejected(val reason: AndroidDurableRejectionReason) : AndroidDurableAdapterResult
  data class Deferred(val reason: AndroidDurableDeferReason) : AndroidDurableAdapterResult
}

internal data class AndroidDurableOutboxReconciliationOutcome(
  val runId: String,
  val result: AndroidDurableAdapterResult,
)

internal sealed interface AndroidDurableOutboxReconciliationResult {
  data class Completed(
    val outcomes: List<AndroidDurableOutboxReconciliationOutcome>,
  ) : AndroidDurableOutboxReconciliationResult

  data object StoreUnavailable : AndroidDurableOutboxReconciliationResult
}
