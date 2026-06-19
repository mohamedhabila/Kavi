package com.kavi.mobile.localllm

import kotlinx.coroutines.TimeoutCancellationException

internal class LocalLlmFallbackPolicy {
  private val acceleratorFallbackErrorSnippets = listOf(
    "opencl",
    "libopencl",
    "vndksupport",
    "gpu sampler not available",
    "vk_error",
    "vulkan",
    "createcomputepipelines failed",
    "compute pipeline",
    "initialization_failed",
  )

  fun shouldFallbackToCpu(requestedBackend: String, error: Throwable): Boolean {
    if (normalizeLocalLlmAccelerator(requestedBackend) == "cpu") {
      return false
    }
    if (error is LocalLlmAcceleratorInitializationException) {
      return true
    }
    if (error is TimeoutCancellationException) {
      return true
    }
    return containsAcceleratorFallbackError(error)
  }

  private fun containsAcceleratorFallbackError(error: Throwable?): Boolean {
    if (error == null) {
      return false
    }

    val message = error.message.orEmpty()
    if (acceleratorFallbackErrorSnippets.any { snippet -> message.contains(snippet, ignoreCase = true) }) {
      return true
    }
    if (containsAcceleratorFallbackError(error.cause)) {
      return true
    }
    return error.suppressed.any { suppressed -> containsAcceleratorFallbackError(suppressed) }
  }
}
