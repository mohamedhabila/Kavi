import CLiteRTLM
import Foundation

typealias ConversationHandle = OpaquePointer

public final class Conversation {
  private var handle: ConversationHandle?

  public var isAlive: Bool {
    handle != nil
  }

  init(handle: ConversationHandle) {
    self.handle = handle
  }

  deinit {
    if let handle {
      litert_lm_conversation_delete(handle)
    }
  }

  public func sendMessage(_ message: Message, extraContext: [String: Any]? = nil) async throws -> Message {
    let handle = try activeHandle()
    let messageString = try jsonString(message.toJson)
    let extraContextString = try optionalJsonString(extraContext)
    let optionalArgs = litert_lm_conversation_optional_args_create()
    if let visualTokenBudget = ExperimentalFlags.visualTokenBudget {
      litert_lm_conversation_optional_args_set_visual_token_budget(optionalArgs, Int32(visualTokenBudget))
    }
    defer { litert_lm_conversation_optional_args_delete(optionalArgs) }

    guard let response = litert_lm_conversation_send_message(
      handle,
      messageString,
      extraContextString,
      optionalArgs
    ) else {
      throw LiteRTLMError.conversation(.invalidResponse("Native sendMessage returned null."))
    }
    defer { litert_lm_json_response_delete(response) }

    guard let responseChars = litert_lm_json_response_get_string(response) else {
      throw LiteRTLMError.conversation(.invalidResponse("Native response string was null."))
    }
    return try Self.jsonToMessage(String(cString: responseChars))
  }

  public func cancel() throws {
    litert_lm_conversation_cancel_process(try activeHandle())
  }

  func activeHandle() throws -> ConversationHandle {
    guard let handle else {
      throw LiteRTLMError.conversation(.notAlive)
    }
    return handle
  }
}

func jsonString(_ value: Any) throws -> String {
  let data = try JSONSerialization.data(withJSONObject: value, options: [])
  guard let string = String(data: data, encoding: .utf8) else {
    throw LiteRTLMError.conversation(.failedToSerializeMessage)
  }
  return string
}

func optionalJsonString(_ value: [String: Any]?) throws -> String? {
  guard let value, !value.isEmpty else {
    return nil
  }
  return try jsonString(value)
}
