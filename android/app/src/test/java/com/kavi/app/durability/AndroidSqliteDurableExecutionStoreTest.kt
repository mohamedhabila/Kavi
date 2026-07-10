package com.kavi.mobile.durability

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import java.io.File
import java.util.Collections
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidSqliteDurableExecutionStoreTest {
  private lateinit var context: Context
  private val openedStores = mutableListOf<AndroidSqliteDurableExecutionStore>()

  @Before
  fun clearStore() {
    context = ApplicationProvider.getApplicationContext()
    SQLiteDatabase.deleteDatabase(databaseFile())
    corruptionMarker().delete()
  }

  @After
  fun closeStores() {
    openedStores.forEach(AndroidSqliteDurableExecutionStore::close)
    openedStores.clear()
    SQLiteDatabase.deleteDatabase(databaseFile())
    corruptionMarker().delete()
  }

  @Test
  fun `a complete retry envelope survives a new store instance`() {
    val store = store()
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
      store().read("run-1"),
    )
    assertEquals(
      AndroidDurableStoreReadResult.Found(retry),
      store().readByWorkId(retry.platformWorkId),
    )
  }

  @Test
  fun `one platform work id cannot belong to two runs`() {
    val store = store()
    val first = record(runId = "run-1")
    val conflicting = record(runId = "run-2", platformWorkId = first.platformWorkId)

    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", null, first),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.CONFLICT,
      store.compareAndSet("run-2", null, conflicting),
    )
    assertEquals(
      AndroidDurableStoreReadResult.Found(first),
      store.readByWorkId(first.platformWorkId),
    )
  }

  @Test
  fun `scheduling outbox rows are listed deterministically and with a bound`() {
    val store = store()
    val later = record(runId = "run-2", updatedAtMillis = 200)
    val earlier = record(runId = "run-1", updatedAtMillis = 100)
    val alreadyEnqueued = record(runId = "run-3", updatedAtMillis = 150).copy(
      state = AndroidDurableExecutionState.ENQUEUED,
    )
    val cancellationRequested = record(runId = "run-4", updatedAtMillis = 125).copy(
      state = AndroidDurableExecutionState.CANCEL_REQUESTED,
    )
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-2", null, later),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", null, earlier),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-3", null, alreadyEnqueued),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-4", null, cancellationRequested),
    )

    assertEquals(
      AndroidDurableStoreListResult.Records(listOf(earlier)),
      store.listScheduling(1),
    )
    assertEquals(
      AndroidDurableStoreListResult.Records(listOf(earlier, later)),
      store.listScheduling(10),
    )
    assertEquals(AndroidDurableStoreListResult.Unavailable, store.listScheduling(0))
    assertEquals(
      AndroidDurableStoreListResult.Records(listOf(cancellationRequested)),
      store.listCancellationRequested(10),
    )
  }

  @Test
  fun `compare and set rejects stale revision and invalid successor`() {
    val store = store()
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
          state = AndroidDurableExecutionState.BLOCKED,
          failureReason = AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE,
          revision = 1,
        ),
      ),
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
  fun `malformed row fails closed and cannot be overwritten`() {
    val first = store()
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      first.compareAndSet("run-1", null, record()),
    )
    first.close()
    openedStores.remove(first)

    SQLiteDatabase.openDatabase(
      databaseFile().path,
      null,
      SQLiteDatabase.OPEN_READWRITE,
    ).use { database ->
      database.execSQL(
        "UPDATE durable_execution_records SET record_json = ? WHERE run_id = ?",
        arrayOf("{\"schema\":2}", "run-1"),
      )
    }
    val reopened = store()

    assertEquals(AndroidDurableStoreReadResult.Unavailable, reopened.read("run-1"))
    assertEquals(
      AndroidDurableStoreWriteResult.UNAVAILABLE,
      reopened.compareAndSet("run-1", 0, record().copy(revision = 1)),
    )
  }

  @Test
  fun `indexed record metadata cannot diverge from the durable envelope`() {
    val first = store()
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      first.compareAndSet("run-1", null, record()),
    )
    first.close()
    openedStores.remove(first)

    SQLiteDatabase.openDatabase(
      databaseFile().path,
      null,
      SQLiteDatabase.OPEN_READWRITE,
    ).use { database ->
      database.execSQL(
        "UPDATE durable_execution_records SET state = ? WHERE run_id = ?",
        arrayOf(AndroidDurableExecutionState.COMPLETED.name, "run-1"),
      )
    }

    assertEquals(AndroidDurableStoreReadResult.Unavailable, store().read("run-1"))
  }

  @Test
  fun `persisted corruption evidence blocks every later access`() {
    val store = store()
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", null, record()),
    )
    assertTrue(corruptionMarker().createNewFile())

    assertEquals(AndroidDurableStoreReadResult.Unavailable, store.read("run-1"))
    assertEquals(
      AndroidDurableStoreWriteResult.UNAVAILABLE,
      store.compareAndSet(
        "run-1",
        0,
        record().copy(state = AndroidDurableExecutionState.ENQUEUED, revision = 1),
      ),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.UNAVAILABLE,
      store.deleteTerminal("run-1", 0),
    )
    assertEquals(
      AndroidDurableStoreReadResult.Unavailable,
      AndroidSqliteDurableExecutionStore(context).use { it.read("run-1") },
    )
  }

  @Test
  fun `two helpers serialize compare and set across one database`() {
    val first = store()
    val second = store()
    val initial = record()
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      first.compareAndSet("run-1", null, initial),
    )
    val ready = CountDownLatch(2)
    val start = CountDownLatch(1)
    val results = Collections.synchronizedList(mutableListOf<AndroidDurableStoreWriteResult>())
    val threads = listOf(first, second).mapIndexed { index, candidate ->
      Thread {
        ready.countDown()
        start.await()
        results += candidate.compareAndSet(
          "run-1",
          0,
          initial.copy(
            state = AndroidDurableExecutionState.ENQUEUED,
            revision = 1,
            updatedAtMillis = 101L + index,
          ),
        )
      }.apply { start() }
    }
    assertTrue(ready.await(5, TimeUnit.SECONDS))
    start.countDown()
    threads.forEach { it.join(5_000) }

    assertEquals(1, results.count { it == AndroidDurableStoreWriteResult.STORED })
    assertEquals(1, results.count { it == AndroidDurableStoreWriteResult.CONFLICT })
    assertTrue(threads.none { it.isAlive })
  }

  @Test
  fun `database is isolated under no backup storage`() {
    val store = store()
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", null, record()),
    )

    assertTrue(databaseFile().exists())
    assertEquals(context.noBackupFilesDir.canonicalFile, databaseFile().canonicalFile.parentFile)
    assertTrue(
      !File(
        context.applicationInfo.dataDir,
        "databases/$ANDROID_DURABLE_DATABASE_NAME",
      ).exists(),
    )
  }

  @Test
  fun `only exact terminal revisions can be released`() {
    val store = store()
    val scheduling = record()
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", null, scheduling),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.CONFLICT,
      store.deleteTerminal("run-1", 0),
    )
    val terminal = scheduling.copy(
      state = AndroidDurableExecutionState.BLOCKED,
      failureReason = AndroidDurableFailureReason.HANDLER_FAILED,
      revision = 1,
      updatedAtMillis = 200,
    )
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.compareAndSet("run-1", 0, terminal),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.CONFLICT,
      store.deleteTerminal("run-1", 0),
    )
    assertEquals(
      AndroidDurableStoreWriteResult.STORED,
      store.deleteTerminal("run-1", 1),
    )
    assertEquals(AndroidDurableStoreReadResult.Missing, store.read("run-1"))
  }

  private fun store() = AndroidSqliteDurableExecutionStore(context).also(openedStores::add)

  private fun databaseFile() = File(context.noBackupFilesDir, ANDROID_DURABLE_DATABASE_NAME)

  private fun corruptionMarker() = File(
    context.noBackupFilesDir,
    ANDROID_DURABLE_CORRUPTION_MARKER_NAME,
  )

  private fun record(
    runId: String = "run-1",
    updatedAtMillis: Long = 100,
    platformWorkId: String = UUID.nameUUIDFromBytes(runId.toByteArray()).toString(),
  ) = AndroidDurableExecutionRecord(
    request = AndroidDurableExecutionRequest(
      durabilityClass = AndroidTaskDurabilityClass.EXTERNAL_DURABLE_OPERATION,
      identity = AndroidRecoveryCommandIdentity(
        runId = runId,
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
    uniqueWorkName = "$ANDROID_DURABLE_WORK_NAME_PREFIX$runId",
    platformWorkId = platformWorkId,
    state = AndroidDurableExecutionState.SCHEDULING,
    attempt = 0,
    nextAttemptAtMillis = null,
    failureReason = null,
    receiptDigest = null,
    revision = 0,
    updatedAtMillis = updatedAtMillis,
  )
}
