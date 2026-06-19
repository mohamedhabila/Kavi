import Foundation
import LiteRTLM

final class LocalLlmMessageAdapter {
  func conversationConfig(for request: LocalLlmRequest) throws -> ConversationConfig {
    try conversationConfig(
      systemPrompt: request.systemPrompt,
      history: request.history,
      tools: request.tools,
      topK: request.topK,
      topP: request.topP,
      temperature: request.temperature
    )
  }

  func conversationConfig(for request: LocalLlmWarmupRequest) throws -> ConversationConfig {
    try conversationConfig(
      systemPrompt: request.systemPrompt,
      history: [],
      tools: request.tools,
      topK: request.topK,
      topP: request.topP,
      temperature: request.temperature
    )
  }

  func currentMessage(for request: LocalLlmRequest) throws -> Message {
    if let currentMessage = request.currentMessage {
      return try message(from: currentMessage)
    }
    guard let prompt = request.prompt, !prompt.isEmpty else {
      throw LocalLlmBridgeError.invalidRequest("On-device requests require a non-empty prompt.")
    }
    return Message(prompt, role: .user)
  }

  func configSignature(for request: LocalLlmRequest) throws -> String {
    try stableJsonString([
      "systemPrompt": request.systemPrompt ?? "",
      "tools": request.tools.map { toolDictionary($0) },
      "topK": jsonValue(request.topK),
      "topP": jsonValue(request.topP),
      "temperature": jsonValue(request.temperature),
      "enableConstrainedDecoding": request.enableConstrainedDecoding,
    ])
  }

  func configSignature(for request: LocalLlmWarmupRequest) throws -> String {
    try stableJsonString([
      "systemPrompt": request.systemPrompt ?? "",
      "tools": request.tools.map { toolDictionary($0) },
      "topK": jsonValue(request.topK),
      "topP": jsonValue(request.topP),
      "temperature": jsonValue(request.temperature),
      "enableConstrainedDecoding": request.enableConstrainedDecoding,
    ])
  }

  func transcriptSignature(for history: [LocalLlmHistoryEntry]) throws -> String {
    try stableJsonString(history.map(messageDictionary))
  }

  func committedTranscriptSignature(for request: LocalLlmRequest, response: Message?) throws -> String {
    var transcript = request.history
    if let currentMessage = request.currentMessage {
      transcript.append(currentMessage)
    } else if let prompt = request.prompt, !prompt.isEmpty {
      transcript.append(LocalLlmHistoryEntry(role: "user", content: prompt, toolCalls: [], toolResponses: []))
    }
    if let response, !response.toString.isEmpty || !response.toolCalls.isEmpty {
      transcript.append(
        LocalLlmHistoryEntry(
          role: "model",
          content: response.toString.isEmpty ? nil : response.toString,
          toolCalls: response.toolCalls.map { LocalLlmToolCallEntry(name: $0.name, arguments: $0.arguments) },
          toolResponses: []
        )
      )
    }
    return try transcriptSignature(for: transcript)
  }

  private func conversationConfig(
    systemPrompt: String?,
    history: [LocalLlmHistoryEntry],
    tools: [LocalLlmToolDefinitionEntry],
    topK: Int?,
    topP: Float?,
    temperature: Float?
  ) throws -> ConversationConfig {
    let systemMessage = systemPrompt.flatMap { $0.isEmpty ? nil : Message($0, role: .system) }
    let sampler = try samplerConfig(topK: topK, topP: topP, temperature: temperature)
    return ConversationConfig(
      systemMessage: systemMessage,
      initialMessages: try history.map { try message(from: $0) },
      tools: tools.map { tool in
        ToolDefinition(
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        )
      },
      samplerConfig: sampler
    )
  }

  private func samplerConfig(topK: Int?, topP: Float?, temperature: Float?) throws -> SamplerConfig? {
    guard let topK, let topP, let temperature else {
      return nil
    }
    return try SamplerConfig(topK: topK, topP: topP, temperature: temperature)
  }

  private func message(from entry: LocalLlmHistoryEntry) throws -> Message {
    let role = try nativeRole(for: entry.role)
    if role == .tool {
      let responses = entry.toolResponses.map { response in
        Content.toolResponse(name: response.name, response: response.response)
      }
      guard !responses.isEmpty else {
        throw LocalLlmBridgeError.invalidRequest("Tool messages require tool responses.")
      }
      return Message(contents: responses, role: .tool)
    }

    let content = normalizedContent(for: entry)
    let toolCalls = entry.toolCalls.map { ToolCall(name: $0.name, arguments: $0.arguments) }
    guard !content.isEmpty || !toolCalls.isEmpty else {
      throw LocalLlmBridgeError.invalidRequest("On-device conversation messages require content or tool calls.")
    }
    return Message(
      contents: content.isEmpty ? Contents.empty() : Contents.of(content),
      role: role,
      toolCalls: toolCalls
    )
  }

  private func nativeRole(for role: String) throws -> Role {
    switch role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "system":
      return .system
    case "user":
      return .user
    case "assistant", "model":
      return .model
    case "tool":
      return .tool
    default:
      throw LocalLlmBridgeError.unsupportedRole(role)
    }
  }

  private func normalizedContent(for entry: LocalLlmHistoryEntry) -> String {
    if entry.role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "tool" {
      return ""
    }
    if let content = entry.content?.trimmingCharacters(in: .whitespacesAndNewlines), !content.isEmpty {
      return content
    }
    guard !entry.toolResponses.isEmpty else {
      return ""
    }
    return (try? stableJsonString(entry.toolResponses.map(responseDictionary))) ?? ""
  }

  private func messageDictionary(_ entry: LocalLlmHistoryEntry) -> [String: Any] {
    [
      "role": entry.role,
      "content": entry.content ?? "",
      "toolCalls": entry.toolCalls.map(callDictionary),
      "toolResponses": entry.toolResponses.map(responseDictionary),
    ]
  }

  private func toolDictionary(_ entry: LocalLlmToolDefinitionEntry) -> [String: Any] {
    [
      "name": entry.name,
      "description": entry.description,
      "parameters": entry.parameters,
    ]
  }

  private func callDictionary(_ entry: LocalLlmToolCallEntry) -> [String: Any] {
    ["name": entry.name, "arguments": entry.arguments]
  }

  private func responseDictionary(_ entry: LocalLlmToolResponseEntry) -> [String: Any] {
    ["name": entry.name, "response": entry.response ?? NSNull()]
  }

  private func jsonValue(_ value: Any?) -> Any {
    value ?? NSNull()
  }

  private func stableJsonString(_ value: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard let string = String(data: data, encoding: .utf8) else {
      throw LocalLlmBridgeError.invalidRequest("Failed to serialize local conversation state.")
    }
    return string
  }

  func generationResult(from message: Message, requestId: String, backend: String) -> LocalLlmGenerationResult {
    LocalLlmGenerationResult(
      text: message.toString,
      toolCalls: toolCallResults(from: message.toolCalls, requestId: requestId, offset: 0),
      backend: backend
    )
  }

  func toolCallResults(
    from toolCalls: [ToolCall],
    requestId: String,
    offset: Int
  ) -> [LocalLlmToolCallResult] {
    toolCalls.enumerated().map { index, toolCall in
      LocalLlmToolCallResult(
        id: "local_\(requestId)_tool_\(offset + index)",
        name: toolCall.name,
        arguments: toolCall.arguments
      )
    }
  }

  func newToolCallResults(
    from toolCalls: [ToolCall],
    requestId: String,
    emittedOccurrences: inout [String: Int],
    emittedCount: Int
  ) throws -> (toolCalls: [ToolCall], results: [LocalLlmToolCallResult]) {
    var chunkOccurrences: [String: Int] = [:]
    var newToolCalls: [ToolCall] = []
    var results: [LocalLlmToolCallResult] = []

    for toolCall in toolCalls {
      let signature = "\(toolCall.name)|\(try stableJsonString(toolCall.arguments))"
      let chunkOccurrence = chunkOccurrences[signature] ?? 0
      chunkOccurrences[signature] = chunkOccurrence + 1
      let emittedOccurrence = emittedOccurrences[signature] ?? 0
      if chunkOccurrence < emittedOccurrence {
        continue
      }

      emittedOccurrences[signature] = emittedOccurrence + 1
      newToolCalls.append(toolCall)
      results.append(
        LocalLlmToolCallResult(
          id: "local_\(requestId)_tool_\(emittedCount + results.count)",
          name: toolCall.name,
          arguments: toolCall.arguments
        )
      )
    }

    return (newToolCalls, results)
  }
}
