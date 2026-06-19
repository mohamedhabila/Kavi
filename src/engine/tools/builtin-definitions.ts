// ---------------------------------------------------------------------------
// Kavi — Builtin Tool Definitions (for Kavi built-in capability)
// ---------------------------------------------------------------------------
// New tools: canvas, sessions, pdf_read, camera_snap, audio_transcribe,
// memory_search (embedding-based), hooks management.

import { ToolDefinition } from '../../types/tool';
import { BUILTIN_FAMILY_TOOL_DEFINITIONS } from './builtin-definitions-families';
import { BUILTIN_COORDINATION_TOOL_DEFINITIONS } from './builtin-definitions-coordination';
import { BUILTIN_EXPO_TOOL_DEFINITIONS } from './builtin-definitions-expo';
import { BUILTIN_SSH_TOOL_DEFINITIONS } from './builtin-definitions-ssh';

export * from './builtin-definitions-families';
export * from './builtin-definitions-coordination';
export * from './builtin-definitions-expo';
export * from './builtin-definitions-ssh';

// ── All builtin tools ─────────────────────────────────────────────────────

export const ALL_BUILTIN_TOOL_DEFINITIONS: ToolDefinition[] = [
  ...BUILTIN_FAMILY_TOOL_DEFINITIONS,
  ...BUILTIN_SSH_TOOL_DEFINITIONS,
  ...BUILTIN_EXPO_TOOL_DEFINITIONS,
  ...BUILTIN_COORDINATION_TOOL_DEFINITIONS,
];
