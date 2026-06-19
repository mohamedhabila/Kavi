import Foundation

public enum LiteRTLMError: Error, LocalizedError, Equatable {
  case engine(EngineError)
  case conversation(ConversationError)
  case config(ConfigError)
  case message(MessageError)

  public var errorDescription: String? {
    switch self {
    case .engine(let error):
      return error.errorDescription
    case .conversation(let error):
      return error.errorDescription
    case .config(let error):
      return error.errorDescription
    case .message(let error):
      return error.errorDescription
    }
  }

  public enum EngineError: Error, LocalizedError, Equatable {
    case alreadyInitialized
    case failedToCreateSettings
    case failedToCreateEngine
    case notInitialized
    case failedToCreateSessionConfig
    case failedToCreateConversationConfig
    case failedToCreateConversation

    public var errorDescription: String? {
      switch self {
      case .alreadyInitialized:
        return "Engine is already initialized."
      case .failedToCreateSettings:
        return "Failed to create engine settings."
      case .failedToCreateEngine:
        return "Failed to create engine."
      case .notInitialized:
        return "Engine is not initialized."
      case .failedToCreateSessionConfig:
        return "Failed to create session config."
      case .failedToCreateConversationConfig:
        return "Failed to create conversation config."
      case .failedToCreateConversation:
        return "Failed to create conversation."
      }
    }
  }

  public enum ConversationError: Error, LocalizedError, Equatable {
    case notAlive
    case failedToSerializeMessage
    case invalidResponse(String)
    case failedToStartStream(status: Int)
    case invalidJson(String)

    public var errorDescription: String? {
      switch self {
      case .notAlive:
        return "Conversation is not alive."
      case .failedToSerializeMessage:
        return "Failed to serialize message to JSON string."
      case .invalidResponse(let details):
        return "Invalid response from native layer: \(details)"
      case .failedToStartStream(let status):
        return "Failed to start stream. Status: \(status)"
      case .invalidJson(let details):
        return "Invalid JSON: \(details)"
      }
    }
  }

  public enum ConfigError: Error, LocalizedError, Equatable {
    case invalidMaxNumTokens
    case invalidTopK
    case invalidTopP
    case invalidTemperature
    case multipleSystemMessages
    case invalidTools

    public var errorDescription: String? {
      switch self {
      case .invalidMaxNumTokens:
        return "maxNumTokens must be positive or nil."
      case .invalidTopK:
        return "topK must be positive."
      case .invalidTopP:
        return "topP must be between 0 and 1."
      case .invalidTemperature:
        return "temperature must be non-negative."
      case .multipleSystemMessages:
        return "Cannot set both systemMessage and system messages in initialMessages."
      case .invalidTools:
        return "Failed to serialize tool definitions."
      }
    }
  }

  public enum MessageError: Error, LocalizedError, Equatable {
    case failedToConvertToJson
    case invalidContent

    public var errorDescription: String? {
      switch self {
      case .failedToConvertToJson:
        return "Failed to convert message to JSON."
      case .invalidContent:
        return "No message content found."
      }
    }
  }
}
