package com.kavi.mobile.durability

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidDurableExecutionAdapterTest {
  @Test
  fun `enqueue persists the exact work envelope before scheduling`() {
    val store = FakeStore()
    val scheduler = FakeScheduler()
    val adapter = AndroidDurableExecutionAdapter(store, scheduler)
    val request = request()
    scheduler.onEnqueue = { spec ->
      assertEquals(AndroidDurableExecutionState.SCHEDULING, store.record?.state)
      assertEquals(request, spec.request)
      assertEquals(request.constraints, store.record?.request?.constraints)
      assertEquals(request.retryPolicy, store.record?.request?.retryPolicy)
    }

    val accepted = adapter.enqueue(request).acceptedRecord()

    assertEquals(AndroidDurableExecutionState.ENQUEUED, accepted.state)
    assertEquals(request.identity, accepted.request.identity)
    assertEquals(1L, accepted.revision)
    assertEquals(listOf("store", "store"), store.events)
    assertEquals(listOf("enqueue"), scheduler.events)
  }

  @Test
  fun `an exact scheduling retry recovers without creating a second record`() {
    val store = FakeStore()
    val scheduler = FakeScheduler(enqueueResult = AndroidDurableScheduleResult.UNAVAILABLE)
    val adapter = AndroidDurableExecutionAdapter(store, scheduler)
    val request = request()

    assertEquals(
      AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.SCHEDULER_UNAVAILABLE),
      adapter.enqueue(request),
    )
    assertEquals(AndroidDurableExecutionState.SCHEDULING, store.record?.state)
    assertEquals(0L, store.record?.revision)

    scheduler.enqueueResult = AndroidDurableScheduleResult.ACCEPTED
    val accepted = adapter.enqueue(request).acceptedRecord()

    assertEquals(AndroidDurableExecutionState.ENQUEUED, accepted.state)
    assertEquals(2, scheduler.enqueued.size)
    assertEquals(1L, accepted.revision)
  }

  @Test
  fun `active exact work deduplicates without touching the scheduler`() {
    val store = FakeStore()
    val scheduler = FakeScheduler()
    val adapter = AndroidDurableExecutionAdapter(store, scheduler)
    val request = request()
    val scheduled = adapter.enqueue(request).acceptedRecord()

    assertEquals(AndroidDurableAdapterResult.NoOp(scheduled), adapter.enqueue(request))
    assertEquals(1, scheduler.enqueued.size)
  }

  @Test
  fun `epochs command identities and request contracts cannot be silently replaced`() {
    val store = FakeStore()
    val scheduler = FakeScheduler()
    val adapter = AndroidDurableExecutionAdapter(store, scheduler)
    val request = request()
    adapter.enqueue(request).acceptedRecord()

    assertRejected(
      AndroidDurableRejectionReason.STALE_CONTROL_EPOCH,
      adapter.enqueue(request(identity = identity(controlEpoch = 1))),
    )
    assertRejected(
      AndroidDurableRejectionReason.COMMAND_IDENTITY_CONFLICT,
      adapter.enqueue(request(identity = identity(commandDigest = "c".repeat(64)))),
    )
    assertRejected(
      AndroidDurableRejectionReason.REQUEST_CONTRACT_CONFLICT,
      adapter.enqueue(
        request(
          constraints = constraints(requiresCharging = true),
        ),
      ),
    )
    assertRejected(
      AndroidDurableRejectionReason.ACTIVE_OLDER_GENERATION,
      adapter.enqueue(request(identity = identity(controlEpoch = 3))),
    )
    assertEquals(1, scheduler.enqueued.size)
  }

  @Test
  fun `progress and retry state are persisted with exact identity fencing`() {
    val store = FakeStore()
    val adapter = AndroidDurableExecutionAdapter(store, FakeScheduler())
    val request = request()
    adapter.enqueue(request).acceptedRecord()
    val pointer = pointer(request.identity)

    val running = adapter.markRunning(pointer, attempt = 1, updatedAtMillis = 200).acceptedRecord()
    assertEquals(AndroidDurableExecutionState.RUNNING, running.state)
    assertEquals(1, running.attempt)

    assertRejected(
      AndroidDurableRejectionReason.INVALID_PROGRESS,
      adapter.scheduleRetry(
        pointer = pointer,
        nextAttemptAtMillis = 10_300,
        failureReason = AndroidDurableFailureReason.HANDLER_FAILED,
        updatedAtMillis = 300,
      ),
    )

    val retry = adapter.scheduleRetry(
      pointer = pointer,
      nextAttemptAtMillis = 10_300,
      failureReason = AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE,
      updatedAtMillis = 300,
    ).acceptedRecord()
    assertEquals(AndroidDurableExecutionState.RETRY_WAITING, retry.state)
    assertEquals(10_300L, retry.nextAttemptAtMillis)
    assertEquals(AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE, retry.failureReason)

    adapter.markRunning(pointer, attempt = 2, updatedAtMillis = 10_300).acceptedRecord()
    assertRejected(
      AndroidDurableRejectionReason.INVALID_PROGRESS,
      adapter.scheduleRetry(
        pointer = pointer,
        nextAttemptAtMillis = 30_299,
        failureReason = AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE,
        updatedAtMillis = 10_300,
      ),
    )
    adapter.scheduleRetry(
      pointer = pointer,
      nextAttemptAtMillis = 30_300,
      failureReason = AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE,
      updatedAtMillis = 10_300,
    ).acceptedRecord()
    adapter.markRunning(pointer, attempt = 3, updatedAtMillis = 30_300).acceptedRecord()
    val completed = adapter.complete(
      pointer = pointer,
      receiptDigest = "d".repeat(64),
      updatedAtMillis = 30_400,
    ).acceptedRecord()
    assertEquals(AndroidDurableExecutionState.COMPLETED, completed.state)
    assertEquals("d".repeat(64), completed.receiptDigest)

    assertRejected(
      AndroidDurableRejectionReason.INVALID_PROGRESS_TRANSITION,
      adapter.markRunning(pointer, attempt = 4, updatedAtMillis = 30_500),
    )
    assertRejected(
      AndroidDurableRejectionReason.STALE_CONTROL_EPOCH,
      adapter.markRunning(pointer.copy(controlEpoch = 1), 4, 30_500),
    )
    assertRejected(
      AndroidDurableRejectionReason.COMMAND_IDENTITY_CONFLICT,
      adapter.markRunning(pointer.copy(snapshotUpdatedAtMillis = 91), 4, 30_500),
    )
  }

  @Test
  fun `invalid attempts backoff and receipts fail closed`() {
    val store = FakeStore()
    val adapter = AndroidDurableExecutionAdapter(store, FakeScheduler())
    val request = request(retryPolicy = retryPolicy(maxAttempts = 1))
    adapter.enqueue(request).acceptedRecord()
    val pointer = pointer(request.identity)

    assertRejected(
      AndroidDurableRejectionReason.INVALID_PROGRESS,
      adapter.markRunning(pointer, attempt = 2, updatedAtMillis = 200),
    )
    adapter.markRunning(pointer, attempt = 1, updatedAtMillis = 200).acceptedRecord()
    assertRejected(
      AndroidDurableRejectionReason.INVALID_PROGRESS,
      adapter.scheduleRetry(
        pointer,
        nextAttemptAtMillis = 10_199,
        failureReason = AndroidDurableFailureReason.TRANSIENT_UNAVAILABLE,
        updatedAtMillis = 200,
      ),
    )
    assertRejected(
      AndroidDurableRejectionReason.INVALID_PROGRESS,
      adapter.complete(pointer, receiptDigest = "invalid", updatedAtMillis = 300),
    )
  }

  @Test
  fun `cancellation is durable before platform cancellation and fences stale progress`() {
    val store = FakeStore()
    val scheduler = FakeScheduler(cancelResult = AndroidDurableCancellationResult.UNAVAILABLE)
    val adapter = AndroidDurableExecutionAdapter(store, scheduler)
    val request = request()
    adapter.enqueue(request).acceptedRecord()
    val pointer = pointer(request.identity)

    assertEquals(
      AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.SCHEDULER_UNAVAILABLE),
      adapter.cancel(pointer, updatedAtMillis = 200),
    )
    assertEquals(AndroidDurableExecutionState.CANCEL_REQUESTED, store.record?.state)
    assertRejected(
      AndroidDurableRejectionReason.INVALID_PROGRESS_TRANSITION,
      adapter.markRunning(pointer, attempt = 1, updatedAtMillis = 201),
    )

    scheduler.cancelResult = AndroidDurableCancellationResult.NOT_FOUND
    val cancelled = adapter.cancel(pointer, updatedAtMillis = 202).acceptedRecord()
    assertEquals(AndroidDurableExecutionState.CANCELLED, cancelled.state)

    val nextRequest = request(
      identity = identity(controlEpoch = 3, snapshotDigest = "e".repeat(64)),
      requestedAtMillis = 300,
      constraints = constraints(earliestStartAtMillis = 300),
    )
    val next = adapter.enqueue(nextRequest).acceptedRecord()
    assertEquals(3L, next.request.identity.controlEpoch)
    assertEquals(AndroidDurableExecutionState.ENQUEUED, next.state)
  }

  @Test
  fun `compare and set conflict never reaches the scheduler`() {
    val store = FakeStore(forceConflict = true)
    val scheduler = FakeScheduler()
    val adapter = AndroidDurableExecutionAdapter(store, scheduler)

    assertEquals(
      AndroidDurableAdapterResult.Deferred(AndroidDurableDeferReason.STORE_CONFLICT),
      adapter.enqueue(request()),
    )
    assertTrue(scheduler.enqueued.isEmpty())
  }

  private fun AndroidDurableAdapterResult.acceptedRecord(): AndroidDurableExecutionRecord {
    assertTrue("Expected accepted result, got $this", this is AndroidDurableAdapterResult.Accepted)
    return (this as AndroidDurableAdapterResult.Accepted).record
  }

  private fun assertRejected(
    reason: AndroidDurableRejectionReason,
    result: AndroidDurableAdapterResult,
  ) {
    assertEquals(AndroidDurableAdapterResult.Rejected(reason), result)
  }

  private fun request(
    identity: AndroidRecoveryCommandIdentity = identity(),
    constraints: AndroidExecutionConstraints = constraints(),
    retryPolicy: AndroidRetryPolicy = retryPolicy(),
    requestedAtMillis: Long = 100,
  ) = AndroidDurableExecutionRequest(
    durabilityClass = AndroidTaskDurabilityClass.EXTERNAL_DURABLE_OPERATION,
    identity = identity,
    constraints = constraints,
    retryPolicy = retryPolicy,
    requestedAtMillis = requestedAtMillis,
  )

  private fun identity(
    controlEpoch: Long = 2,
    snapshotUpdatedAtMillis: Long = 90,
    snapshotDigest: String = "a".repeat(64),
    commandDigest: String = "b".repeat(64),
  ) = AndroidRecoveryCommandIdentity(
    runId = "run-1",
    controlEpoch = controlEpoch,
    snapshotUpdatedAtMillis = snapshotUpdatedAtMillis,
    snapshotDigest = snapshotDigest,
    commandKind = AndroidRecoveryCommandKind.RECONCILE_EXTERNAL_HANDLES,
    commandDigest = commandDigest,
  )

  private fun pointer(identity: AndroidRecoveryCommandIdentity) = AndroidDurableExecutionPointer(
    runId = identity.runId,
    controlEpoch = identity.controlEpoch,
    snapshotUpdatedAtMillis = identity.snapshotUpdatedAtMillis,
    snapshotDigest = identity.snapshotDigest,
    commandDigest = identity.commandDigest,
  )

  private fun constraints(
    requiresCharging: Boolean = false,
    earliestStartAtMillis: Long = 100,
  ) = AndroidExecutionConstraints(
    network = AndroidNetworkConstraint.CONNECTED,
    requiresCharging = requiresCharging,
    requiresBatteryNotLow = true,
    requiresStorageNotLow = true,
    requiresDeviceIdle = false,
    earliestStartAtMillis = earliestStartAtMillis,
  )

  private fun retryPolicy(maxAttempts: Int = 3) = AndroidRetryPolicy(
    maxAttempts = maxAttempts,
    backoffPolicy = AndroidBackoffPolicy.EXPONENTIAL,
    initialBackoffMillis = 10_000,
  )

  private class FakeStore(
    var record: AndroidDurableExecutionRecord? = null,
    var forceConflict: Boolean = false,
  ) : AndroidDurableExecutionStore {
    val events = mutableListOf<String>()

    override fun read(runId: String): AndroidDurableStoreReadResult =
      record?.let(AndroidDurableStoreReadResult::Found) ?: AndroidDurableStoreReadResult.Missing

    override fun compareAndSet(
      runId: String,
      expectedRevision: Long?,
      next: AndroidDurableExecutionRecord,
    ): AndroidDurableStoreWriteResult {
      if (forceConflict) {
        forceConflict = false
        return AndroidDurableStoreWriteResult.CONFLICT
      }
      if (record?.revision != expectedRevision || next.request.identity.runId != runId) {
        return AndroidDurableStoreWriteResult.CONFLICT
      }
      events += "store"
      record = next
      return AndroidDurableStoreWriteResult.STORED
    }
  }

  private class FakeScheduler(
    var enqueueResult: AndroidDurableScheduleResult = AndroidDurableScheduleResult.ACCEPTED,
    var cancelResult: AndroidDurableCancellationResult = AndroidDurableCancellationResult.CANCELLED,
  ) : AndroidDurablePlatformScheduler {
    val enqueued = mutableListOf<AndroidDurableWorkSpec>()
    val events = mutableListOf<String>()
    var onEnqueue: (AndroidDurableWorkSpec) -> Unit = {}

    override fun enqueue(spec: AndroidDurableWorkSpec): AndroidDurableScheduleResult {
      events += "enqueue"
      enqueued += spec
      onEnqueue(spec)
      return enqueueResult
    }

    override fun cancel(uniqueWorkName: String): AndroidDurableCancellationResult {
      events += "cancel"
      return cancelResult
    }
  }
}
