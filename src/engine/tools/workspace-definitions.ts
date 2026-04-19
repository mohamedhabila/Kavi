/**
 * Workspace file operation tool definitions for remote code-server /
 * OpenVSCode Server workspaces.
 *
 * These tools let the AI agent read, write, list, rename, and delete files
 * on a remote workspace target — completing the "editor surface" alongside
 * the existing workspace connector (launch/probe).
 */

import type { ToolDefinition } from '../../types';

export const WORKSPACE_READ_FILE_TOOL: ToolDefinition = {
  name: 'workspace_read_file',
  description:
    'Read a file from a configured external remote workspace target (code-server / OpenVSCode Server). ' +
    'Use read_file for the conversation workspace; this tool is only for explicit remote workspace targets and requires targetId.',
  input_schema: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'Workspace target ID from settings' },
      path: {
        type: 'string',
        description: 'File path relative to workspace root (e.g. "src/main.ts")',
      },
    },
    required: ['targetId', 'path'],
  },
};

export const WORKSPACE_WRITE_FILE_TOOL: ToolDefinition = {
  name: 'workspace_write_file',
  description:
    'Write (create or overwrite) a file on a configured external remote workspace target. ' +
    'Use write_file for the conversation workspace; this tool is only for explicit remote workspace targets and requires targetId.',
  input_schema: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'Workspace target ID from settings' },
      path: { type: 'string', description: 'File path relative to workspace root' },
      content: { type: 'string', description: 'File content to write' },
    },
    required: ['targetId', 'path', 'content'],
  },
};

export const WORKSPACE_LIST_FILES_TOOL: ToolDefinition = {
  name: 'workspace_list_files',
  description:
    'List files and directories in a configured external remote workspace directory. ' +
    'Use list_files for the conversation workspace; this tool is only for explicit remote workspace targets and requires targetId.',
  input_schema: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'Workspace target ID from settings' },
      path: {
        type: 'string',
        description: 'Directory path relative to workspace root (default: root ".")',
      },
    },
    required: ['targetId'],
  },
};

export const WORKSPACE_MKDIR_TOOL: ToolDefinition = {
  name: 'workspace_mkdir',
  description:
    'Create a directory on a configured external remote workspace target. Not for the conversation workspace.',
  input_schema: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'Workspace target ID from settings' },
      path: {
        type: 'string',
        description: 'Directory path to create (relative to workspace root)',
      },
    },
    required: ['targetId', 'path'],
  },
};

export const WORKSPACE_RENAME_TOOL: ToolDefinition = {
  name: 'workspace_rename',
  description:
    'Rename or move a file or directory on a configured external remote workspace target. Not for the conversation workspace.',
  input_schema: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'Workspace target ID from settings' },
      oldPath: {
        type: 'string',
        description: 'Current file/directory path (relative to workspace root)',
      },
      newPath: {
        type: 'string',
        description: 'New file/directory path (relative to workspace root)',
      },
    },
    required: ['targetId', 'oldPath', 'newPath'],
  },
};

export const WORKSPACE_DELETE_TOOL: ToolDefinition = {
  name: 'workspace_delete',
  description:
    'Delete a file or directory on a configured external remote workspace target. Not for the conversation workspace.',
  input_schema: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'Workspace target ID from settings' },
      path: {
        type: 'string',
        description: 'File or directory path to delete (relative to workspace root)',
      },
    },
    required: ['targetId', 'path'],
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
  WORKSPACE_READ_FILE_TOOL,
  WORKSPACE_WRITE_FILE_TOOL,
  WORKSPACE_LIST_FILES_TOOL,
  WORKSPACE_MKDIR_TOOL,
  WORKSPACE_RENAME_TOOL,
  WORKSPACE_DELETE_TOOL,
  WORKSPACE_STATUS_TOOL,
  WORKSPACE_LAUNCH_BROWSER_TOOL,
  WORKSPACE_DELEGATE_TASK_TOOL,
];
