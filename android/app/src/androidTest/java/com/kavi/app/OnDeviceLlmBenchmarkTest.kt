package com.kavi.mobile

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class OnDeviceLlmBenchmarkTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val targetContext = instrumentation.targetContext
  private val arguments = InstrumentationRegistry.getArguments()

  @Test
  fun runPhase0Benchmark() = runBlocking {
    val config = readOnDeviceBenchmarkConfig(arguments)
    val results = OnDeviceLlmBenchmarkRunner(targetContext).run(config)
    writeReport(config, results)
  }

  private fun writeReport(
    config: OnDeviceBenchmarkConfig,
    results: List<OnDeviceBenchmarkScenarioResult>,
  ) {
    val report = JSONObject()
      .put("device", JSONObject().put("deviceId", android.os.Build.MODEL))
      .put(
        "model",
        JSONObject()
          .put("modelId", config.modelId)
          .put("modelPath", config.modelPath)
          .put("runtime", config.runtime)
          .put("backend", config.backend)
          .put("capabilities", JSONObject().put("tools", config.modelSupportsTools)),
      )
      .put(
        "scenarios",
        JSONArray().apply {
          results.forEach { result ->
            put(
              JSONObject()
                .put("id", result.id)
                .put("status", result.status)
                .put("durationMs", result.durationMs ?: JSONObject.NULL)
                .put("metrics", result.metrics)
                .put("error", result.error ?: JSONObject.NULL),
            )
          }
        },
      )

    val reportFile = File(targetContext.dataDir, config.reportPath.removePrefix("${targetContext.dataDir}/"))
    reportFile.parentFile?.mkdirs()
    reportFile.writeText(report.toString(2))
  }
}
