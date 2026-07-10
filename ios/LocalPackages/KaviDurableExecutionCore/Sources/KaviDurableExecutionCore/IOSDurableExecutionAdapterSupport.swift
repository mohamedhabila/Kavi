import Foundation

extension IOSDurableExecutionAdapter {
  func finishCancellation(
    _ requested: IOSDurableExecutionRecord,
    updatedAtMillis: Int64
  ) -> IOSDurableAdapterResult {
    let cancelShared = !Self.hasOtherActiveBackgroundRecord(
      store: store,
      excludingRunId: requested.request.identity.runId
    )
    switch scheduler.cancel(Self.spec(requested), cancelSharedRequest: cancelShared) {
    case .unavailable:
      return .deferred(.schedulerUnavailable)
    case .accepted, .terminal, .missing:
      let cancelled = requested.next(
        state: .cancelled,
        nextAttemptAtMillis: .some(nil),
        failureReason: .some(nil),
        updatedAtMillis: updatedAtMillis
      )
      return write(current: requested, next: cancelled)
    }
  }

  func matchingRecords(
    taskIdentifier: String,
    states: Set<IOSDurableExecutionState>? = nil,
    schedulerKind: IOSDurableSchedulerKind? = nil,
    limit: Int
  ) -> IOSDurableStoreListResult {
    guard IOSDurableExecutionPolicy.isValidIdentifier(taskIdentifier) else {
      return .unavailable
    }
    switch store.list(
      query: .init(
        states: states,
        schedulerKind: schedulerKind,
        taskIdentifier: taskIdentifier
      ),
      limit: limit
    ) {
    case .unavailable: return .unavailable
    case .records(let records):
      return .records(records)
    }
  }

  func resolvePostScheduleConflict(
    _ request: IOSDurableExecutionRequest
  ) -> IOSDurableAdapterResult {
    switch store.read(runId: request.identity.runId) {
    case .found(let current) where current.request == request:
      return .noOp(current)
    case .found:
      return .rejected(.commandIdentityConflict)
    case .missing:
      return .deferred(.storeConflict)
    case .unavailable:
      return .deferred(.storeUnavailable)
    }
  }

  func write(
    current: IOSDurableExecutionRecord,
    next: IOSDurableExecutionRecord
  ) -> IOSDurableAdapterResult {
    switch store.compareAndSet(
      runId: current.request.identity.runId,
      expectedRevision: current.revision,
      next: next
    ) {
    case .stored: return .accepted(next)
    case .conflict: return .deferred(.storeConflict)
    case .unavailable: return .deferred(.storeUnavailable)
    }
  }

  func conflictReason(
    existing: IOSDurableExecutionRecord,
    incoming: IOSDurableExecutionRequest
  ) -> IOSDurableRejectionReason {
    let current = existing.request.identity
    let next = incoming.identity
    if next.controlEpoch < current.controlEpoch {
      return .staleControlEpoch
    }
    if next.controlEpoch == current.controlEpoch
      && (next.snapshotUpdatedAtMillis != current.snapshotUpdatedAtMillis
        || next.snapshotDigest != current.snapshotDigest
        || next.commandDigest != current.commandDigest || next.commandKind != current.commandKind)
    {
      return .commandIdentityConflict
    }
    if current == next {
      return .requestContractConflict
    }
    return existing.state.isTerminal ? .terminalGeneration : .activeOlderGeneration
  }

  static func spec(_ record: IOSDurableExecutionRecord) -> IOSDurableTaskSpec {
    IOSDurableTaskSpec(
      schedulerKind: record.schedulerKind,
      taskIdentifier: record.taskIdentifier,
      request: record.request
    )
  }

  static func hasOtherRunningBackgroundRecord(
    store: IOSDurableExecutionStore,
    excludingRunId: String
  ) -> Bool {
    guard
      case .records(let records) = store.list(
        query: .init(
          states: [.running],
          schedulerKind: .backgroundProcessing,
          excludingRunId: excludingRunId
        ),
        limit: 1
      )
    else { return true }
    return !records.isEmpty
  }

  static func isValidRetrySchedule(
    current: IOSDurableExecutionRecord,
    nextAttemptAtMillis: Int64,
    updatedAtMillis: Int64
  ) -> Bool {
    let effectiveUpdatedAt = max(current.updatedAtMillis, updatedAtMillis)
    let (delay, overflow) = nextAttemptAtMillis.subtractingReportingOverflow(effectiveUpdatedAt)
    guard !overflow, delay >= 0 else { return false }
    var minimumDelay = current.request.retryPolicy.initialBackoffMillis
    if current.attempt > 1 {
      for _ in 1..<current.attempt {
        if minimumDelay >= IOSDurableExecutionPolicy.maximumBackoffMillis / 2 {
          minimumDelay = IOSDurableExecutionPolicy.maximumBackoffMillis
          break
        }
        minimumDelay *= 2
      }
    }
    return delay >= minimumDelay
      && delay <= IOSDurableExecutionPolicy.maximumBackoffMillis
  }

  static func hasOtherActiveBackgroundRecord(
    store: IOSDurableExecutionStore,
    excludingRunId: String
  ) -> Bool {
    guard
      case .records(let records) = store.list(
        query: .init(
          states: [.scheduling, .submitted, .running, .retryWaiting, .cancelRequested],
          schedulerKind: .backgroundProcessing,
          excludingRunId: excludingRunId
        ),
        limit: 1
      )
    else { return true }
    return !records.isEmpty
  }
}
