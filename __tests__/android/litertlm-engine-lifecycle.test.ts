import { readFileSync } from 'fs';
import { join } from 'path';

describe('android litertlm engine lifecycle hardening', () => {
  test('reuses one engine per model/backend and upgrades it instead of retaining context buckets', () => {
    const source = readFileSync(
      join(__dirname, '../../android/app/src/main/java/com/kavi/app/KaviLocalLlmModule.kt'),
      'utf8',
    );

    expect(source).toContain('private data class CachedEngineEntry(');
    expect(source).toContain(
      'if (existingEntry != null && existingEntry.contextWindowTokens >= request.contextWindowTokens) {',
    );
    expect(source).toContain('cachedEngines[key] = CachedEngineEntry(');
    expect(source).toContain(
      'private fun replaceEngineWithCpuFallback(key: EngineKey, contextWindowTokens: Int): Engine',
    );
  });

  test('bounds cached conversations and preloads the LiteRT-LM JNI library before initialization', () => {
    const source = readFileSync(
      join(__dirname, '../../android/app/src/main/java/com/kavi/app/KaviLocalLlmModule.kt'),
      'utf8',
    );

    expect(source).toContain('private const val MAX_CACHED_CONVERSATIONS_PER_ENGINE = 2');
    expect(source).toContain('private fun trimCachedConversationsForEngine(');
    expect(source).toContain('System.loadLibrary("litertlm_jni")');
    expect(source).toContain('ensureLiteRtNativeLibraryLoaded()');
  });

  test('evicts cached engines after non-cancellation inference failures so retries start clean', () => {
    const source = readFileSync(
      join(__dirname, '../../android/app/src/main/java/com/kavi/app/KaviLocalLlmModule.kt'),
      'utf8',
    );

    expect(source).toContain('private fun acquireConversationOrResetEngine(');
    expect(source).toContain(
      'private fun resetEngineAfterFailure(engineKey: EngineKey, error: Throwable) {',
    );
    expect(source).toContain('if (error is CancellationException) {');
    expect(source).toContain('closeCachedEngine(engineKey)');
    expect(source).toContain(
      'invalidateConversation(acquiredConversation)\n        resetEngineAfterFailure(engineKey, error)',
    );
  });
});
