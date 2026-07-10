package com.kavi.mobile.durability

private val SHA256_DIGEST = Regex("^[a-f0-9]{64}$")

/**
 * Persistence-first orchestration around the Android scheduler boundary.
 *
 * A scheduled wake is never execution authority. The eventual worker must call the journal
 * recovery coordinator, which revalidates the generation and cancellation state and acquires a
 * fresh single-use dispatch fence before any effect.
 */
internal class AndroidDurableExecutionAdapter(
  private val store: AndroidDurableExecutionStore,
  private val scheduler: AndroidDurablePlatformScheduler,
) {
  fun enqueue(request: AndroidDurableExecutionRequest): AndroidDurableAdapterResult {
    val decision = AndroidDurableExecutionPolicy.decide(request)
    if (decision is AndroidDurableExecutionDecision.Unsupported) {
      return AndroidDurableAdapterResult.Unsupported(decision.reason)
    }
    decision as AndroidDurableExecutionDecision.Supported

    val existing = when (val read = store.read(request.identity.runId)) {
      is AndroidDurableStoreReadResult.Found -> read.record
      AndroidDurableStoreReadResult.Missing -> null
      AndroidDurableStoreReadResult.Unavailable ->
        return AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_UNAVAILABLE)
    }
    val prepared = when (val result = prepareRecord(request, decision, existing)) {
      is PrepareResult.Prepared -> result
      is PrepareResult.Result -> return result.result
    }

    val schedulingRecord = prepared.record
    if (prepared.mustPersist) {
      when (
        store.compareAndSet(
          runId = request.identity.runId,
          expectedRevision = existing?.revision,
          next = schedulingRecord,
        )
      ) {
        AndroidDurableStoreWriteResult.STORED -> Unit
        AndroidDurableStoreWriteResult.CONFLICT ->
          return AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_CONFLICT)
        AndroidDurableStoreWriteResult.UNAVAILABLE ->
          return AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_UNAVAILABLE)
      }
    }

    val scheduleResult = scheduler.enqueue(
      AndroidDurableWorkSpec(
        schedulerKind = schedulingRecord.schedulerKind,
        uniqueWorkName = schedulingRecord.uniqueWorkName,
        request = schedulingRecord.request,
      ),
    )
    if (scheduleResult == AndroidDurableScheduleResult.UNAVAILABLE) {
      return AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.SCHEDULER_UNAVAILABLE)
    }

    val enqueued = schedulingRecord.next(
      state = AndroidDurableExecutionState.ENQUEUED,
      updatedAtMillis = maxOf(schedulingRecord.updatedAtMillis, request.requestedAtMillis),
    )
    return when (
      store.compareAndSet(
        runId = request.identity.runId,
        expectedRevision = schedulingRecord.revision,
        next = enqueued,
      )
    ) {
      AndroidDurableStoreWriteResult.STORED -> AndroidDurableAdapterResult.Accepted(enqueued)
      AndroidDurableStoreWriteResult.CONFLICT ->
        AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_CONFLICT)
      AndroidDurableStoreWriteResult.UNAVAILABLE ->
        AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_UNAVAILABLE)
    }
  }

  fun markRunning(
    pointer: AndroidDurableExecutionPointer,
    attempt: Int,
    updatedAtMillis: Long,
  ): AndroidDurableAdapterResult = updateProgress(pointer) { current ->
    if (
      current.state !in setOf(
        AndroidDurableExecutionState.ENQUEUED,
        AndroidDurableExecutionState.RETRY_WAITING,
      )
    ) {
      return@updateProgress ProgressResult.Rejected(
        AndroidDurableRejectionReason.INVALID_PROGRESS_TRANSITION,
      )
    }
    if (attempt != current.attempt + 1 || updatedAtMillis < current.updatedAtMillis) {
      return@updateProgress ProgressResult.Rejected(
        AndroidDurableRejectionReason.INVALID_PROGRESS,
      )
    }
    ProgressResult.Next(
      current.next(
        state = AndroidDurableExecutionState.RUNNING,
        attempt = attempt,
        nextAttemptAtMillis = null,
        failureReason = null,
        updatedAtMillis = updatedAtMillis,
      ),
    )
  }

  fun scheduleRetry(
    pointer: AndroidDurableExecutionPointer,
    nextAttemptAtMillis: Long,
    failureReason: AndroidDurableFailureReason,
    updatedAtMillis: Long,
  ): AndroidDurableAdapterResult = updateProgress(pointer) { current ->
    if (current.state != AndroidDurableExecutionState.RUNNING) {
      return@updateProgress ProgressResult.Rejected(
        AndroidDurableRejectionReason.INVALID_PROGRESS_TRANSITION,
      )
    }
    val minimumBackoff = exponentialBackoffMillis(current)
    if (
      current.attempt >= current.request.retryPolicy.maxAttempts ||
      failureReason != AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE ||
      updatedAtMillis < current.updatedAtMillis ||
      nextAttemptAtMillis < saturatingAdd(updatedAtMillis, minimumBackoff)
    ) {
      return@updateProgress ProgressResult.Rejected(AndroidDurableRejectionReason.INVALID_PROGRESS)
    }
    ProgressResult.Next(
      current.next(
        state = AndroidDurableExecutionState.RETRY_WAITING,
        nextAttemptAtMillis = nextAttemptAtMillis,
        failureReason = failureReason,
        updatedAtMillis = updatedAtMillis,
      ),
    )
  }

  fun complete(
    pointer: AndroidDurableExecutionPointer,
    receiptDigest: String,
    updatedAtMillis: Long,
  ): AndroidDurableAdapterResult = updateProgress(pointer) { current ->
    if (current.state != AndroidDurableExecutionState.RUNNING) {
      return@updateProgress ProgressResult.Rejected(
        AndroidDurableRejectionReason.INVALID_PROGRESS_TRANSITION,
      )
    }
    if (!SHA256_DIGEST.matches(receiptDigest) || updatedAtMillis < current.updatedAtMillis) {
      return@updateProgress ProgressResult.Rejected(AndroidDurableRejectionReason.INVALID_PROGRESS)
    }
    ProgressResult.Next(
      current.next(
        state = AndroidDurableExecutionState.COMPLETED,
        receiptDigest = receiptDigest,
        updatedAtMillis = updatedAtMillis,
      ),
    )
  }

  fun block(
    pointer: AndroidDurableExecutionPointer,
    failureReason: AndroidDurableFailureReason,
    updatedAtMillis: Long,
  ): AndroidDurableAdapterResult = updateProgress(pointer) { current ->
    if (
      current.state in TERMINAL_STATES ||
      current.state == AndroidDurableExecutionState.CANCEL_REQUESTED ||
      updatedAtMillis < current.updatedAtMillis
    ) {
      return@updateProgress ProgressResult.Rejected(
        AndroidDurableRejectionReason.INVALID_PROGRESS_TRANSITION,
      )
    }
    ProgressResult.Next(
      current.next(
        state = AndroidDurableExecutionState.BLOCKED,
        nextAttemptAtMillis = null,
        failureReason = failureReason,
        updatedAtMillis = updatedAtMillis,
      ),
    )
  }

  fun cancel(
    pointer: AndroidDurableExecutionPointer,
    updatedAtMillis: Long,
  ): AndroidDurableAdapterResult {
    val current = when (val result = readExact(pointer)) {
      is ExactRead.Found -> result.record
      is ExactRead.Result -> return result.result
    }
    if (current.state == AndroidDurableExecutionState.CANCELLED) {
      return AndroidDurableAdapterResult.NoOp(current)
    }
    if (current.state in TERMINAL_STATES) {
      return AndroidDurableAdapterResult.Rejected(AndroidDurableRejectionReason.TERMINAL_GENERATION)
    }
    if (updatedAtMillis < current.updatedAtMillis) {
      return AndroidDurableAdapterResult.Rejected(AndroidDurableRejectionReason.INVALID_PROGRESS)
    }

    val cancelRequested = if (current.state == AndroidDurableExecutionState.CANCEL_REQUESTED) {
      current
    } else {
      current.next(
        state = AndroidDurableExecutionState.CANCEL_REQUESTED,
        nextAttemptAtMillis = null,
        failureReason = null,
        updatedAtMillis = updatedAtMillis,
      ).also { next ->
        when (store.compareAndSet(pointer.runId, current.revision, next)) {
          AndroidDurableStoreWriteResult.STORED -> Unit
          AndroidDurableStoreWriteResult.CONFLICT ->
            return AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_CONFLICT)
          AndroidDurableStoreWriteResult.UNAVAILABLE ->
            return AndroidDurableAdapterResult.Deferred(
              AndroidDurableDeferReason.STORE_UNAVAILABLE,
            )
        }
      }
    }

    if (scheduler.cancel(cancelRequested.uniqueWorkName) == AndroidDurableCancellationResult.UNAVAILABLE) {
      return AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.SCHEDULER_UNAVAILABLE)
    }
    val cancelled = cancelRequested.next(
      state = AndroidDurableExecutionState.CANCELLED,
      updatedAtMillis = maxOf(updatedAtMillis, cancelRequested.updatedAtMillis),
    )
    return when (store.compareAndSet(pointer.runId, cancelRequested.revision, cancelled)) {
      AndroidDurableStoreWriteResult.STORED -> AndroidDurableAdapterResult.Accepted(cancelled)
      AndroidDurableStoreWriteResult.CONFLICT ->
        AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_CONFLICT)
      AndroidDurableStoreWriteResult.UNAVAILABLE ->
        AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_UNAVAILABLE)
    }
  }

  private fun prepareRecord(
    request: AndroidDurableExecutionRequest,
    decision: AndroidDurableExecutionDecision.Supported,
    existing: AndroidDurableExecutionRecord?,
  ): PrepareResult {
    if (existing == null) {
      return PrepareResult.Prepared(
        record = newRecord(request, decision, revision = 0),
        mustPersist = true,
      )
    }
    val incoming = request.identity
    val current = existing.request.identity
    if (incoming.controlEpoch < current.controlEpoch) {
      return PrepareResult.Result(
        AndroidDurableAdapterResult.Rejected(AndroidDurableRejectionReason.STALE_CONTROL_EPOCH),
      )
    }
    if (incoming.controlEpoch == current.controlEpoch) {
      if (
        incoming.commandDigest != current.commandDigest ||
        incoming.snapshotDigest != current.snapshotDigest ||
        incoming.commandKind != current.commandKind
      ) {
        return PrepareResult.Result(
          AndroidDurableAdapterResult.Rejected(
            AndroidDurableRejectionReason.COMMAND_IDENTITY_CONFLICT,
          ),
        )
      }
      if (request != existing.request) {
        return PrepareResult.Result(
          AndroidDurableAdapterResult.Rejected(
            AndroidDurableRejectionReason.REQUEST_CONTRACT_CONFLICT,
          ),
        )
      }
      return when (existing.state) {
        AndroidDurableExecutionState.SCHEDULING ->
          PrepareResult.Prepared(existing, mustPersist = false)
        in ACTIVE_SCHEDULED_STATES ->
          PrepareResult.Result(AndroidDurableAdapterResult.NoOp(existing))
        else -> PrepareResult.Result(
          AndroidDurableAdapterResult.Rejected(
            AndroidDurableRejectionReason.TERMINAL_GENERATION,
          ),
        )
      }
    }
    if (existing.state !in TERMINAL_STATES) {
      return PrepareResult.Result(
        AndroidDurableAdapterResult.Rejected(
          AndroidDurableRejectionReason.ACTIVE_OLDER_GENERATION,
        ),
      )
    }
    return PrepareResult.Prepared(
      record = newRecord(request, decision, revision = existing.revision + 1),
      mustPersist = true,
    )
  }

  private fun newRecord(
    request: AndroidDurableExecutionRequest,
    decision: AndroidDurableExecutionDecision.Supported,
    revision: Long,
  ) = AndroidDurableExecutionRecord(
    request = request,
    schedulerKind = decision.schedulerKind,
    uniqueWorkName = decision.uniqueWorkName,
    state = AndroidDurableExecutionState.SCHEDULING,
    attempt = 0,
    nextAttemptAtMillis = null,
    failureReason = null,
    receiptDigest = null,
    revision = revision,
    updatedAtMillis = request.requestedAtMillis,
  )

  private fun updateProgress(
    pointer: AndroidDurableExecutionPointer,
    update: (AndroidDurableExecutionRecord) -> ProgressResult,
  ): AndroidDurableAdapterResult {
    val current = when (val result = readExact(pointer)) {
      is ExactRead.Found -> result.record
      is ExactRead.Result -> return result.result
    }
    val progress = update(current)
    if (progress is ProgressResult.Rejected) {
      return AndroidDurableAdapterResult.Rejected(progress.reason)
    }
    progress as ProgressResult.Next
    return when (store.compareAndSet(pointer.runId, current.revision, progress.record)) {
      AndroidDurableStoreWriteResult.STORED -> AndroidDurableAdapterResult.Accepted(progress.record)
      AndroidDurableStoreWriteResult.CONFLICT ->
        AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_CONFLICT)
      AndroidDurableStoreWriteResult.UNAVAILABLE ->
        AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_UNAVAILABLE)
    }
  }

  private fun readExact(pointer: AndroidDurableExecutionPointer): ExactRead {
    val record = when (val result = store.read(pointer.runId)) {
      is AndroidDurableStoreReadResult.Found -> result.record
      AndroidDurableStoreReadResult.Missing ->
        return ExactRead.Result(
          AndroidDurableAdapterResult.Rejected(AndroidDurableRejectionReason.RECORD_NOT_FOUND),
        )
      AndroidDurableStoreReadResult.Unavailable ->
        return ExactRead.Result(
          AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_UNAVAILABLE),
        )
    }
    val identity = record.request.identity
    if (pointer.controlEpoch < identity.controlEpoch) {
      return ExactRead.Result(
        AndroidDurableAdapterResult.Rejected(AndroidDurableRejectionReason.STALE_CONTROL_EPOCH),
      )
    }
    if (
      pointer.controlEpoch != identity.controlEpoch ||
      pointer.snapshotUpdatedAtMillis != identity.snapshotUpdatedAtMillis ||
      pointer.snapshotDigest != identity.snapshotDigest ||
      pointer.commandDigest != identity.commandDigest
    ) {
      return ExactRead.Result(
        AndroidDurableAdapterResult.Rejected(
          AndroidDurableRejectionReason.COMMAND_IDENTITY_CONFLICT,
        ),
      )
    }
    return ExactRead.Found(record)
  }

  private fun AndroidDurableExecutionRecord.next(
    state: AndroidDurableExecutionState,
    attempt: Int = this.attempt,
    nextAttemptAtMillis: Long? = this.nextAttemptAtMillis,
    failureReason: AndroidDurableFailureReason? = this.failureReason,
    receiptDigest: String? = this.receiptDigest,
    updatedAtMillis: Long,
  ) = copy(
    state = state,
    attempt = attempt,
    nextAttemptAtMillis = nextAttemptAtMillis,
    failureReason = failureReason,
    receiptDigest = receiptDigest,
    revision = revision + 1,
    updatedAtMillis = updatedAtMillis,
  )

  private fun exponentialBackoffMillis(record: AndroidDurableExecutionRecord): Long {
    var backoff = record.request.retryPolicy.initialBackoffMillis
    repeat((record.attempt - 1).coerceAtLeast(0)) {
      backoff = (backoff * 2).coerceAtMost(WORK_MANAGER_MAX_BACKOFF_MILLIS)
    }
    return backoff
  }

  private fun saturatingAdd(value: Long, increment: Long): Long =
    if (value > Long.MAX_VALUE - increment) Long.MAX_VALUE else value + increment

  private sealed interface PrepareResult {
    data class Prepared(
      val record: AndroidDurableExecutionRecord,
      val mustPersist: Boolean,
    ) : PrepareResult

    data class Result(val result: AndroidDurableAdapterResult) : PrepareResult
  }

  private sealed interface ProgressResult {
    data class Next(val record: AndroidDurableExecutionRecord) : ProgressResult
    data class Rejected(val reason: AndroidDurableRejectionReason) : ProgressResult
  }

  private sealed interface ExactRead {
    data class Found(val record: AndroidDurableExecutionRecord) : ExactRead
    data class Result(val result: AndroidDurableAdapterResult) : ExactRead
  }

  private companion object {
    val ACTIVE_SCHEDULED_STATES = setOf(
      AndroidDurableExecutionState.ENQUEUED,
      AndroidDurableExecutionState.RUNNING,
      AndroidDurableExecutionState.RETRY_WAITING,
      AndroidDurableExecutionState.CANCEL_REQUESTED,
    )
    val TERMINAL_STATES = setOf(
      AndroidDurableExecutionState.CANCELLED,
      AndroidDurableExecutionState.COMPLETED,
      AndroidDurableExecutionState.BLOCKED,
    )
  }
}
