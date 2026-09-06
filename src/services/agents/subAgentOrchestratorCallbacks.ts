import type { OrchestratorCallbacks } from '../../engine/orchestrator';
import type { SubAgentSnapshot } from '../../types/subAgent';
import type { SubAgentOrchestratorCallbackParams } from './subAgentOrchestratorCallbackTypes';
import { createSubAgentOrchestratorProgressCallbacks } from './subAgentOrchestratorProgressCallbacks';
import { createSubAgentOrchestratorToolCallbacks } from './subAgentOrchestratorToolCallbacks';

export type { SubAgentExecutionRuntimeState } from './subAgentOrchestratorCallbackTypes';

export function createSubAgentOrchestratorCallbacks<TAgent extends SubAgentSnapshot>(
  params: SubAgentOrchestratorCallbackParams<TAgent>,
): OrchestratorCallbacks {
  return {
    ...createSubAgentOrchestratorProgressCallbacks(params),
    ...createSubAgentOrchestratorToolCallbacks(params),
    // `onUserMessageEnriched` and `onUserMessageAttachmentsUpdated` are intentionally left
    // undefined: a sub-agent's user turn is a synthesized prompt built by
    // `buildInitialSubAgentMessages` (see `lifecycle/runConfig.ts`) — `SubAgentConfig` carries no
    // `attachments` field, so `runMediaUnderstanding` never has a PDF to refuse in the first
    // place — and it is never written into `transcriptMessages`, the only transcript this runner
    // persists (populated solely from assistant/tool events via `appendTranscriptMessage`). There
    // is no chat-store message for a refusal to land on, so wiring the callback would have
    // nothing to write to.
  };
}
