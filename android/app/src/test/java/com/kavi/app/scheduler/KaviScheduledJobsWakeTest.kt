package com.kavi.mobile.scheduler

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import com.kavi.mobile.durability.AndroidDurableHeadlessDispatchResult
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class KaviScheduledJobsWakeTest {
  private lateinit var context: Context
  private lateinit var workManager: WorkManager
  private lateinit var scheduler: KaviScheduledJobsWakeScheduler

  @Before
  fun initializeWorkManager() {
    context = ApplicationProvider.getApplicationContext()
    WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().build())
    workManager = WorkManager.getInstance(context)
    scheduler = KaviScheduledJobsWakeScheduler(workManager, clock = { NOW_MILLIS })
  }

  @After
  fun closeWorkManager() {
    WorkManagerTestInitHelper.closeWorkDatabase()
  }

  @Test
  fun `a run is due when the earliest scheduled task is`() {
    val request = scheduler.buildWorkRequest(NOW_MILLIS + 90_000L)

    assertEquals(90_000L, request.workSpec.initialDelay)
    assertTrue(KAVI_SCHEDULED_JOBS_WORK_TAG in request.tags)
    assertTrue(KaviScheduledJobsWakeScheduler.uniqueWorkName(NOW_MILLIS + 90_000L) in request.tags)
  }

  @Test
  fun `a past due time runs at once`() {
    assertEquals(0L, scheduler.buildWorkRequest(NOW_MILLIS - 5_000L).workSpec.initialDelay)
  }

  @Test
  fun `moving the schedule leaves exactly one pending run, at the new time`() {
    scheduler.schedule(NOW_MILLIS + 60_000L)
    scheduler.schedule(NOW_MILLIS + 120_000L)

    assertEquals(listOf(NOW_MILLIS + 120_000L), pendingRunTimes())
  }

  @Test
  fun `scheduling the same time again keeps the one pending run`() {
    scheduler.schedule(NOW_MILLIS + 60_000L)
    val first = pendingWork().single().id
    scheduler.schedule(NOW_MILLIS + 60_000L)

    assertEquals(listOf(first), pendingWork().map { it.id })
  }

  @Test
  fun `cancel clears the pending run`() {
    scheduler.schedule(NOW_MILLIS + 60_000L)
    scheduler.cancel()

    assertEquals(emptyList<Long>(), pendingRunTimes())
  }

  @Test
  fun `a finished or timed-out run is done, the scheduler owning retries and the next wake`() =
    runBlocking {
      for (result in listOf(
        AndroidDurableHeadlessDispatchResult.FINISHED,
        AndroidDurableHeadlessDispatchResult.TIMED_OUT,
      )) {
        assertEquals(
          KaviScheduledJobsRunOutcome.DONE,
          KaviScheduledJobsRunner { result }.run(runAttemptCount = 0),
        )
      }
    }

  @Test
  fun `a runtime that cannot start is retried, then given up`() = runBlocking {
    val unavailable = KaviScheduledJobsRunner { AndroidDurableHeadlessDispatchResult.UNAVAILABLE }

    assertEquals(KaviScheduledJobsRunOutcome.RETRY, unavailable.run(runAttemptCount = 0))
    assertEquals(KaviScheduledJobsRunOutcome.RETRY, unavailable.run(runAttemptCount = 1))
    assertEquals(KaviScheduledJobsRunOutcome.GIVE_UP, unavailable.run(runAttemptCount = 2))
  }

  private fun pendingWork(): List<WorkInfo> =
    workManager.getWorkInfosByTag(KAVI_SCHEDULED_JOBS_WORK_TAG).get()
      .filter { it.state == WorkInfo.State.ENQUEUED }

  private fun pendingRunTimes(): List<Long> = pendingWork().map { info ->
    info.tags.single { it.startsWith("kavi.scheduled-jobs@") }.substringAfter('@').toLong()
  }

  private companion object {
    const val NOW_MILLIS = 1_800_000_000_000L
  }
}
