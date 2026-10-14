package com.kavi.mobile.scheduler

import androidx.work.WorkManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

internal const val KAVI_SCHEDULED_JOBS_MODULE_NAME = "KaviScheduledJobs"

/** Lets the JS scheduler keep the background run for its earliest due task scheduled. */
internal class KaviScheduledJobsModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "kavi-scheduled-jobs-bridge")
  }
  private val scheduler by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
    KaviScheduledJobsWakeScheduler(WorkManager.getInstance(reactContext.applicationContext))
  }

  override fun getName(): String = KAVI_SCHEDULED_JOBS_MODULE_NAME

  @ReactMethod
  fun scheduleRun(atMillis: Double, promise: Promise) {
    if (!atMillis.isFinite() || atMillis <= 0.0) {
      promise.reject(ERROR_CONTRACT, "atMillis must be a positive finite timestamp")
      return
    }
    submit(promise) { scheduler.schedule(atMillis.toLong()) }
  }

  @ReactMethod
  fun cancelRun(promise: Promise) = submit(promise) { scheduler.cancel() }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  private fun submit(promise: Promise, operation: () -> Unit) {
    try {
      executor.execute {
        try {
          operation()
          promise.resolve(null)
        } catch (error: Exception) {
          promise.reject(ERROR_SCHEDULE, error.message ?: error.javaClass.simpleName, error)
        }
      }
    } catch (error: RejectedExecutionException) {
      promise.reject(ERROR_SCHEDULE, "the scheduled-jobs bridge is shut down", error)
    }
  }

  private companion object {
    const val ERROR_CONTRACT = "KAVI_SCHEDULED_JOBS_CONTRACT"
    const val ERROR_SCHEDULE = "KAVI_SCHEDULED_JOBS_SCHEDULE_FAILED"
  }
}
