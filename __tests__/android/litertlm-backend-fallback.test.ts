import { readFileSync } from 'fs';
import { join } from 'path';

describe('android litertlm backend fallback hardening', () => {
  test('forces CPU on emulators and treats GPU/OpenCL failures as CPU fallback candidates', () => {
    const source = readFileSync(
      join(__dirname, '../../android/app/src/main/java/com/kavi/app/KaviLocalLlmModule.kt'),
      'utf8',
    );

    expect(source).toContain('private fun normalizeRequestedBackend(backend: String): String');
    expect(source).toContain('private fun isProbablyEmulator(): Boolean');
    expect(source).toContain('if (isProbablyEmulator()) {');
    expect(source).toContain('return "cpu"');
    expect(source).toContain('private fun shouldFallbackToCpu(requestedBackend: String, error: Throwable): Boolean');
    expect(source).toContain('return containsGpuFallbackError(error)');
    expect(source).toContain('"opencl"');
    expect(source).toContain('"libopencl"');
  });

  test('retries top-level GPU request failures on CPU before surfacing them to JS', () => {
    const source = readFileSync(
      join(__dirname, '../../android/app/src/main/java/com/kavi/app/KaviLocalLlmModule.kt'),
      'utf8',
    );

    expect(source).toContain('withCpuRetry(parsed) { warmupEngine(it) }');
    expect(source).toContain('val result = withCpuRetry(parsed) { runInference(it) }');
    expect(source).toContain('withCpuRetrySuspend(parsed) { runStreamingInference(it) }');
    expect(source).toContain('private inline fun <T> withCpuRetry(request: LocalRequest, operation: (LocalRequest) -> T): T');
    expect(source).toContain('private suspend inline fun <T> withCpuRetrySuspend(');
  });

  test('sizes the engine KV cache from the request context window instead of the output cap', () => {
    const source = readFileSync(
      join(__dirname, '../../android/app/src/main/java/com/kavi/app/KaviLocalLlmModule.kt'),
      'utf8',
    );

    expect(source).toContain('val contextWindowTokens = if (request.hasKey("contextWindowTokens") && !request.isNull("contextWindowTokens")) {');
    expect(source).toContain('contextWindowTokens = request.contextWindowTokens');
    expect(source).toContain('require(contextWindowTokens >= maxTokens) { "contextWindowTokens must be greater than or equal to maxTokens." }');
    expect(source).toContain('maxNumTokens = contextWindowTokens');
  });
});