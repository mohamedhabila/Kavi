import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');
const iosRoot = join(repoRoot, 'ios');
const kaviRoot = join(iosRoot, 'Kavi');
const localLlmRoot = join(kaviRoot, 'LocalLlm');

function readIosFile(relativePath: string): string {
  return readFileSync(join(iosRoot, relativePath), 'utf8');
}

function readLocalLlmFile(fileName: string): string {
  return readFileSync(join(localLlmRoot, fileName), 'utf8');
}

describe('iOS LiteRT-LM runtime bridge', () => {
  it('removes the legacy MediaPipe GenAI runtime from production iOS sources', () => {
    const productionSources = [
      readIosFile('Podfile'),
      readIosFile('Kavi/KaviLocalLlm.swift'),
      readIosFile('Kavi/KaviLocalLlm.m'),
      ...[
        'LocalLlmAccelerators.swift',
        'LocalLlmBackgroundTask.swift',
        'LocalLlmDeviceInfo.swift',
        'LocalLlmEvents.swift',
        'LocalLlmMessageAdapter.swift',
        'LocalLlmRequestParser.swift',
        'LocalLlmRuntime.swift',
        'LocalLlmTypes.swift',
      ].map(readLocalLlmFile),
    ].join('\n');

    expect(productionSources).not.toContain('MediaPipeTasksGenAI');
    expect(productionSources).not.toContain('MediaPipeTasksGenAIC');
    expect(productionSources).not.toContain('LlmInference');
    expect(productionSources).not.toContain('mediapipe-genai');
    expect(productionSources).not.toContain('<start_of_turn>');
  });

  it('uses the official LiteRT-LM Swift engine and conversation APIs', () => {
    const runtimeSource = readLocalLlmFile('LocalLlmRuntime.swift');
    const adapterSource = readLocalLlmFile('LocalLlmMessageAdapter.swift');
    const deviceInfoSource = readLocalLlmFile('LocalLlmDeviceInfo.swift');

    expect(runtimeSource).toContain('import LiteRTLM');
    expect(runtimeSource).toContain('EngineConfig(');
    expect(runtimeSource).toContain('engine.initialize()');
    expect(runtimeSource).toContain('createConversation(with:');
    expect(runtimeSource).toContain('sendMessage(message)');
    expect(runtimeSource).toContain('sendMessageStream(message)');
    expect(runtimeSource).toContain('conversation.cancel()');
    expect(adapterSource).toContain('ConversationConfig(');
    expect(adapterSource).toContain('Message(prompt, role: .user)');
    expect(deviceInfoSource).toContain('"runtime": "litert-lm"');
    expect(deviceInfoSource).toContain('"supportedAccelerators": localLlmSupportedIosAccelerators');
  });

  it('wires every iOS bridge source and the LiteRT-LM package into the Xcode target', () => {
    const project = readIosFile('Kavi.xcodeproj/project.pbxproj');
    const packageManifest = readIosFile('LocalPackages/LiteRTLM/Package.swift');

    for (const fileName of [
      'KaviLocalLlm.swift in Sources',
      'KaviLocalLlm.m in Sources',
      'LocalLlmTypes.swift in Sources',
      'LocalLlmAccelerators.swift in Sources',
      'LocalLlmBackgroundTask.swift in Sources',
      'LocalLlmDeviceInfo.swift in Sources',
      'LocalLlmEvents.swift in Sources',
      'LocalLlmRequestParser.swift in Sources',
      'LocalLlmMessageAdapter.swift in Sources',
      'LocalLlmRuntime.swift in Sources',
    ]) {
      expect(project).toContain(fileName);
    }

    expect(project).toContain('relativePath = LocalPackages/LiteRTLM;');
    expect(project).toContain('LiteRTLM in Frameworks');
    expect(project).toContain('packageProductDependencies');
    expect(packageManifest).toContain(
      'https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.13.1/CLiteRTLM.xcframework.zip',
    );
    expect(packageManifest).toContain(
      'https://github.com/google-ai-edge/LiteRT-LM/releases/download/v0.13.1/CLiteRTLM_mac.xcframework.zip',
    );
    expect(packageManifest).not.toContain('-all_load');
  });

  it('exports the full native bridge contract through React Native', () => {
    const bridge = readIosFile('Kavi/KaviLocalLlm.m');

    expect(bridge).toContain('RCT_EXTERN_METHOD(getAvailability:');
    expect(bridge).toContain('RCT_EXTERN_METHOD(warmup:');
    expect(bridge).toContain('RCT_EXTERN_METHOD(generate:');
    expect(bridge).toContain('RCT_EXTERN_METHOD(startStreaming:');
    expect(bridge).toContain('RCT_EXTERN_METHOD(cancel:');
  });

  it('propagates native iOS tool calls through LiteRT-LM without prompt parsing workarounds', () => {
    const liteConfig = readIosFile('LocalPackages/LiteRTLM/Sources/LiteRTLM/Config.swift');
    const liteMessage = readIosFile('LocalPackages/LiteRTLM/Sources/LiteRTLM/Message.swift');
    const liteEngine = readIosFile('LocalPackages/LiteRTLM/Sources/LiteRTLM/Engine.swift');
    const adapterSource = readLocalLlmFile('LocalLlmMessageAdapter.swift');
    const runtimeSource = readLocalLlmFile('LocalLlmRuntime.swift');
    const eventsSource = readLocalLlmFile('LocalLlmEvents.swift');

    expect(liteConfig).toContain('public struct ToolDefinition');
    expect(liteEngine).toContain('litert_lm_conversation_config_set_tools');
    expect(liteEngine).not.toContain('litert_lm_conversation_config_set_stream_tool_calls');
    expect(liteMessage).toContain('public struct ToolCall');
    expect(adapterSource).toContain('ToolDefinition(');
    expect(adapterSource).toContain('Content.toolResponse');
    expect(runtimeSource).toContain('events.emitToolCall');
    expect(eventsSource).toContain('"type": "tool_call"');
    expect(adapterSource).not.toContain('unsupportedTools');
  });

  it('uses bounded iOS background execution for active local inference requests', () => {
    const bridgeSource = readIosFile('Kavi/KaviLocalLlm.swift');
    const backgroundTaskSource = readLocalLlmFile('LocalLlmBackgroundTask.swift');

    expect(bridgeSource).toContain('private let backgroundTask = LocalLlmBackgroundTask()');
    expect(bridgeSource).toContain('backgroundTask.begin(requestId: parsed.requestId)');
    expect(bridgeSource).toContain('backgroundTask.end(requestId: parsed.requestId)');
    expect(bridgeSource).toContain('backgroundTask.endAll()');
    expect(backgroundTaskSource).toContain('UIApplication.shared.beginBackgroundTask');
    expect(backgroundTaskSource).toContain('UIApplication.shared.endBackgroundTask');
  });
});
