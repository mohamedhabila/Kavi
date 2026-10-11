import { cancelMemoryExtraction } from './core/memoryExtractionWorker';
import { skipMemoryCaptureToNow } from './core/memoryCapture';
import { setDurableMemoryPolicyEnabled } from './memoryAuthority';

/** Late binding prevents the settings and chat Zustand shells from importing each other. */
function getChatStore(): typeof import('../../store/useChatStore').useChatStore {
  const module = require('../../store/useChatStore') as typeof import('../../store/useChatStore');
  return module.useChatStore;
}

/** Turning memory off: reads stop at once and background extraction is cancelled. */
export function prepareLongTermMemoryOptOut(): void {
  setDurableMemoryPolicyEnabled(false);
  cancelMemoryExtraction();
}

/** Turning memory on: nothing said while it was off is captured afterwards. */
export function prepareLongTermMemoryOptIn(): void {
  skipMemoryCaptureToNow(getChatStore().getState().conversations);
  setDurableMemoryPolicyEnabled(true);
}
