// ---------------------------------------------------------------------------
// Kavi — Domain Tool Definitions
// ---------------------------------------------------------------------------
// Combines all tool domains into a single registry.

import { ToolDefinition } from '../../../types/tool';
import { CORE_DOMAIN_TOOLS } from './core';
import { EXTENDED_DOMAIN_TOOLS } from './extended';
import { WEB_DOMAIN_TOOLS } from './web';
import { ALL_NATIVE_TOOL_DEFINITIONS } from './native';
import { ALL_BUILTIN_TOOL_DEFINITIONS } from './builtin';
import { ALL_BROWSER_TOOL_DEFINITIONS } from './browser';
import { ALL_WORKSPACE_TOOL_DEFINITIONS } from './workspace';

export { CORE_DOMAIN_TOOLS } from './core';
export { EXTENDED_DOMAIN_TOOLS } from './extended';
export { WEB_DOMAIN_TOOLS } from './web';
export { ALL_NATIVE_TOOL_DEFINITIONS } from './native';
export { ALL_BUILTIN_TOOL_DEFINITIONS } from './builtin';
export { ALL_BROWSER_TOOL_DEFINITIONS } from './browser';
export { ALL_WORKSPACE_TOOL_DEFINITIONS } from './workspace';

export const DOMAIN_TOOL_DEFINITIONS: ToolDefinition[] = [
  ...CORE_DOMAIN_TOOLS,
  ...EXTENDED_DOMAIN_TOOLS,
  ...WEB_DOMAIN_TOOLS,
  ...ALL_NATIVE_TOOL_DEFINITIONS,
  ...ALL_BUILTIN_TOOL_DEFINITIONS,
  ...ALL_BROWSER_TOOL_DEFINITIONS,
  ...ALL_WORKSPACE_TOOL_DEFINITIONS,
];
