package com.kavi.mobile.durability

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidSharedPreferencesDurableExecutionStoreTest {
  private lateinit var context: Context

  @Before
  fun clearStore() {
    context = ApplicationProvider.getApplicationContext()
    context.getSharedPreferences(ANDROID_DURABLE_STORE_NAME, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .commit()
  }

  @Test
  fun `a complete retry envelope survives a new store instance`() {
    val store = AndroidSharedPreferencesDurableExecutionStore(context)
    val scheduling = record()
    val enqueued = scheduling.copy(
      state = AndroidDurableExecutionState.ENQUEUED,
      revision = 1,
    )
    val running = enqueued.copy(
      state = AndroidDurableExecutionState.RUNNING,
      attempt = 1,
      revision = 2,
      updatedAtMillis = 200,
    )
    val retry = running.copy(
      state = AndroidDurableExecutionState.RETRY_WAITING,
      nextAttemptAtMillis = 10_300,
      failureReason = AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE,
      revision = 3,
      updatedAtMillis = 300,
    )

    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", null, scheduling),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", 0, enqueued),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", 1, running),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", 2, retry),
    )

    assertEquals(
      AndroidDurableStoreReadResult.Found(retry),
      AndroidSharedPreferencesDurableExecutionStore(context).read("run-1"),
    )
  }

  @Test
  fun `compare and set rejects stale revision and invalid successor`() {
    val store = AndroidSharedPreferencesDurableExecutionStore(context)
    val scheduling = record()
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", null, scheduling),
    )

    assertEquals(
      AndroidDurableStoreWriteResult.CONFLICT,
      store.compareAndSet("run-1", null, scheduling),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.CONFLICT,
      store.compareAndSet("run-1", 7, scheduling.copy(revision = 8)),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.UNAVAILABLE,
      store.compareAndSet("run-1", 0, scheduling),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.UNAVAILABLE,
      store.compareAndSet(
        "run-1",
        0,
        scheduling.copy(
          request = scheduling.request.copy(
            identity = scheduling.request.identity.copy(runId = "run-2"),
          ),
          revision = 1,
        ),
      ),
    )
    assertEquals(AndroidDurableStoreReadResult.Found(scheduling), store.read("run-1"))
  }

  @Test
  fun `unknown and malformed records fail closed without legacy decoding`() {
    val preferences = context.getSharedPreferences(
      ANDROID_DURABLE_STORE_NAME,
      Context.MODE_PRIVATE,
    )
    preferences.edit()
      .putString(androidDurableRecordKey("run-1"), "{\"schema\":2}")
      .commit()
    val store = AndroidSharedPreferencesDurableExecutionStore(context)

    assertEquals(AndroidDurableStoreReadResult.Unavailable, store.read("run-1"))
    assertEquals(
      AndroidDurableStoreWriteResult.UNAVAILABLE,
      store.compareAndSet("run-1", null, record()),
    )

    preferences.edit()
      .putString(androidDurableRecordKey("run-1"), "not-json")
      .commit()
    assertEquals(AndroidDurableStoreReadResult.Unavailable, store.read("run-1"))
  }

  private fun record() = AndroidDurableExecutionRecord(
    request = AndroidDurableExecutionRequest(
      durabilityClass = AndroidTaskDurabilityClass.EXTERNAL_DURABLE_OPERATION,
      identity = AndroidRecoveryCommandIdentity(
        runId = "run-1",
        controlEpoch = 2,
        snapshotUpdatedAtMillis = 90,
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
        earliestStartAtMillis = 100,
      ),
      retryPolicy = AndroidRetryPolicy(
        maxAttempts = 3,
        backoffPolicy = AndroidBackoffPolicy.EXPONENTIAL,
        initialBackoffMillis = 10_000,
      ),
      requestedAtMillis = 100,
    ),
    schedulerKind = AndroidDurableSchedulerKind.WORK_MANAGER_ONE_TIME,
    uniqueWorkName = "${ANDROID_DURABLE_WORK_NAME_PREFIX}run-1",
    state = AndroidDurableExecutionState.SCHEDULING,
    attempt = 0,
    nextAttemptAtMillis = null,
    failureReason = null,
    receiptDigest = null,
    revision = 0,
    updatedAtMillis = 100,
  )
}
