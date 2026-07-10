package com.kavi.mobile.durability

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.BackoffPolicy
import androidx.work.Configuration
import androidx.work.NetworkType
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidDurableWorkManagerSchedulerTest {
  private lateinit var context: Context
  private lateinit var workManager: WorkManager
  private lateinit var scheduler: AndroidWorkManagerDurablePlatformScheduler

  @Before
  fun initializeWorkManager() {
    context = ApplicationProvider.getApplicationContext()
    WorkManagerTestInitHelper.initializeTestWorkManager(
      context,
      Configuration.Builder().build(),
    )
    workManager = WorkManager.getInstance(context)
    scheduler = AndroidWorkManagerDurablePlatformScheduler(
      context = context,
      workManager = workManager,
      clock = { NOW_MILLIS },
    )
  }

  @After
  fun closeWorkManager() {
    WorkManagerTestInitHelper.closeWorkDatabase()
  }

  @Test
  fun `request maps the exact finite contract without hidden defaults`() {
    val spec = spec()

    val request = scheduler.buildWorkRequest(spec, NOW_MILLIS)
    val workSpec = request.workSpec

    assertEquals(UUID.fromString(WORK_ID), request.id)
    assertEquals(
      setOf(
        AndroidDurableExecutionWorker::class.java.name,
        ANDROID_DURABLE_WORK_TAG,
        UNIQUE_WORK_NAME,
      ),
      request.tags,
    )
    assertEquals(5_000L, workSpec.initialDelay)
    assertEquals(0L, workSpec.intervalDuration)
    assertFalse(workSpec.isPeriodic)
    assertFalse(workSpec.expedited)
    assertEquals(BackoffPolicy.EXPONENTIAL, workSpec.backoffPolicy)
    assertEquals(10_000L, workSpec.backoffDelayDuration)
    assertEquals(NetworkType.UNMETERED, workSpec.constraints.requiredNetworkType)
    assertTrue(workSpec.constraints.requiresCharging())
    assertTrue(workSpec.constraints.requiresBatteryNotLow())
    assertTrue(workSpec.constraints.requiresStorageNotLow())
    assertFalse(workSpec.constraints.requiresDeviceIdle())
    assertEquals(
      AndroidDurableWorkInput(WORK_ID, spec.request.identity),
      AndroidDurableWorkInput.parse(request.workSpec.input),
    )
  }

  @Test
  fun `exact enqueue deduplicates and rejects another active work id`() {
    val exact = spec()

    assertEquals(AndroidDurableScheduleResult.ACCEPTED, scheduler.enqueue(exact))
    assertEquals(AndroidDurableScheduleResult.ACCEPTED, scheduler.enqueue(exact))
    assertEquals(
      AndroidDurableScheduleResult.CONFLICT,
      scheduler.enqueue(spec(platformWorkId = OTHER_WORK_ID)),
    )

    val infos = workManager.getWorkInfosForUniqueWork(UNIQUE_WORK_NAME).get()
    assertEquals(1, infos.size)
    assertEquals(UUID.fromString(WORK_ID), infos.single().id)
  }

  @Test
  fun `exact cancellation is terminal and missing ids are explicit`() {
    assertEquals(AndroidDurableCancellationResult.MISSING, scheduler.cancel(WORK_ID))
    assertEquals(AndroidDurableScheduleResult.ACCEPTED, scheduler.enqueue(spec()))

    assertEquals(AndroidDurableCancellationResult.TERMINAL, scheduler.cancel(WORK_ID))
    assertEquals(AndroidDurableScheduleResult.TERMINAL, scheduler.enqueue(spec()))
    assertEquals(
      androidx.work.WorkInfo.State.CANCELLED,
      workManager.getWorkInfoById(UUID.fromString(WORK_ID)).get()?.state,
    )
  }

  @Test
  fun `input parser rejects extra malformed and noncanonical fields`() {
    val valid = scheduler.buildWorkRequest(spec(), NOW_MILLIS).workSpec.input
    assertTrue(AndroidDurableWorkInput.parse(valid) != null)

    assertNull(
      AndroidDurableWorkInput.parse(
        androidx.work.Data.Builder()
          .putAll(valid)
          .putString("unexpected", "field")
          .build(),
      ),
    )
    assertNull(
      AndroidDurableWorkInput.parse(
        androidx.work.Data.Builder()
          .putAll(valid)
          .putString(ANDROID_DURABLE_WORK_INPUT_COMMAND_KIND_KEY, "reconcile_external_handles")
          .build(),
      ),
    )
    assertNull(
      AndroidDurableWorkInput.parse(
        androidx.work.Data.Builder()
          .putAll(valid)
          .putString(ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_DIGEST_KEY, "A".repeat(64))
          .build(),
      ),
    )
    assertNull(
      AndroidDurableWorkInput.parse(
        androidx.work.Data.Builder()
          .putAll(valid)
          .putString(
            ANDROID_DURABLE_WORK_INPUT_ID_KEY,
            "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          )
          .build(),
      ),
    )
  }

  private fun spec(
    platformWorkId: String = WORK_ID,
  ) = AndroidDurableWorkSpec(
    schedulerKind = AndroidDurableSchedulerKind.WORK_MANAGER_ONE_TIME,
    uniqueWorkName = UNIQUE_WORK_NAME,
    platformWorkId = platformWorkId,
    request = AndroidDurableExecutionRequest(
      durabilityClass = AndroidTaskDurabilityClass.EXTERNAL_DURABLE_OPERATION,
      identity = AndroidRecoveryCommandIdentity(
        runId = "run-work-manager",
        controlEpoch = 7,
        snapshotUpdatedAtMillis = 900,
        snapshotDigest = "a".repeat(64),
        commandKind = AndroidRecoveryCommandKind.RECONCILE_EXTERNAL_HANDLES,
        commandDigest = "b".repeat(64),
      ),
      constraints = AndroidExecutionConstraints(
        network = AndroidNetworkConstraint.UNMETERED,
        requiresCharging = true,
        requiresBatteryNotLow = true,
        requiresStorageNotLow = true,
        requiresDeviceIdle = false,
        earliestStartAtMillis = NOW_MILLIS + 5_000,
      ),
      retryPolicy = AndroidRetryPolicy(
        maxAttempts = 3,
        backoffPolicy = AndroidBackoffPolicy.EXPONENTIAL,
        initialBackoffMillis = 10_000,
      ),
      requestedAtMillis = NOW_MILLIS,
    ),
  )

  private companion object {
    const val NOW_MILLIS = 1_000L
    const val UNIQUE_WORK_NAME = "${ANDROID_DURABLE_WORK_NAME_PREFIX}run-work-manager"
    const val WORK_ID = "00000000-0000-4000-8000-000000000011"
    const val OTHER_WORK_ID = "00000000-0000-4000-8000-000000000012"
  }
}
