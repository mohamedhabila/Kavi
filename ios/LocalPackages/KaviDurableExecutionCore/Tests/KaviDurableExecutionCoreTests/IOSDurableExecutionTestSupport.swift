import Foundation

@testable import KaviDurableExecutionCore

final class InMemoryDurableStore: IOSDurableExecutionStore, @unchecked Sendable {
  var records: [String: IOSDurableExecutionRecord] = [:]
  var unavailable = false
  private let lock = NSLock()

  func read(runId: String) -> IOSDurableStoreReadResult {
    locked {
      if unavailable { return .unavailable }
      return records[runId].map(IOSDurableStoreReadResult.found) ?? .missing
    }
  }

  func list(
    query: IOSDurableStoreQuery,
    limit: Int
  ) -> IOSDurableStoreListResult {
    locked {
      if unavailable { return .unavailable }
      return .records(
        Array(
          records.values.filter(query.matches).sorted {
            $0.request.identity.runId < $1.request.identity.runId
          }.prefix(limit)
        )
      )
    }
  }

  func compareAndSet(
    runId: String,
    expectedRevision: Int64?,
    next: IOSDurableExecutionRecord
  ) -> IOSDurableStoreWriteResult {
    locked {
      if unavailable { return .unavailable }
      if let expectedRevision {
        guard records[runId]?.revision == expectedRevision else { return .conflict }
      } else if records[runId] != nil {
        return .conflict
      }
      records[runId] = next
      return .stored
    }
  }

  func deleteTerminal(
    runId: String,
    expectedRevision: Int64
  ) -> IOSDurableStoreWriteResult {
    locked {
      if unavailable { return .unavailable }
      guard let record = records[runId],
        record.revision == expectedRevision,
        record.state.isTerminal
      else {
        return .conflict
      }
      records.removeValue(forKey: runId)
      return .stored
    }
  }

  private func locked<T>(_ operation: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return operation()
  }
}

final class FakeDurableScheduler: IOSDurablePlatformScheduler, @unchecked Sendable {
  var submitResult = IOSDurableScheduleResult.accepted
  var cancellationResult = IOSDurableCancellationResult.accepted
  var progressResult = IOSDurableSettlementResult.accepted
  var completionResult = IOSDurableSettlementResult.accepted
  var submitted: [IOSDurableTaskSpec] = []
  var cancelled: [(IOSDurableTaskSpec, Bool)] = []
  var progress: [(IOSDurableTaskSpec, Int64, Int64)] = []
  var completions: [(IOSDurableTaskSpec, Bool, Bool)] = []
  var onSubmit: ((IOSDurableTaskSpec) -> Void)?

  func taskIdentifier(kind: IOSDurableSchedulerKind, runId: String) -> String? {
    switch kind {
    case .continuedProcessing: return "com.kavi.test.continued.\(runId)"
    case .backgroundProcessing: return "com.kavi.test.processing"
    }
  }

  func submit(_ spec: IOSDurableTaskSpec) -> IOSDurableScheduleResult {
    onSubmit?(spec)
    submitted.append(spec)
    return submitResult
  }

  func cancel(
    _ spec: IOSDurableTaskSpec,
    cancelSharedRequest: Bool
  ) -> IOSDurableCancellationResult {
    cancelled.append((spec, cancelSharedRequest))
    return cancellationResult
  }

  func updateProgress(
    _ spec: IOSDurableTaskSpec,
    completed: Int64,
    total: Int64
  ) -> IOSDurableSettlementResult {
    progress.append((spec, completed, total))
    return progressResult
  }

  func complete(
    _ spec: IOSDurableTaskSpec,
    success: Bool,
    completeSharedTask: Bool
  ) -> IOSDurableSettlementResult {
    completions.append((spec, success, completeSharedTask))
    return completionResult
  }
}

func durableRequest(
  runId: String = "run-1",
  durabilityClass: IOSTaskDurabilityClass = .userInitiatedContinuable,
  commandKind: IOSRecoveryCommandKind = .reconcileExternalHandles,
  controlEpoch: Int64 = 0,
  snapshotUpdatedAtMillis: Int64 = 900,
  snapshotDigest: String = String(repeating: "a", count: 64),
  commandDigest: String = String(repeating: "b", count: 64),
  network: IOSNetworkConstraint = .notRequired,
  requiresCharging: Bool = false,
  earliestStartAtMillis: Int64 = 1_000,
  requestedAtMillis: Int64 = 1_000,
  maxAttempts: Int = 3
) -> IOSDurableExecutionRequest {
  IOSDurableExecutionRequest(
    durabilityClass: durabilityClass,
    identity: .init(
      runId: runId,
      controlEpoch: controlEpoch,
      snapshotUpdatedAtMillis: snapshotUpdatedAtMillis,
      snapshotDigest: snapshotDigest,
      commandKind: commandKind,
      commandDigest: commandDigest
    ),
    constraints: .init(
      network: network,
      requiresCharging: requiresCharging,
      requiresBatteryNotLow: false,
      requiresStorageNotLow: false,
      requiresDeviceIdle: false,
      earliestStartAtMillis: earliestStartAtMillis
    ),
    retryPolicy: .init(
      maxAttempts: maxAttempts,
      backoffPolicy: .exponential,
      initialBackoffMillis: 10_000
    ),
    requestedAtMillis: requestedAtMillis
  )
}

func durableRecord(
  request: IOSDurableExecutionRequest,
  schedulerKind: IOSDurableSchedulerKind,
  taskIdentifier: String,
  state: IOSDurableExecutionState,
  attempt: Int = 0,
  nextAttemptAtMillis: Int64? = nil,
  failureReason: IOSDurableFailureReason? = nil,
  revision: Int64 = 0,
  updatedAtMillis: Int64 = 1_000
) -> IOSDurableExecutionRecord {
  IOSDurableExecutionRecord(
    request: request,
    schedulerKind: schedulerKind,
    taskIdentifier: taskIdentifier,
    state: state,
    attempt: attempt,
    nextAttemptAtMillis: nextAttemptAtMillis,
    failureReason: failureReason,
    receiptDigest: nil,
    progressCompleted: nil,
    progressTotal: nil,
    lastCheckpointAtMillis: nil,
    revision: revision,
    updatedAtMillis: updatedAtMillis
  )
}

func foregroundIOS26() -> IOSDurablePlatformCapabilities {
  .init(
    supportsContinuedProcessing: true,
    appIsForeground: true,
    requestTimestampIsFresh: true
  )
}

func acceptedRecord(_ result: IOSDurableAdapterResult) -> IOSDurableExecutionRecord {
  guard case .accepted(let record) = result else {
    fatalError("Expected accepted record, got \(result)")
  }
  return record
}

func pointer(_ record: IOSDurableExecutionRecord) -> IOSDurableExecutionPointer {
  IOSDurableExecutionPointer(record.request.identity)
}

func attemptPointer(
  _ record: IOSDurableExecutionRecord
) -> IOSDurableExecutionAttemptPointer {
  .init(generation: pointer(record), attempt: record.attempt)
}
