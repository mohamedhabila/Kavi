import XCTest

@testable import KaviDurableExecutionCore

final class IOSDurableExecutionSchedulingTests: XCTestCase {
  func testProcessingWakeHonorsIndependentEarliestStartTimes() {
    let store = InMemoryDurableStore()
    let scheduler = FakeDurableScheduler()
    let adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    for (runId, earliestStart) in [("run-1", 1_000), ("run-2", 5_000)] {
      _ = adapter.enqueue(
        durableRequest(
          runId: runId,
          durabilityClass: .externalDurableOperation,
          commandKind: .reconcileExternalHandles,
          network: .connected,
          earliestStartAtMillis: Int64(earliestStart)
        ),
        capabilities: .init(supportsContinuedProcessing: false, appIsForeground: false)
      )
    }

    guard
      case .records(let firstWake) = adapter.launchBackgroundProcessing(
        updatedAtMillis: 2_000,
        limit: 10
      )
    else {
      return XCTFail("First processing wake unavailable")
    }
    XCTAssertEqual(firstWake.map { $0.request.identity.runId }, ["run-1"])
    XCTAssertEqual(store.records["run-2"]?.state, .submitted)

    guard
      case .records(let secondWake) = adapter.launchBackgroundProcessing(
        updatedAtMillis: 5_000,
        limit: 10
      )
    else {
      return XCTFail("Second processing wake unavailable")
    }
    XCTAssertEqual(secondWake.map { $0.request.identity.runId }, ["run-2"])
  }

  func testRetryAndSubmittedProcessingRowsRemainRepairableSchedulingOutboxes() {
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
    scheduler.submitResult = .unavailable
    guard
      case .deferred = adapter.scheduleRetry(
        pointer: attemptPointer(record),
        nextAttemptAtMillis: 12_100,
        failureReason: .remoteStillPending,
        updatedAtMillis: 2_100
      )
    else {
      return XCTFail("Unavailable retry submission must remain deferred")
    }
    XCTAssertEqual(store.records["run-1"]?.state, .retryWaiting)

    scheduler.submitResult = .accepted
    guard case .completed(let retryOutcomes) = adapter.reconcileScheduling(limit: 10) else {
      return XCTFail("Retry scheduling outbox unavailable")
    }
    XCTAssertEqual(retryOutcomes.count, 1)
    XCTAssertEqual(store.records["run-1"]?.state, .retryWaiting)
    XCTAssertEqual(scheduler.submitted.count, 3)
  }

  func testRetryScheduleEnforcesExponentialBounds() {
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
      case .records(let firstAttempt) = adapter.launchBackgroundProcessing(
        updatedAtMillis: 2_000,
        limit: 1
      ), let first = firstAttempt.first
    else {
      return XCTFail("First attempt unavailable")
    }
    _ = adapter.scheduleRetry(
      pointer: attemptPointer(first),
      nextAttemptAtMillis: 12_000,
      failureReason: .transientUnavailable,
      updatedAtMillis: 2_000
    )
    guard
      case .records(let secondAttempt) = adapter.launchBackgroundProcessing(
        updatedAtMillis: 12_000,
        limit: 1
      ), let second = secondAttempt.first
    else {
      return XCTFail("Second attempt unavailable")
    }

    guard
      case .rejected(let tooSoon) = adapter.scheduleRetry(
        pointer: attemptPointer(second),
        nextAttemptAtMillis: 22_000,
        failureReason: .transientUnavailable,
        updatedAtMillis: 12_000
      )
    else {
      return XCTFail("Second retry must apply exponential backoff")
    }
    XCTAssertEqual(tooSoon, .invalidProgress)
    XCTAssertEqual(
      acceptedRecord(
        adapter.scheduleRetry(
          pointer: attemptPointer(second),
          nextAttemptAtMillis: 32_000,
          failureReason: .transientUnavailable,
          updatedAtMillis: 12_000
        )
      ).nextAttemptAtMillis,
      32_000
    )
  }
}
