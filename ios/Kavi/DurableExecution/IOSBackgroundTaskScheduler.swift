import BackgroundTasks
import CryptoKit
import Foundation
import KaviDurableExecutionCore
import UIKit

struct IOSBackgroundProcessingRequirements: Equatable {
  let requiresNetworkConnectivity: Bool
  let requiresExternalPower: Bool
  let earliestBeginDate: Date
}

protocol IOSBackgroundTaskSchedulerDelegate: AnyObject {
  func backgroundTaskScheduler(
    _ scheduler: IOSBackgroundTaskScheduler,
    launched taskIdentifier: String,
    kind: IOSDurableSchedulerKind
  )

  func backgroundTaskScheduler(
    _ scheduler: IOSBackgroundTaskScheduler,
    expired taskIdentifier: String,
    kind: IOSDurableSchedulerKind
  )
}

/// Maps the closed durable-execution policy onto Apple's BackgroundTasks APIs.
/// A launch only wakes the persisted recovery path; it never grants effect authority.
final class IOSBackgroundTaskScheduler: IOSDurablePlatformScheduler, @unchecked Sendable {
  typealias RequirementsProvider = () -> IOSBackgroundProcessingRequirements?
  typealias ForegroundStateProvider = () -> Bool

  weak var delegate: IOSBackgroundTaskSchedulerDelegate?
  var backgroundProcessingRequirements: RequirementsProvider?

  let processingIdentifier: String
  let continuedIdentifierPrefix: String
  let isConfigured: Bool

  private let scheduler: BGTaskScheduler
  private let foregroundStateProvider: ForegroundStateProvider
  private let handlerQueue = DispatchQueue(
    label: "com.kavi.app.durable-execution.handlers",
    qos: .utility
  )
  private let registrationLock = NSLock()
  private let activeTaskLock = NSLock()
  private var registeredIdentifiers: Set<String> = []
  private var activeContinuedTasks: [String: AnyObject] = [:]
  private var activeProcessingTask: BGProcessingTask?
  private var activeProcessingOutcome = IOSSharedTaskOutcome()

  init(
    bundleIdentifier: String,
    scheduler: BGTaskScheduler = .shared,
    foregroundStateProvider: @escaping ForegroundStateProvider = IOSBackgroundTaskScheduler
      .readApplicationIsForeground
  ) {
    isConfigured =
      !bundleIdentifier.isEmpty
      && bundleIdentifier == bundleIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
    processingIdentifier = "\(bundleIdentifier).durable-processing"
    continuedIdentifierPrefix = "\(bundleIdentifier).durable-continuation."
    self.scheduler = scheduler
    self.foregroundStateProvider = foregroundStateProvider
  }

  @discardableResult
  func registerAtLaunch() -> Bool {
    guard isConfigured else { return false }
    return registerProcessingHandler()
  }

  func registerContinuedHandlers(_ identifiers: [String]) -> Set<String> {
    guard isConfigured else { return Set(identifiers) }
    guard #available(iOS 26.0, *) else { return Set(identifiers) }
    var failures: Set<String> = []
    for identifier in identifiers {
      if !registerContinuedHandler(identifier) {
        failures.insert(identifier)
      }
    }
    return failures
  }

  func taskIdentifier(kind: IOSDurableSchedulerKind, runId: String) -> String? {
    guard isConfigured, IOSDurableExecutionPolicy.isValidIdentifier(runId) else { return nil }
    switch kind {
    case .backgroundProcessing:
      return processingIdentifier
    case .continuedProcessing:
      let digest = SHA256.hash(data: Data(runId.utf8))
        .map { String(format: "%02x", $0) }
        .joined()
      return continuedIdentifierPrefix + digest
    }
  }

  func submit(_ spec: IOSDurableTaskSpec) -> IOSDurableScheduleResult {
    guard isConfigured else { return .terminal }
    switch spec.schedulerKind {
    case .backgroundProcessing:
      guard let requirements = backgroundProcessingRequirements?(),
        registerProcessingHandler()
      else {
        return .unavailable
      }
      let request = BGProcessingTaskRequest(identifier: processingIdentifier)
      request.requiresNetworkConnectivity = requirements.requiresNetworkConnectivity
      request.requiresExternalPower = requirements.requiresExternalPower
      request.earliestBeginDate = requirements.earliestBeginDate
      return submit(request)

    case .continuedProcessing:
      guard #available(iOS 26.0, *),
        foregroundStateProvider(),
        registerContinuedHandler(spec.taskIdentifier)
      else {
        return .terminal
      }
      let request = BGContinuedProcessingTaskRequest(
        identifier: spec.taskIdentifier,
        title: NSLocalizedString(
          "Kavi is working",
          comment: "System-visible title for user-initiated continued processing"
        ),
        subtitle: NSLocalizedString(
          "Continuing your request",
          comment: "System-visible subtitle for user-initiated continued processing"
        )
      )
      request.strategy = .queue
      request.requiredResources = []
      return submit(request)
    }
  }

  func cancel(
    _ spec: IOSDurableTaskSpec,
    cancelSharedRequest: Bool
  ) -> IOSDurableCancellationResult {
    switch spec.schedulerKind {
    case .continuedProcessing:
      scheduler.cancel(taskRequestWithIdentifier: spec.taskIdentifier)
      if #available(iOS 26.0, *),
        let task = removeContinuedTask(identifier: spec.taskIdentifier)
      {
        task.setTaskCompleted(success: false)
      }
      return .accepted

    case .backgroundProcessing:
      recordProcessingFailure()
      guard cancelSharedRequest else { return .accepted }
      scheduler.cancel(taskRequestWithIdentifier: processingIdentifier)
      let task = removeProcessingTask()
      task?.setTaskCompleted(success: false)
      return .accepted
    }
  }

  func updateProgress(
    _ spec: IOSDurableTaskSpec,
    completed: Int64,
    total: Int64
  ) -> IOSDurableSettlementResult {
    guard spec.schedulerKind == .continuedProcessing else {
      // BGProcessingTask has no system progress surface; the durable record remains authoritative.
      return .accepted
    }
    guard #available(iOS 26.0, *),
      let task = readContinuedTask(identifier: spec.taskIdentifier)
    else {
      return .unavailable
    }
    task.progress.totalUnitCount = total
    task.progress.completedUnitCount = completed
    let percentage = Int((Double(completed) / Double(total) * 100).rounded(.down))
    task.updateTitle(
      NSLocalizedString(
        "Kavi is working",
        comment: "System-visible title for user-initiated continued processing"
      ),
      subtitle: String(
        format: NSLocalizedString(
          "%d%% complete",
          comment: "System-visible continued-processing progress percentage"
        ),
        percentage
      )
    )
    return .accepted
  }

  func complete(
    _ spec: IOSDurableTaskSpec,
    success: Bool,
    completeSharedTask: Bool
  ) -> IOSDurableSettlementResult {
    completeBoundTask(
      taskIdentifier: spec.taskIdentifier,
      kind: spec.schedulerKind,
      success: success,
      completeSharedTask: completeSharedTask
    )
  }

  func completeBoundTask(
    taskIdentifier: String,
    kind: IOSDurableSchedulerKind,
    success: Bool,
    completeSharedTask: Bool = true
  ) -> IOSDurableSettlementResult {
    switch kind {
    case .continuedProcessing:
      guard #available(iOS 26.0, *),
        let task = removeContinuedTask(identifier: taskIdentifier)
      else {
        return .unavailable
      }
      task.setTaskCompleted(success: success)
      return .accepted

    case .backgroundProcessing:
      return settleProcessingTask(
        success: success,
        completeSharedTask: completeSharedTask
      )
    }
  }

  func pendingOrActiveTaskIdentifiers(
    completion: @escaping (Set<String>) -> Void
  ) {
    scheduler.getPendingTaskRequests { [weak self] requests in
      guard let self else {
        completion(Set(requests.map(\.identifier)))
        return
      }
      activeTaskLock.lock()
      var identifiers = Set(activeContinuedTasks.keys)
      if activeProcessingTask != nil {
        identifiers.insert(processingIdentifier)
      }
      activeTaskLock.unlock()
      identifiers.formUnion(requests.map(\.identifier))
      completion(identifiers)
    }
  }

  func isTaskActive(_ identifier: String) -> Bool {
    activeTaskLock.lock()
    defer { activeTaskLock.unlock() }
    return activeContinuedTasks[identifier] != nil
      || (identifier == processingIdentifier && activeProcessingTask != nil)
  }

  private func registerProcessingHandler() -> Bool {
    register(identifier: processingIdentifier) { [weak self] task in
      guard let self, let processingTask = task as? BGProcessingTask else {
        task.setTaskCompleted(success: false)
        return
      }
      bindProcessingTask(processingTask)
    }
  }

  @available(iOS 26.0, *)
  private func registerContinuedHandler(_ identifier: String) -> Bool {
    guard identifier.hasPrefix(continuedIdentifierPrefix) else { return false }
    return register(identifier: identifier) { [weak self] task in
      guard let self, let continuedTask = task as? BGContinuedProcessingTask else {
        task.setTaskCompleted(success: false)
        return
      }
      bindContinuedTask(continuedTask)
    }
  }

  private func register(
    identifier: String,
    handler: @escaping (BGTask) -> Void
  ) -> Bool {
    registrationLock.lock()
    defer { registrationLock.unlock() }
    if registeredIdentifiers.contains(identifier) { return true }
    let registered = scheduler.register(
      forTaskWithIdentifier: identifier,
      using: handlerQueue,
      launchHandler: handler
    )
    if registered { registeredIdentifiers.insert(identifier) }
    return registered
  }

  private func bindProcessingTask(_ task: BGProcessingTask) {
    activeTaskLock.lock()
    let conflict = activeProcessingTask != nil
    if !conflict {
      activeProcessingTask = task
      activeProcessingOutcome.reset()
    }
    activeTaskLock.unlock()
    guard !conflict else {
      task.setTaskCompleted(success: false)
      return
    }
    task.expirationHandler = { [weak self, weak task] in
      guard let self, let task, removeProcessingTask(ifSame: task) != nil else { return }
      delegate?.backgroundTaskScheduler(
        self,
        expired: processingIdentifier,
        kind: .backgroundProcessing
      )
      task.setTaskCompleted(success: false)
    }
    delegate?.backgroundTaskScheduler(
      self,
      launched: processingIdentifier,
      kind: .backgroundProcessing
    )
  }

  @available(iOS 26.0, *)
  private func bindContinuedTask(_ task: BGContinuedProcessingTask) {
    let identifier = task.identifier
    activeTaskLock.lock()
    let conflict = activeContinuedTasks[identifier] != nil
    if !conflict { activeContinuedTasks[identifier] = task }
    activeTaskLock.unlock()
    guard !conflict else {
      task.setTaskCompleted(success: false)
      return
    }
    task.expirationHandler = { [weak self, weak task] in
      guard let self, let task,
        removeContinuedTask(identifier: identifier, ifSame: task) != nil
      else { return }
      delegate?.backgroundTaskScheduler(
        self,
        expired: identifier,
        kind: .continuedProcessing
      )
      task.setTaskCompleted(success: false)
    }
    task.progress.totalUnitCount = 100
    task.progress.completedUnitCount = 0
    delegate?.backgroundTaskScheduler(
      self,
      launched: identifier,
      kind: .continuedProcessing
    )
  }

  private func submit(_ request: BGTaskRequest) -> IOSDurableScheduleResult {
    do {
      try scheduler.submit(request)
      return .accepted
    } catch {
      let error = error as NSError
      guard error.domain == BGTaskScheduler.Error.errorDomain,
        let code = BGTaskScheduler.Error.Code(rawValue: error.code)
      else {
        return .unavailable
      }
      switch code {
      case .tooManyPendingTaskRequests:
        return .conflict
      case .notPermitted:
        return .terminal
      case .unavailable, .immediateRunIneligible:
        return .unavailable
      @unknown default:
        return .unavailable
      }
    }
  }

  @available(iOS 26.0, *)
  private func readContinuedTask(identifier: String) -> BGContinuedProcessingTask? {
    activeTaskLock.lock()
    defer { activeTaskLock.unlock() }
    return activeContinuedTasks[identifier] as? BGContinuedProcessingTask
  }

  @available(iOS 26.0, *)
  private func removeContinuedTask(
    identifier: String,
    ifSame expected: BGContinuedProcessingTask? = nil
  ) -> BGContinuedProcessingTask? {
    activeTaskLock.lock()
    defer { activeTaskLock.unlock() }
    guard let task = activeContinuedTasks[identifier] as? BGContinuedProcessingTask,
      expected == nil || task === expected
    else {
      return nil
    }
    activeContinuedTasks.removeValue(forKey: identifier)
    return task
  }

  private func removeProcessingTask(
    ifSame expected: BGProcessingTask? = nil
  ) -> BGProcessingTask? {
    activeTaskLock.lock()
    defer { activeTaskLock.unlock() }
    guard let task = activeProcessingTask, expected == nil || task === expected else {
      return nil
    }
    activeProcessingTask = nil
    activeProcessingOutcome.reset()
    return task
  }

  private func recordProcessingFailure() {
    activeTaskLock.lock()
    if activeProcessingTask != nil {
      activeProcessingOutcome.record(success: false)
    }
    activeTaskLock.unlock()
  }

  private func settleProcessingTask(
    success: Bool,
    completeSharedTask: Bool
  ) -> IOSDurableSettlementResult {
    activeTaskLock.lock()
    guard let task = activeProcessingTask else {
      activeTaskLock.unlock()
      return .unavailable
    }
    activeProcessingOutcome.record(success: success)
    guard completeSharedTask else {
      activeTaskLock.unlock()
      return .accepted
    }
    let aggregateSuccess = activeProcessingOutcome.completionSuccess(
      lastChildSucceeded: success
    )
    activeProcessingTask = nil
    activeProcessingOutcome.reset()
    activeTaskLock.unlock()
    task.setTaskCompleted(success: aggregateSuccess)
    return .accepted
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
