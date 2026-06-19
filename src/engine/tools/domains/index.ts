// ---------------------------------------------------------------------------
// Kavi — Domain Tool Definitions
// ---------------------------------------------------------------------------
// Combines all tool domains into a single registry.

import { ToolDefinition } from '../../../types/tool';
import { CORE_DOMAIN_TOOLS } from './core';
import { EXTENDED_DOMAIN_TOOLS } from './extended';
import { WEB_DOMAIN_TOOLS } from './web';
import { ALL_BROWSER_TOOL_DEFINITIONS } from '../browser-definitions';
import { ALL_BUILTIN_TOOL_DEFINITIONS } from '../builtin-definitions';
import { ALL_NATIVE_TOOL_DEFINITIONS } from '../native/definitions';
import { ALL_WORKSPACE_TOOL_DEFINITIONS } from '../workspace-definitions';

export { CORE_DOMAIN_TOOLS } from './core';
export { EXTENDED_DOMAIN_TOOLS } from './extended';
export { WEB_DOMAIN_TOOLS } from './web';
export { ALL_BROWSER_TOOL_DEFINITIONS } from '../browser-definitions';
export { ALL_BUILTIN_TOOL_DEFINITIONS } from '../builtin-definitions';
export { ALL_NATIVE_TOOL_DEFINITIONS } from '../native/definitions';
export { ALL_WORKSPACE_TOOL_DEFINITIONS } from '../workspace-definitions';

export const DOMAIN_TOOL_DEFINITIONS: ToolDefinition[] = [
  ...CORE_DOMAIN_TOOLS,
  ...EXTENDED_DOMAIN_TOOLS,
  ...WEB_DOMAIN_TOOLS,
  ...ALL_NATIVE_TOOL_DEFINITIONS,
  ...ALL_BUILTIN_TOOL_DEFINITIONS,
  ...ALL_BROWSER_TOOL_DEFINITIONS,
  ...ALL_WORKSPACE_TOOL_DEFINITIONS,
];
