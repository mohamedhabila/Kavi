package com.kavi.mobile.localllm

import com.facebook.react.bridge.ReactApplicationContext
import com.google.ai.edge.litertlm.Engine
import kotlinx.coroutines.CancellationException

internal class LocalLlmEngineStore(
  reactContext: ReactApplicationContext,
  private val deviceInfo: LocalLlmDeviceInfo,
  private val messageAdapter: LiteRtMessageAdapter,
  private val fallbackPolicy: LocalLlmFallbackPolicy,
  private val metrics: RuntimeMetrics,
) {
  private val flagScope = LiteRtFlagScope()
  private val accelerationPolicy = LiteRtAccelerationPolicy(metrics)
  private val engineFactory = LocalLlmEngineFactory(reactContext, flagScope)
  private val cachedEngines = linkedMapOf<EngineKey, EngineState>()
  private val cachedConversations = linkedMapOf<ConversationCacheKey, ConversationState>()

  suspend fun <T> withEngine(
    request: EngineRequest,
    operation: suspend (EngineState, String, EngineKey) -> T,
  ): T {
    val key = buildEngineKey(request)
    return try {
      operation(getOrCreateEngine(request, key), key.backend, key)
    } catch (error: Throwable) {
      if (!fallbackPolicy.shouldFallbackToCpu(key.backend, error)) {
        throw error
      }
      metrics.backendFallbackCount += 1
      val fallbackKey = key.toCpuFallbackKey()
      val fallbackEngine = try {
        replaceEngineWithCpuFallback(key, request.contextWindowTokens)
      } catch (fallbackInitializationError: Throwable) {
        fallbackInitializationError.addSuppressed(error)
        throw fallbackInitializationError
      }
      try {
        operation(fallbackEngine, fallbackKey.backend, fallbackKey)
      } catch (fallbackError: Throwable) {
        fallbackError.addSuppressed(error)
        throw fallbackError
      }
    }
  }

  fun acquireConversationOrResetEngine(
    engineState: EngineState,
    request: LocalRequest,
  ): AcquiredConversation {
    return try {
      acquireConversation(engineState, request)
    } catch (error: Throwable) {
      resetEngineAfterFailure(engineState.key, error)
      throw error
    }
  }

  fun markActive(acquiredConversation: AcquiredConversation, requestId: String) {
    require(acquiredConversation.engineState.activeRequestIds.isEmpty()) {
      "LiteRT-LM engine already has an active request."
    }
    val conversationState = acquiredConversation.conversationState
    require(conversationState?.activeRequestId == null) {
      "LiteRT-LM conversation already has an active request."
    }
    acquiredConversation.engineState.activeRequestIds.add(requestId)
    conversationState?.activeRequestId = requestId
    metrics.activeRequestStartCount += 1
  }

  fun clearActive(acquiredConversation: AcquiredConversation, requestId: String) {
    acquiredConversation.engineState.activeRequestIds.remove(requestId)
    if (acquiredConversation.conversationState?.activeRequestId == requestId) {
      acquiredConversation.conversationState.activeRequestId = null
    }
    metrics.activeRequestEndCount += 1
  }

  fun commitConversation(acquiredConversation: AcquiredConversation, transcriptSignature: String) {
    acquiredConversation.conversationState?.apply {
      this.transcriptSignature = transcriptSignature
      this.lastAccessedAt = System.currentTimeMillis()
    }
  }

  fun releaseConversation(acquiredConversation: AcquiredConversation) {
    if (acquiredConversation.closeOnRelease) {
      closeAcquiredConversation(acquiredConversation)
    }
  }

  fun invalidateConversation(acquiredConversation: AcquiredConversation) {
    val cacheKey = acquiredConversation.cacheKey
    if (cacheKey != null) {
      val removed = cachedConversations.remove(cacheKey)
      closeConversationState(removed)
      acquiredConversation.closed = true
      return
    }
    closeAcquiredConversation(acquiredConversation)
  }

  fun resetEngineAfterFailure(engineKey: EngineKey, error: Throwable) {
    if (error is CancellationException) {
      return
    }
    closeCachedEngine(engineKey)
  }

  fun closeAll() {
    val conversations = cachedConversations.values.toList()
    cachedConversations.clear()
    conversations.forEach(::closeConversationState)
    val engines = cachedEngines.values.toList()
    cachedEngines.clear()
    engines.forEach(::closeEngineState)
  }

  private fun getOrCreateEngine(request: EngineRequest, key: EngineKey): EngineState {
    deviceInfo.validateRequestEnvironment(request)
    val existingState = cachedEngines[key]
    if (existingState != null && existingState.contextWindowTokens >= request.contextWindowTokens) {
      metrics.engineReuseCount += 1
      return existingState
    }

    closeCachedEngine(key)
    val engineState = EngineState(
      key = key,
      engine = engineFactory.createInitializedEngine(
        key,
        request.contextWindowTokens,
        accelerationPolicy.flagsForEngine(key),
      ),
      contextWindowTokens = request.contextWindowTokens,
    )
    cachedEngines[key] = engineState
    metrics.engineCreateCount += 1
    return engineState
  }

  private fun acquireConversation(engineState: EngineState, request: LocalRequest): AcquiredConversation {
    val conversationKey = request.conversationKey?.takeIf { it.isNotBlank() }
    if (conversationKey == null) {
      metrics.conversationCreateCount += 1
      return AcquiredConversation(
        engineState = engineState,
        conversation = createConversation(engineState.engine, request),
        cacheKey = null,
        conversationState = null,
        closeOnRelease = true,
      )
    }

    val cacheKey = ConversationCacheKey(engineState.key, conversationKey)
    val expectedTranscriptSignature = messageAdapter.buildTranscriptSignature(request.history)
    val configSignature = messageAdapter.buildConversationConfigSignature(request)
    val existingState = cachedConversations[cacheKey]
    if (
      existingState != null &&
      existingState.configSignature == configSignature &&
      existingState.transcriptSignature == expectedTranscriptSignature
    ) {
      existingState.lastAccessedAt = System.currentTimeMillis()
      metrics.conversationReuseCount += 1
      return AcquiredConversation(engineState, existingState.conversation, cacheKey, existingState, false)
    }

    closeConversationState(cachedConversations.remove(cacheKey))
    val newState = ConversationState(
      conversation = createConversation(engineState.engine, request),
      configSignature = configSignature,
      transcriptSignature = expectedTranscriptSignature,
      lastAccessedAt = System.currentTimeMillis(),
    )
    cachedConversations[cacheKey] = newState
    trimCachedConversationsForEngine(engineState.key, cacheKey)
    metrics.conversationCreateCount += 1
    return AcquiredConversation(engineState, newState.conversation, cacheKey, newState, false)
  }

  private fun trimCachedConversationsForEngine(engineKey: EngineKey, keepKey: ConversationCacheKey) {
    val overflow = cachedConversations
      .filter { (cacheKey, _) -> cacheKey.engineKey == engineKey && cacheKey != keepKey }
      .toList()
      .sortedBy { (_, state) -> state.lastAccessedAt }
      .let { cachedEntries -> (cachedEntries.size + 1) - MAX_CACHED_CONVERSATIONS_PER_ENGINE }
    if (overflow <= 0) {
      return
    }

    cachedConversations
      .filter { (cacheKey, _) -> cacheKey.engineKey == engineKey && cacheKey != keepKey }
      .toList()
      .sortedBy { (_, state) -> state.lastAccessedAt }
      .take(overflow)
      .forEach { (cacheKey, state) ->
        if (cachedConversations.remove(cacheKey) != null) {
          closeConversationState(state)
        }
      }
  }

  private fun createConversation(engine: Engine, request: LocalRequest) =
    flagScope.withScopedFlags(accelerationPolicy.flagsForConversation(request)) {
      engine.createConversation(messageAdapter.createConversationConfig(request))
    }

  private fun buildEngineKey(request: EngineRequest): EngineKey {
    return EngineKey(
      modelPath = request.modelPath,
      backend = normalizeLocalLlmAccelerator(request.backend),
      visionBackend = request.visionBackend?.let(::normalizeLocalLlmAccelerator),
      audioBackend = request.audioBackend?.let(::normalizeLocalLlmAccelerator),
    )
  }

  private fun replaceEngineWithCpuFallback(key: EngineKey, contextWindowTokens: Int): EngineState {
    closeCachedEngine(key)
    val fallbackKey = key.toCpuFallbackKey()
    val existingState = cachedEngines[fallbackKey]
    if (existingState != null && existingState.contextWindowTokens >= contextWindowTokens) {
      metrics.engineReuseCount += 1
      return existingState
    }

    closeCachedEngine(fallbackKey)
    val fallbackState = EngineState(
      key = fallbackKey,
      engine = engineFactory.createInitializedEngine(
        fallbackKey,
        contextWindowTokens,
        accelerationPolicy.flagsForEngine(fallbackKey),
      ),
      contextWindowTokens = contextWindowTokens,
    )
    cachedEngines[fallbackKey] = fallbackState
    metrics.engineCreateCount += 1
    return fallbackState
  }

  private fun EngineKey.toCpuFallbackKey(): EngineKey {
    return copy(
      backend = "cpu",
      visionBackend = visionBackend?.let { "cpu" },
      audioBackend = audioBackend?.let { "cpu" },
    )
  }

  private fun closeCachedEngine(key: EngineKey) {
    closeCachedConversationsForEngine(key)
    closeEngineState(cachedEngines.remove(key))
  }

  private fun closeCachedConversationsForEngine(engineKey: EngineKey) {
    cachedConversations
      .filterKeys { cacheKey -> cacheKey.engineKey == engineKey }
      .keys
      .toList()
      .forEach { cacheKey -> closeConversationState(cachedConversations.remove(cacheKey)) }
  }

  private fun closeAcquiredConversation(acquiredConversation: AcquiredConversation) {
    if (acquiredConversation.closed) {
      return
    }
    require(acquiredConversation.conversationState?.activeRequestId == null) {
      "Cannot close an active LiteRT-LM conversation."
    }
    acquiredConversation.closed = true
    closeConversationSilently(acquiredConversation.conversation)
    metrics.conversationCloseCount += 1
  }

  private fun closeConversationState(state: ConversationState?) {
    if (state == null) {
      return
    }
    require(state.activeRequestId == null) { "Cannot close an active LiteRT-LM conversation." }
    closeConversationSilently(state.conversation)
    metrics.conversationCloseCount += 1
  }

  private fun closeEngineState(state: EngineState?) {
    if (state == null) {
      return
    }
    require(state.activeRequestIds.isEmpty()) { "Cannot close an active LiteRT-LM engine." }
    closeEngineSilently(state.engine)
    metrics.engineCloseCount += 1
  }

}
