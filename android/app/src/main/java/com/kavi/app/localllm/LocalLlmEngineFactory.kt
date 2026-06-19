package com.kavi.mobile.localllm

import com.facebook.react.bridge.ReactApplicationContext
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.LogSeverity

internal class LocalLlmEngineFactory(
  private val reactContext: ReactApplicationContext,
  private val flagScope: LiteRtFlagScope,
) {
  fun createInitializedEngine(
    key: EngineKey,
    contextWindowTokens: Int,
    flags: LiteRtFlagState,
  ): Engine {
    require(contextWindowTokens > 0) { "contextWindowTokens must be greater than 0." }
    ensureLiteRtNativeLibraryLoaded()
    Engine.setNativeMinLogSeverity(LogSeverity.ERROR)
    return flagScope.withScopedFlags(flags) {
      val engine = Engine(
        EngineConfig(
          modelPath = key.modelPath,
          backend = resolveBackend(key.backend),
          visionBackend = key.visionBackend?.let(::resolveBackend),
          audioBackend = key.audioBackend?.let(::resolveBackend),
          maxNumTokens = contextWindowTokens,
          cacheDir = resolveCacheDir(key.modelPath),
        ),
      )
      try {
        engine.initialize()
        engine
      } catch (error: Throwable) {
        closeEngineSilently(engine)
        throw LocalLlmAcceleratorInitializationException(key.backend, error)
      }
    }
  }

  private fun resolveBackend(name: String): Backend {
    return resolveLiteRtBackend(name, reactContext.applicationInfo.nativeLibraryDir)
  }

  private fun resolveCacheDir(modelPath: String): String? {
    return if (modelPath.startsWith("/data/local/tmp")) {
      reactContext.getExternalFilesDir(null)?.absolutePath
    } else {
      null
    }
  }

  companion object {
    @Volatile
    private var nativeLibraryPreloaded = false

    private fun ensureLiteRtNativeLibraryLoaded() {
      if (nativeLibraryPreloaded) {
        return
      }
      synchronized(LocalLlmEngineFactory::class.java) {
        if (nativeLibraryPreloaded) {
          return
        }
        try {
          System.loadLibrary("litertlm_jni")
          nativeLibraryPreloaded = true
        } catch (_: UnsatisfiedLinkError) {
        }
      }
    }
  }
}
