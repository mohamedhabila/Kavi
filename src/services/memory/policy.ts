// ---------------------------------------------------------------------------
// Kavi — Memory policy
// ---------------------------------------------------------------------------
// Long-term memory is on unless the user turned it off in settings. Prompt code, tools and
// background work ask here before reading or writing it.
// ---------------------------------------------------------------------------

import { useSettingsStore } from '../../store/useSettingsStore';

export function isLongTermMemoryEnabled(): boolean {
  return useSettingsStore.getState().disableLongTermMemory !== true;
}
