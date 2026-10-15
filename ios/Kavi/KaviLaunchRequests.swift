import Foundation
import React

extension Notification.Name {
  static let kaviLaunchRequestSubmitted = Notification.Name("KaviLaunchRequestSubmitted")
}

/// The one pending request to open Kavi a particular way, left by an App Intent (Siri,
/// Shortcuts, the Action button). An intent that opens the app gives React Native no launch
/// URL, so JS reads the request from here, once, at startup and whenever one arrives.
final class KaviLaunchRequestStore {
  static let shared = KaviLaunchRequestStore()

  private let lock = NSLock()
  private var pendingURL: String?

  func submit(_ url: String) {
    lock.lock()
    pendingURL = url
    lock.unlock()
    NotificationCenter.default.post(name: .kaviLaunchRequestSubmitted, object: nil)
  }

  func consume() -> String? {
    lock.lock()
    defer { lock.unlock() }
    let url = pendingURL
    pendingURL = nil
    return url
  }
}

@objc(KaviLaunchRequests)
class KaviLaunchRequests: RCTEventEmitter {
  private static let requestEventName = "KaviLaunchRequest"
  private var hasListeners = false
  private var observer: NSObjectProtocol?

  override init() {
    super.init()
    observer = NotificationCenter.default.addObserver(
      forName: .kaviLaunchRequestSubmitted,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      guard let self, self.hasListeners else { return }
      self.sendEvent(withName: Self.requestEventName, body: nil)
    }
  }

  deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }
  }

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    [Self.requestEventName]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc
  func consumePendingLaunchRequest(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    resolve(KaviLaunchRequestStore.shared.consume())
  }
}
