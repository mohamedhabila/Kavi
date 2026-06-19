import { readFileSync } from 'fs';
import { join } from 'path';

const localLlmSourceRoot = join(
  __dirname,
  '../../android/app/src/main/java/com/kavi/app/localllm',
);

function readSource(file: string): string {
  return readFileSync(join(localLlmSourceRoot, file), 'utf8');
}

describe('android litertlm experimental flag and capability policy', () => {
  test('mutates all LiteRT experimental flags through one scoped native lock', () => {
    const source = readSource('LiteRtFlagScope.kt');

    expect(source).toContain('fun <T> withScopedFlags(');
    expect(source).toContain('synchronized(lock)');
    expect(source).toContain('val previousConstrainedDecoding');
    expect(source).toContain('val previousSpeculativeDecoding');
    expect(source).toContain('ExperimentalFlags.enableConversationConstrainedDecoding =');
    expect(source).toContain('ExperimentalFlags.enableSpeculativeDecoding =');
    expect(source).toContain('finally');
    expect(source).toContain('ExperimentalFlags.enableConversationConstrainedDecoding = previousConstrainedDecoding');
    expect(source).toContain('ExperimentalFlags.enableSpeculativeDecoding = previousSpeculativeDecoding');
    expect(source).toContain('companion object');
    expect(source).toContain('private val lock = Any()');
  });

  test('enables speculative decoding only from LiteRT model capabilities and GPU backend', () => {
    const source = readSource('LiteRtAccelerationPolicy.kt');

    expect(source).toContain('import com.google.ai.edge.litertlm.Capabilities');
    expect(source).toContain('Capabilities(modelPath).use');
    expect(source).toContain('capabilities.hasSpeculativeDecodingSupport()');
    expect(source).toContain('supportsSpeculativeDecodingOnAccelerator(key.backend)');
    expect(source).not.toMatch(/gemma|qwen|deepseek/u);
  });

  test('wraps engine initialization and conversation creation in scoped flag blocks', () => {
    const factorySource = readSource('LocalLlmEngineFactory.kt');
    const storeSource = readSource('LocalLlmEngineStore.kt');

    expect(factorySource).toContain('flagScope.withScopedFlags(flags)');
    expect(factorySource.indexOf('flagScope.withScopedFlags(flags)')).toBeLessThan(
      factorySource.indexOf('engine.initialize()'),
    );
    expect(storeSource).toContain('accelerationPolicy.flagsForEngine(key)');
    expect(storeSource).toContain('accelerationPolicy.flagsForEngine(fallbackKey)');
    expect(storeSource).toContain('accelerationPolicy.flagsForConversation(request)');
  });

  test('exposes acceleration state through runtime metrics and availability', () => {
    const modelSource = readSource('LocalLlmModels.kt');
    const deviceInfoSource = readSource('LocalLlmDeviceInfo.kt');

    expect(modelSource).toContain('fun recordAccelerationDecision(');
    expect(modelSource).toContain('constrainedDecodingEnabledCount');
    expect(modelSource).toContain('speculativeDecodingEnabledCount');
    expect(modelSource).toContain('capabilityCheckFailureCount');
    expect(modelSource).toContain('fun accelerationFeaturesToWritableMap()');
    expect(deviceInfoSource).toContain('putMap("accelerationFeatures", metrics.accelerationFeaturesToWritableMap())');
    expect(deviceInfoSource).toContain('putMap("runtimeMetrics", metrics.toWritableMap())');
  });
});
