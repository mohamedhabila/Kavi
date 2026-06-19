import Foundation

final class LocalLlmEvents {
  private let emitBody: ([String: Any]) -> Void

  init(emit: @escaping ([String: Any]) -> Void) {
    self.emitBody = emit
  }

  func emitToken(requestId: String, content: String, backend: String) {
    emit([
      "requestId": requestId,
      "type": "token",
      "content": content,
      "backend": backend,
    ])
  }

  func emitToolCall(requestId: String, toolCall: LocalLlmToolCallResult, backend: String) {
    emit([
      "requestId": requestId,
      "type": "tool_call",
      "toolCall": toolCall.toDictionary(),
      "backend": backend,
    ])
  }

  func emitDone(requestId: String, backend: String?) {
    var body: [String: Any] = [
      "requestId": requestId,
      "type": "done",
    ]
    if let backend {
      body["backend"] = backend
    }
    emit(body)
  }

  func emitError(requestId: String, message: String) {
    emit([
      "requestId": requestId,
      "type": "error",
      "error": message,
    ])
  }

  private func emit(_ body: [String: Any]) {
    DispatchQueue.main.async { [emitBody] in
      emitBody(body)
    }
  }
}
