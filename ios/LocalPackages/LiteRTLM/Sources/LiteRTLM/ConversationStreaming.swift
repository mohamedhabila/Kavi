import CLiteRTLM
import Foundation
import OSLog

private let streamLogger = Logger(
  subsystem: "com.kavi.litertlm.swift",
  category: "ConversationStreaming"
)

extension Conversation {
  public func sendMessageStream(_ message: Message, extraContext: [String: Any]? = nil)
    -> AsyncThrowingStream<Message, Error>
  {
    AsyncThrowingStream { continuation in
      do {
        let handle = try activeHandle()
        let context = StreamContext(continuation: continuation)
        try sendToStream(handle: handle, message: message, extraContext: extraContext, context: context)
      } catch {
        continuation.finish(throwing: error)
      }
    }
  }

  func sendToStream(
    handle: ConversationHandle,
    message: Message,
    extraContext: [String: Any]? = nil,
    context: StreamContext
  ) throws {
    let messageString = try jsonString(message.toJson)
    let extraContextString = try optionalJsonString(extraContext)
    let optionalArgs = litert_lm_conversation_optional_args_create()
    if let visualTokenBudget = ExperimentalFlags.visualTokenBudget {
      litert_lm_conversation_optional_args_set_visual_token_budget(optionalArgs, Int32(visualTokenBudget))
    }
    defer { litert_lm_conversation_optional_args_delete(optionalArgs) }

    let contextPointer = Unmanaged.passRetained(context).toOpaque()
    let status = litert_lm_conversation_send_message_stream(
      handle,
      messageString,
      extraContextString,
      optionalArgs,
      streamCallback,
      contextPointer
    )
    guard status == 0 else {
      Unmanaged<StreamContext>.fromOpaque(contextPointer).release()
      throw LiteRTLMError.conversation(.failedToStartStream(status: Int(status)))
    }
  }

  final class StreamContext {
    let continuation: AsyncThrowingStream<Message, Error>.Continuation

    init(continuation: AsyncThrowingStream<Message, Error>.Continuation) {
      self.continuation = continuation
    }
  }
}

/// Since LiteRT-LM 0.18 a chunk arrives as one object; its strings live as long as the chunk.
private func streamCallback(
  userData: UnsafeMutableRawPointer?,
  chunk: OpaquePointer?
) {
  guard let userData, let chunk else {
    return
  }
  let responseJson = litert_lm_stream_chunk_get_text(chunk)
  let isFinal = litert_lm_stream_chunk_is_final(chunk)
  let errorMessage = litert_lm_stream_chunk_get_error(chunk)
  let context = Unmanaged<Conversation.StreamContext>.fromOpaque(userData).takeUnretainedValue()

  if let errorMessage {
    let error = LiteRTLMError.conversation(.invalidResponse(String(cString: errorMessage)))
    context.continuation.finish(throwing: error)
    Unmanaged<Conversation.StreamContext>.fromOpaque(userData).release()
    return
  }

  if let responseJson {
    let responseString = String(cString: responseJson)
    do {
      guard let responseData = responseString.data(using: .utf8),
        let jsonObject = try JSONSerialization.jsonObject(with: responseData) as? [String: Any]
      else {
        throw LiteRTLMError.conversation(.invalidJson("Invalid JSON stream chunk."))
      }

      if jsonObject["content"] != nil || jsonObject["channels"] != nil || jsonObject["tool_calls"] != nil {
        let message = try Conversation.jsonToMessage(responseString)
        context.continuation.yield(message)
      }
    } catch {
      streamLogger.error("Failed to parse LiteRT-LM stream chunk: \(error.localizedDescription)")
      context.continuation.finish(throwing: error)
      Unmanaged<Conversation.StreamContext>.fromOpaque(userData).release()
      return
    }
  }

  if isFinal {
    context.continuation.finish()
    Unmanaged<Conversation.StreamContext>.fromOpaque(userData).release()
  }
}
