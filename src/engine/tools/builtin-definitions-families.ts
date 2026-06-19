import { ToolDefinition } from '../../types/tool';
import { BUILTIN_CANVAS_TOOL_DEFINITIONS } from './builtin-definitions-canvas';
import { BUILTIN_MEMORY_REGISTERED_TOOL_DEFINITIONS } from './builtin-definitions-memory';
import { BUILTIN_SESSION_TOOL_DEFINITIONS } from './builtin-definitions-sessions';
import { BUILTIN_UTILITY_TOOL_DEFINITIONS } from './builtin-definitions-utility';

export * from './builtin-definitions-canvas';
export * from './builtin-definitions-memory';
export * from './builtin-definitions-sessions';
export * from './builtin-definitions-utility';

export const BUILTIN_FAMILY_TOOL_DEFINITIONS: ToolDefinition[] = [
  ...BUILTIN_CANVAS_TOOL_DEFINITIONS,
  ...BUILTIN_SESSION_TOOL_DEFINITIONS,
  ...BUILTIN_UTILITY_TOOL_DEFINITIONS,
  ...BUILTIN_MEMORY_REGISTERED_TOOL_DEFINITIONS,
];
