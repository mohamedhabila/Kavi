package com.kavi.mobile.durability

import androidx.work.Data
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidDurableWorkerRunnerTest {
  @Test
  fun `a reported receipt completes the exact attempt`() = runBlocking {
    val fixture = fixture()
    val enqueued = fixture.enqueue()
    val runner = fixture.runner { payload ->
      fixture.adapter.complete(
        pointer = AndroidDurableExecutionAttemptPointer(
          payload.work.pointer(),
          payload.attempt,
        ),
        receiptDigest = RECEIPT_DIGEST,
        updatedAtMillis = 201,
      )
      AndroidDurableHeadlessDispatchResult.FINISHED
    }

    assertEquals(
      AndroidDurableWorkerResult.SUCCESS,
      runner.run(WORK_ID, input(enqueued)),
    )
    assertEquals(AndroidDurableExecutionState.COMPLETED, fixture.store.record?.state)
    assertEquals(RECEIPT_DIGEST, fixture.store.record?.receiptDigest)
    assertEquals(1, fixture.store.record?.attempt)
  }

  @Test
  fun `headless completion without a reported outcome fails closed`() = runBlocking {
    val fixture = fixture()
    val enqueued = fixture.enqueue()
    val runner = fixture.runner { AndroidDurableHeadlessDispatchResult.FINISHED }

    assertEquals(AndroidDurableWorkerResult.FAILURE, runner.run(WORK_ID, input(enqueued)))
    assertEquals(AndroidDurableExecutionState.BLOCKED, fixture.store.record?.state)
    assertEquals(AndroidDurableFailureReason.HANDLER_FAILED, fixture.store.record?.failureReason)
  }

  @Test
  fun `superseded generation completes its platform chain for a fresh candidate scan`() =
    runBlocking {
      val fixture = fixture()
      val enqueued = fixture.enqueue()
      val runner = fixture.runner { payload ->
        fixture.adapter.block(
          pointer = AndroidDurableExecutionAttemptPointer(
            payload.work.pointer(),
            payload.attempt,
          ),
          failureReason = AndroidDurableFailureReason.GENERATION_CHANGED,
          updatedAtMillis = 201,
        )
        AndroidDurableHeadlessDispatchResult.FINISHED
      }

      assertEquals(AndroidDurableWorkerResult.SUCCESS, runner.run(WORK_ID, input(enqueued)))
      assertEquals(AndroidDurableExecutionState.BLOCKED, fixture.store.record?.state)
      assertEquals(
        AndroidDurableFailureReason.GENERATION_CHANGED,
        fixture.store.record?.failureReason,
      )
    }

  @Test
  fun `transient dispatcher unavailability persists retry before asking WorkManager`() =
    runBlocking {
      val fixture = fixture()
      val enqueued = fixture.enqueue()
      val runner = fixture.runner { AndroidDurableHeadlessDispatchResult.UNAVAILABLE }

      assertEquals(AndroidDurableWorkerResult.RETRY, runner.run(WORK_ID, input(enqueued)))
      assertEquals(AndroidDurableExecutionState.RETRY_WAITING, fixture.store.record?.state)
      assertEquals(10_200L, fixture.store.record?.nextAttemptAtMillis)
      assertEquals(
        AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE,
        fixture.store.record?.failureReason,
      )
    }

  @Test
  fun `an early platform wake remains pending without consuming an attempt`() = runBlocking {
    val fixture = fixture(nowMillis = 299, earliestStartAtMillis = 300)
    val enqueued = fixture.enqueue()
    var dispatches = 0
    val runner = fixture.runner {
      dispatches += 1
      AndroidDurableHeadlessDispatchResult.FINISHED
    }

    assertEquals(AndroidDurableWorkerResult.RETRY, runner.run(WORK_ID, input(enqueued)))
    assertEquals(AndroidDurableExecutionState.ENQUEUED, fixture.store.record?.state)
    assertEquals(0, fixture.store.record?.attempt)
    assertEquals(0, dispatches)
  }

  @Test
  fun `an interrupted final attempt becomes an explicit terminal failure`() = runBlocking {
    val fixture = fixture(maxAttempts = 1, nowMillis = 300)
    val enqueued = fixture.enqueue()
    fixture.adapter.markRunning(
      pointer = pointer(enqueued),
      attempt = 1,
      updatedAtMillis = 200,
    )
    var dispatches = 0
    val runner = fixture.runner {
      dispatches += 1
      AndroidDurableHeadlessDispatchResult.FINISHED
    }

    assertEquals(AndroidDurableWorkerResult.FAILURE, runner.run(WORK_ID, input(enqueued)))
    assertEquals(AndroidDurableExecutionState.BLOCKED, fixture.store.record?.state)
    assertEquals(AndroidDurableFailureReason.RETRY_EXHAUSTED, fixture.store.record?.failureReason)
    assertEquals(0, dispatches)
  }

  @Test
  fun `durable cancellation is confirmed before any headless dispatch`() = runBlocking {
    val fixture = fixture(nowMillis = 300)
    val enqueued = fixture.enqueue()
    fixture.adapter.cancel(pointer(enqueued), updatedAtMillis = 250)
    var dispatches = 0
    val runner = fixture.runner {
      dispatches += 1
      AndroidDurableHeadlessDispatchResult.FINISHED
    }

    assertEquals(AndroidDurableWorkerResult.SUCCESS, runner.run(WORK_ID, input(enqueued)))
    assertEquals(AndroidDurableExecutionState.CANCELLED, fixture.store.record?.state)
    assertEquals(0, dispatches)
  }

  @Test
  fun `mismatched exact input fails without mutating or dispatching`() = runBlocking {
    val fixture = fixture()
    val enqueued = fixture.enqueue()
    var dispatches = 0
    val runner = fixture.runner {
      dispatches += 1
      AndroidDurableHeadlessDispatchResult.FINISHED
    }
    val mismatched = input(
      enqueued.copy(
        request = enqueued.request.copy(
          identity = enqueued.request.identity.copy(commandDigest = "c".repeat(64)),
        ),
      ),
    )

    assertEquals(AndroidDurableWorkerResult.FAILURE, runner.run(WORK_ID, mismatched))
    assertEquals(AndroidDurableExecutionState.ENQUEUED, fixture.store.record?.state)
    assertEquals(0, dispatches)
  }

  private fun fixture(
    nowMillis: Long = 200,
    earliestStartAtMillis: Long = 100,
    maxAttempts: Int = 3,
  ) = Fixture(nowMillis, earliestStartAtMillis, maxAttempts)

  private class Fixture(
    private val nowMillis: Long,
    earliestStartAtMillis: Long,
    maxAttempts: Int,
  ) {
    val store = FakeStore()
    private val scheduler = FakeScheduler()
    val adapter = AndroidDurableExecutionAdapter(store, scheduler)
    private val request = request(earliestStartAtMillis, maxAttempts)

    fun enqueue(): AndroidDurableExecutionRecord =
      (adapter.enqueue(request) as AndroidDurableAdapterResult.Accepted).record

    fun runner(
      dispatch: suspend (AndroidDurableHeadlessPayload) -> AndroidDurableHeadlessDispatchResult,
    ) = AndroidDurableWorkerRunner(
      store = store,
      adapter = adapter,
      dispatcher = AndroidDurableHeadlessDispatcher(dispatch),
      clock = { nowMillis },
    )
  }

  private class FakeStore : AndroidDurableExecutionStore {
    var record: AndroidDurableExecutionRecord? = null

    override fun read(runId: String): AndroidDurableStoreReadResult =
      record?.takeIf { it.request.identity.runId == runId }
        ?.let(AndroidDurableStoreReadResult::Found)
        ?: AndroidDurableStoreReadResult.Missing

    override fun readByWorkId(platformWorkId: String): AndroidDurableStoreReadResult =
      record?.takeIf { it.platformWorkId == platformWorkId }
        ?.let(AndroidDurableStoreReadResult::Found)
        ?: AndroidDurableStoreReadResult.Missing

    override fun listScheduling(limit: Int) = AndroidDurableStoreListResult.Records(
      listOfNotNull(record?.takeIf { it.state == AndroidDurableExecutionState.SCHEDULING }),
    )

    override fun listCancellationRequested(limit: Int) = AndroidDurableStoreListResult.Records(
      listOfNotNull(record?.takeIf {
        it.state == AndroidDurableExecutionState.CANCEL_REQUESTED
      }),
    )

    override fun compareAndSet(
      runId: String,
      expectedRevision: Long?,
      next: AndroidDurableExecutionRecord,
    ): AndroidDurableStoreWriteResult {
      if (
        record?.revision != expectedRevision ||
        next.request.identity.runId != runId
      ) {
        return AndroidDurableStoreWriteResult.CONFLICT
      }
      record = next
      return AndroidDurableStoreWriteResult.STORED
    }

    override fun deleteTerminal(
      runId: String,
      expectedRevision: Long,
    ): AndroidDurableStoreWriteResult = AndroidDurableStoreWriteResult.CONFLICT
  }

  private class FakeScheduler : AndroidDurablePlatformScheduler {
    override fun allocateWorkId(): String = WORK_ID

    override fun enqueue(spec: AndroidDurableWorkSpec) = AndroidDurableScheduleResult.ACCEPTED

    override fun cancel(platformWorkId: String) = AndroidDurableCancellationResult.ACCEPTED
  }

  private companion object {
    const val WORK_ID = "00000000-0000-4000-8000-000000000021"
    val RECEIPT_DIGEST = "d".repeat(64)

    fun request(
      earliestStartAtMillis: Long,
      maxAttempts: Int,
    ) = AndroidDurableExecutionRequest(
      durabilityClass = AndroidTaskDurabilityClass.EXTERNAL_DURABLE_OPERATION,
      identity = AndroidRecoveryCommandIdentity(
        runId = "run-worker",
        controlEpoch = 3,
        snapshotUpdatedAtMillis = 90,
        snapshotDigest = "a".repeat(64),
        commandKind = AndroidRecoveryCommandKind.RECONCILE_EXTERNAL_HANDLES,
        commandDigest = "b".repeat(64),
      ),
      constraints = AndroidExecutionConstraints(
        network = AndroidNetworkConstraint.CONNECTED,
        requiresCharging = false,
        requiresBatteryNotLow = true,
        requiresStorageNotLow = true,
        requiresDeviceIdle = false,
        earliestStartAtMillis = earliestStartAtMillis,
      ),
      retryPolicy = AndroidRetryPolicy(
        maxAttempts = maxAttempts,
        backoffPolicy = AndroidBackoffPolicy.EXPONENTIAL,
        initialBackoffMillis = 10_000,
      ),
      requestedAtMillis = 100,
    )

    fun pointer(record: AndroidDurableExecutionRecord) = AndroidDurableExecutionPointer(
      runId = record.request.identity.runId,
      controlEpoch = record.request.identity.controlEpoch,
      snapshotUpdatedAtMillis = record.request.identity.snapshotUpdatedAtMillis,
      snapshotDigest = record.request.identity.snapshotDigest,
      commandDigest = record.request.identity.commandDigest,
    )

    fun input(record: AndroidDurableExecutionRecord): Data {
      val identity = record.request.identity
      return Data.Builder()
        .putInt(ANDROID_DURABLE_WORK_INPUT_SCHEMA_KEY, ANDROID_DURABLE_WORK_INPUT_SCHEMA)
        .putString(ANDROID_DURABLE_WORK_INPUT_ID_KEY, record.platformWorkId)
        .putString(ANDROID_DURABLE_WORK_INPUT_RUN_ID_KEY, identity.runId)
        .putLong(ANDROID_DURABLE_WORK_INPUT_CONTROL_EPOCH_KEY, identity.controlEpoch)
        .putLong(
          ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_UPDATED_AT_KEY,
          identity.snapshotUpdatedAtMillis,
        )
        .putString(ANDROID_DURABLE_WORK_INPUT_SNAPSHOT_DIGEST_KEY, identity.snapshotDigest)
        .putString(ANDROID_DURABLE_WORK_INPUT_COMMAND_KIND_KEY, identity.commandKind.name)
        .putString(ANDROID_DURABLE_WORK_INPUT_COMMAND_DIGEST_KEY, identity.commandDigest)
        .build()
    }
  }
}
