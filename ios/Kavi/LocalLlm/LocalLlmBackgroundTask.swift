import Foundation
import UIKit

final class LocalLlmBackgroundTask {
  private let lock = NSLock()
  private var taskByRequestId: [String: UIBackgroundTaskIdentifier] = [:]

  func begin(requestId: String, onExpired: @escaping () -> Void) {
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        return
      }
      self.lock.lock()
      if self.taskByRequestId[requestId] != nil {
        self.lock.unlock()
        return
      }
      self.lock.unlock()

      var taskId = UIBackgroundTaskIdentifier.invalid
      taskId = UIApplication.shared.beginBackgroundTask(withName: "KaviLocalLlm") { [weak self] in
        onExpired()
        self?.end(requestId: requestId)
      }
      guard taskId != .invalid else {
        onExpired()
        return
      }

      self.lock.lock()
      self.taskByRequestId[requestId] = taskId
      self.lock.unlock()
    }
  }

  func end(requestId: String) {
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        return
      }
      self.lock.lock()
      let taskId = self.taskByRequestId.removeValue(forKey: requestId)
      self.lock.unlock()
      guard let taskId, taskId != .invalid else {
        return
      }
      UIApplication.shared.endBackgroundTask(taskId)
    }
  }

  func endAll() {
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        return
      }
      self.lock.lock()
      let taskIds = Array(self.taskByRequestId.values)
      self.taskByRequestId.removeAll()
      self.lock.unlock()
      taskIds
        .filter { $0 != .invalid }
        .forEach(UIApplication.shared.endBackgroundTask)
    }
  }
}
