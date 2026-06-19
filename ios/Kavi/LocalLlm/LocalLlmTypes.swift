import Foundation
import LiteRTLM

enum LocalLlmBridgeError: Error, LocalizedError {
  case cancelled
  case invalidRequest(String)
  case unsupportedRole(String)
  case insufficientMemory(requiredGb: Int, availableGb: Double)

  var errorDescription: String? {
    switch self {
    case .cancelled:
      return "The on-device request was cancelled."
    case .invalidRequest(let message):
      return message
    case .unsupportedRole(let role):
      return "Unsupported conversation message role: \(role)"
    case .insufficientMemory(let requiredGb, let availableGb):
      return String(
        format: "This model requires at least %d GB of device memory; this device reports %.2f GB.",
        requiredGb,
        availableGb
      )
    }
  }
}

struct LocalLlmToolCallEntry {
  let name: String
  let arguments: [String: Any]
}

struct LocalLlmToolResponseEntry {
  let name: String
  let response: Any?
}

struct LocalLlmToolDefinitionEntry {
  let name: String
  let description: String
  let parameters: [String: Any]
}

struct LocalLlmHistoryEntry {
  let role: String
  let content: String?
  let toolCalls: [LocalLlmToolCallEntry]
  let toolResponses: [LocalLlmToolResponseEntry]
}

protocol LocalLlmEngineRequest {
  var modelPath: String { get }
  var backend: String { get }
  var visionBackend: String? { get }
  var audioBackend: String? { get }
  var maxTokens: Int { get }
  var contextWindowTokens: Int { get }
  var topK: Int? { get }
  var topP: Float? { get }
  var temperature: Float? { get }
  var minDeviceMemoryGb: Int? { get }
}

struct LocalLlmRequest: LocalLlmEngineRequest {
  let requestId: String
  let conversationKey: String?
  let modelPath: String
  let prompt: String?
  let systemPrompt: String?
  let history: [LocalLlmHistoryEntry]
  let currentMessage: LocalLlmHistoryEntry?
  let tools: [LocalLlmToolDefinitionEntry]
  let backend: String
  let visionBackend: String?
  let audioBackend: String?
  let maxTokens: Int
  let contextWindowTokens: Int
  let topK: Int?
  let topP: Float?
  let temperature: Float?
  let enableConstrainedDecoding: Bool
  let minDeviceMemoryGb: Int?
}

struct LocalLlmWarmupRequest: LocalLlmEngineRequest {
  let conversationKey: String?
  let modelPath: String
  let systemPrompt: String?
  let tools: [LocalLlmToolDefinitionEntry]
  let backend: String
  let visionBackend: String?
  let audioBackend: String?
  let maxTokens: Int
  let contextWindowTokens: Int
  let topK: Int?
  let topP: Float?
  let temperature: Float?
  let enableConstrainedDecoding: Bool
  let minDeviceMemoryGb: Int?
}

struct LocalLlmEngineKey: Hashable {
  let modelPath: String
  let backend: String
  let visionBackend: String?
  let audioBackend: String?

  func cpuFallback() -> LocalLlmEngineKey {
    LocalLlmEngineKey(
      modelPath: modelPath,
      backend: "cpu",
      visionBackend: visionBackend == nil ? nil : "cpu",
      audioBackend: audioBackend == nil ? nil : "cpu"
    )
  }
}

struct LocalLlmConversationCacheKey: Hashable {
  let engineKey: LocalLlmEngineKey
  let conversationKey: String
}

final class LocalLlmEngineState {
  let key: LocalLlmEngineKey
  let engine: Engine
  let contextWindowTokens: Int

  init(key: LocalLlmEngineKey, engine: Engine, contextWindowTokens: Int) {
    self.key = key
    self.engine = engine
    self.contextWindowTokens = contextWindowTokens
  }
}

final class LocalLlmConversationState {
  let conversation: Conversation
  let configSignature: String
  var transcriptSignature: String
  var lastAccessedAt: TimeInterval
  var activeRequestId: String?

  init(
    conversation: Conversation,
    configSignature: String,
    transcriptSignature: String,
    lastAccessedAt: TimeInterval
  ) {
    self.conversation = conversation
    self.configSignature = configSignature
    self.transcriptSignature = transcriptSignature
    self.lastAccessedAt = lastAccessedAt
  }
}

struct LocalLlmGenerationResult {
  let text: String
  let toolCalls: [LocalLlmToolCallResult]
  let backend: String

  func toDictionary() -> [String: Any] {
    var dictionary: [String: Any] = [
      "text": text,
      "backend": backend,
    ]
    if !toolCalls.isEmpty {
      dictionary["toolCalls"] = toolCalls.map { $0.toDictionary() }
    }
    return dictionary
  }
}

struct LocalLlmToolCallResult {
  let id: String
  let name: String
  let arguments: [String: Any]

  func toDictionary() -> [String: Any] {
    [
      "id": id,
      "name": name,
      "arguments": arguments,
    ]
  }
}
