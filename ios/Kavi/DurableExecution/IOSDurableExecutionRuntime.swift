import Foundation
import KaviDurableExecutionCore
import UIKit

enum IOSDurableWakeTrigger: String {
  case platformLaunch = "platform_launch"
  case platformExpiration = "platform_expiration"
  case relaunchReconciliation = "relaunch_reconciliation"
}

enum IOSDurableWakeDisposition: String {
  case recover
  case interruptThenRecover = "interrupt_then_recover"
  case requireUserAction = "require_user_action"
}

struct IOSDurableWakeEvent {
  let trigger: IOSDurableWakeTrigger
  let disposition: IOSDurableWakeDisposition
  let record: IOSDurableExecutionRecord
}

func iosDurableWakeDisposition(
  for record: IOSDurableExecutionRecord
) -> IOSDurableWakeDisposition {
  if record.schedulerKind == .continuedProcessing && record.state == .expired {
    return .requireUserAction
  }
  if record.schedulerKind == .backgroundProcessing && record.state == .expired {
    return .interruptThenRecover
  }
  return .recover
}

/// Process singleton shared by AppDelegate, BackgroundTasks handlers, and the RN bridge.
final class IOSDurableExecutionRuntime: IOSBackgroundTaskSchedulerDelegate, @unchecked Sendable {
  static let shared = IOSDurableExecutionRuntime()

  let store: IOSSqliteDurableExecutionStore
  let scheduler: IOSBackgroundTaskScheduler
  let adapter: IOSDurableExecutionAdapter
  let operationQueue = DispatchQueue(
    label: "com.kavi.app.durable-execution.runtime",
    qos: .utility
  )

  private let operationQueueKey = DispatchSpecificKey<UInt8>()
  private let eventLock = NSLock()
  private var eventHandler: ((IOSDurableWakeEvent) -> Void)?

  private init() {
    guard
      let applicationSupport = FileManager.default.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
      ).first
    else {
      preconditionFailure("Application Support is required for durable execution")
    }
    let store = IOSSqliteDurableExecutionStore(
      directoryURL: applicationSupport.appendingPathComponent(
        "KaviDurableExecution",
        isDirectory: true
      )
    )
    let bundleIdentifier = Bundle.main.bundleIdentifier ?? ""
    let scheduler = IOSBackgroundTaskScheduler(bundleIdentifier: bundleIdentifier)
    self.store = store
    self.scheduler = scheduler
    adapter = IOSDurableExecutionAdapter(store: store, scheduler: scheduler)
    scheduler.delegate = self
    scheduler.backgroundProcessingRequirements = { [store] in
      Self.processingRequirements(store: store)
    }
    operationQueue.setSpecific(key: operationQueueKey, value: 1)
  }

  /// Must run before AppDelegate finishes launching so static BGProcessing registration is legal.
  func registerAtApplicationLaunch() {
    guard scheduler.isConfigured else { return }
    _ = scheduler.registerAtLaunch()
    operationQueue.async { [weak self] in
      self?.registerPersistedContinuedHandlers()
      self?.reconcileProcessRelaunch()
    }
  }

  func setEventHandler(_ handler: ((IOSDurableWakeEvent) -> Void)?) {
    eventLock.lock()
    eventHandler = handler
    eventLock.unlock()
    guard handler != nil else { return }
    operationQueue.async { [weak self] in
      self?.replayPendingRecoveryEvents()
    }
  }

  func capabilities(requestedAtMillis: Int64) -> IOSDurablePlatformCapabilities {
    let now = Self.nowMillis()
    let actionAge = now.subtractingReportingOverflow(requestedAtMillis)
    return IOSDurablePlatformCapabilities(
      supportsContinuedProcessing: {
        if #available(iOS 26.0, *) { return scheduler.isConfigured }
        return false
      }(),
      appIsForeground: Self.readApplicationIsForeground(),
      requestTimestampIsFresh: !actionAge.overflow
        && actionAge.partialValue >= 0
        && actionAge.partialValue <= 5_000
    )
  }

  func backgroundTaskScheduler(
    _ scheduler: IOSBackgroundTaskScheduler,
    launched taskIdentifier: String,
    kind: IOSDurableSchedulerKind
  ) {
    operationQueue.async { [weak self] in
      guard let self else { return }
      switch kind {
      case .continuedProcessing:
        switch adapter.launchContinuedTask(
          taskIdentifier: taskIdentifier,
          updatedAtMillis: Self.nowMillis()
        ) {
        case .accepted(let record), .noOp(let record):
          emit(
            .init(
              trigger: .platformLaunch,
              disposition: .recover,
              record: record
            )
          )
        case .released, .unsupported, .rejected, .deferred:
          _ = self.scheduler.completeBoundTask(
            taskIdentifier: taskIdentifier,
            kind: kind,
            success: false,
            completeSharedTask: true
          )
        }

      case .backgroundProcessing:
        switch adapter.launchBackgroundProcessing(
          updatedAtMillis: Self.nowMillis(),
          limit: 1_000
        ) {
        case .unavailable:
          completeOrphanedProcessingTask()
        case .records(let records):
          ensureBackgroundProcessingRequest()
          if records.isEmpty {
            completeOrphanedProcessingTask()
          } else {
            for record in records {
              emit(
                .init(
                  trigger: .platformLaunch,
                  disposition: .recover,
                  record: record
                )
              )
            }
          }
        }
      }
    }
  }

  func backgroundTaskScheduler(
    _ scheduler: IOSBackgroundTaskScheduler,
    expired taskIdentifier: String,
    kind: IOSDurableSchedulerKind
  ) {
    performSerialized {
      if case .records(let records) = adapter.expireTask(
        taskIdentifier: taskIdentifier,
        schedulerKind: kind,
        updatedAtMillis: Self.nowMillis()
      ) {
        for record in records {
          emit(
            .init(
              trigger: .platformExpiration,
              disposition: iosDurableWakeDisposition(for: record),
              record: record
            )
          )
        }
      }
    }
  }

  private func registerPersistedContinuedHandlers() {
    guard
      case .records(let records) = store.list(
        query: .init(
          states: [.scheduling, .submitted, .running, .cancelRequested],
          schedulerKind: .continuedProcessing
        ),
        limit: 1_000
      )
    else {
      return
    }
    let failures = scheduler.registerContinuedHandlers(
      Array(Set(records.map(\.taskIdentifier))).sorted()
    )
    for identifier in failures {
      _ = adapter.markMissingContinuedRequest(
        taskIdentifier: identifier,
        updatedAtMillis: Self.nowMillis()
      )
      _ = adapter.markOrphanedContinuedExecution(
        taskIdentifier: identifier,
        updatedAtMillis: Self.nowMillis()
      )
    }
  }

  private func reconcileProcessRelaunch() {
    _ = adapter.reconcileScheduling(limit: 1_000)
    _ = adapter.reconcileCancellationRequests(limit: 1_000)
    ensureBackgroundProcessingRequest()
    scheduler.pendingOrActiveTaskIdentifiers { [weak self] firstObservation in
      self?.operationQueue.asyncAfter(deadline: .now() + 1) {
        self?.confirmMissingContinuedRequests(firstObservation: firstObservation)
      }
    }
  }

  private func confirmMissingContinuedRequests(firstObservation: Set<String>) {
    scheduler.pendingOrActiveTaskIdentifiers { [weak self] secondObservation in
      self?.operationQueue.async {
        self?.reconcileMissingContinuedRequests(
          firstObservation: firstObservation,
          secondObservation: secondObservation
        )
      }
    }
  }

  private func ensureBackgroundProcessingRequest() {
    guard
      case .records(let records) = store.list(
        query: .init(
          states: [.scheduling, .submitted, .retryWaiting],
          schedulerKind: .backgroundProcessing
        ),
        limit: 1
      ), let record = records.first
    else {
      return
    }
    _ = scheduler.submit(
      IOSDurableTaskSpec(
        schedulerKind: record.schedulerKind,
        taskIdentifier: record.taskIdentifier,
        request: record.request
      )
    )
  }

  private func reconcileMissingContinuedRequests(
    firstObservation: Set<String>,
    secondObservation: Set<String>
  ) {
    guard
      case .records(let submitted) = store.list(
        query: .init(
          states: [.submitted, .running],
          schedulerKind: .continuedProcessing
        ),
        limit: 1_000
      )
    else {
      return
    }
    for record in submitted
    where !firstObservation.contains(record.taskIdentifier)
      && !secondObservation.contains(record.taskIdentifier)
      && !scheduler.isTaskActive(record.taskIdentifier)
    {
      if record.state == .running {
        _ = adapter.markOrphanedContinuedExecution(
          taskIdentifier: record.taskIdentifier,
          updatedAtMillis: Self.nowMillis()
        )
      } else {
        _ = adapter.markMissingContinuedRequest(
          taskIdentifier: record.taskIdentifier,
          updatedAtMillis: Self.nowMillis()
        )
      }
    }
    replayPendingRecoveryEvents()
  }

  private func replayPendingRecoveryEvents() {
    guard case .records(let records) = adapter.listPendingRecoveryRecords(limit: 1_000) else {
      return
    }
    for record in records {
      emit(
        .init(
          trigger: .relaunchReconciliation,
          disposition: iosDurableWakeDisposition(for: record),
          record: record
        )
      )
    }
  }

  private func completeOrphanedProcessingTask() {
    _ = scheduler.completeBoundTask(
      taskIdentifier: scheduler.processingIdentifier,
      kind: .backgroundProcessing,
      success: false,
      completeSharedTask: true
    )
  }

  private func emit(_ event: IOSDurableWakeEvent) {
    eventLock.lock()
    let handler = eventHandler
    eventLock.unlock()
    handler?(event)
  }

  private func performSerialized(_ operation: () -> Void) {
    if DispatchQueue.getSpecific(key: operationQueueKey) != nil {
      operation()
    } else {
      operationQueue.sync(execute: operation)
    }
  }

  private static func processingRequirements(
    store: IOSDurableExecutionStore
  ) -> IOSBackgroundProcessingRequirements? {
    guard
      case .records(let records) = store.list(
        query: .init(
          states: [.scheduling, .submitted, .retryWaiting],
          schedulerKind: .backgroundProcessing
        ),
        limit: 1_000
      ), !records.isEmpty
    else {
      return nil
    }
    let earliestMillis =
      records.map { record in
        if record.state == .retryWaiting {
          return record.nextAttemptAtMillis ?? Int64.max
        }
        return record.request.constraints.earliestStartAtMillis
      }.min() ?? nowMillis()
    return IOSBackgroundProcessingRequirements(
      requiresNetworkConnectivity: records.contains {
        $0.request.constraints.network == .connected
      },
      requiresExternalPower: records.contains {
        $0.request.constraints.requiresCharging
      },
      earliestBeginDate: Date(
        timeIntervalSince1970: Double(earliestMillis) / 1_000
      )
    )
  }

  private static func nowMillis() -> Int64 {
    Int64((Date().timeIntervalSince1970 * 1_000).rounded(.down))
  }

  private static func readApplicationIsForeground() -> Bool {
    if Thread.isMainThread {
      return UIApplication.shared.applicationState == .active
    }
    return DispatchQueue.main.sync {
      UIApplication.shared.applicationState == .active
    }
  }

}
