import Foundation

public final class IOSDurableExecutionAdapter: @unchecked Sendable {
  let store: IOSDurableExecutionStore
  let scheduler: IOSDurablePlatformScheduler

  public init(
    store: IOSDurableExecutionStore,
    scheduler: IOSDurablePlatformScheduler
  ) {
    self.store = store
    self.scheduler = scheduler
  }

  public func enqueue(
    _ request: IOSDurableExecutionRequest,
    capabilities: IOSDurablePlatformCapabilities
  ) -> IOSDurableAdapterResult {
    let decision = IOSDurableExecutionPolicy.decide(request, capabilities: capabilities)
    guard let schedulerKind = decision.schedulerKind else {
      return .unsupported(decision.unsupportedReason ?? .invalidRequest)
    }

    let existing: IOSDurableExecutionRecord?
    switch store.read(runId: request.identity.runId) {
    case .found(let record): existing = record
    case .missing: existing = nil
    case .unavailable: return .deferred(.storeUnavailable)
    }
    if let existing {
      if existing.request == request {
        switch existing.state {
        case .scheduling:
          return submit(existing)
        case .submitted, .running, .retryWaiting, .cancelRequested:
          return .noOp(existing)
        case .cancelled, .completed, .expired, .blocked:
          return .rejected(.terminalGeneration)
        }
      }
      return .rejected(conflictReason(existing: existing, incoming: request))
    }

    guard
      let taskIdentifier = scheduler.taskIdentifier(
        kind: schedulerKind,
        runId: request.identity.runId
      ), IOSDurableExecutionPolicy.isValidIdentifier(taskIdentifier)
    else {
      return .deferred(.schedulerUnavailable)
    }
    let scheduling = IOSDurableExecutionRecord(
      request: request,
      schedulerKind: schedulerKind,
      taskIdentifier: taskIdentifier,
      state: .scheduling,
      attempt: 0,
      nextAttemptAtMillis: nil,
      failureReason: nil,
      receiptDigest: nil,
      progressCompleted: nil,
      progressTotal: nil,
      lastCheckpointAtMillis: nil,
      revision: 0,
      updatedAtMillis: request.requestedAtMillis
    )
    switch store.compareAndSet(
      runId: request.identity.runId,
      expectedRevision: nil,
      next: scheduling
    ) {
    case .stored: return submit(scheduling)
    case .conflict: return .deferred(.storeConflict)
    case .unavailable: return .deferred(.storeUnavailable)
    }
  }

  public func reconcileScheduling(limit: Int) -> IOSDurableOutboxResult {
    guard limit >= 1 && limit <= 1_000 else { return .storeUnavailable }
    guard
      case .records(let scheduling) = store.list(
        query: .init(states: [.scheduling]),
        limit: limit
      )
    else {
      return .storeUnavailable
    }
    let remaining = limit - scheduling.count
    let processing: [IOSDurableExecutionRecord]
    if remaining > 0 {
      guard
        case .records(let records) = store.list(
          query: .init(
            states: [.submitted, .retryWaiting],
            schedulerKind: .backgroundProcessing
          ),
          limit: remaining
        )
      else {
        return .storeUnavailable
      }
      processing = records
    } else {
      processing = []
    }
    return .completed(
      (scheduling + processing).map { record in
        IOSDurableOutboxOutcome(
          runId: record.request.identity.runId,
          result: reconcileSchedulingRecord(record)
        )
      }
    )
  }

  public func reconcileCancellationRequests(limit: Int) -> IOSDurableOutboxResult {
    switch store.list(query: .init(states: [.cancelRequested]), limit: limit) {
    case .unavailable:
      return .storeUnavailable
    case .records(let records):
      return .completed(
        records.map { record in
          IOSDurableOutboxOutcome(
            runId: record.request.identity.runId,
            result: finishCancellation(record, updatedAtMillis: record.updatedAtMillis)
          )
        }
      )
    }
  }

  public func listPendingRecoveryRecords(limit: Int) -> IOSDurableStoreListResult {
    switch store.list(query: .init(states: [.running, .expired]), limit: limit) {
    case .unavailable:
      return .unavailable
    case .records(let records):
      return .records(records)
    }
  }

  public func launchContinuedTask(
    taskIdentifier: String,
    updatedAtMillis: Int64
  ) -> IOSDurableAdapterResult {
    switch matchingRecords(taskIdentifier: taskIdentifier, limit: 1_000) {
    case .unavailable: return .deferred(.storeUnavailable)
    case .records(let records):
      guard records.count == 1,
        records[0].schedulerKind == .continuedProcessing
      else {
        return .rejected(.recordNotFound)
      }
      return markRunning(records[0], updatedAtMillis: updatedAtMillis)
    }
  }

  public func launchBackgroundProcessing(
    updatedAtMillis: Int64,
    limit: Int
  ) -> IOSDurableStoreListResult {
    guard limit >= 1 && limit <= 1_000 else { return .unavailable }
    let immediateResult = store.list(
      query: .init(
        states: [.scheduling, .submitted],
        schedulerKind: .backgroundProcessing,
        earliestStartAtOrBeforeMillis: updatedAtMillis
      ),
      limit: limit
    )
    guard case .records(let immediate) = immediateResult else { return .unavailable }
    let remaining = limit - immediate.count
    let retries: [IOSDurableExecutionRecord]
    if remaining > 0 {
      let retryResult = store.list(
        query: .init(
          states: [.retryWaiting],
          schedulerKind: .backgroundProcessing,
          nextAttemptAtOrBeforeMillis: updatedAtMillis
        ),
        limit: remaining
      )
      guard case .records(let dueRetries) = retryResult else { return .unavailable }
      retries = dueRetries
    } else {
      retries = []
    }
    var launched: [IOSDurableExecutionRecord] = []
    for record in immediate + retries {
      if case .accepted(let running) = markRunning(record, updatedAtMillis: updatedAtMillis) {
        launched.append(running)
      }
    }
    return .records(launched)
  }

  public func reportProgress(
    pointer: IOSDurableExecutionAttemptPointer,
    completed: Int64,
    total: Int64,
    updatedAtMillis: Int64
  ) -> IOSDurableAdapterResult {
    guard total > 0, completed >= 0, completed <= total else {
      return .rejected(.invalidProgress)
    }
    return updateRunning(pointer) { current in
      if let previousTotal = current.progressTotal, previousTotal != total {
        return .result(.rejected(.invalidProgress))
      }
      if let previousCompleted = current.progressCompleted, completed < previousCompleted {
        return .result(.rejected(.invalidProgress))
      }
      let next = current.next(
        progressCompleted: .some(completed),
        progressTotal: .some(total),
        updatedAtMillis: updatedAtMillis
      )
      return .record(next) { [scheduler] in
        scheduler.updateProgress(
          Self.spec(next),
          completed: completed,
          total: total
        ) == .accepted ? nil : .deferred(.schedulerUnavailable)
      }
    }
  }

  public func checkpoint(
    pointer: IOSDurableExecutionAttemptPointer,
    nextIdentity: IOSRecoveryCommandIdentity,
    updatedAtMillis: Int64
  ) -> IOSDurableAdapterResult {
    updateRunning(pointer) { current in
      let previous = current.request.identity
      guard IOSDurableExecutionPolicy.isValidIdentity(nextIdentity),
        nextIdentity.commandKind == .reconcileExternalHandles,
        nextIdentity.runId == previous.runId,
        nextIdentity.controlEpoch >= previous.controlEpoch,
        nextIdentity.snapshotUpdatedAtMillis >= previous.snapshotUpdatedAtMillis,
        nextIdentity.snapshotUpdatedAtMillis <= updatedAtMillis,
        nextIdentity.controlEpoch > previous.controlEpoch
          || nextIdentity.snapshotUpdatedAtMillis > previous.snapshotUpdatedAtMillis
          || nextIdentity == previous
      else {
        return .result(.rejected(.invalidCheckpoint))
      }
      return .record(
        current.next(
          request: current.request.replacingIdentity(nextIdentity),
          lastCheckpointAtMillis: .some(updatedAtMillis),
          updatedAtMillis: updatedAtMillis
        )
      )
    }
  }

  public func cancel(
    pointer: IOSDurableExecutionPointer,
    updatedAtMillis: Int64
  ) -> IOSDurableAdapterResult {
    let current: IOSDurableExecutionRecord
    switch store.read(runId: pointer.runId) {
    case .missing: return .rejected(.recordNotFound)
    case .unavailable: return .deferred(.storeUnavailable)
    case .found(let record): current = record
    }
    guard pointer.matches(current.request.identity) else {
      return .rejected(
        pointer.controlEpoch < current.request.identity.controlEpoch
          ? .staleControlEpoch : .commandIdentityConflict)
    }
    if current.state == .cancelled {
      return .noOp(current)
    }
    guard !current.state.isTerminal else {
      return .rejected(.terminalGeneration)
    }
    let requested = current.next(
      state: .cancelRequested,
      updatedAtMillis: updatedAtMillis
    )
    switch store.compareAndSet(
      runId: pointer.runId,
      expectedRevision: current.revision,
      next: requested
    ) {
    case .conflict: return .deferred(.storeConflict)
    case .unavailable: return .deferred(.storeUnavailable)
    case .stored: return finishCancellation(requested, updatedAtMillis: updatedAtMillis)
    }
  }

  public func complete(
    pointer: IOSDurableExecutionAttemptPointer,
    receiptDigest: String,
    updatedAtMillis: Int64
  ) -> IOSDurableAdapterResult {
    guard IOSDurableExecutionPolicy.isSHA256Digest(receiptDigest) else {
      return .rejected(.invalidProgress)
    }
    return settleRunning(
      pointer: pointer,
      state: .completed,
      failureReason: nil,
      receiptDigest: receiptDigest,
      success: true,
      updatedAtMillis: updatedAtMillis
    )
  }

  public func block(
    pointer: IOSDurableExecutionAttemptPointer,
    failureReason: IOSDurableFailureReason,
    updatedAtMillis: Int64
  ) -> IOSDurableAdapterResult {
    settleRunning(
      pointer: pointer,
      state: .blocked,
      failureReason: failureReason,
      receiptDigest: nil,
      success: false,
      updatedAtMillis: updatedAtMillis
    )
  }

  public func scheduleRetry(
    pointer: IOSDurableExecutionAttemptPointer,
    nextAttemptAtMillis: Int64,
    failureReason: IOSDurableFailureReason,
    updatedAtMillis: Int64
  ) -> IOSDurableAdapterResult {
    guard failureReason.isRetryable else {
      return .rejected(.invalidProgress)
    }
    return updateRunning(pointer) { current in
      guard
        Self.isValidRetrySchedule(
          current: current,
          nextAttemptAtMillis: nextAttemptAtMillis,
          updatedAtMillis: updatedAtMillis
        )
      else {
        return .result(.rejected(.invalidProgress))
      }
      guard current.schedulerKind == .backgroundProcessing else {
        return .record(
          current.next(
            state: .blocked,
            failureReason: .some(failureReason),
            updatedAtMillis: updatedAtMillis
          )
        ) { [scheduler] in
          _ = scheduler.complete(
            Self.spec(current),
            success: false,
            completeSharedTask: true
          )
          return .rejected(.continuedRetryRequiresUserAction)
        }
      }
      guard current.attempt < current.request.retryPolicy.maxAttempts else {
        return .record(
          current.next(
            state: .blocked,
            failureReason: .some(.retryExhausted),
            updatedAtMillis: updatedAtMillis
          )
        ) { [store, scheduler] in
          let completeShared = !Self.hasOtherRunningBackgroundRecord(
            store: store,
            excludingRunId: current.request.identity.runId
          )
          return scheduler.complete(
            Self.spec(current),
            success: false,
            completeSharedTask: completeShared
          ) == .accepted ? nil : .deferred(.schedulerUnavailable)
        }
      }
      let waiting = current.next(
        state: .retryWaiting,
        nextAttemptAtMillis: .some(nextAttemptAtMillis),
        failureReason: .some(failureReason),
        updatedAtMillis: updatedAtMillis
      )
      return .record(waiting) { [store, scheduler] in
        let completeShared = !Self.hasOtherRunningBackgroundRecord(
          store: store,
          excludingRunId: current.request.identity.runId
        )
        _ = scheduler.complete(
          Self.spec(current),
          success: false,
          completeSharedTask: completeShared
        )
        switch scheduler.submit(Self.spec(waiting)) {
        case .accepted: return nil
        case .conflict: return .deferred(.schedulerConflict)
        case .terminal, .unavailable: return .deferred(.schedulerUnavailable)
        }
      }
    }
  }

  public func expireTask(
    taskIdentifier: String,
    schedulerKind: IOSDurableSchedulerKind,
    updatedAtMillis: Int64
  ) -> IOSDurableStoreListResult {
    let states: Set<IOSDurableExecutionState> =
      schedulerKind == .continuedProcessing ? [.scheduling, .submitted, .running] : [.running]
    let failureReason: IOSDurableFailureReason =
      schedulerKind == .continuedProcessing
      ? .continuedProcessingInterrupted : .platformExpired
    return interruptRecords(
      taskIdentifier: taskIdentifier,
      schedulerKind: schedulerKind,
      states: states,
      failureReason: failureReason,
      updatedAtMillis: updatedAtMillis
    )
  }

  public func markMissingContinuedRequest(
    taskIdentifier: String,
    updatedAtMillis: Int64
  ) -> IOSDurableStoreListResult {
    interruptRecords(
      taskIdentifier: taskIdentifier,
      schedulerKind: .continuedProcessing,
      states: [.submitted],
      failureReason: .platformRequestMissing,
      updatedAtMillis: updatedAtMillis
    )
  }

  public func markOrphanedContinuedExecution(
    taskIdentifier: String,
    updatedAtMillis: Int64
  ) -> IOSDurableStoreListResult {
    interruptRecords(
      taskIdentifier: taskIdentifier,
      schedulerKind: .continuedProcessing,
      states: [.running],
      failureReason: .continuedProcessingInterrupted,
      updatedAtMillis: updatedAtMillis
    )
  }

  private func interruptRecords(
    taskIdentifier: String,
    schedulerKind: IOSDurableSchedulerKind,
    states: Set<IOSDurableExecutionState>,
    failureReason: IOSDurableFailureReason,
    updatedAtMillis: Int64
  ) -> IOSDurableStoreListResult {
    switch matchingRecords(
      taskIdentifier: taskIdentifier,
      states: states,
      schedulerKind: schedulerKind,
      limit: 1_000
    ) {
    case .unavailable:
      return .unavailable
    case .records(let records):
      var expired: [IOSDurableExecutionRecord] = []
      for current in records where !current.state.isTerminal {
        let next = current.next(
          state: .expired,
          failureReason: .some(failureReason),
          updatedAtMillis: updatedAtMillis
        )
        if store.compareAndSet(
          runId: current.request.identity.runId,
          expectedRevision: current.revision,
          next: next
        ) == .stored {
          expired.append(next)
        }
      }
      return .records(expired)
    }
  }

  public func releaseTerminal(
    pointer: IOSDurableExecutionPointer
  ) -> IOSDurableAdapterResult {
    let current: IOSDurableExecutionRecord
    switch store.read(runId: pointer.runId) {
    case .missing: return .rejected(.recordNotFound)
    case .unavailable: return .deferred(.storeUnavailable)
    case .found(let record): current = record
    }
    guard pointer.matches(current.request.identity) else {
      return .rejected(.commandIdentityConflict)
    }
    guard current.state.isTerminal else {
      return .rejected(.invalidProgressTransition)
    }
    switch store.deleteTerminal(runId: pointer.runId, expectedRevision: current.revision) {
    case .stored: return .released(current)
    case .conflict: return .deferred(.storeConflict)
    case .unavailable: return .deferred(.storeUnavailable)
    }
  }

  private func submit(_ scheduling: IOSDurableExecutionRecord) -> IOSDurableAdapterResult {
    switch scheduler.submit(Self.spec(scheduling)) {
    case .conflict:
      return .deferred(.schedulerConflict)
    case .unavailable:
      return .deferred(.schedulerUnavailable)
    case .terminal:
      return terminalizeScheduling(scheduling)
    case .accepted:
      let submitted = scheduling.next(
        state: .submitted,
        updatedAtMillis: scheduling.updatedAtMillis
      )
      switch store.compareAndSet(
        runId: scheduling.request.identity.runId,
        expectedRevision: scheduling.revision,
        next: submitted
      ) {
      case .stored: return .accepted(submitted)
      case .conflict: return resolvePostScheduleConflict(scheduling.request)
      case .unavailable: return .deferred(.storeUnavailable)
      }
    }
  }

  private func reconcileSchedulingRecord(
    _ record: IOSDurableExecutionRecord
  ) -> IOSDurableAdapterResult {
    switch record.state {
    case .scheduling:
      return submit(record)
    case .submitted where record.schedulerKind == .backgroundProcessing,
      .retryWaiting where record.schedulerKind == .backgroundProcessing:
      switch scheduler.submit(Self.spec(record)) {
      case .accepted:
        return .noOp(record)
      case .conflict:
        return .deferred(.schedulerConflict)
      case .unavailable:
        return .deferred(.schedulerUnavailable)
      case .terminal:
        return terminalizeScheduling(record)
      }
    case .submitted, .running, .retryWaiting, .cancelRequested, .cancelled, .completed, .expired,
      .blocked:
      return .rejected(.invalidProgressTransition)
    }
  }

  private func terminalizeScheduling(
    _ current: IOSDurableExecutionRecord
  ) -> IOSDurableAdapterResult {
    let blocked = current.next(
      state: .blocked,
      failureReason: .some(.platformTerminatedWithoutReceipt),
      updatedAtMillis: current.updatedAtMillis
    )
    switch store.compareAndSet(
      runId: current.request.identity.runId,
      expectedRevision: current.revision,
      next: blocked
    ) {
    case .stored: return .rejected(.platformTerminatedWithoutReceipt)
    case .conflict: return .deferred(.storeConflict)
    case .unavailable: return .deferred(.storeUnavailable)
    }
  }

  private func markRunning(
    _ current: IOSDurableExecutionRecord,
    updatedAtMillis: Int64
  ) -> IOSDurableAdapterResult {
    if current.state == .running {
      return .noOp(current)
    }
    guard
      current.state == .submitted || current.state == .scheduling
        || (current.state == .retryWaiting
          && (current.nextAttemptAtMillis ?? Int64.max) <= updatedAtMillis)
    else {
      return .rejected(current.state.isTerminal ? .terminalGeneration : .invalidProgressTransition)
    }
    guard current.attempt < current.request.retryPolicy.maxAttempts else {
      let blocked = current.next(
        state: .blocked,
        failureReason: .some(.retryExhausted),
        updatedAtMillis: updatedAtMillis
      )
      return write(current: current, next: blocked)
    }
    let running = current.next(
      state: .running,
      attempt: current.attempt + 1,
      nextAttemptAtMillis: .some(nil),
      failureReason: .some(nil),
      updatedAtMillis: updatedAtMillis
    )
    return write(current: current, next: running)
  }

  private enum RunningUpdate {
    case result(IOSDurableAdapterResult)
    case record(
      IOSDurableExecutionRecord,
      afterPersist: (() -> IOSDurableAdapterResult?)? = nil
    )
  }

  private func updateRunning(
    _ pointer: IOSDurableExecutionAttemptPointer,
    transform: (IOSDurableExecutionRecord) -> RunningUpdate
  ) -> IOSDurableAdapterResult {
    let current: IOSDurableExecutionRecord
    switch store.read(runId: pointer.generation.runId) {
    case .missing: return .rejected(.recordNotFound)
    case .unavailable: return .deferred(.storeUnavailable)
    case .found(let record): current = record
    }
    guard pointer.generation.matches(current.request.identity) else {
      return .rejected(
        pointer.generation.controlEpoch < current.request.identity.controlEpoch
          ? .staleControlEpoch : .commandIdentityConflict
      )
    }
    guard current.attempt == pointer.attempt else {
      return .rejected(.staleAttempt)
    }
    guard current.state == .running else {
      return .rejected(.invalidProgressTransition)
    }
    switch transform(current) {
    case .result(let result):
      return result
    case .record(let next, let afterPersist):
      switch store.compareAndSet(
        runId: current.request.identity.runId,
        expectedRevision: current.revision,
        next: next
      ) {
      case .conflict: return .deferred(.storeConflict)
      case .unavailable: return .deferred(.storeUnavailable)
      case .stored: return afterPersist?() ?? .accepted(next)
      }
    }
  }

  private func settleRunning(
    pointer: IOSDurableExecutionAttemptPointer,
    state: IOSDurableExecutionState,
    failureReason: IOSDurableFailureReason?,
    receiptDigest: String?,
    success: Bool,
    updatedAtMillis: Int64
  ) -> IOSDurableAdapterResult {
    updateRunning(pointer) { current in
      let terminal = current.next(
        state: state,
        failureReason: .some(failureReason),
        receiptDigest: .some(receiptDigest),
        updatedAtMillis: updatedAtMillis
      )
      return .record(terminal) { [store, scheduler] in
        let completeShared = !Self.hasOtherRunningBackgroundRecord(
          store: store,
          excludingRunId: current.request.identity.runId
        )
        return scheduler.complete(
          Self.spec(current),
          success: success,
          completeSharedTask: completeShared
        ) == .accepted ? nil : .deferred(.schedulerUnavailable)
      }
    }
  }

}
