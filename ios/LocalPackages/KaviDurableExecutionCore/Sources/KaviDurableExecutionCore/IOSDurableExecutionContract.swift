import Foundation

public let iosDurableBridgeSchema = 1

public enum IOSTaskDurabilityClass: String, Codable, CaseIterable, Sendable {
  case foregroundInteractive = "foreground_interactive"
  case userInitiatedContinuable = "user_initiated_continuable"
  case deferrableMaintenance = "deferrable_maintenance"
  case eventDrivenMonitor = "event_driven_monitor"
  case externalDurableOperation = "external_durable_operation"
}

public enum IOSRecoveryCommandKind: String, Codable, CaseIterable, Sendable {
  case resumeModelStep = "resume_model_step"
  case resumePersistedToolBatch = "resume_persisted_tool_batch"
  case continueAfterToolResult = "continue_after_tool_result"
  case reconcileExternalHandles = "reconcile_external_handles"
  case resumeReview = "resume_review"
  case finalizeExistingTerminalProjection = "finalize_existing_terminal_projection"
}

public enum IOSNetworkConstraint: String, Codable, CaseIterable, Sendable {
  case notRequired = "not_required"
  case connected
  case unmetered
}

public struct IOSExecutionConstraints: Codable, Equatable, Sendable {
  public let network: IOSNetworkConstraint
  public let requiresCharging: Bool
  public let requiresBatteryNotLow: Bool
  public let requiresStorageNotLow: Bool
  public let requiresDeviceIdle: Bool
  public let earliestStartAtMillis: Int64

  public init(
    network: IOSNetworkConstraint,
    requiresCharging: Bool,
    requiresBatteryNotLow: Bool,
    requiresStorageNotLow: Bool,
    requiresDeviceIdle: Bool,
    earliestStartAtMillis: Int64
  ) {
    self.network = network
    self.requiresCharging = requiresCharging
    self.requiresBatteryNotLow = requiresBatteryNotLow
    self.requiresStorageNotLow = requiresStorageNotLow
    self.requiresDeviceIdle = requiresDeviceIdle
    self.earliestStartAtMillis = earliestStartAtMillis
  }
}

public enum IOSBackoffPolicy: String, Codable, CaseIterable, Sendable {
  case exponential
}

public struct IOSRetryPolicy: Codable, Equatable, Sendable {
  /// Includes the first execution attempt.
  public let maxAttempts: Int
  public let backoffPolicy: IOSBackoffPolicy
  public let initialBackoffMillis: Int64

  public init(
    maxAttempts: Int,
    backoffPolicy: IOSBackoffPolicy,
    initialBackoffMillis: Int64
  ) {
    self.maxAttempts = maxAttempts
    self.backoffPolicy = backoffPolicy
    self.initialBackoffMillis = initialBackoffMillis
  }
}

///
/// Stable identity of one persisted journal generation and recovery command.
///
/// This is deliberately not execution authority. A platform wake must query the
/// journal again, revalidate cancellation and approval state, and acquire a new
/// single-use dispatch fence before it performs any effect.
///
public struct IOSRecoveryCommandIdentity: Codable, Equatable, Sendable {
  public let runId: String
  public let controlEpoch: Int64
  public let snapshotUpdatedAtMillis: Int64
  public let snapshotDigest: String
  public let commandKind: IOSRecoveryCommandKind
  public let commandDigest: String

  public init(
    runId: String,
    controlEpoch: Int64,
    snapshotUpdatedAtMillis: Int64,
    snapshotDigest: String,
    commandKind: IOSRecoveryCommandKind,
    commandDigest: String
  ) {
    self.runId = runId
    self.controlEpoch = controlEpoch
    self.snapshotUpdatedAtMillis = snapshotUpdatedAtMillis
    self.snapshotDigest = snapshotDigest
    self.commandKind = commandKind
    self.commandDigest = commandDigest
  }
}

public struct IOSDurableExecutionRequest: Codable, Equatable, Sendable {
  public let durabilityClass: IOSTaskDurabilityClass
  public let identity: IOSRecoveryCommandIdentity
  public let constraints: IOSExecutionConstraints
  public let retryPolicy: IOSRetryPolicy
  public let requestedAtMillis: Int64

  public init(
    durabilityClass: IOSTaskDurabilityClass,
    identity: IOSRecoveryCommandIdentity,
    constraints: IOSExecutionConstraints,
    retryPolicy: IOSRetryPolicy,
    requestedAtMillis: Int64
  ) {
    self.durabilityClass = durabilityClass
    self.identity = identity
    self.constraints = constraints
    self.retryPolicy = retryPolicy
    self.requestedAtMillis = requestedAtMillis
  }

  public func replacingIdentity(_ identity: IOSRecoveryCommandIdentity) -> Self {
    Self(
      durabilityClass: durabilityClass,
      identity: identity,
      constraints: constraints,
      retryPolicy: retryPolicy,
      requestedAtMillis: requestedAtMillis
    )
  }
}

public enum IOSDurableSchedulerKind: String, Codable, Sendable {
  /// iOS 26 foreground-originated work with system progress and cancellation UI.
  case continuedProcessing = "continued_processing"
  /// A discretionary, scheduler-controlled processing wake shared by queued records.
  case backgroundProcessing = "background_processing"
}

public struct IOSDurablePlatformCapabilities: Equatable, Sendable {
  public let supportsContinuedProcessing: Bool
  public let appIsForeground: Bool
  /// Anti-replay signal only; the caller must still originate continued work from audited UI code.
  public let requestTimestampIsFresh: Bool

  public init(
    supportsContinuedProcessing: Bool,
    appIsForeground: Bool,
    requestTimestampIsFresh: Bool = false
  ) {
    self.supportsContinuedProcessing = supportsContinuedProcessing
    self.appIsForeground = appIsForeground
    self.requestTimestampIsFresh = requestTimestampIsFresh
  }
}

public enum IOSDurableUnsupportedReason: String, Codable, Sendable {
  case invalidRequest = "invalid_request"
  case processBoundInteractiveWork = "process_bound_interactive_work"
  case continuedProcessingUnavailable = "continued_processing_unavailable"
  case foregroundUserActionRequired = "foreground_user_action_required"
  case staleRequestTimestamp = "stale_request_timestamp"
  case continuedProcessingDelayUnsupported = "continued_processing_delay_unsupported"
  case unsupportedNetworkConstraint = "unsupported_network_constraint"
  case unsupportedPlatformConstraint = "unsupported_platform_constraint"
  case missingEventTriggerContract = "missing_event_trigger_contract"
  case missingRequiredNetworkConstraint = "missing_required_network_constraint"
  case unsafeRecoveryCommand = "unsafe_recovery_command"
}

public struct IOSDurableExecutionDecision: Equatable, Sendable {
  public let schedulerKind: IOSDurableSchedulerKind?
  public let unsupportedReason: IOSDurableUnsupportedReason?
  public let requiresFreshRecoveryQuery: Bool
  public let requiresFreshAuthorityAndFence: Bool

  private init(
    schedulerKind: IOSDurableSchedulerKind?,
    unsupportedReason: IOSDurableUnsupportedReason?,
    requiresFreshRecoveryQuery: Bool,
    requiresFreshAuthorityAndFence: Bool
  ) {
    self.schedulerKind = schedulerKind
    self.unsupportedReason = unsupportedReason
    self.requiresFreshRecoveryQuery = requiresFreshRecoveryQuery
    self.requiresFreshAuthorityAndFence = requiresFreshAuthorityAndFence
  }

  public static func supported(_ schedulerKind: IOSDurableSchedulerKind) -> Self {
    Self(
      schedulerKind: schedulerKind,
      unsupportedReason: nil,
      requiresFreshRecoveryQuery: true,
      requiresFreshAuthorityAndFence: true
    )
  }

  public static func unsupported(_ reason: IOSDurableUnsupportedReason) -> Self {
    Self(
      schedulerKind: nil,
      unsupportedReason: reason,
      requiresFreshRecoveryQuery: false,
      requiresFreshAuthorityAndFence: false
    )
  }

  public var isSupported: Bool {
    schedulerKind != nil && unsupportedReason == nil
  }
}
