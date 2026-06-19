import Foundation

public struct EngineConfig {
  public let modelPath: String
  public let backend: Backend
  public let visionBackend: Backend?
  public let audioBackend: Backend?
  public let maxNumTokens: Int?
  public let cacheDir: String?

  public init(
    modelPath: String,
    backend: Backend = .cpu(),
    visionBackend: Backend? = nil,
    audioBackend: Backend? = nil,
    maxNumTokens: Int? = nil,
    cacheDir: String? = nil
  ) throws {
    if let maxNumTokens, maxNumTokens <= 0 {
      throw LiteRTLMError.config(.invalidMaxNumTokens)
    }
    self.modelPath = modelPath
    self.backend = backend
    self.visionBackend = visionBackend
    self.audioBackend = audioBackend
    self.maxNumTokens = maxNumTokens
    self.cacheDir = cacheDir
  }
}

public struct SamplerConfig {
  public let topK: Int
  public let topP: Float
  public let temperature: Float
  public let seed: Int

  public init(topK: Int, topP: Float, temperature: Float, seed: Int = 0) throws {
    if topK <= 0 {
      throw LiteRTLMError.config(.invalidTopK)
    }
    if topP < 0 || topP > 1 {
      throw LiteRTLMError.config(.invalidTopP)
    }
    if temperature < 0 {
      throw LiteRTLMError.config(.invalidTemperature)
    }
    self.topK = topK
    self.topP = topP
    self.temperature = temperature
    self.seed = seed
  }
}

public struct ToolDefinition {
  public let name: String
  public let description: String
  public let parameters: [String: Any]

  public init(name: String, description: String, parameters: [String: Any]) {
    self.name = name
    self.description = description
    self.parameters = parameters
  }

  var toJson: [String: Any] {
    [
      "type": "function",
      "function": [
        "name": name,
        "description": description,
        "parameters": parameters,
      ],
    ]
  }
}

public struct ConversationConfig {
  public let systemMessage: Message?
  public let initialMessages: [Message]
  public let tools: [ToolDefinition]
  public let samplerConfig: SamplerConfig?

  public init(
    systemMessage: Message? = nil,
    initialMessages: [Message] = [],
    tools: [ToolDefinition] = [],
    samplerConfig: SamplerConfig? = nil
  ) {
    self.systemMessage = systemMessage.map { message in
      message.role == .system
        ? message
        : Message(contents: message.contents, role: .system, channels: message.channels)
    }
    self.initialMessages = initialMessages
    self.tools = tools
    self.samplerConfig = samplerConfig
  }

  var toolsJsonString: String {
    get throws {
      guard !tools.isEmpty else {
        return ""
      }
      let data = try JSONSerialization.data(withJSONObject: tools.map { $0.toJson }, options: [])
      guard let string = String(data: data, encoding: .utf8) else {
        throw LiteRTLMError.config(.invalidTools)
      }
      return string
    }
  }
}
