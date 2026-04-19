import Foundation
import React
import MediaPipeTasksGenAI
import MediaPipeTasksGenAIC

@objc(KaviLocalLlm)
class KaviLocalLlm: RCTEventEmitter {
  private struct HistoryEntry {
    let role: String
    let content: String
  }

  private struct LocalRequest {
    let requestId: String
    let modelPath: String
    let runtime: String
    let prompt: String
    let systemPrompt: String?
    let history: [HistoryEntry]
    let maxTokens: Int
  }

  private final class ActiveRequest {
    let task: Task<Void, Never>
    let inference: NSObject?

    init(task: Task<Void, Never>, inference: NSObject?) {
      self.task = task
      self.inference = inference
    }
  }

  private let streamEventName = "KaviLocalLlmStream"
  private let activeRequestsLock = NSLock()
  private var activeRequests: [String: ActiveRequest] = [:]

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    [streamEventName]
  }

  @objc
  func getAvailability(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve([
      "available": true,
      "linked": true,
      "platform": "ios",
      "runtime": "mediapipe-genai",
      "supportsStreaming": true,
      "deviceMemoryGb": NSNull(),
      "lowMemoryDevice": false,
      "reason": NSNull(),
    ])
  }

  @objc
  func generate(_ request: NSDictionary, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let parsed: LocalRequest
    do {
      parsed = try parseRequest(request)
    } catch {
      reject("LOCAL_LLM_INVALID_REQUEST", error.localizedDescription, error)
      return
    }

    let inference: LlmInference
    do {
      inference = try createInference(modelPath: parsed.modelPath, maxTokens: parsed.maxTokens)
    } catch {
      reject("LOCAL_LLM_LOAD_FAILED", error.localizedDescription, error)
      return
    }

    let task = Task(priority: .userInitiated) { [weak self] in
      defer {
        self?.removeActiveRequest(parsed.requestId)
        self?.closeIfPossible(inference as? NSObject)
      }

      do {
        let text = try await self?.runInference(parsed, inference: inference) ?? ""
        DispatchQueue.main.async {
          resolve(["text": text])
        }
      } catch is CancellationError {
        DispatchQueue.main.async {
          reject("LOCAL_LLM_CANCELLED", "The on-device request was cancelled.", nil)
        }
      } catch {
        DispatchQueue.main.async {
          reject("LOCAL_LLM_GENERATE_FAILED", error.localizedDescription, error)
        }
      }
    }

    storeActiveRequest(parsed.requestId, task: task, inference: inference as? NSObject)
  }

  @objc
  func startStreaming(_ request: NSDictionary, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let parsed: LocalRequest
    do {
      parsed = try parseRequest(request)
    } catch {
      reject("LOCAL_LLM_INVALID_REQUEST", error.localizedDescription, error)
      return
    }

    let inference: LlmInference
    do {
      inference = try createInference(modelPath: parsed.modelPath, maxTokens: parsed.maxTokens)
    } catch {
      reject("LOCAL_LLM_LOAD_FAILED", error.localizedDescription, error)
      return
    }

    let task = Task(priority: .userInitiated) { [weak self] in
      defer {
        self?.removeActiveRequest(parsed.requestId)
        self?.closeIfPossible(inference as? NSObject)
      }

      do {
        try await self?.runStreamingInference(parsed, inference: inference)
        self?.emitDone(parsed.requestId)
      } catch is CancellationError {
        self?.emitDone(parsed.requestId)
      } catch {
        self?.emitError(parsed.requestId, error.localizedDescription)
      }
    }

    storeActiveRequest(parsed.requestId, task: task, inference: inference as? NSObject)
    resolve(nil)
  }

  @objc
  func cancel(_ requestId: NSString, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    if let activeRequest = removeActiveRequest(requestId as String) {
      activeRequest.task.cancel()
      cancelIfPossible(activeRequest.inference)
    }
    resolve(nil)
  }

  override func invalidate() {
    super.invalidate()
    activeRequestsLock.lock()
    let active = activeRequests.values
    activeRequests.removeAll()
    activeRequestsLock.unlock()

    for request in active {
      request.task.cancel()
      cancelIfPossible(request.inference)
    }
  }

  private func parseRequest(_ request: NSDictionary) throws -> LocalRequest {
    let requestId = (request["requestId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let modelPath = (request["modelPath"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let runtime = (request["runtime"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "mediapipe-genai"
    let prompt = (request["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let systemPrompt = (request["systemPrompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
      .flatMap { $0.isEmpty ? nil : $0 }
    let history = parseHistory(request["history"] as? NSArray)
    let maxTokens = max((request["maxTokens"] as? NSNumber)?.intValue ?? 1024, 1)

    guard !requestId.isEmpty else {
      throw NSError(domain: "KaviLocalLlm", code: 1, userInfo: [NSLocalizedDescriptionKey: "requestId is required."])
    }
    guard !modelPath.isEmpty else {
      throw NSError(domain: "KaviLocalLlm", code: 1, userInfo: [NSLocalizedDescriptionKey: "modelPath is required."])
    }
    guard !prompt.isEmpty else {
      throw NSError(domain: "KaviLocalLlm", code: 1, userInfo: [NSLocalizedDescriptionKey: "prompt is required."])
    }

    return LocalRequest(
      requestId: requestId,
      modelPath: modelPath,
      runtime: runtime,
      prompt: prompt,
      systemPrompt: systemPrompt,
      history: history,
      maxTokens: maxTokens
    )
  }

  private func parseHistory(_ historyArray: NSArray?) -> [HistoryEntry] {
    guard let historyArray else {
      return []
    }

    return historyArray.compactMap { item in
      guard
        let entry = item as? NSDictionary,
        let role = (entry["role"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
        let content = (entry["content"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
        !role.isEmpty,
        !content.isEmpty
      else {
        return nil
      }

      return HistoryEntry(role: role, content: content)
    }
  }

  private func createInference(modelPath: String, maxTokens: Int) throws -> LlmInference {
    let options = LlmInference.Options(modelPath: modelPath)
    options.maxTokens = maxTokens
    return try LlmInference(options: options)
  }

  private func createSession(for inference: LlmInference) throws -> LlmInference.Session {
    let options = LlmInference.Session.Options()
    options.topk = 64
    options.topp = 0.95
    options.temperature = 1.0
    return try LlmInference.Session(llmInference: inference, options: options)
  }

  private func runInference(_ request: LocalRequest, inference: LlmInference) async throws -> String {
    let session = try createSession(for: inference)
    defer {
      closeIfPossible(session as? NSObject)
    }

    try session.addQueryChunk(inputText: renderPrompt(for: request))

    var output = ""
    let responseStream = session.generateResponseAsync()
    for try await chunk in responseStream {
      try Task.checkCancellation()
      output += chunk
    }
    return output
  }

  private func runStreamingInference(_ request: LocalRequest, inference: LlmInference) async throws {
    let session = try createSession(for: inference)
    defer {
      closeIfPossible(session as? NSObject)
    }

    try session.addQueryChunk(inputText: renderPrompt(for: request))

    let responseStream = session.generateResponseAsync()
    for try await chunk in responseStream {
      try Task.checkCancellation()
      emitToken(request.requestId, chunk)
    }
  }

  private func renderPrompt(for request: LocalRequest) -> String {
    var rendered = ""

    if let systemPrompt = request.systemPrompt, !systemPrompt.isEmpty {
      rendered += renderTurn(role: "user", content: systemPrompt)
    }

    for entry in request.history {
      let role = entry.role == "assistant" ? "model" : "user"
      rendered += renderTurn(role: role, content: entry.content)
    }

    rendered += renderTurn(role: "user", content: request.prompt, closeTurn: true)
    rendered += "<start_of_turn>model\n"
    return rendered
  }

  private func renderTurn(role: String, content: String, closeTurn: Bool = true) -> String {
    var rendered = "<start_of_turn>\(role)\n\(content)"
    if closeTurn {
      rendered += "<end_of_turn>\n"
    }
    return rendered
  }

  private func emitToken(_ requestId: String, _ content: String) {
    emit([
      "requestId": requestId,
      "type": "token",
      "content": content,
    ])
  }

  private func emitDone(_ requestId: String) {
    emit([
      "requestId": requestId,
      "type": "done",
    ])
  }

  private func emitError(_ requestId: String, _ error: String) {
    emit([
      "requestId": requestId,
      "type": "error",
      "error": error,
    ])
  }

  private func emit(_ body: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      self?.sendEvent(withName: self?.streamEventName ?? "KaviLocalLlmStream", body: body)
    }
  }

  private func storeActiveRequest(_ requestId: String, task: Task<Void, Never>, inference: NSObject?) {
    activeRequestsLock.lock()
    activeRequests[requestId] = ActiveRequest(task: task, inference: inference)
    activeRequestsLock.unlock()
  }

  @discardableResult
  private func removeActiveRequest(_ requestId: String) -> ActiveRequest? {
    activeRequestsLock.lock()
    let activeRequest = activeRequests.removeValue(forKey: requestId)
    activeRequestsLock.unlock()
    return activeRequest
  }

  private func cancelIfPossible(_ inference: NSObject?) {
    guard let inference else {
      return
    }

    let selector = NSSelectorFromString("cancelProcessing")
    if inference.responds(to: selector) {
      _ = inference.perform(selector)
    }
  }

  private func closeIfPossible(_ object: NSObject?) {
    guard let object else {
      return
    }

    let selector = NSSelectorFromString("close")
    if object.responds(to: selector) {
      _ = object.perform(selector)
    }
  }
}