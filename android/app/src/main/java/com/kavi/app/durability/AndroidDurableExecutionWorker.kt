package com.kavi.mobile.durability

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

internal class AndroidDurableExecutionWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
  override suspend fun doWork(): Result = when (
    AndroidDurableExecutionRuntime.get(applicationContext).runWorker(
      platformWorkId = id.toString(),
      inputData = inputData,
    )
  ) {
    AndroidDurableWorkerResult.SUCCESS -> Result.success()
    AndroidDurableWorkerResult.RETRY -> Result.retry()
    AndroidDurableWorkerResult.FAILURE -> Result.failure()
  }
}
