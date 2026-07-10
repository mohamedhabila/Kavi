package com.kavi.mobile.durability

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

internal class AndroidDurableCandidateWakeWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
  override suspend fun doWork(): Result = when (
    AndroidDurableExecutionRuntime.get(applicationContext).runCandidateWake(
      actualWakeWorkId = id.toString(),
      inputData = inputData,
      runAttemptCount = runAttemptCount,
    )
  ) {
    AndroidDurableWorkerResult.SUCCESS -> Result.success()
    AndroidDurableWorkerResult.RETRY -> Result.retry()
    AndroidDurableWorkerResult.FAILURE -> Result.failure()
  }
}

internal class AndroidDurableCandidateWakeRunner(
  private val dispatcher: AndroidDurableCandidateHeadlessDispatcher,
  private val tracker: AndroidDurableCandidateWakeTracker,
) {
  suspend fun run(
    actualWakeWorkId: String,
    inputData: androidx.work.Data,
    runAttemptCount: Int,
  ): AndroidDurableWorkerResult {
    val input = AndroidDurableCandidateWakeInput.parse(inputData, actualWakeWorkId)
      ?: return AndroidDurableWorkerResult.FAILURE
    if (!tracker.start(input.wakeWorkId, input.predecessorWorkId, input.runId)) {
      return retryOrFail(runAttemptCount)
    }
    return try {
      val dispatch = dispatcher.dispatchCandidateWake(
        AndroidDurableCandidateHeadlessPayload(
          wakeWorkId = input.wakeWorkId,
          predecessorWorkId = input.predecessorWorkId,
          runId = input.runId,
        ),
      )
      if (dispatch != AndroidDurableHeadlessDispatchResult.FINISHED) {
        return retryOrFail(runAttemptCount)
      }
      when (tracker.consume(input.wakeWorkId, input.runId)) {
        AndroidDurableCandidateWakeOutcome.COMPLETED -> AndroidDurableWorkerResult.SUCCESS
        AndroidDurableCandidateWakeOutcome.RETRY,
        null,
        -> retryOrFail(runAttemptCount)
      }
    } finally {
      tracker.discard(input.wakeWorkId, input.runId)
    }
  }

  private fun retryOrFail(runAttemptCount: Int): AndroidDurableWorkerResult =
    if (runAttemptCount + 1 >= MAX_ATTEMPTS) {
      AndroidDurableWorkerResult.FAILURE
    } else {
      AndroidDurableWorkerResult.RETRY
    }

  private companion object {
    const val MAX_ATTEMPTS = 5
  }
}
