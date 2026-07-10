package com.kavi.mobile.durability

import androidx.work.Data
import kotlinx.coroutines.CancellationException

internal enum class AndroidDurableWorkerResult {
  SUCCESS,
  RETRY,
  FAILURE,
}

internal class AndroidDurableWorkerRunner(
  private val store: AndroidDurableExecutionStore,
  private val adapter: AndroidDurableExecutionAdapter,
  private val dispatcher: AndroidDurableHeadlessDispatcher,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  suspend fun run(
    actualWorkId: String,
    inputData: Data,
  ): AndroidDurableWorkerResult {
    val input = AndroidDurableWorkInput.parse(inputData) ?: return AndroidDurableWorkerResult.FAILURE
    if (input.platformWorkId != actualWorkId) return AndroidDurableWorkerResult.FAILURE
    val initial = when (val read = store.readByWorkId(actualWorkId)) {
      is AndroidDurableStoreReadResult.Found -> read.record
      AndroidDurableStoreReadResult.Missing -> return AndroidDurableWorkerResult.FAILURE
      AndroidDurableStoreReadResult.Unavailable -> return AndroidDurableWorkerResult.RETRY
    }
    if (!input.matches(initial)) return AndroidDurableWorkerResult.FAILURE

    terminalWorkerResult(initial)?.let { return it }
    if (initial.state == AndroidDurableExecutionState.CANCEL_REQUESTED) {
      return confirmCancellation(input, initial)
    }
    val observedAtMillis = clock()
    if (observedAtMillis < dueAtMillis(initial)) {
      return AndroidDurableWorkerResult.RETRY
    }
    if (
      initial.state == AndroidDurableExecutionState.RUNNING &&
      initial.attempt >= initial.request.retryPolicy.maxAttempts
    ) {
      return blockInterruptedFinalAttempt(input, initial)
    }

    val running = when (
      val marked = adapter.markRunning(
        pointer = input.pointer(),
        attempt = initial.attempt + 1,
        updatedAtMillis = maxOf(observedAtMillis, initial.updatedAtMillis),
      )
    ) {
      is AndroidDurableAdapterResult.Accepted -> marked.record
      is AndroidDurableAdapterResult.Deferred -> return AndroidDurableWorkerResult.RETRY
      else -> return AndroidDurableWorkerResult.FAILURE
    }
    val attemptPointer = AndroidDurableExecutionAttemptPointer(
      generation = input.pointer(),
      attempt = running.attempt,
    )
    val dispatchResult = try {
      dispatcher.dispatch(AndroidDurableHeadlessPayload(input, running.attempt))
    } catch (cancelled: CancellationException) {
      throw cancelled
    } catch (_: Exception) {
      AndroidDurableHeadlessDispatchResult.UNAVAILABLE
    }
    val current = when (val read = store.readByWorkId(actualWorkId)) {
      is AndroidDurableStoreReadResult.Found -> read.record
      AndroidDurableStoreReadResult.Missing -> return AndroidDurableWorkerResult.FAILURE
      AndroidDurableStoreReadResult.Unavailable -> return AndroidDurableWorkerResult.RETRY
    }
    if (!input.matches(current)) return AndroidDurableWorkerResult.FAILURE
    terminalWorkerResult(current)?.let { return it }
    if (current.state == AndroidDurableExecutionState.CANCEL_REQUESTED) {
      return confirmCancellation(input, current)
    }
    if (current.state == AndroidDurableExecutionState.RETRY_WAITING) {
      return AndroidDurableWorkerResult.RETRY
    }
    if (current.state != AndroidDurableExecutionState.RUNNING) {
      return AndroidDurableWorkerResult.FAILURE
    }
    if (dispatchResult == AndroidDurableHeadlessDispatchResult.FINISHED) {
      return when (
        adapter.block(
          pointer = attemptPointer,
          failureReason = AndroidDurableFailureReason.HANDLER_FAILED,
          updatedAtMillis = transitionTime(current),
        )
      ) {
        is AndroidDurableAdapterResult.Accepted -> AndroidDurableWorkerResult.FAILURE
        is AndroidDurableAdapterResult.Deferred -> AndroidDurableWorkerResult.RETRY
        else -> AndroidDurableWorkerResult.FAILURE
      }
    }
    val retry = adapter.scheduleRetry(
      pointer = attemptPointer,
      failureReason = AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE,
      updatedAtMillis = transitionTime(current),
    )
    if (retry is AndroidDurableAdapterResult.Accepted) {
      return AndroidDurableWorkerResult.RETRY
    }
    if (retry is AndroidDurableAdapterResult.Deferred) {
      return AndroidDurableWorkerResult.RETRY
    }
    return when (
      adapter.block(
        pointer = attemptPointer,
        failureReason = AndroidDurableFailureReason.RETRY_EXHAUSTED,
        updatedAtMillis = transitionTime(current),
      )
    ) {
      is AndroidDurableAdapterResult.Accepted -> AndroidDurableWorkerResult.FAILURE
      is AndroidDurableAdapterResult.Deferred -> AndroidDurableWorkerResult.RETRY
      else -> AndroidDurableWorkerResult.FAILURE
    }
  }

  private fun confirmCancellation(
    input: AndroidDurableWorkInput,
    record: AndroidDurableExecutionRecord,
  ): AndroidDurableWorkerResult = when (
    adapter.confirmCancelled(
      pointer = AndroidDurableExecutionAttemptPointer(input.pointer(), record.attempt),
      updatedAtMillis = transitionTime(record),
    )
  ) {
    is AndroidDurableAdapterResult.Accepted,
    is AndroidDurableAdapterResult.NoOp,
    -> AndroidDurableWorkerResult.SUCCESS
    is AndroidDurableAdapterResult.Deferred -> AndroidDurableWorkerResult.RETRY
    else -> AndroidDurableWorkerResult.FAILURE
  }

  private fun terminalWorkerResult(
    record: AndroidDurableExecutionRecord,
  ): AndroidDurableWorkerResult? = when (record.state) {
    AndroidDurableExecutionState.COMPLETED,
    AndroidDurableExecutionState.CANCELLED,
    -> AndroidDurableWorkerResult.SUCCESS
    AndroidDurableExecutionState.BLOCKED ->
      if (record.failureReason == AndroidDurableFailureReason.GENERATION_CHANGED) {
        AndroidDurableWorkerResult.SUCCESS
      } else {
        AndroidDurableWorkerResult.FAILURE
      }
    else -> null
  }

  private fun blockInterruptedFinalAttempt(
    input: AndroidDurableWorkInput,
    record: AndroidDurableExecutionRecord,
  ): AndroidDurableWorkerResult = when (
    adapter.block(
      pointer = AndroidDurableExecutionAttemptPointer(input.pointer(), record.attempt),
      failureReason = AndroidDurableFailureReason.RETRY_EXHAUSTED,
      updatedAtMillis = transitionTime(record),
    )
  ) {
    is AndroidDurableAdapterResult.Accepted -> AndroidDurableWorkerResult.FAILURE
    is AndroidDurableAdapterResult.Deferred -> AndroidDurableWorkerResult.RETRY
    else -> AndroidDurableWorkerResult.FAILURE
  }

  private fun dueAtMillis(record: AndroidDurableExecutionRecord): Long = when (record.state) {
    AndroidDurableExecutionState.SCHEDULING,
    AndroidDurableExecutionState.ENQUEUED,
    -> record.request.constraints.earliestStartAtMillis
    AndroidDurableExecutionState.RETRY_WAITING ->
      record.nextAttemptAtMillis ?: Long.MAX_VALUE
    else -> 0L
  }

  private fun transitionTime(record: AndroidDurableExecutionRecord): Long =
    maxOf(clock(), record.updatedAtMillis)
}
