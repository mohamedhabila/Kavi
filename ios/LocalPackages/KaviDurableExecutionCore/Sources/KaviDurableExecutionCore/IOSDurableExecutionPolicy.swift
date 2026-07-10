import Foundation

public enum IOSDurableExecutionPolicy {
  public static let minimumBackoffMillis: Int64 = 10_000
  public static let maximumBackoffMillis: Int64 = 18_000_000
  public static let maximumAttempts = 10

  public static func decide(
    _ request: IOSDurableExecutionRequest,
    capabilities: IOSDurablePlatformCapabilities
  ) -> IOSDurableExecutionDecision {
    guard isValid(request) else {
      return .unsupported(.invalidRequest)
    }

    if request.constraints.requiresBatteryNotLow || request.constraints.requiresStorageNotLow
      || request.constraints.requiresDeviceIdle
    {
      return .unsupported(.unsupportedPlatformConstraint)
    }

    switch request.durabilityClass {
    case .foregroundInteractive:
      return .unsupported(.processBoundInteractiveWork)

    case .eventDrivenMonitor:
      return .unsupported(.missingEventTriggerContract)

    case .userInitiatedContinuable:
      guard capabilities.supportsContinuedProcessing else {
        return .unsupported(.continuedProcessingUnavailable)
      }
      guard capabilities.appIsForeground else {
        return .unsupported(.foregroundUserActionRequired)
      }
      guard capabilities.hasFreshUserInitiatedAction else {
        return .unsupported(.freshUserActionRequired)
      }
      guard request.constraints.earliestStartAtMillis == request.requestedAtMillis else {
        return .unsupported(.continuedProcessingDelayUnsupported)
      }
      guard !request.constraints.requiresCharging else {
        return .unsupported(.unsupportedPlatformConstraint)
      }
      guard request.constraints.network == .notRequired else {
        return .unsupported(.unsupportedNetworkConstraint)
      }
      return .supported(.continuedProcessing)

    case .deferrableMaintenance:
      guard request.identity.commandKind == .finalizeExistingTerminalProjection else {
        return .unsupported(.unsafeRecoveryCommand)
      }
      guard request.constraints.network != .unmetered else {
        return .unsupported(.unsupportedNetworkConstraint)
      }
      return .supported(.backgroundProcessing)

    case .externalDurableOperation:
      guard request.identity.commandKind == .reconcileExternalHandles else {
        return .unsupported(.unsafeRecoveryCommand)
      }
      guard request.constraints.network == .connected else {
        return .unsupported(.missingRequiredNetworkConstraint)
      }
      return .supported(.backgroundProcessing)
    }
  }

  public static func isValid(_ request: IOSDurableExecutionRequest) -> Bool {
    let identity = request.identity
    return isValidIdentifier(identity.runId) && identity.controlEpoch >= 0
      && identity.snapshotUpdatedAtMillis >= 0 && isSHA256Digest(identity.snapshotDigest)
      && isSHA256Digest(identity.commandDigest) && request.requestedAtMillis >= 0
      && identity.snapshotUpdatedAtMillis <= request.requestedAtMillis
      && request.constraints.earliestStartAtMillis >= request.requestedAtMillis
      && request.retryPolicy.maxAttempts >= 1 && request.retryPolicy.maxAttempts <= maximumAttempts
      && request.retryPolicy.initialBackoffMillis >= minimumBackoffMillis
      && request.retryPolicy.initialBackoffMillis <= maximumBackoffMillis
  }

  public static func isValidIdentity(_ identity: IOSRecoveryCommandIdentity) -> Bool {
    isValidIdentifier(identity.runId) && identity.controlEpoch >= 0
      && identity.snapshotUpdatedAtMillis >= 0 && isSHA256Digest(identity.snapshotDigest)
      && isSHA256Digest(identity.commandDigest)
  }

  public static func isValidIdentifier(_ value: String) -> Bool {
    !value.isEmpty && value.count <= 200
      && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
      && value.unicodeScalars.allSatisfy { scalar in
        scalar.value >= 0x20 && scalar.value != 0x7f
      }
  }

  public static func isSHA256Digest(_ value: String) -> Bool {
    value.count == 64
      && value.unicodeScalars.allSatisfy { scalar in
        (scalar.value >= 0x30 && scalar.value <= 0x39)
          || (scalar.value >= 0x61 && scalar.value <= 0x66)
      }
  }
}
