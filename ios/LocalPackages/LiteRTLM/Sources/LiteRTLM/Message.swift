import Foundation

public enum Role: String {
  case system
  case user
  case model
  case tool
}

public enum Content {
  case text(String)
  case imageData(Data)
  case imageFile(String)
  case audioData(Data)
  case audioFile(String)
  case toolResponse(name: String, response: Any?)

  var toJson: [String: Any] {
    switch self {
    case .text(let text):
      return ["type": "text", "text": text]
    case .imageData(let bytes):
      return ["type": "image", "blob": bytes.base64EncodedString()]
    case .imageFile(let path):
      return ["type": "image", "path": path]
    case .audioData(let bytes):
      return ["type": "audio", "blob": bytes.base64EncodedString()]
    case .audioFile(let path):
      return ["type": "audio", "path": path]
    case .toolResponse(let name, let response):
      return [
        "type": "tool_response",
        "name": name,
        "response": response ?? NSNull(),
      ]
    }
  }
}

public struct ToolCall {
  public let name: String
  public let arguments: [String: Any]

  public init(name: String, arguments: [String: Any]) {
    self.name = name
    self.arguments = arguments
  }

  var toJson: [String: Any] {
    [
      "type": "function",
      "function": [
        "name": name,
        "arguments": arguments,
      ],
    ]
  }
}

public struct Message {
  public let role: Role
  public let contents: Contents
  public let channels: [String: String]
  public let toolCalls: [ToolCall]

  public init(_ text: String, role: Role = .user, channels: [String: String] = [:]) {
    self.init(contents: Contents(contents: [.text(text)]), role: role, channels: channels)
  }

  public init(of contents: Content..., role: Role = .user) {
    precondition(!contents.isEmpty, "Contents should not be empty.")
    self.contents = Contents(contents: contents)
    self.role = role
    self.channels = [:]
    self.toolCalls = []
  }

  public init(
    contents: [Content],
    role: Role = .user,
    channels: [String: String] = [:],
    toolCalls: [ToolCall] = []
  ) {
    precondition(
      !contents.isEmpty || !channels.isEmpty || !toolCalls.isEmpty,
      "Contents, channels, and toolCalls should not all be empty."
    )
    self.contents = Contents(contents: contents)
    self.role = role
    self.channels = channels
    self.toolCalls = toolCalls
  }

  public init(
    contents: Contents,
    role: Role = .user,
    channels: [String: String] = [:],
    toolCalls: [ToolCall] = []
  ) {
    precondition(
      !contents.isEmpty || !channels.isEmpty || !toolCalls.isEmpty,
      "Contents, channels, and toolCalls should not all be empty."
    )
    self.contents = contents
    self.role = role
    self.channels = channels
    self.toolCalls = toolCalls
  }

  var toJson: [String: Any] {
    var dict: [String: Any] = ["role": role.rawValue]
    if !contents.isEmpty {
      dict["content"] = contents.toJson
    }
    if !channels.isEmpty {
      dict["channels"] = channels
    }
    if !toolCalls.isEmpty {
      dict["tool_calls"] = toolCalls.map { $0.toJson }
    }
    return dict
  }

  public var toString: String {
    contents.toString
  }

  var jsonString: String {
    get throws {
      let data = try JSONSerialization.data(withJSONObject: toJson, options: [])
      guard let string = String(data: data, encoding: .utf8) else {
        throw LiteRTLMError.message(.failedToConvertToJson)
      }
      return string
    }
  }
}

public struct Contents: RandomAccessCollection {
  public typealias Element = Content
  public typealias Index = Int

  public var contents: [Content]
  public var startIndex: Int { contents.startIndex }
  public var endIndex: Int { contents.endIndex }

  public subscript(position: Int) -> Content {
    contents[position]
  }

  public init(contents: [Content]) {
    self.contents = contents
  }

  public static func empty() -> Contents {
    Contents(contents: [])
  }

  public static func of(_ text: String) -> Contents {
    Contents(contents: [.text(text)])
  }

  public static func of(_ contents: Content...) -> Contents {
    Contents(contents: contents)
  }

  public static func of(_ contents: [Content]) -> Contents {
    Contents(contents: contents)
  }

  var toJson: [[String: Any]] {
    contents.map { $0.toJson }
  }

  var jsonString: String {
    get throws {
      let data = try JSONSerialization.data(withJSONObject: toJson, options: [])
      guard let string = String(data: data, encoding: .utf8) else {
        throw LiteRTLMError.message(.failedToConvertToJson)
      }
      return string
    }
  }

  public var toString: String {
    contents.compactMap { content in
      if case .text(let text) = content {
        return text
      }
      return nil
    }.joined(separator: " ")
  }
}
