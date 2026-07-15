import { isLongTermMemoryEnabled } from '../../services/memory/policy';

export const MEMORY_DISABLED_RUNTIME_CAPABILITY = 'durable_long_term_memory: disabled';

export function buildMemoryPolicyPromptSection(
  longTermMemoryEnabled = isLongTermMemoryEnabled(),
): string | null {
  if (longTermMemoryEnabled) return null;
  return [
    '<runtime_capability_state version="1">',
    MEMORY_DISABLED_RUNTIME_CAPABILITY,
    'Do not claim to recall or save information across conversations while this capability is disabled.',
    'When the user asks to remember something durably, explain that long-term memory is disabled and that they can enable it in settings.',
    'Continue using the visible conversation normally. Approval-gated deletion of previously stored memory may remain available.',
    '</runtime_capability_state>',
  ].join('\n');
}
