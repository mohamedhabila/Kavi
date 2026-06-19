import Foundation
import LiteRTLM

let localLlmSupportedIosAccelerators = ["cpu", "gpu"]

func normalizeLocalLlmIosAccelerator(_ accelerator: String) throws -> String {
  let normalized = accelerator.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  guard localLlmSupportedIosAccelerators.contains(normalized) else {
    throw LocalLlmBridgeError.invalidRequest("Unsupported iOS local LLM accelerator: \(accelerator)")
  }
  return normalized
}

func resolveLocalLlmIosBackend(_ accelerator: String) throws -> Backend {
  switch try normalizeLocalLlmIosAccelerator(accelerator) {
  case "gpu":
    return .gpu
  default:
    return .cpu()
  }
}

final class LocalLlmAcceleratorInitializationError: Error, LocalizedError {
  let accelerator: String
  let underlyingError: Error

  init(accelerator: String, underlyingError: Error) {
    self.accelerator = accelerator
    self.underlyingError = underlyingError
  }

  var errorDescription: String? {
    "LiteRT-LM \(accelerator.uppercased()) initialization failed: \(underlyingError.localizedDescription)"
  }
}
