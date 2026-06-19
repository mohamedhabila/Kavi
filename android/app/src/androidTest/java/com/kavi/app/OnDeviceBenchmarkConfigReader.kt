package com.kavi.mobile

import android.os.Bundle

fun readOnDeviceBenchmarkConfig(arguments: Bundle): OnDeviceBenchmarkConfig {
  val modelId = requireOnDeviceArgument(arguments, "benchmarkModelId")
  val modelPath = requireOnDeviceArgument(arguments, "benchmarkModelPath")
  val reportPath = arguments.getString("benchmarkReportPath") ?: "files/on-device-driver-report.json"
  val backend = arguments.getString("benchmarkBackend") ?: "cpu"
  val runtime = arguments.getString("benchmarkRuntime") ?: "litert-lm"
  val modelSupportsTools = arguments.getString("benchmarkModelSupportsTools") == "true"
  val scenarioIds = arguments.getString("benchmarkScenarioIds")
    ?.split(',')
    ?.map { it.trim() }
    ?.filter { it.isNotEmpty() }
    ?.toSet()
    ?: emptySet()
  val conversationTurns = arguments.getString("benchmarkConversationTurns")?.toIntOrNull() ?: 20

  return OnDeviceBenchmarkConfig(
    modelId = modelId,
    modelPath = modelPath,
    reportPath = reportPath,
    backend = backend,
    runtime = runtime,
    modelSupportsTools = modelSupportsTools,
    conversationTurns = conversationTurns,
    scenarioIds = scenarioIds,
  )
}

private fun requireOnDeviceArgument(arguments: Bundle, name: String): String {
  return requireNotNull(arguments.getString(name)?.takeIf { it.isNotBlank() }) {
    "$name instrumentation argument is required."
  }
}
