import Foundation

private let defaultLocalLlmBackend = "cpu"
private let defaultLocalLlmMaxTokens = 1024
private let defaultLocalLlmContextWindowTokens = 4096

final class LocalLlmRequestParser {
  func parseRequest(_ dictionary: NSDictionary) throws -> LocalLlmRequest {
    let requestId = try requiredString(dictionary, key: "requestId")
    let modelPath = try requiredString(dictionary, key: "modelPath")
    let prompt = optionalString(dictionary, key: "prompt")
    let currentMessage = try optionalMessage(dictionary, key: "currentMessage")

    if (prompt?.isEmpty ?? true) && currentMessage == nil {
      throw LocalLlmBridgeError.invalidRequest("On-device requests require a prompt or current message.")
    }

    return LocalLlmRequest(
      requestId: requestId,
      conversationKey: optionalString(dictionary, key: "conversationKey"),
      modelPath: modelPath,
      prompt: prompt,
      systemPrompt: optionalString(dictionary, key: "systemPrompt"),
      history: try messages(dictionary["history"]),
      currentMessage: currentMessage,
      tools: try tools(dictionary["tools"]),
      backend: optionalString(dictionary, key: "backend") ?? defaultLocalLlmBackend,
      visionBackend: optionalString(dictionary, key: "visionBackend"),
      audioBackend: optionalString(dictionary, key: "audioBackend"),
      maxTokens: optionalPositiveInt(dictionary, key: "maxTokens") ?? defaultLocalLlmMaxTokens,
      contextWindowTokens: optionalPositiveInt(dictionary, key: "contextWindowTokens") ?? defaultLocalLlmContextWindowTokens,
      topK: optionalPositiveInt(dictionary, key: "topK"),
      topP: optionalFloat(dictionary, key: "topP"),
      temperature: optionalFloat(dictionary, key: "temperature"),
      enableConstrainedDecoding: optionalBool(dictionary, key: "enableConstrainedDecoding") ?? false,
      minDeviceMemoryGb: optionalPositiveInt(dictionary, key: "minDeviceMemoryGb")
    )
  }

  func parseWarmupRequest(_ dictionary: NSDictionary) throws -> LocalLlmWarmupRequest {
    LocalLlmWarmupRequest(
      conversationKey: optionalString(dictionary, key: "conversationKey"),
      modelPath: try requiredString(dictionary, key: "modelPath"),
      systemPrompt: optionalString(dictionary, key: "systemPrompt"),
      tools: try tools(dictionary["tools"]),
      backend: optionalString(dictionary, key: "backend") ?? defaultLocalLlmBackend,
      visionBackend: optionalString(dictionary, key: "visionBackend"),
      audioBackend: optionalString(dictionary, key: "audioBackend"),
      maxTokens: optionalPositiveInt(dictionary, key: "maxTokens") ?? defaultLocalLlmMaxTokens,
      contextWindowTokens: optionalPositiveInt(dictionary, key: "contextWindowTokens") ?? defaultLocalLlmContextWindowTokens,
      topK: optionalPositiveInt(dictionary, key: "topK"),
      topP: optionalFloat(dictionary, key: "topP"),
      temperature: optionalFloat(dictionary, key: "temperature"),
      enableConstrainedDecoding: optionalBool(dictionary, key: "enableConstrainedDecoding") ?? false,
      minDeviceMemoryGb: optionalPositiveInt(dictionary, key: "minDeviceMemoryGb")
    )
  }

  private func requiredString(_ dictionary: NSDictionary, key: String) throws -> String {
    guard let value = optionalString(dictionary, key: key), !value.isEmpty else {
      throw LocalLlmBridgeError.invalidRequest("Missing required on-device request field: \(key).")
    }
    return value
  }

  private func optionalString(_ dictionary: NSDictionary, key: String) -> String? {
    guard let value = dictionary[key], !(value is NSNull) else {
      return nil
    }
    return (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func optionalPositiveInt(_ dictionary: NSDictionary, key: String) -> Int? {
    guard let value = dictionary[key], !(value is NSNull) else {
      return nil
    }
    if let number = value as? NSNumber, number.intValue > 0 {
      return number.intValue
    }
    guard let intValue = value as? Int, intValue > 0 else {
      return nil
    }
    return intValue
  }

  private func optionalFloat(_ dictionary: NSDictionary, key: String) -> Float? {
    guard let value = dictionary[key], !(value is NSNull) else {
      return nil
    }
    if let number = value as? NSNumber {
      return number.floatValue
    }
    return value as? Float
  }

  private func optionalBool(_ dictionary: NSDictionary, key: String) -> Bool? {
    guard let value = dictionary[key], !(value is NSNull) else {
      return nil
    }
    if let number = value as? NSNumber {
      return number.boolValue
    }
    return value as? Bool
  }

  private func optionalMessage(_ dictionary: NSDictionary, key: String) throws -> LocalLlmHistoryEntry? {
    guard let rawMessage = dictionary[key], !(rawMessage is NSNull) else {
      return nil
    }
    guard let message = rawMessage as? NSDictionary else {
      throw LocalLlmBridgeError.invalidRequest("Invalid message object for \(key).")
    }
    return try parseMessage(message)
  }

  private func messages(_ rawMessages: Any?) throws -> [LocalLlmHistoryEntry] {
    guard let rawMessages, !(rawMessages is NSNull) else {
      return []
    }
    guard let array = rawMessages as? NSArray else {
      throw LocalLlmBridgeError.invalidRequest("On-device history must be an array.")
    }
    return try array.map { value in
      guard let dictionary = value as? NSDictionary else {
        throw LocalLlmBridgeError.invalidRequest("On-device history entries must be objects.")
      }
      return try parseMessage(dictionary)
    }
  }

  private func parseMessage(_ dictionary: NSDictionary) throws -> LocalLlmHistoryEntry {
    let role = try requiredString(dictionary, key: "role")
    return LocalLlmHistoryEntry(
      role: role,
      content: optionalString(dictionary, key: "content"),
      toolCalls: try toolCalls(dictionary["toolCalls"]),
      toolResponses: try toolResponses(dictionary["toolResponses"])
    )
  }

  private func tools(_ rawTools: Any?) throws -> [LocalLlmToolDefinitionEntry] {
    guard let rawTools, !(rawTools is NSNull) else {
      return []
    }
    guard let array = rawTools as? NSArray else {
      throw LocalLlmBridgeError.invalidRequest("On-device tools must be an array.")
    }
    return try array.map { value in
      guard let dictionary = value as? NSDictionary else {
        throw LocalLlmBridgeError.invalidRequest("On-device tool entries must be objects.")
      }
      return LocalLlmToolDefinitionEntry(
        name: try requiredString(dictionary, key: "name"),
        description: optionalString(dictionary, key: "description") ?? "",
        parameters: dictionary["parameters"] as? [String: Any] ?? [:]
      )
    }
  }

  private func toolCalls(_ rawToolCalls: Any?) throws -> [LocalLlmToolCallEntry] {
    guard let rawToolCalls, !(rawToolCalls is NSNull) else {
      return []
    }
    guard let array = rawToolCalls as? NSArray else {
      throw LocalLlmBridgeError.invalidRequest("On-device tool calls must be an array.")
    }
    return try array.map { value in
      guard let dictionary = value as? NSDictionary else {
        throw LocalLlmBridgeError.invalidRequest("On-device tool call entries must be objects.")
      }
      return LocalLlmToolCallEntry(
        name: try requiredString(dictionary, key: "name"),
        arguments: dictionary["arguments"] as? [String: Any] ?? [:]
      )
    }
  }

  private func toolResponses(_ rawToolResponses: Any?) throws -> [LocalLlmToolResponseEntry] {
    guard let rawToolResponses, !(rawToolResponses is NSNull) else {
      return []
    }
    guard let array = rawToolResponses as? NSArray else {
      throw LocalLlmBridgeError.invalidRequest("On-device tool responses must be an array.")
    }
    return try array.map { value in
      guard let dictionary = value as? NSDictionary else {
        throw LocalLlmBridgeError.invalidRequest("On-device tool response entries must be objects.")
      }
      return LocalLlmToolResponseEntry(
        name: try requiredString(dictionary, key: "name"),
        response: dictionary["response"]
      )
    }
  }
}
