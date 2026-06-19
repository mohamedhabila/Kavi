import { readFileSync } from 'fs';
import { join } from 'path';

const androidSourceRoot = join(__dirname, '../../android/app/src/main/java/com/kavi/app');
const localLlmSourceRoot = join(androidSourceRoot, 'localllm');
const androidMainRoot = join(__dirname, '../../android/app/src/main');

function readAndroidSource(file: string): string {
  return readFileSync(join(localLlmSourceRoot, file), 'utf8');
}

describe('android litertlm engine lifecycle hardening', () => {
  test('keeps the React bridge as a thin facade over parser and runtime ownership', () => {
    const moduleSource = readFileSync(join(androidSourceRoot, 'KaviLocalLlmModule.kt'), 'utf8');
    const lineCount = moduleSource.trim().split(/\r?\n/u).length;

    expect(lineCount).toBeLessThanOrEqual(100);
    expect(moduleSource).toContain('private val requestParser = LocalLlmRequestParser()');
    expect(moduleSource).toContain('private val runtime = LocalLlmRuntime(reactContext)');
    expect(moduleSource).not.toContain('cachedConversations');
    expect(moduleSource).not.toContain('sendMessageAsync');
  });

  test('registers generate and streaming jobs before they can execute', () => {
    const source = readAndroidSource('LocalLlmRuntime.kt');
    const generateRegister = source.indexOf('activeRequest = activeRequests.register(request.requestId, job)');
    const generateStart = source.indexOf('job.start()', generateRegister);
    const streamingRegister = source.indexOf(
      'activeRequest = activeRequests.register(request.requestId, job)',
      generateStart + 1,
    );
    const streamingStart = source.indexOf('job.start()', streamingRegister);

    expect(source).toContain('CoroutineStart.LAZY');
    expect(generateRegister).toBeGreaterThan(-1);
    expect(generateStart).toBeGreaterThan(generateRegister);
    expect(streamingRegister).toBeGreaterThan(generateStart);
    expect(streamingStart).toBeGreaterThan(streamingRegister);
    expect(source).toContain('private val lifecycleMutex = Mutex()');
  });

  test('tracks active requests and cancels native processing before coroutine cancellation', () => {
    const source = readAndroidSource('ActiveRequestRegistry.kt');

    expect(source).toContain('class ActiveRequest(');
    expect(source).toContain('private var conversation: Conversation? = null');
    expect(source).toContain('conversation?.cancelLiteRtProcess()');
    expect(source).toContain('job.cancel()');
    expect(source).toContain('ConcurrentHashMap<String, ActiveRequest>');
  });

  test('guards engine and conversation close paths while requests are active', () => {
    const modelSource = readAndroidSource('LocalLlmModels.kt');
    const storeSource = readAndroidSource('LocalLlmEngineStore.kt');

    expect(modelSource).toContain('data class EngineState(');
    expect(modelSource).toContain('val activeRequestIds: MutableSet<String>');
    expect(modelSource).toContain('data class ConversationState(');
    expect(modelSource).toContain('var activeRequestId: String? = null');
    expect(modelSource).toContain('class RuntimeMetrics');
    expect(storeSource).toContain('require(acquiredConversation.engineState.activeRequestIds.isEmpty())');
    expect(storeSource).toContain('conversationState?.activeRequestId = requestId');
    expect(storeSource).toContain('require(state.activeRequestId == null)');
    expect(storeSource).toContain('require(state.activeRequestIds.isEmpty())');
  });

  test('bounds cached conversations and preloads the LiteRT-LM JNI library before initialization', () => {
    const modelSource = readAndroidSource('LocalLlmModels.kt');
    const storeSource = readAndroidSource('LocalLlmEngineStore.kt');
    const factorySource = readAndroidSource('LocalLlmEngineFactory.kt');

    expect(modelSource).toContain('MAX_CACHED_CONVERSATIONS_PER_ENGINE = 2');
    expect(storeSource).toContain('private fun trimCachedConversationsForEngine(');
    expect(factorySource).toContain('System.loadLibrary("litertlm_jni")');
    expect(factorySource).toContain('ensureLiteRtNativeLibraryLoaded()');
  });

  test('evicts cached engines after non-cancellation inference failures so retries start clean', () => {
    const runtimeSource = readAndroidSource('LocalLlmRuntime.kt');
    const storeSource = readAndroidSource('LocalLlmEngineStore.kt');

    expect(storeSource).toContain('fun acquireConversationOrResetEngine(');
    expect(storeSource).toContain('fun resetEngineAfterFailure(engineKey: EngineKey, error: Throwable)');
    expect(storeSource).toContain('if (error is CancellationException)');
    expect(storeSource).toContain('closeCachedEngine(engineKey)');
    expect(runtimeSource).toContain('engineStore.invalidateConversation(acquiredConversation)');
    expect(runtimeSource).toContain('engineStore.resetEngineAfterFailure(acquiredConversation.engineState.key, error)');
  });

  test('keeps active local inference alive with a bounded foreground short service', () => {
    const manifestSource = readFileSync(join(androidMainRoot, 'AndroidManifest.xml'), 'utf8');
    const runtimeSource = readAndroidSource('LocalLlmRuntime.kt');
    const coordinatorSource = readAndroidSource('LocalLlmForegroundCoordinator.kt');
    const serviceSource = readAndroidSource('LocalLlmForegroundService.kt');

    expect(manifestSource).toContain('android:name=".localllm.LocalLlmForegroundService"');
    expect(manifestSource).toContain('android:foregroundServiceType="shortService"');
    expect(runtimeSource).toContain('private val foregroundCoordinator = LocalLlmForegroundCoordinator');
    expect(runtimeSource).toContain('activeRequests.cancelAll()');
    expect(runtimeSource).toContain('foregroundCoordinator.onRequestStarted()');
    expect(runtimeSource).toContain('foregroundCoordinator.onRequestFinished()');
    expect(coordinatorSource).toContain('LocalLlmForegroundService.timeoutHandler');
    expect(serviceSource).toContain('FOREGROUND_SERVICE_TYPE_SHORT_SERVICE');
    expect(serviceSource).toContain('override fun onTimeout(startId: Int, fgsType: Int)');
  });
});
