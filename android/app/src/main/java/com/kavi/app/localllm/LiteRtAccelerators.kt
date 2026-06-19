package com.kavi.mobile.localllm

import com.google.ai.edge.litertlm.Backend

internal val LOCAL_LLM_ACCELERATORS = listOf("cpu", "gpu", "npu", "tpu")

internal fun normalizeLocalLlmAccelerator(accelerator: String): String {
  val normalized = accelerator.lowercase()
  require(LOCAL_LLM_ACCELERATORS.contains(normalized)) {
    "Unsupported local LLM accelerator: $accelerator"
  }
  return normalized
}

internal fun resolveLiteRtBackend(accelerator: String, nativeLibraryDir: String): Backend {
  return when (normalizeLocalLlmAccelerator(accelerator)) {
    "gpu" -> Backend.GPU()
    "npu", "tpu" -> Backend.NPU(nativeLibraryDir = nativeLibraryDir)
    else -> Backend.CPU()
  }
}

internal fun usesLiteRtNpuBackend(accelerator: String): Boolean {
  val normalized = normalizeLocalLlmAccelerator(accelerator)
  return normalized == "npu" || normalized == "tpu"
}

internal fun supportsSpeculativeDecodingOnAccelerator(accelerator: String): Boolean {
  return normalizeLocalLlmAccelerator(accelerator) == "gpu"
}

internal class LocalLlmAcceleratorInitializationException(
  val accelerator: String,
  cause: Throwable,
) : RuntimeException("LiteRT-LM ${accelerator.uppercase()} initialization failed.", cause)
