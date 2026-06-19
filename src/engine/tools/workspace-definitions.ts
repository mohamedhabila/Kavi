/**
 * Workspace target control tool definitions for configured external
 * code-server / OpenVSCode / browser-first workspace targets.
 *
 * Current-workspace file operations go through the core file tools.
 * These tools exist only for inspecting and controlling explicit external
 * workspace targets.
 */

import type { ToolDefinition } from '../../types/tool';

export const WORKSPACE_STATUS_TOOL: ToolDefinition = {
  name: 'workspace_status',
  description:
    'Inspect one or more configured external workspace/IDE targets and report which control paths are available: file API, browser automation, and AI task delegation.',
  input_schema: {
    type: 'object',
    properties: {
      targetId: {
        type: 'string',
        description: 'Optional workspace target ID. Omit to list all configured targets.',
      },
    },
    required: [],
  },
  contract: {
    category: 'workspace_files',
    capabilities: ['read', 'verify'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
  },
};

export const WORKSPACE_LAUNCH_BROWSER_TOOL: ToolDefinition = {
  name: 'workspace_launch_browser',
  description:
    'Launch a configured external workspace/IDE target inside a remote browser automation session. ' +
    'Use this when the target exposes a browser-accessible IDE surface and you want to drive it with browser_* tools.',
  input_schema: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'Workspace target ID from settings' },
      providerId: {
        type: 'string',
        description:
          'Optional browser provider override. Defaults to the target-linked or first enabled browser provider.',
      },
    },
    required: ['targetId'],
  },
  contract: {
    category: 'browser',
    capabilities: ['write', 'verify'],
    resourceKinds: ['conversation_workspace', 'browser'],
    sideEffects: ['external_run'],
    providesEvidence: ['external_run', 'verification'],
    workflowStages: ['start_external_execution', 'verify_evidence'],
  },
};

export const WORKSPACE_DELEGATE_TASK_TOOL: ToolDefinition = {
  name: 'workspace_delegate_task',
  description:
    'Delegate a coding task to an external IDE target through a configured host-side command path, such as the official Cursor CLI over SSH. ' +
    'Use this only when the target is explicitly configured for AI task handoff.',
  input_schema: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'Workspace target ID from settings' },
      prompt: {
        type: 'string',
        description: 'Task or prompt to hand off to the external IDE agent',
      },
      mode: {
        type: 'string',
        enum: ['agent', 'plan', 'ask'],
        description: 'Optional delegation mode. Defaults to agent.',
      },
    },
    required: ['targetId', 'prompt'],
  },
  contract: {
    category: 'sessions',
    capabilities: ['coordinate', 'write'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['external_run'],
    riskHints: ['requires_approval'],
    providesEvidence: ['external_run'],
    workflowStages: ['start_external_execution'],
  },
};

export const ALL_WORKSPACE_TOOL_DEFINITIONS: ToolDefinition[] = [
  WORKSPACE_STATUS_TOOL,
  WORKSPACE_LAUNCH_BROWSER_TOOL,
  WORKSPACE_DELEGATE_TASK_TOOL,
];
