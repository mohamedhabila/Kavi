import XCTest

@testable import KaviDurableExecutionCore

final class IOSDurableExecutionAdapterTests: XCTestCase {
  func testPersistsSchedulingIntentBeforePlatformSubmission() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let request = durableRequest()
    scheduler.onSubmit = { _ in
      guard case .found(let persisted) = store.read(runId: request.identity.runId) else {
        return XCTFail("Scheduling intent was not persisted")
      }
      XCTAssertEqual(persisted.state, .scheduling)
      XCTAssertEqual(persisted.revision, 0)
    }

    let result = IOSDurableExecutionAdapter(store: store, scheduler: scheduler).enqueue(
      request,
      capabilities: foregroundIOS26()
    )

    XCTAssertEqual(acceptedRecord(result).state, .submitted)
    XCTAssertEqual(scheduler.submitted.count, 1)
  }

  func testTerminalSchedulerPersistsEvidenceWithoutReportingScheduled() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    scheduler.submitResult = .terminal
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)

    guard
      case .rejected(let directReason) = adapter.enqueue(
        durableRequest(),
        capabilities: foregroundIOS26()
      )
    else {
      return XCTFail("Terminal scheduler result must not report an accepted schedule")
    }
    XCTAssertEqual(directReason, .platformTerminatedWithoutReceipt)
    XCTAssertEqual(store.records["run-1"]?.state, .blocked)
    XCTAssertEqual(
      store.records["run-1"]?.failureReason,
      .platformTerminatedWithoutReceipt
    )

    scheduler.submitResult = .unavailable
    guard
      case .deferred = adapter.enqueue(
        durableRequest(runId: "run-2"),
        capabilities: foregroundIOS26()
      )
    else {
      return XCTFail("Unavailable scheduler must retain the scheduling outbox")
    }
    scheduler.submitResult = .terminal
    guard case .completed(let outcomes) = adapter.reconcileScheduling(limit: 10),
      outcomes.count == 1,
      case .rejected(let replayReason) = outcomes[0].result
    else {
      return XCTFail("Outbox replay must preserve terminal scheduling failure")
    }
    XCTAssertEqual(replayReason, .platformTerminatedWithoutReceipt)
    XCTAssertEqual(store.records["run-2"]?.state, .blocked)
  }

  func testExactReplayIsNoOpAndConflictingIdentityIsClosed() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    let request = durableRequest()
    _ = adapter.enqueue(request, capabilities: foregroundIOS26())

    guard
      case .noOp(let replay) = adapter.enqueue(
        request,
        capabilities: foregroundIOS26()
      )
    else {
      return XCTFail("Exact replay must be a no-op")
    }
    XCTAssertEqual(replay.state, .submitted)
    XCTAssertEqual(scheduler.submitted.count, 1)

    let conflict = adapter.enqueue(
      durableRequest(commandDigest: String(repeating: "c", count: 64)),
      capabilities: foregroundIOS26()
    )
    guard case .rejected(let reason) = conflict else {
      return XCTFail("Conflicting command must be rejected")
    }
    XCTAssertEqual(reason, .commandIdentityConflict)
  }

  func testLaunchProgressCheckpointAndCompletionUseExactAttemptIdentity() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    let submitted = acceptedRecord(
      adapter.enqueue(durableRequest(), capabilities: foregroundIOS26())
    )
    let running = acceptedRecord(
      adapter.launchContinuedTask(
        taskIdentifier: submitted.taskIdentifier,
        updatedAtMillis: 2_000
      )
    )
    XCTAssertEqual(running.attempt, 1)

    let withProgress = acceptedRecord(
      adapter.reportProgress(
        pointer: attemptPointer(running),
        completed: 30,
        total: 100,
        updatedAtMillis: 2_100
      )
    )
    XCTAssertEqual(withProgress.progressCompleted, 30)
    XCTAssertEqual(scheduler.progress.count, 1)

    let nextIdentity = IOSRecoveryCommandIdentity(
      runId: "run-1",
      controlEpoch: 1,
      snapshotUpdatedAtMillis: 2_200,
      snapshotDigest: String(repeating: "c", count: 64),
      commandKind: .continueAfterToolResult,
      commandDigest: String(repeating: "d", count: 64)
    )
    let checkpointed = acceptedRecord(
      adapter.checkpoint(
        pointer: attemptPointer(withProgress),
        nextIdentity: nextIdentity,
        updatedAtMillis: 2_200
      )
    )
    XCTAssertEqual(checkpointed.request.identity, nextIdentity)
    XCTAssertEqual(checkpointed.lastCheckpointAtMillis, 2_200)

    guard
      case .rejected(let staleReason) = adapter.complete(
        pointer: attemptPointer(withProgress),
        receiptDigest: String(repeating: "e", count: 64),
        updatedAtMillis: 2_300
      )
    else {
      return XCTFail("Pre-checkpoint pointer must be stale")
    }
    XCTAssertEqual(staleReason, .staleControlEpoch)

    let completed = acceptedRecord(
      adapter.complete(
        pointer: attemptPointer(checkpointed),
        receiptDigest: String(repeating: "e", count: 64),
        updatedAtMillis: 2_300
      )
    )
    XCTAssertEqual(completed.state, .completed)
    XCTAssertEqual(completed.receiptDigest, String(repeating: "e", count: 64))
    XCTAssertEqual(scheduler.completions.last?.1, true)
  }

  func testRejectsRegressingProgressAndStaleAttempts() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    let submitted = acceptedRecord(
      adapter.enqueue(durableRequest(), capabilities: foregroundIOS26())
    )
    let running = acceptedRecord(
      adapter.launchContinuedTask(
        taskIdentifier: submitted.taskIdentifier,
        updatedAtMillis: 2_000
      )
    )
    let progressed = acceptedRecord(
      adapter.reportProgress(
        pointer: attemptPointer(running),
        completed: 20,
        total: 100,
        updatedAtMillis: 2_100
      )
    )

    for result in [
      adapter.reportProgress(
        pointer: attemptPointer(progressed),
        completed: 19,
        total: 100,
        updatedAtMillis: 2_200
      ),
      adapter.reportProgress(
        pointer: attemptPointer(progressed),
        completed: 21,
        total: 101,
        updatedAtMillis: 2_200
      ),
    ] {
      guard case .rejected(let reason) = result else {
        return XCTFail("Invalid progress must be rejected")
      }
      XCTAssertEqual(reason, .invalidProgress)
    }

    let stale = IOSDurableExecutionAttemptPointer(
      generation: pointer(progressed),
      attempt: 0
    )
    guard
      case .rejected(let staleReason) = adapter.reportProgress(
        pointer: stale,
        completed: 21,
        total: 100,
        updatedAtMillis: 2_200
      )
    else {
      return XCTFail("Stale attempt must be rejected")
    }
    XCTAssertEqual(staleReason, .staleAttempt)
  }

  func testExpirationPersistsRecoverableGenerationAndRetainsTombstone() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    let submitted = acceptedRecord(
      adapter.enqueue(durableRequest(), capabilities: foregroundIOS26())
    )
    _ = adapter.launchContinuedTask(
      taskIdentifier: submitted.taskIdentifier,
      updatedAtMillis: 2_000
    )

    guard
      case .records(let expired) = adapter.expireTask(
        taskIdentifier: submitted.taskIdentifier,
        schedulerKind: .continuedProcessing,
        updatedAtMillis: 2_100
      )
    else {
      return XCTFail("Expiration must remain persisted")
    }
    XCTAssertEqual(expired.count, 1)
    XCTAssertEqual(expired[0].state, .expired)
    XCTAssertEqual(expired[0].failureReason, .continuedProcessingInterrupted)

    guard case .records(let pending) = adapter.listPendingRecoveryRecords(limit: 10) else {
      return XCTFail("Expired record must be available for reconciliation")
    }
    XCTAssertEqual(pending, expired)
    XCTAssertNotNil(store.records["run-1"])
  }

  func testRelaunchMarksMissingContinuedRequestWithoutInventingCompletion() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    let submitted = acceptedRecord(
      adapter.enqueue(durableRequest(), capabilities: foregroundIOS26())
    )

    guard
      case .records(let interrupted) = adapter.markMissingContinuedRequest(
        taskIdentifier: submitted.taskIdentifier,
        updatedAtMillis: 2_000
      )
    else {
      return XCTFail("Missing request reconciliation unavailable")
    }
    XCTAssertEqual(interrupted.count, 1)
    XCTAssertEqual(interrupted[0].state, .expired)
    XCTAssertEqual(interrupted[0].failureReason, .platformRequestMissing)
    XCTAssertNil(interrupted[0].receiptDigest)
  }

  func testProcessingWakeDrainsIndependentDueRecords() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    for runId in ["run-1", "run-2"] {
      _ = adapter.enqueue(
        durableRequest(
          runId: runId,
          durabilityClass: .externalDurableOperation,
          commandKind: .reconcileExternalHandles,
          network: .connected
        ),
        capabilities: .init(supportsContinuedProcessing: false, appIsForeground: false)
      )
    }

    guard
      case .records(let running) = adapter.launchBackgroundProcessing(
        updatedAtMillis: 2_000,
        limit: 10
      )
    else {
      return XCTFail("Processing queue unavailable")
    }
    XCTAssertEqual(running.map { $0.request.identity.runId }, ["run-1", "run-2"])
    XCTAssertTrue(running.allSatisfy { $0.state == .running && $0.attempt == 1 })

    _ = adapter.complete(
      pointer: attemptPointer(running[0]),
      receiptDigest: String(repeating: "e", count: 64),
      updatedAtMillis: 2_100
    )
    XCTAssertEqual(scheduler.completions.last?.2, false)
    _ = adapter.complete(
      pointer: attemptPointer(running[1]),
      receiptDigest: String(repeating: "f", count: 64),
      updatedAtMillis: 2_200
    )
    XCTAssertEqual(scheduler.completions.last?.2, true)
  }

  func testProcessingExpirationOnlyInterruptsLaunchedRecords() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    for runId in ["run-1", "run-2"] {
      _ = adapter.enqueue(
        durableRequest(
          runId: runId,
          durabilityClass: .externalDurableOperation,
          commandKind: .reconcileExternalHandles,
          network: .connected
        ),
        capabilities: .init(supportsContinuedProcessing: false, appIsForeground: false)
      )
    }
    guard
      case .records(let running) = adapter.launchBackgroundProcessing(
        updatedAtMillis: 2_000,
        limit: 1
      ), running.count == 1
    else {
      return XCTFail("Processing queue unavailable")
    }

    guard
      case .records(let expired) = adapter.expireTask(
        taskIdentifier: running[0].taskIdentifier,
        schedulerKind: .backgroundProcessing,
        updatedAtMillis: 2_100
      )
    else {
      return XCTFail("Processing expiration unavailable")
    }

    XCTAssertEqual(expired.map { $0.request.identity.runId }, ["run-1"])
    XCTAssertEqual(store.records["run-1"]?.state, .expired)
    XCTAssertEqual(store.records["run-2"]?.state, .submitted)
  }

  func testProcessingRetryClosesSharedTaskAndPersistsNextWake() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    _ = adapter.enqueue(
      durableRequest(
        durabilityClass: .externalDurableOperation,
        commandKind: .reconcileExternalHandles,
        network: .connected
      ),
      capabilities: .init(supportsContinuedProcessing: false, appIsForeground: false)
    )
    guard
      case .records(let running) = adapter.launchBackgroundProcessing(
        updatedAtMillis: 2_000,
        limit: 1
      ), let record = running.first
    else {
      return XCTFail("Processing queue unavailable")
    }

    let waiting = acceptedRecord(
      adapter.scheduleRetry(
        pointer: attemptPointer(record),
        nextAttemptAtMillis: 12_100,
        failureReason: .remoteStillPending,
        updatedAtMillis: 2_100
      )
    )

    XCTAssertEqual(waiting.state, .retryWaiting)
    XCTAssertEqual(waiting.nextAttemptAtMillis, 12_100)
    XCTAssertEqual(scheduler.completions.last?.2, true)
    XCTAssertEqual(scheduler.submitted.count, 2)
  }

  func testExhaustedProcessingRetryClosesSharedTaskWithoutResubmission() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    _ = adapter.enqueue(
      durableRequest(
        durabilityClass: .externalDurableOperation,
        commandKind: .reconcileExternalHandles,
        network: .connected,
        maxAttempts: 1
      ),
      capabilities: .init(supportsContinuedProcessing: false, appIsForeground: false)
    )
    guard
      case .records(let running) = adapter.launchBackgroundProcessing(
        updatedAtMillis: 2_000,
        limit: 1
      ), let record = running.first
    else {
      return XCTFail("Processing queue unavailable")
    }

    let blocked = acceptedRecord(
      adapter.scheduleRetry(
        pointer: attemptPointer(record),
        nextAttemptAtMillis: 12_100,
        failureReason: .remoteStillPending,
        updatedAtMillis: 2_100
      )
    )

    XCTAssertEqual(blocked.state, .blocked)
    XCTAssertEqual(blocked.failureReason, .retryExhausted)
    XCTAssertEqual(scheduler.completions.last?.2, true)
    XCTAssertEqual(scheduler.submitted.count, 1)
  }

  func testCancellationIsPersistedBeforePlatformAndSharedRequestStaysForPeers() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    var records: [IOSDurableExecutionRecord] = []
    for runId in ["run-1", "run-2"] {
      records.append(
        acceptedRecord(
          adapter.enqueue(
            durableRequest(
              runId: runId,
              durabilityClass: .externalDurableOperation,
              commandKind: .reconcileExternalHandles,
              network: .connected
            ),
            capabilities: .init(supportsContinuedProcessing: false, appIsForeground: false)
          )
        )
      )
    }
    scheduler.cancellationResult = .unavailable
    guard
      case .deferred = adapter.cancel(
        pointer: pointer(records[0]),
        updatedAtMillis: 2_000
      )
    else {
      return XCTFail("Unavailable platform must defer cancellation")
    }
    XCTAssertEqual(store.records["run-1"]?.state, .cancelRequested)

    scheduler.cancellationResult = .accepted
    guard case .completed(let outcomes) = adapter.reconcileCancellationRequests(limit: 10) else {
      return XCTFail("Cancellation outbox unavailable")
    }
    XCTAssertEqual(outcomes.count, 1)
    XCTAssertEqual(store.records["run-1"]?.state, .cancelled)
    XCTAssertEqual(scheduler.cancelled.last?.1, false)
    XCTAssertEqual(store.records["run-2"]?.state, .submitted)
  }

  func testContinuedTaskRetryClosesAndRequiresNewForegroundAction() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    let submitted = acceptedRecord(
      adapter.enqueue(durableRequest(), capabilities: foregroundIOS26())
    )
    let running = acceptedRecord(
      adapter.launchContinuedTask(
        taskIdentifier: submitted.taskIdentifier,
        updatedAtMillis: 2_000
      )
    )

    guard
      case .rejected(let reason) = adapter.scheduleRetry(
        pointer: attemptPointer(running),
        nextAttemptAtMillis: 12_100,
        failureReason: .transientUnavailable,
        updatedAtMillis: 2_100
      )
    else {
      return XCTFail("Continued processing must not become an automatic background retry")
    }
    XCTAssertEqual(reason, .continuedRetryRequiresUserAction)
    XCTAssertEqual(store.records["run-1"]?.state, .blocked)
    XCTAssertEqual(scheduler.completions.last?.1, false)
  }

  func testStoreAndSchedulerFailuresRemainDeferredWithoutLosingOutbox() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    scheduler.submitResult = .unavailable
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    guard
      case .deferred(let reason) = adapter.enqueue(
        durableRequest(),
        capabilities: foregroundIOS26()
      )
    else {
      return XCTFail("Scheduler failure must defer")
    }
    XCTAssertEqual(reason, .schedulerUnavailable)
    XCTAssertEqual(store.records["run-1"]?.state, .scheduling)

    scheduler.submitResult = .accepted
    guard case .completed(let outcomes) = adapter.reconcileScheduling(limit: 10) else {
      return XCTFail("Scheduling outbox unavailable")
    }
    XCTAssertEqual(outcomes.count, 1)
    XCTAssertEqual(store.records["run-1"]?.state, .submitted)

    store.unavailable = true
    guard
      case .deferred(let storeReason) = adapter.enqueue(
        durableRequest(runId: "run-2"),
        capabilities: foregroundIOS26()
      )
    else {
      return XCTFail("Store failure must defer")
    }
    XCTAssertEqual(storeReason, .storeUnavailable)
  }

  func testOutboxQueriesFilterBeforeLimitAndDoNotHaveATombstoneCliff() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    for index in 0..<1_000 {
      let request = durableRequest(runId: "terminal-\(index)")
      store.records[request.identity.runId] = durableRecord(
        request: request,
        schedulerKind: .continuedProcessing,
        taskIdentifier: "com.kavi.test.terminal.\(index)",
        state: .completed
      )
    }
    let activeRequest = durableRequest(runId: "zz-active")
    store.records[activeRequest.identity.runId] = durableRecord(
      request: activeRequest,
      schedulerKind: .continuedProcessing,
      taskIdentifier: "com.kavi.test.active",
      state: .scheduling
    )
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)

    guard case .completed(let outcomes) = adapter.reconcileScheduling(limit: 1) else {
      return XCTFail("Scheduling outbox unavailable")
    }
    XCTAssertEqual(outcomes.map(\.runId), ["zz-active"])
    XCTAssertEqual(store.records["zz-active"]?.state, .submitted)
  }

  func testProcessingRetryQuerySelectsDueRecordBeforeApplyingLimit() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    for index in 0..<10 {
      let request = durableRequest(
        runId: "future-\(index)",
        durabilityClass: .externalDurableOperation,
        commandKind: .reconcileExternalHandles,
        network: .connected
      )
      store.records[request.identity.runId] = durableRecord(
        request: request,
        schedulerKind: .backgroundProcessing,
        taskIdentifier: "com.kavi.test.processing",
        state: .retryWaiting,
        attempt: 1,
        nextAttemptAtMillis: 50_000,
        failureReason: .remoteStillPending,
        updatedAtMillis: 2_000
      )
    }
    let dueRequest = durableRequest(
      runId: "zz-due",
      durabilityClass: .externalDurableOperation,
      commandKind: .reconcileExternalHandles,
      network: .connected
    )
    store.records[dueRequest.identity.runId] = durableRecord(
      request: dueRequest,
      schedulerKind: .backgroundProcessing,
      taskIdentifier: "com.kavi.test.processing",
      state: .retryWaiting,
      attempt: 1,
      nextAttemptAtMillis: 5_000,
      failureReason: .remoteStillPending,
      updatedAtMillis: 2_000
    )
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)

    guard
      case .records(let launched) = adapter.launchBackgroundProcessing(
        updatedAtMillis: 5_000,
        limit: 1
      )
    else {
      return XCTFail("Processing outbox unavailable")
    }
    XCTAssertEqual(launched.map { $0.request.identity.runId }, ["zz-due"])
  }

}
