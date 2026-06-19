import { ToolDefinition } from '../../types/tool';
import { BUILTIN_EXPO_PROJECT_TOOL_DEFINITIONS } from './builtin-definitions-expoProjects';
import { BUILTIN_EXPO_WORKFLOW_TOOL_DEFINITIONS } from './builtin-definitions-expoWorkflows';

export * from './builtin-definitions-expoProjects';
export * from './builtin-definitions-expoWorkflows';

export const BUILTIN_EXPO_TOOL_DEFINITIONS: ToolDefinition[] = [
  ...BUILTIN_EXPO_PROJECT_TOOL_DEFINITIONS,
  ...BUILTIN_EXPO_WORKFLOW_TOOL_DEFINITIONS,
];
