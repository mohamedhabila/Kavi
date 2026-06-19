package com.kavi.mobile.localllm

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.google.ai.edge.litertlm.Message
import com.google.gson.Gson
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.produceIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout

internal class LocalLlmRuntime(
  reactContext: ReactApplicationContext,
) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val lifecycleMutex = Mutex()
  private val activeRequests = ActiveRequestRegistry()
  private val foregroundCoordinator = LocalLlmForegroundCoordinator(reactContext) {
    activeRequests.cancelAll()
  }
  private val metrics = RuntimeMetrics()
  private val gson = Gson()
  private val deviceInfo = LocalLlmDeviceInfo(reactContext)
  private val events = LocalLlmEvents(reactContext)
  private val messageAdapter = LiteRtMessageAdapter(gson)
  private val engineStore = LocalLlmEngineStore(
    reactContext = reactContext,
    deviceInfo = deviceInfo,
    messageAdapter = messageAdapter,
    fallbackPolicy = LocalLlmFallbackPolicy(),
    metrics = metrics,
  )

  fun getAvailability(): WritableMap {
    return deviceInfo.buildAvailabilityMap(metrics)
  }

  fun warmup(request: WarmupRequest, promise: Promise) {
    scope.launch {
      try {
        val backend = lifecycleMutex.withLock { warmupEngine(request) }
        promise.resolve(Arguments.createMap().apply { putString("backend", backend) })
      } catch (error: Throwable) {
        promise.reject("LOCAL_LLM_WARMUP_FAILED", error.message, error)
      }
    }
  }

  fun generate(request: LocalRequest, promise: Promise) {
    lateinit var activeRequest: ActiveRequest
    val job = scope.launch(start = CoroutineStart.LAZY) {
      foregroundCoordinator.onRequestStarted()
      try {
        val result = lifecycleMutex.withLock { runInference(request, activeRequest) }
        promise.resolve(Arguments.createMap().apply {
          putString("text", result.text)
          putString("backend", result.backend)
          if (result.toolCalls.isNotEmpty()) {
            val toolCalls = Arguments.createArray()
            result.toolCalls.forEach { toolCall -> toolCalls.pushMap(buildToolCallWritableMap(toolCall)) }
            putArray("toolCalls", toolCalls)
          }
        })
      } catch (error: CancellationException) {
        promise.reject("LOCAL_LLM_GENERATE_CANCELLED", "Local inference was cancelled.", error)
      } catch (error: Throwable) {
        promise.reject("LOCAL_LLM_GENERATE_FAILED", error.message, error)
      } finally {
        activeRequests.complete(request.requestId)
        foregroundCoordinator.onRequestFinished()
      }
    }

    activeRequest = activeRequests.register(request.requestId, job) ?: run {
      promise.reject("LOCAL_LLM_REQUEST_ACTIVE", "Request is already active: ${request.requestId}")
      return
    }
    job.start()
  }

  fun startStreaming(request: LocalRequest, promise: Promise) {
    lateinit var activeRequest: ActiveRequest
    val job = scope.launch(start = CoroutineStart.LAZY) {
      foregroundCoordinator.onRequestStarted()
      try {
        val resolvedBackend = lifecycleMutex.withLock { runStreamingInference(request, activeRequest) }
        events.emitDone(request.requestId, resolvedBackend)
      } catch (_: CancellationException) {
        events.emitDone(request.requestId)
      } catch (error: Throwable) {
        events.emitError(request.requestId, error.message ?: "Local inference failed.")
      } finally {
        activeRequests.complete(request.requestId)
        foregroundCoordinator.onRequestFinished()
      }
    }

    activeRequest = activeRequests.register(request.requestId, job) ?: run {
      promise.reject("LOCAL_LLM_REQUEST_ACTIVE", "Request is already active: ${request.requestId}")
      return
    }
    job.start()
    promise.resolve(null)
  }

  fun cancel(requestId: String) {
    metrics.activeRequestCancelCount += 1
    activeRequests.cancel(requestId)
  }

  fun invalidate() {
    activeRequests.cancelAll()
    runBlocking {
      lifecycleMutex.withLock { engineStore.closeAll() }
    }
    foregroundCoordinator.close()
    scope.cancel()
  }

  private suspend fun warmupEngine(request: WarmupRequest): String {
    return engineStore.withEngine(request) { engineState, resolvedBackend, _ ->
      request.conversationKey?.takeIf { it.isNotBlank() }?.let { conversationKey ->
        val acquiredConversation = engineStore.acquireConversationOrResetEngine(
          engineState,
          LocalRequest(
            requestId = "warmup:$conversationKey",
            conversationKey = conversationKey,
            modelPath = request.modelPath,
            prompt = null,
            systemPrompt = request.systemPrompt,
            history = emptyList(),
            currentMessage = null,
            tools = request.tools,
            backend = resolvedBackend,
            visionBackend = request.visionBackend,
            audioBackend = request.audioBackend,
            maxTokens = request.maxTokens,
            contextWindowTokens = request.contextWindowTokens,
            topK = request.topK,
            topP = request.topP,
            temperature = request.temperature,
            enableConstrainedDecoding = request.enableConstrainedDecoding,
            minDeviceMemoryGb = request.minDeviceMemoryGb,
          ),
        )
        engineStore.releaseConversation(acquiredConversation)
      }
      resolvedBackend
    }
  }

  private suspend fun runInference(request: LocalRequest, activeRequest: ActiveRequest): InferenceResult {
    val currentMessage = messageAdapter.resolveCurrentMessage(request)
    return engineStore.withEngine(request) { engineState, resolvedBackend, _ ->
      val acquiredConversation = engineStore.acquireConversationOrResetEngine(engineState, request)
      executeWithActiveConversation(request, activeRequest, acquiredConversation) {
        messageAdapter.buildInferenceResult(
          request.requestId,
          acquiredConversation.conversation.sendMessage(currentMessage),
          resolvedBackend,
        )
      }.also { result ->
        engineStore.commitConversation(
          acquiredConversation,
          messageAdapter.buildUpdatedTranscriptSignature(request, result),
        )
      }
    }
  }

  private suspend fun runStreamingInference(request: LocalRequest, activeRequest: ActiveRequest): String {
    val currentMessage = messageAdapter.resolveCurrentMessage(request)
    return engineStore.withEngine(request) { engineState, resolvedBackend, _ ->
      val acquiredConversation = engineStore.acquireConversationOrResetEngine(engineState, request)
      val streamedText = StringBuilder()
      val streamedToolCalls = mutableListOf<ToolCallResult>()

      executeWithActiveConversation(request, activeRequest, acquiredConversation) {
        coroutineScope {
          val emittedToolCallOccurrences = linkedMapOf<String, Int>()
          var emittedToolCallCount = 0
          val streamChannel =
            acquiredConversation.conversation.sendMessageAsync(currentMessage).produceIn(this)
          try {
            val firstChunk = receiveFirstChunk(streamChannel, resolvedBackend)
            emittedToolCallCount += processChunk(
              request,
              firstChunk,
              resolvedBackend,
              streamedText,
              streamedToolCalls,
              emittedToolCallOccurrences,
              emittedToolCallCount,
            )
            for (chunk in streamChannel) {
              emittedToolCallCount += processChunk(
                request,
                chunk,
                resolvedBackend,
                streamedText,
                streamedToolCalls,
                emittedToolCallOccurrences,
                emittedToolCallCount,
              )
            }
          } finally {
            streamChannel.cancel()
          }
        }
        InferenceResult(streamedText.toString(), streamedToolCalls.toList(), resolvedBackend)
      }.also { result ->
        engineStore.commitConversation(
          acquiredConversation,
          messageAdapter.buildUpdatedTranscriptSignature(request, result),
        )
      }

      resolvedBackend
    }
  }

  private suspend fun <T> executeWithActiveConversation(
    request: LocalRequest,
    activeRequest: ActiveRequest,
    acquiredConversation: AcquiredConversation,
    operation: suspend () -> T,
  ): T {
    var activeCleared = false
    return try {
      engineStore.markActive(acquiredConversation, request.requestId)
      activeRequest.attachConversation(acquiredConversation.conversation)
      operation()
    } catch (error: Throwable) {
      activeRequest.detachConversation(acquiredConversation.conversation)
      engineStore.clearActive(acquiredConversation, request.requestId)
      activeCleared = true
      engineStore.invalidateConversation(acquiredConversation)
      engineStore.resetEngineAfterFailure(acquiredConversation.engineState.key, error)
      throw error
    } finally {
      if (!activeCleared) {
        activeRequest.detachConversation(acquiredConversation.conversation)
        engineStore.clearActive(acquiredConversation, request.requestId)
      }
      engineStore.releaseConversation(acquiredConversation)
    }
  }

  private suspend fun receiveFirstChunk(
    streamChannel: kotlinx.coroutines.channels.ReceiveChannel<Message>,
    resolvedBackend: String,
  ): Message {
    return if (resolvedBackend != "cpu") {
      withTimeout(ACCELERATOR_FIRST_STREAM_CHUNK_TIMEOUT_MS) { streamChannel.receive() }
    } else {
      streamChannel.receive()
    }
  }

  private fun processChunk(
    request: LocalRequest,
    chunk: Message,
    resolvedBackend: String,
    streamedText: StringBuilder,
    streamedToolCalls: MutableList<ToolCallResult>,
    emittedToolCallOccurrences: MutableMap<String, Int>,
    emittedToolCallCount: Int,
  ): Int {
    val textChunk = messageAdapter.extractTextContent(chunk)
    if (textChunk.isNotEmpty()) {
      streamedText.append(textChunk)
      events.emitToken(request.requestId, textChunk, resolvedBackend)
    }

    val newToolCalls = messageAdapter.buildNewToolCallResults(
      request.requestId,
      chunk.toolCalls,
      emittedToolCallOccurrences,
      emittedToolCallCount,
    )
    newToolCalls.forEach { toolCall ->
      streamedToolCalls.add(toolCall)
      events.emitToolCall(request.requestId, toolCall, resolvedBackend)
    }
    return newToolCalls.size
  }
}
