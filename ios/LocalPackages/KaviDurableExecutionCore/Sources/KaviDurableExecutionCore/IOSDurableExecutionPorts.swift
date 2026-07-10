import Foundation

public enum IOSDurableExecutionState: String, Codable, CaseIterable, Hashable, Sendable {
  case scheduling
  case submitted
  case running
  case retryWaiting = "retry_waiting"
  case cancelRequested = "cancel_requested"
  case cancelled
  case completed
  case expired
  case blocked

  public var isTerminal: Bool {
    switch self {
    case .cancelled, .completed, .expired, .blocked:
      return true
    case .scheduling, .submitted, .running, .retryWaiting, .cancelRequested:
      return false
    }
  }
}

public enum IOSDurableFailureReason: String, Codable, CaseIterable, Hashable, Sendable {
  case transientUnavailable = "transient_unavailable"
  case remoteStillPending = "remote_still_pending"
  case providerTemporarilyUnavailable = "provider_temporarily_unavailable"
  case generationChanged = "generation_changed"
  case authorityChanged = "authority_changed"
  case handlerRejected = "handler_rejected"
  case handlerFailed = "handler_failed"
  case retryExhausted = "retry_exhausted"
  case platformExpired = "platform_expired"
  case continuedProcessingInterrupted = "continued_processing_interrupted"
  case platformRequestMissing = "platform_request_missing"
  case platformTerminatedWithoutReceipt = "platform_terminated_without_receipt"

  public var isRetryable: Bool {
    switch self {
    case .transientUnavailable, .remoteStillPending, .providerTemporarilyUnavailable:
      return true
    case .generationChanged, .authorityChanged, .handlerRejected, .handlerFailed,
      .retryExhausted, .platformExpired, .continuedProcessingInterrupted,
      .platformRequestMissing,
      .platformTerminatedWithoutReceipt:
      return false
    }
  }
}

public struct IOSDurableExecutionRecord: Codable, Equatable, Sendable {
  public let request: IOSDurableExecutionRequest
  public let schedulerKind: IOSDurableSchedulerKind
  public let taskIdentifier: String
  public let state: IOSDurableExecutionState
  public let attempt: Int
  public let nextAttemptAtMillis: Int64?
  public let failureReason: IOSDurableFailureReason?
  public let receiptDigest: String?
  public let progressCompleted: Int64?
  public let progressTotal: Int64?
  public let lastCheckpointAtMillis: Int64?
  public let revision: Int64
  public let updatedAtMillis: Int64

  public init(
    request: IOSDurableExecutionRequest,
    schedulerKind: IOSDurableSchedulerKind,
    taskIdentifier: String,
    state: IOSDurableExecutionState,
    attempt: Int,
    nextAttemptAtMillis: Int64?,
    failureReason: IOSDurableFailureReason?,
    receiptDigest: String?,
    progressCompleted: Int64?,
    progressTotal: Int64?,
    lastCheckpointAtMillis: Int64?,
    revision: Int64,
    updatedAtMillis: Int64
  ) {
    self.request = request
    self.schedulerKind = schedulerKind
    self.taskIdentifier = taskIdentifier
    self.state = state
    self.attempt = attempt
    self.nextAttemptAtMillis = nextAttemptAtMillis
    self.failureReason = failureReason
    self.receiptDigest = receiptDigest
    self.progressCompleted = progressCompleted
    self.progressTotal = progressTotal
    self.lastCheckpointAtMillis = lastCheckpointAtMillis
    self.revision = revision
    self.updatedAtMillis = updatedAtMillis
  }

  public func next(
    request: IOSDurableExecutionRequest? = nil,
    state: IOSDurableExecutionState? = nil,
    attempt: Int? = nil,
    nextAttemptAtMillis: Int64?? = nil,
    failureReason: IOSDurableFailureReason?? = nil,
    receiptDigest: String?? = nil,
    progressCompleted: Int64?? = nil,
    progressTotal: Int64?? = nil,
    lastCheckpointAtMillis: Int64?? = nil,
    updatedAtMillis: Int64
  ) -> Self {
    Self(
      request: request ?? self.request,
      schedulerKind: schedulerKind,
      taskIdentifier: taskIdentifier,
      state: state ?? self.state,
      attempt: attempt ?? self.attempt,
      nextAttemptAtMillis: nextAttemptAtMillis ?? self.nextAttemptAtMillis,
      failureReason: failureReason ?? self.failureReason,
      receiptDigest: receiptDigest ?? self.receiptDigest,
      progressCompleted: progressCompleted ?? self.progressCompleted,
      progressTotal: progressTotal ?? self.progressTotal,
      lastCheckpointAtMillis: lastCheckpointAtMillis ?? self.lastCheckpointAtMillis,
      revision: revision + 1,
      updatedAtMillis: max(self.updatedAtMillis, updatedAtMillis)
    )
  }
}

public struct IOSDurableExecutionPointer: Codable, Equatable, Sendable {
  public let runId: String
  public let controlEpoch: Int64
  public let snapshotUpdatedAtMillis: Int64
  public let snapshotDigest: String
  public let commandDigest: String

  public init(
    runId: String,
    controlEpoch: Int64,
    snapshotUpdatedAtMillis: Int64,
    snapshotDigest: String,
    commandDigest: String
  ) {
    self.runId = runId
    self.controlEpoch = controlEpoch
    self.snapshotUpdatedAtMillis = snapshotUpdatedAtMillis
    self.snapshotDigest = snapshotDigest
    self.commandDigest = commandDigest
  }

  public init(_ identity: IOSRecoveryCommandIdentity) {
    self.init(
      runId: identity.runId,
      controlEpoch: identity.controlEpoch,
      snapshotUpdatedAtMillis: identity.snapshotUpdatedAtMillis,
      snapshotDigest: identity.snapshotDigest,
      commandDigest: identity.commandDigest
    )
  }

  public func matches(_ identity: IOSRecoveryCommandIdentity) -> Bool {
    self == IOSDurableExecutionPointer(identity)
  }
}

public struct IOSDurableExecutionAttemptPointer: Codable, Equatable, Sendable {
  public let generation: IOSDurableExecutionPointer
  public let attempt: Int

  public init(generation: IOSDurableExecutionPointer, attempt: Int) {
    self.generation = generation
    self.attempt = attempt
  }
}

public enum IOSDurableStoreReadResult: Sendable {
  case found(IOSDurableExecutionRecord)
  case missing
  case unavailable
}

public enum IOSDurableStoreListResult: Sendable {
  case records([IOSDurableExecutionRecord])
  case unavailable
}

public enum IOSDurableStoreWriteResult: Equatable, Sendable {
  case stored
  case conflict
  case unavailable
}

public struct IOSDurableStoreQuery: Equatable, Sendable {
  public let states: Set<IOSDurableExecutionState>?
  public let schedulerKind: IOSDurableSchedulerKind?
  public let taskIdentifier: String?
  public let excludingRunId: String?
  public let nextAttemptAtOrBeforeMillis: Int64?
  public let earliestStartAtOrBeforeMillis: Int64?

  public init(
    states: Set<IOSDurableExecutionState>? = nil,
    schedulerKind: IOSDurableSchedulerKind? = nil,
    taskIdentifier: String? = nil,
    excludingRunId: String? = nil,
    nextAttemptAtOrBeforeMillis: Int64? = nil,
    earliestStartAtOrBeforeMillis: Int64? = nil
  ) {
    self.states = states
    self.schedulerKind = schedulerKind
    self.taskIdentifier = taskIdentifier
    self.excludingRunId = excludingRunId
    self.nextAttemptAtOrBeforeMillis = nextAttemptAtOrBeforeMillis
    self.earliestStartAtOrBeforeMillis = earliestStartAtOrBeforeMillis
  }

  public func matches(_ record: IOSDurableExecutionRecord) -> Bool {
    (states == nil || states!.contains(record.state))
      && (schedulerKind == nil || schedulerKind == record.schedulerKind)
      && (taskIdentifier == nil || taskIdentifier == record.taskIdentifier)
      && (excludingRunId == nil || excludingRunId != record.request.identity.runId)
      && (nextAttemptAtOrBeforeMillis == nil
        || (record.nextAttemptAtMillis != nil
          && record.nextAttemptAtMillis! <= nextAttemptAtOrBeforeMillis!))
      && (earliestStartAtOrBeforeMillis == nil
        || record.request.constraints.earliestStartAtMillis
          <= earliestStartAtOrBeforeMillis!)
  }
}

public protocol IOSDurableExecutionStore: AnyObject, Sendable {
  func read(runId: String) -> IOSDurableStoreReadResult
  /// Applies the query before the limit so retained tombstones cannot hide active outbox rows.
  func list(query: IOSDurableStoreQuery, limit: Int) -> IOSDurableStoreListResult
  func compareAndSet(
    runId: String,
    expectedRevision: Int64?,
    next: IOSDurableExecutionRecord
  ) -> IOSDurableStoreWriteResult
  func deleteTerminal(runId: String, expectedRevision: Int64) -> IOSDurableStoreWriteResult
}

extension IOSDurableExecutionStore {
  public func list(limit: Int) -> IOSDurableStoreListResult {
    list(query: .init(), limit: limit)
  }
}

public struct IOSDurableTaskSpec: Equatable, Sendable {
  public let schedulerKind: IOSDurableSchedulerKind
  public let taskIdentifier: String
  public let request: IOSDurableExecutionRequest

  public init(
    schedulerKind: IOSDurableSchedulerKind,
    taskIdentifier: String,
    request: IOSDurableExecutionRequest
  ) {
    self.schedulerKind = schedulerKind
    self.taskIdentifier = taskIdentifier
    self.request = request
  }
}

public enum IOSDurableScheduleResult: Equatable, Sendable {
  case accepted
  case terminal
  case conflict
  case unavailable
}

public enum IOSDurableCancellationResult: Equatable, Sendable {
  case accepted
  case terminal
  case missing
  case unavailable
}

public enum IOSDurableSettlementResult: Equatable, Sendable {
  case accepted
  case unavailable
}

public protocol IOSDurablePlatformScheduler: AnyObject, Sendable {
  func taskIdentifier(kind: IOSDurableSchedulerKind, runId: String) -> String?
  func submit(_ spec: IOSDurableTaskSpec) -> IOSDurableScheduleResult
  func cancel(_ spec: IOSDurableTaskSpec, cancelSharedRequest: Bool) -> IOSDurableCancellationResult
  func updateProgress(
    _ spec: IOSDurableTaskSpec,
    completed: Int64,
    total: Int64
  ) -> IOSDurableSettlementResult
  func complete(
    _ spec: IOSDurableTaskSpec,
    success: Bool,
    completeSharedTask: Bool
  ) -> IOSDurableSettlementResult
}

public enum IOSDurableRejectionReason: String, Codable, Sendable {
  case staleControlEpoch = "stale_control_epoch"
  case commandIdentityConflict = "command_identity_conflict"
  case requestContractConflict = "request_contract_conflict"
  case activeOlderGeneration = "active_older_generation"
  case terminalGeneration = "terminal_generation"
  case recordNotFound = "record_not_found"
  case invalidProgressTransition = "invalid_progress_transition"
  case invalidProgress = "invalid_progress"
  case invalidCheckpoint = "invalid_checkpoint"
  case staleAttempt = "stale_attempt"
  case continuedRetryRequiresUserAction = "continued_retry_requires_user_action"
  case platformTerminatedWithoutReceipt = "platform_terminated_without_receipt"
}

public enum IOSDurableDeferReason: String, Codable, Sendable {
  case storeUnavailable = "store_unavailable"
  case storeConflict = "store_conflict"
  case schedulerUnavailable = "scheduler_unavailable"
  case schedulerConflict = "scheduler_conflict"
}

public enum IOSDurableAdapterResult: Sendable {
  case accepted(IOSDurableExecutionRecord)
  case noOp(IOSDurableExecutionRecord)
  case released(IOSDurableExecutionRecord)
  case unsupported(IOSDurableUnsupportedReason)
  case rejected(IOSDurableRejectionReason)
  case deferred(IOSDurableDeferReason)
}

public struct IOSDurableOutboxOutcome: Sendable {
  public let runId: String
  public let result: IOSDurableAdapterResult

  public init(runId: String, result: IOSDurableAdapterResult) {
    self.runId = runId
    self.result = result
  }
}

public enum IOSDurableOutboxResult: Sendable {
  case completed([IOSDurableOutboxOutcome])
  case storeUnavailable
}
