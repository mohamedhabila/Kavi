import { appForegroundRequestRegistry } from '../../src/engine/graph/foregroundRun/requestRegistry';
import { __resetAgentRunCancellationRegistryForTests } from '../../src/services/agents/agentRunCancellation';

export function resetChatScreenGlobalRegistries(): void {
  __resetAgentRunCancellationRegistryForTests();
  appForegroundRequestRegistry.dispose('Resetting ChatScreen test foreground requests.');
}
