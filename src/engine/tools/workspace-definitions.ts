/**
 * Workspace file operation tool definitions for remote code-server /
 * OpenVSCode Server workspaces.
 *
 * These tools let the AI agent read, write, list, rename, and delete files
 * on a remote workspace target — completing the "editor surface" alongside
 * the existing workspace connector (launch/probe).
 */

import type { ToolDefinition } from '../../types';

export const WORKSPACE_FS_TOOL: ToolDefinition = {
  name: 'workspace_fs',
  description:
    'Perform a filesystem operation on a configured external remote workspace target (code-server / OpenVSCode Server). ' +
    'Use action to choose: list, read, write (create or overwrite), mkdir, rename/move, or delete. ' +
    'For the conversation workspace use read_file/write_file/list_files instead; this tool is only for explicit remote workspace targets and requires targetId.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read', 'write', 'mkdir', 'rename', 'delete'],
        description: 'Filesystem operation to perform.',
      },
      targetId: { type: 'string', description: 'Workspace target ID from settings.' },
      path: {
        type: 'string',
        description:
          'File or directory path relative to workspace root. Required for read/write/mkdir/delete; defaults to root for list.',
      },
      content: {
        type: 'string',
        description: 'File content. Required for action=write.',
      },
      oldPath: { type: 'string', description: 'Existing path. Required for action=rename.' },
      newPath: { type: 'string', description: 'Destination path. Required for action=rename.' },
    },
    required: ['action', 'targetId'],
  },
};

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
};

export const ALL_WORKSPACE_FILE_TOOL_DEFINITIONS: ToolDefinition[] = [
  WORKSPACE_FS_TOOL,
  WORKSPACE_STATUS_TOOL,
  WORKSPACE_LAUNCH_BROWSER_TOOL,
  WORKSPACE_DELEGATE_TASK_TOOL,
];
