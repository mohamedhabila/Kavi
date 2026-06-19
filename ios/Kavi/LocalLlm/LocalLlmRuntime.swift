import Foundation
import LiteRTLM

private let maxCachedLocalLlmConversationsPerEngine = 2

actor LocalLlmRuntime {
  private let adapter = LocalLlmMessageAdapter()
  private let deviceInfo = LocalLlmDeviceInfo()
  private let metrics = LocalLlmRuntimeMetrics()
  private var engines: [LocalLlmEngineKey: LocalLlmEngineState] = [:]
  private var conversations: [LocalLlmConversationCacheKey: LocalLlmConversationState] = [:]
  private var activeConversations: [String: LocalLlmConversationState] = [:]
  private var runtimeBusy = false
  private var runtimeWaiters: [CheckedContinuation<Void, Never>] = []

  func getAvailability() -> [String: Any] {
    deviceInfo.availability(metrics: metrics)
  }

  func warmup(_ request: LocalLlmWarmupRequest) async throws -> [String: Any] {
    try deviceInfo.validateMemory(minDeviceMemoryGb: request.minDeviceMemoryGb)
    let state = try await engine(for: request)
    _ = try adapter.conversationConfig(for: request)
    return ["backend": state.key.backend]
  }

  func generate(_ request: LocalLlmRequest) async throws -> LocalLlmGenerationResult {
    try await acquireRuntimeSlot()
    defer { releaseRuntimeSlot() }

    try deviceInfo.validateMemory(minDeviceMemoryGb: request.minDeviceMemoryGb)
    let state = try await engine(for: request)
    let conversation = try await conversationState(for: request, engineState: state)
    let message = try adapter.currentMessage(for: request)
    markActive(request.requestId, conversation)
    defer { clearActive(request.requestId) }

    let response = try await conversation.conversation.sendMessage(message)
    conversation.transcriptSignature = try adapter.committedTranscriptSignature(
      for: request,
      response: response
    )
    return adapter.generationResult(from: response, requestId: request.requestId, backend: state.key.backend)
  }

  func stream(_ request: LocalLlmRequest, events: LocalLlmEvents) async throws -> String {
    try await acquireRuntimeSlot()
    defer { releaseRuntimeSlot() }

    try deviceInfo.validateMemory(minDeviceMemoryGb: request.minDeviceMemoryGb)
    let state = try await engine(for: request)
    let conversation = try await conversationState(for: request, engineState: state)
    let message = try adapter.currentMessage(for: request)
    var output = ""
    var toolCalls: [ToolCall] = []
    var emittedToolCallOccurrences: [String: Int] = [:]
    var emittedToolCallCount = 0
    markActive(request.requestId, conversation)
    defer { clearActive(request.requestId) }

    for try await chunk in conversation.conversation.sendMessageStream(message) {
      let text = chunk.toString
      if !text.isEmpty {
        output += text
        events.emitToken(requestId: request.requestId, content: text, backend: state.key.backend)
      }
      let newToolCalls = try adapter.newToolCallResults(
        from: chunk.toolCalls,
        requestId: request.requestId,
        emittedOccurrences: &emittedToolCallOccurrences,
        emittedCount: emittedToolCallCount
      )
      if !newToolCalls.results.isEmpty {
        emittedToolCallCount += newToolCalls.results.count
        toolCalls.append(contentsOf: newToolCalls.toolCalls)
        newToolCalls.results.forEach { toolCall in
          events.emitToolCall(requestId: request.requestId, toolCall: toolCall, backend: state.key.backend)
        }
      }
    }

    let response: Message?
    if output.isEmpty && toolCalls.isEmpty {
      response = nil
    } else {
      response = Message(
        contents: output.isEmpty ? Contents.empty() : Contents.of(output),
        role: .model,
        toolCalls: toolCalls
      )
    }
    conversation.transcriptSignature = try adapter.committedTranscriptSignature(
      for: request,
      response: response
    )
    return state.key.backend
  }

  func cancel(requestId: String) {
    guard let conversation = activeConversations[requestId] else {
      return
    }
    metrics.activeRequestCancelCount += 1
    try? conversation.conversation.cancel()
  }

  func cancelAll() {
    for conversation in activeConversations.values {
      try? conversation.conversation.cancel()
    }
    metrics.activeRequestCancelCount += activeConversations.count
    activeConversations.removeAll()
  }

  private func engine(for request: LocalLlmEngineRequest) async throws -> LocalLlmEngineState {
    let key = try engineKey(for: request)
    if let existing = engines[key], existing.contextWindowTokens >= request.contextWindowTokens {
      metrics.engineReuseCount += 1
      return existing
    }

    do {
      let created = try await createInitializedEngine(key: key, contextWindowTokens: request.contextWindowTokens)
      engines[key] = created
      metrics.engineCreateCount += 1
      return created
    } catch {
      guard key.backend != "cpu" else {
        throw error
      }
      metrics.backendFallbackCount += 1
      let fallbackKey = key.cpuFallback()
      if let existing = engines[fallbackKey], existing.contextWindowTokens >= request.contextWindowTokens {
        metrics.engineReuseCount += 1
        return existing
      }
      let fallback = try await createInitializedEngine(
        key: fallbackKey,
        contextWindowTokens: request.contextWindowTokens
      )
      engines[fallbackKey] = fallback
      metrics.engineCreateCount += 1
      return fallback
    }
  }

  private func engineKey(for request: LocalLlmEngineRequest) throws -> LocalLlmEngineKey {
    LocalLlmEngineKey(
      modelPath: request.modelPath,
      backend: try normalizeLocalLlmIosAccelerator(request.backend),
      visionBackend: try request.visionBackend.map(normalizeLocalLlmIosAccelerator),
      audioBackend: try request.audioBackend.map(normalizeLocalLlmIosAccelerator)
    )
  }

  private func createInitializedEngine(
    key: LocalLlmEngineKey,
    contextWindowTokens: Int
  ) async throws -> LocalLlmEngineState {
    do {
      let config = try EngineConfig(
        modelPath: key.modelPath,
        backend: try resolveLocalLlmIosBackend(key.backend),
        visionBackend: try key.visionBackend.map(resolveLocalLlmIosBackend),
        audioBackend: try key.audioBackend.map(resolveLocalLlmIosBackend),
        maxNumTokens: contextWindowTokens,
        cacheDir: NSTemporaryDirectory()
      )
      let engine = Engine(engineConfig: config)
      try await engine.initialize()
      return LocalLlmEngineState(key: key, engine: engine, contextWindowTokens: contextWindowTokens)
    } catch {
      throw LocalLlmAcceleratorInitializationError(accelerator: key.backend, underlyingError: error)
    }
  }

  private func conversationState(
    for request: LocalLlmRequest,
    engineState: LocalLlmEngineState
  ) async throws -> LocalLlmConversationState {
    let configSignature = try adapter.configSignature(for: request)
    let transcriptSignature = try adapter.transcriptSignature(for: request.history)
    guard let conversationKey = request.conversationKey, !conversationKey.isEmpty else {
      return try await createConversationState(
        request: request,
        engineState: engineState,
        configSignature: configSignature,
        transcriptSignature: transcriptSignature
      )
    }

    let cacheKey = LocalLlmConversationCacheKey(engineKey: engineState.key, conversationKey: conversationKey)
    if let cached = conversations[cacheKey],
      cached.configSignature == configSignature,
      cached.transcriptSignature == transcriptSignature,
      cached.activeRequestId == nil
    {
      cached.lastAccessedAt = Date().timeIntervalSince1970
      metrics.conversationReuseCount += 1
      return cached
    }

    let created = try await createConversationState(
      request: request,
      engineState: engineState,
      configSignature: configSignature,
      transcriptSignature: transcriptSignature
    )
    conversations[cacheKey] = created
    trimConversations(for: engineState.key)
    return created
  }

  private func createConversationState(
    request: LocalLlmRequest,
    engineState: LocalLlmEngineState,
    configSignature: String,
    transcriptSignature: String
  ) async throws -> LocalLlmConversationState {
    ExperimentalFlags.enableConversationConstrainedDecoding = request.enableConstrainedDecoding
    let config = try adapter.conversationConfig(for: request)
    let conversation = try await engineState.engine.createConversation(with: config)
    metrics.conversationCreateCount += 1
    return LocalLlmConversationState(
      conversation: conversation,
      configSignature: configSignature,
      transcriptSignature: transcriptSignature,
      lastAccessedAt: Date().timeIntervalSince1970
    )
  }

  private func markActive(_ requestId: String, _ conversation: LocalLlmConversationState) {
    conversation.activeRequestId = requestId
    activeConversations[requestId] = conversation
    metrics.activeRequestStartCount += 1
  }

  private func clearActive(_ requestId: String) {
    activeConversations[requestId]?.activeRequestId = nil
    activeConversations.removeValue(forKey: requestId)
    metrics.activeRequestEndCount += 1
  }

  private func trimConversations(for engineKey: LocalLlmEngineKey) {
    let scoped = conversations.filter { $0.key.engineKey == engineKey }
    guard scoped.count > maxCachedLocalLlmConversationsPerEngine else {
      return
    }
    let removals = scoped.sorted { $0.value.lastAccessedAt < $1.value.lastAccessedAt }
      .prefix(scoped.count - maxCachedLocalLlmConversationsPerEngine)
    for removal in removals where removal.value.activeRequestId == nil {
      conversations.removeValue(forKey: removal.key)
    }
  }

  private func acquireRuntimeSlot() async throws {
    if Task.isCancelled {
      throw LocalLlmBridgeError.cancelled
    }
    if !runtimeBusy {
      runtimeBusy = true
      return
    }
    await withCheckedContinuation { continuation in
      runtimeWaiters.append(continuation)
    }
    if Task.isCancelled {
      releaseRuntimeSlot()
      throw LocalLlmBridgeError.cancelled
    }
  }

  private func releaseRuntimeSlot() {
    if runtimeWaiters.isEmpty {
      runtimeBusy = false
      return
    }
    let next = runtimeWaiters.removeFirst()
    next.resume()
  }
}
