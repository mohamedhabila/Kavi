import Foundation

extension Conversation {
  public static func jsonToMessage(_ jsonString: String) throws -> Message {
    guard let data = jsonString.data(using: .utf8),
      let jsonObject = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      throw LiteRTLMError.message(.failedToConvertToJson)
    }

    var contents: [Content] = []
    if let contentArray = jsonObject["content"] as? [[String: Any]] {
      for item in contentArray {
        if let type = item["type"] as? String,
          type == "text",
          let text = item["text"] as? String
        {
          contents.append(.text(text))
        }
      }
    }

    var channels: [String: String] = [:]
    if let channelsDict = jsonObject["channels"] as? [String: Any] {
      for (key, value) in channelsDict {
        if let string = value as? String {
          channels[key] = string
        }
      }
    }

    let toolCalls = parseToolCalls(jsonObject["tool_calls"])

    if contents.isEmpty && channels.isEmpty && toolCalls.isEmpty {
      throw LiteRTLMError.message(.invalidContent)
    }
    return Message(contents: contents, channels: channels, toolCalls: toolCalls)
  }

  private static func parseToolCalls(_ rawValue: Any?) -> [ToolCall] {
    guard let rawCalls = rawValue as? [[String: Any]] else {
      return []
    }

    return rawCalls.compactMap { item in
      guard
        let function = item["function"] as? [String: Any],
        let name = function["name"] as? String,
        !name.isEmpty
      else {
        return nil
      }
      let arguments = parseToolArguments(function["arguments"])
      return ToolCall(name: name, arguments: arguments)
    }
  }

  private static func parseToolArguments(_ rawValue: Any?) -> [String: Any] {
    if let object = rawValue as? [String: Any] {
      return object
    }
    guard let string = rawValue as? String,
      let data = string.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return [:]
    }
    return object
  }
}
