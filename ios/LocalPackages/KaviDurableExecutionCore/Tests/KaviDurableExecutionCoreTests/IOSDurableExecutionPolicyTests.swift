import XCTest
@testable import KaviDurableExecutionCore

final class IOSDurableExecutionPolicyTests: XCTestCase {
  private let foregroundIOS26 = IOSDurablePlatformCapabilities(
    supportsContinuedProcessing: true,
    appIsForeground: true
  )

  func testDurabilityTaxonomyMatchesJournalContract() {
    XCTAssertEqual(
      IOSTaskDurabilityClass.allCases.map(\.rawValue),
      [
        "foreground_interactive",
        "user_initiated_continuable",
        "deferrable_maintenance",
        "event_driven_monitor",
        "external_durable_operation",
      ]
    )
  }

  func testAcceptsImmediateForegroundContinuedProcessingOnIOS26() {
    for commandKind in IOSRecoveryCommandKind.allCases {
      let decision = IOSDurableExecutionPolicy.decide(
        request(
          durabilityClass: .userInitiatedContinuable,
          commandKind: commandKind
        ),
        capabilities: foregroundIOS26
      )
      XCTAssertEqual(decision.schedulerKind, .continuedProcessing)
      XCTAssertTrue(decision.requiresFreshRecoveryQuery)
      XCTAssertTrue(decision.requiresFreshAuthorityAndFence)
    }
  }

  func testContinuedProcessingRequiresIOS26ForegroundAndImmediateStart() {
    let candidate = request(durabilityClass: .userInitiatedContinuable)
    XCTAssertEqual(
      IOSDurableExecutionPolicy.decide(
        candidate,
        capabilities: .init(supportsContinuedProcessing: false, appIsForeground: true)
      ).unsupportedReason,
      .continuedProcessingUnavailable
    )
    XCTAssertEqual(
      IOSDurableExecutionPolicy.decide(
        candidate,
        capabilities: .init(supportsContinuedProcessing: true, appIsForeground: false)
      ).unsupportedReason,
      .foregroundUserActionRequired
    )
    XCTAssertEqual(
      IOSDurableExecutionPolicy.decide(
        request(
          durabilityClass: .userInitiatedContinuable,
          earliestStartAtMillis: 1_001
        ),
        capabilities: foregroundIOS26
      ).unsupportedReason,
      .continuedProcessingDelayUnsupported
    )
  }

  func testContinuedProcessingRejectsConstraintsItCannotEnforce() {
    XCTAssertEqual(
      IOSDurableExecutionPolicy.decide(
        request(durabilityClass: .userInitiatedContinuable, requiresCharging: true),
        capabilities: foregroundIOS26
      ).unsupportedReason,
      .unsupportedPlatformConstraint
    )
    XCTAssertEqual(
      IOSDurableExecutionPolicy.decide(
        request(durabilityClass: .userInitiatedContinuable, network: .unmetered),
        capabilities: foregroundIOS26
      ).unsupportedReason,
      .unsupportedNetworkConstraint
    )
  }

  func testDeferrableMaintenanceOnlyFinalizesExistingTerminalProjection() {
    let supported = IOSDurableExecutionPolicy.decide(
      request(
        durabilityClass: .deferrableMaintenance,
        commandKind: .finalizeExistingTerminalProjection,
        requiresCharging: true,
        earliestStartAtMillis: 5_000
      ),
      capabilities: .init(supportsContinuedProcessing: false, appIsForeground: false)
    )
    XCTAssertEqual(supported.schedulerKind, .backgroundProcessing)

    for commandKind in IOSRecoveryCommandKind.allCases where
      commandKind != .finalizeExistingTerminalProjection
    {
      XCTAssertEqual(
        IOSDurableExecutionPolicy.decide(
          request(durabilityClass: .deferrableMaintenance, commandKind: commandKind),
          capabilities: foregroundIOS26
        ).unsupportedReason,
        .unsafeRecoveryCommand
      )
    }
  }

  func testExternalDurableOperationOnlyReconcilesOneNetworkHandle() {
    XCTAssertEqual(
      IOSDurableExecutionPolicy.decide(
        request(
          durabilityClass: .externalDurableOperation,
          commandKind: .reconcileExternalHandles,
          network: .connected
        ),
        capabilities: .init(supportsContinuedProcessing: false, appIsForeground: false)
      ).schedulerKind,
      .backgroundProcessing
    )
    XCTAssertEqual(
      IOSDurableExecutionPolicy.decide(
        request(
          durabilityClass: .externalDurableOperation,
          commandKind: .reconcileExternalHandles
        ),
        capabilities: foregroundIOS26
      ).unsupportedReason,
      .missingRequiredNetworkConstraint
    )
    XCTAssertEqual(
      IOSDurableExecutionPolicy.decide(
        request(
          durabilityClass: .externalDurableOperation,
          commandKind: .resumeModelStep,
          network: .connected
        ),
        capabilities: foregroundIOS26
      ).unsupportedReason,
      .unsafeRecoveryCommand
    )
  }

  func testDeclinesForegroundAndEventWorkInsteadOfPretendingToScheduleIt() {
    XCTAssertEqual(
      IOSDurableExecutionPolicy.decide(
        request(durabilityClass: .foregroundInteractive),
        capabilities: foregroundIOS26
      ).unsupportedReason,
      .processBoundInteractiveWork
    )
    XCTAssertEqual(
      IOSDurableExecutionPolicy.decide(
        request(durabilityClass: .eventDrivenMonitor),
        capabilities: foregroundIOS26
      ).unsupportedReason,
      .missingEventTriggerContract
    )
  }

  func testRejectsMalformedIdentityClockAndRetryBounds() {
    let invalidRequests = [
      request(runId: " run-1"),
      request(controlEpoch: -1),
      request(snapshotUpdatedAtMillis: 1_001),
      request(snapshotDigest: "A" + String(repeating: "a", count: 63)),
      request(commandDigest: String(repeating: "g", count: 64)),
      request(maxAttempts: 0),
      request(maxAttempts: 11),
      request(initialBackoffMillis: 9_999),
      request(initialBackoffMillis: 18_000_001),
    ]
    for invalid in invalidRequests {
      XCTAssertEqual(
        IOSDurableExecutionPolicy.decide(
          invalid,
          capabilities: foregroundIOS26
        ).unsupportedReason,
        .invalidRequest
      )
    }
  }

  func testRejectsUnsupportedBatteryStorageAndIdleConstraintsForEveryClass() {
    for durabilityClass in IOSTaskDurabilityClass.allCases {
      for candidate in [
        request(durabilityClass: durabilityClass, requiresBatteryNotLow: true),
        request(durabilityClass: durabilityClass, requiresStorageNotLow: true),
        request(durabilityClass: durabilityClass, requiresDeviceIdle: true),
      ] {
        XCTAssertEqual(
          IOSDurableExecutionPolicy.decide(
            candidate,
            capabilities: foregroundIOS26
          ).unsupportedReason,
          .unsupportedPlatformConstraint
        )
      }
    }
  }

  private func request(
    durabilityClass: IOSTaskDurabilityClass = .userInitiatedContinuable,
    runId: String = "run-1",
    controlEpoch: Int64 = 0,
    snapshotUpdatedAtMillis: Int64 = 999,
    snapshotDigest: String = String(repeating: "a", count: 64),
    commandKind: IOSRecoveryCommandKind = .resumeModelStep,
    commandDigest: String = String(repeating: "b", count: 64),
    network: IOSNetworkConstraint = .notRequired,
    requiresCharging: Bool = false,
    requiresBatteryNotLow: Bool = false,
    requiresStorageNotLow: Bool = false,
    requiresDeviceIdle: Bool = false,
    earliestStartAtMillis: Int64 = 1_000,
    maxAttempts: Int = 3,
    initialBackoffMillis: Int64 = 10_000
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
        requiresBatteryNotLow: requiresBatteryNotLow,
        requiresStorageNotLow: requiresStorageNotLow,
        requiresDeviceIdle: requiresDeviceIdle,
        earliestStartAtMillis: earliestStartAtMillis
      ),
      retryPolicy: .init(
        maxAttempts: maxAttempts,
        backoffPolicy: .exponential,
        initialBackoffMillis: initialBackoffMillis
      ),
      requestedAtMillis: 1_000
    )
  }
}
