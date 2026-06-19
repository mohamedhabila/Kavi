import Foundation
import React

@objc(KaviLocalLlm)
class KaviLocalLlm: RCTEventEmitter {
  private let streamEventName = "KaviLocalLlmStream"
  private let requestParser = LocalLlmRequestParser()
  private let runtime = LocalLlmRuntime()
  private let backgroundTask = LocalLlmBackgroundTask()
  private let activeTaskLock = NSLock()
  private var activeTasks: [String: Task<Void, Never>] = [:]

  private lazy var events = LocalLlmEvents(
    emit: { [weak self] body in
      self?.sendEvent(withName: self?.streamEventName ?? "KaviLocalLlmStream", body: body)
    }
  )

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    [streamEventName]
  }

  @objc
  func getAvailability(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    Task { [runtime] in
      let availability = await runtime.getAvailability()
      resolveOnMain(resolve, availability)
    }
  }

  @objc
  func warmup(_ request: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let parsed: LocalLlmWarmupRequest
    do {
      parsed = try requestParser.parseWarmupRequest(request)
    } catch {
      reject("LOCAL_LLM_INVALID_REQUEST", error.localizedDescription, error)
      return
    }

    Task { [runtime] in
      do {
        let result = try await runtime.warmup(parsed)
        resolveOnMain(resolve, result)
      } catch {
        rejectOnMain(reject, "LOCAL_LLM_WARMUP_FAILED", error)
      }
    }
  }

  @objc
  func generate(_ request: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let parsed: LocalLlmRequest
    do {
      parsed = try requestParser.parseRequest(request)
    } catch {
      reject("LOCAL_LLM_INVALID_REQUEST", error.localizedDescription, error)
      return
    }

    let task = Task { [weak self, runtime] in
      defer {
        self?.backgroundTask.end(requestId: parsed.requestId)
        self?.removeTask(parsed.requestId)
      }
      do {
        let result = try await runtime.generate(parsed)
        resolveOnMain(resolve, result.toDictionary())
      } catch is CancellationError {
        rejectOnMain(reject, "LOCAL_LLM_CANCELLED", LocalLlmBridgeError.cancelled)
      } catch {
        rejectOnMain(reject, "LOCAL_LLM_GENERATE_FAILED", error)
      }
    }
    storeTask(parsed.requestId, task)
    backgroundTask.begin(requestId: parsed.requestId) { [weak self, runtime] in
      self?.cancelTask(parsed.requestId)
      Task { await runtime.cancel(requestId: parsed.requestId) }
    }
  }

  @objc
  func startStreaming(_ request: NSDictionary, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let parsed: LocalLlmRequest
    do {
      parsed = try requestParser.parseRequest(request)
    } catch {
      reject("LOCAL_LLM_INVALID_REQUEST", error.localizedDescription, error)
      return
    }

    let task = Task { [weak self, runtime, events] in
      defer {
        self?.backgroundTask.end(requestId: parsed.requestId)
        self?.removeTask(parsed.requestId)
      }
      do {
        let backend = try await runtime.stream(parsed, events: events)
        events.emitDone(requestId: parsed.requestId, backend: backend)
      } catch {
        if Task.isCancelled {
          events.emitDone(requestId: parsed.requestId, backend: nil)
        } else {
          events.emitError(requestId: parsed.requestId, message: error.localizedDescription)
        }
      }
    }
    storeTask(parsed.requestId, task)
    backgroundTask.begin(requestId: parsed.requestId) { [weak self, runtime] in
      self?.cancelTask(parsed.requestId)
      Task { await runtime.cancel(requestId: parsed.requestId) }
    }
    resolve(nil)
  }

  @objc
  func cancel(_ requestId: NSString, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let id = requestId as String
    cancelTask(id)
    Task { [runtime] in
      await runtime.cancel(requestId: id)
      resolveOnMain(resolve, nil)
    }
  }

  override func invalidate() {
    super.invalidate()
    let tasks = clearTasks()
    tasks.forEach { $0.cancel() }
    backgroundTask.endAll()
    Task { [runtime] in
      await runtime.cancelAll()
    }
  }

  private func storeTask(_ requestId: String, _ task: Task<Void, Never>) {
    activeTaskLock.lock()
    activeTasks[requestId] = task
    activeTaskLock.unlock()
  }

  private func removeTask(_ requestId: String) {
    activeTaskLock.lock()
    activeTasks.removeValue(forKey: requestId)
    activeTaskLock.unlock()
  }

  private func cancelTask(_ requestId: String) {
    activeTaskLock.lock()
    let task = activeTasks[requestId]
    activeTaskLock.unlock()
    task?.cancel()
  }

  private func clearTasks() -> [Task<Void, Never>] {
    activeTaskLock.lock()
    let tasks = Array(activeTasks.values)
    activeTasks.removeAll()
    activeTaskLock.unlock()
    return tasks
  }
}

private func resolveOnMain(_ resolve: @escaping RCTPromiseResolveBlock, _ value: Any?) {
  DispatchQueue.main.async {
    resolve(value)
  }
}

private func rejectOnMain(_ reject: @escaping RCTPromiseRejectBlock, _ code: String, _ error: Error) {
  DispatchQueue.main.async {
    reject(code, error.localizedDescription, error)
  }
}
