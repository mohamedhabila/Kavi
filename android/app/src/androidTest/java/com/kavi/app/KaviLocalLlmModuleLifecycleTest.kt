@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package com.kavi.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KaviLocalLlmModuleLifecycleTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val targetContext = instrumentation.targetContext
  private val arguments = InstrumentationRegistry.getArguments()

  @Test
  fun concurrentGenerateRequestsCompleteThroughProductionModule() {
    runBlocking {
      val config = readOnDeviceBenchmarkConfig(arguments)
      val module = KaviLocalLlmModule(BridgeReactContext(targetContext))
      try {
        val first = CapturingPromise()
        val second = CapturingPromise()
        module.generate(buildRequest(config, "phase1-concurrency-a"), first)
        module.generate(buildRequest(config, "phase1-concurrency-b"), second)

        awaitAll(
          async { first.awaitResolved() },
          async { second.awaitResolved() },
        )
      } finally {
        module.invalidate()
      }
    }
  }

  private fun buildRequest(config: OnDeviceBenchmarkConfig, requestId: String): JavaOnlyMap {
    return JavaOnlyMap.of(
      "requestId",
      requestId,
      "conversationKey",
      "phase1-production-runtime-concurrency",
      "modelPath",
      config.modelPath,
      "prompt",
      "Reply with one short sentence.",
      "backend",
      config.backend,
      "maxTokens",
      32,
      "contextWindowTokens",
      4096,
      "topK",
      20,
      "topP",
      0.8,
      "temperature",
      0.2,
    )
  }

  private class CapturingPromise : Promise {
    private val result = CompletableDeferred<Any?>()

    suspend fun awaitResolved(): Any? = withTimeout(120_000) { result.await() }

    override fun resolve(value: Any?) {
      result.complete(value)
    }

    override fun reject(code: String, message: String?) {
      reject(code, message, null)
    }

    override fun reject(code: String, throwable: Throwable?) {
      reject(code, throwable?.message, throwable)
    }

    override fun reject(code: String, message: String?, throwable: Throwable?) {
      result.completeExceptionally(AssertionError("$code: ${message ?: throwable?.message}", throwable))
    }

    override fun reject(throwable: Throwable) {
      result.completeExceptionally(throwable)
    }

    override fun reject(throwable: Throwable, userInfo: WritableMap) {
      result.completeExceptionally(throwable)
    }

    override fun reject(code: String, userInfo: WritableMap) {
      reject(code, null, null)
    }

    override fun reject(code: String, throwable: Throwable?, userInfo: WritableMap) {
      reject(code, throwable)
    }

    override fun reject(code: String, message: String?, userInfo: WritableMap) {
      reject(code, message, null)
    }

    override fun reject(code: String?, message: String?, throwable: Throwable?, userInfo: WritableMap?) {
      reject(code ?: "LOCAL_LLM_TEST_REJECTED", message, throwable)
    }

    @Suppress("DEPRECATION")
    override fun reject(message: String) {
      reject("LOCAL_LLM_TEST_REJECTED", message, null)
    }
  }
}
