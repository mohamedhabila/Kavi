package com.kavi.mobile.scheduler

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.kavi.mobile.durability.AndroidDurableHeadlessDispatchResult
import com.kavi.mobile.durability.AndroidReactHeadlessRecoveryDispatcher
import java.util.concurrent.TimeUnit

internal const val KAVI_SCHEDULED_JOBS_WORK_TAG = "kavi.scheduled-jobs.v1"

/**
 * Keeps exactly one pending WorkManager job, due when the earliest scheduled task is. Each due
 * time gets its own unique work name, so moving the schedule cancels only the pending job and
 * never the one running now (whose run is what moves the schedule).
 */
internal class KaviScheduledJobsWakeScheduler(
  private val workManager: WorkManager,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  fun schedule(atMillis: Long) {
    val name = uniqueWorkName(atMillis)
    cancelPending(except = name)
    workManager.enqueueUniqueWork(name, ExistingWorkPolicy.KEEP, buildWorkRequest(atMillis))
  }

  fun cancel() = cancelPending(except = null)

  internal fun buildWorkRequest(atMillis: Long): OneTimeWorkRequest =
    OneTimeWorkRequestBuilder<KaviScheduledJobsWorker>()
      .setInitialDelay((atMillis - clock()).coerceAtLeast(0L), TimeUnit.MILLISECONDS)
      .addTag(KAVI_SCHEDULED_JOBS_WORK_TAG)
      .addTag(uniqueWorkName(atMillis))
      .build()

  private fun cancelPending(except: String?) {
    workManager.getWorkInfosByTag(KAVI_SCHEDULED_JOBS_WORK_TAG).get()
      .filter { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED }
      .filter { except == null || except !in it.tags }
      .forEach { workManager.cancelWorkById(it.id) }
  }

  companion object {
    fun uniqueWorkName(atMillis: Long) = "kavi.scheduled-jobs@$atMillis"
  }
}

/** Runs the due scheduled tasks headlessly; the JS scheduler owns retries and the next wake. */
internal class KaviScheduledJobsRunner(
  private val dispatch: suspend () -> AndroidDurableHeadlessDispatchResult,
) {
  suspend fun run(runAttemptCount: Int): KaviScheduledJobsRunOutcome = when (dispatch()) {
    AndroidDurableHeadlessDispatchResult.FINISHED,
    AndroidDurableHeadlessDispatchResult.TIMED_OUT,
    -> KaviScheduledJobsRunOutcome.DONE
    AndroidDurableHeadlessDispatchResult.UNAVAILABLE ->
      if (runAttemptCount + 1 >= MAX_ATTEMPTS) {
        KaviScheduledJobsRunOutcome.GIVE_UP
      } else {
        KaviScheduledJobsRunOutcome.RETRY
      }
  }

  private companion object {
    const val MAX_ATTEMPTS = 3
  }
}

internal enum class KaviScheduledJobsRunOutcome { DONE, RETRY, GIVE_UP }

internal class KaviScheduledJobsWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
  override suspend fun doWork(): Result {
    val dispatcher = AndroidReactHeadlessRecoveryDispatcher(applicationContext)
    return when (KaviScheduledJobsRunner(dispatcher::dispatchScheduledJobs).run(runAttemptCount)) {
      KaviScheduledJobsRunOutcome.DONE -> Result.success()
      KaviScheduledJobsRunOutcome.RETRY -> Result.retry()
      KaviScheduledJobsRunOutcome.GIVE_UP -> Result.failure()
    }
  }
}
