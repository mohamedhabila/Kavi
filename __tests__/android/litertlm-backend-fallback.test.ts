import { readFileSync } from 'fs';
import { join } from 'path';

const sourceRoot = join(__dirname, '../../android/app/src/main/java/com/kavi/app/localllm');
const androidRoot = join(__dirname, '../../android/app/src/main');

function readSource(file: string): string {
  return readFileSync(join(sourceRoot, file), 'utf8');
}

describe('android litertlm backend fallback hardening', () => {
  test('trusts requested backends and treats GPU/OpenCL failures as CPU fallback candidates', () => {
    const parserSource = readSource('LocalLlmRequestParser.kt');
    const fallbackSource = readSource('LocalLlmFallbackPolicy.kt');

    expect(parserSource).toContain('private fun normalizeRequestedBackend(backend: String): String');
    expect(parserSource).not.toContain('isProbablyEmulator');
    expect(fallbackSource).not.toContain('isProbablyEmulator');
    expect(fallbackSource).toContain('fun shouldFallbackToCpu(requestedBackend: String, error: Throwable): Boolean');
    expect(fallbackSource).toContain('error is LocalLlmAcceleratorInitializationException');
    expect(fallbackSource).toContain('return containsAcceleratorFallbackError(error)');
    expect(fallbackSource).toContain('"opencl"');
    expect(fallbackSource).toContain('"libopencl"');
    expect(fallbackSource).toContain('"vk_error"');
    expect(fallbackSource).toContain('"vulkan"');
  });

  test('retries GPU runtime failures on CPU before surfacing them to JS', () => {
    const source = readSource('LocalLlmEngineStore.kt');

    expect(source).toContain('fallbackPolicy.shouldFallbackToCpu(key.backend, error)');
    expect(source).toContain('metrics.backendFallbackCount += 1');
    expect(source).toContain('replaceEngineWithCpuFallback(key, request.contextWindowTokens)');
    expect(source).toContain('operation(fallbackEngine, fallbackKey.backend, fallbackKey)');
    expect(readSource('LocalLlmModels.kt')).toContain(
      'ACCELERATOR_FIRST_STREAM_CHUNK_TIMEOUT_MS = 10_000L',
    );
    expect(readSource('LocalLlmRuntime.kt')).toContain(
      'withTimeout(ACCELERATOR_FIRST_STREAM_CHUNK_TIMEOUT_MS)',
    );
    expect(readSource('LocalLlmFallbackPolicy.kt')).toContain('if (error is TimeoutCancellationException)');
  });

  test('maps Android accelerators through LiteRT backends without prompt policy branches', () => {
    const acceleratorSource = readSource('LiteRtAccelerators.kt');
    const factorySource = readSource('LocalLlmEngineFactory.kt');
    const messageSource = readSource('LiteRtMessageAdapter.kt');
    const deviceInfoSource = readSource('LocalLlmDeviceInfo.kt');

    expect(acceleratorSource).toContain('listOf("cpu", "gpu", "npu", "tpu")');
    expect(acceleratorSource).toContain('"npu", "tpu" -> Backend.NPU(nativeLibraryDir = nativeLibraryDir)');
    expect(factorySource).toContain('visionBackend = key.visionBackend?.let(::resolveBackend)');
    expect(factorySource).toContain('audioBackend = key.audioBackend?.let(::resolveBackend)');
    expect(messageSource).toContain('if (usesLiteRtNpuBackend(backend))');
    expect(messageSource).toContain('return null');
    expect(deviceInfoSource).toContain('putArray("supportedAccelerators"');
  });

  test('declares optional Gallery native accelerator libraries', () => {
    const manifestSource = readFileSync(join(androidRoot, 'AndroidManifest.xml'), 'utf8');

    expect(manifestSource).toContain('android:name="libvndksupport.so"');
    expect(manifestSource).toContain('android:name="libOpenCL.so"');
    expect(manifestSource).toContain('android:name="libcdsprpc.so"');
    expect(manifestSource).toContain('android:name="libedgetpu_litert.so"');
  });

  test('sizes the engine KV cache from the request context window instead of the output cap', () => {
    const parserSource = readSource('LocalLlmRequestParser.kt');
    const factorySource = readSource('LocalLlmEngineFactory.kt');

    expect(parserSource).toContain('contextWindowTokens = readInt(request, "contextWindowTokens") ?: maxTokens');
    expect(parserSource).toContain('"contextWindowTokens must be greater than or equal to maxTokens."');
    expect(factorySource).toContain('fun createInitializedEngine(');
    expect(factorySource).toContain('contextWindowTokens: Int');
    expect(factorySource).toContain('maxNumTokens = contextWindowTokens');
  });
});
