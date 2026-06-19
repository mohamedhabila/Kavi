import { ToolDefinition } from '../../types/tool';

export const SSH_EXEC_TOOL: ToolDefinition = {
  name: 'ssh_exec',
  description:
    'Execute a shell command on a configured SSH target. Use this for real remote command execution when a task must run on an SSH host instead of the local mobile sandbox. Supports background execution mode for long-running commands; when background is true, follow up with ssh_background_job_status or ssh_background_job_wait using the returned jobId until the job reaches a terminal state.',
  input_schema: {
    type: 'object',
    properties: {
      targetId: {
        type: 'string',
        description:
          'SSH target ID from Settings. Optional when exactly one SSH target is enabled.',
      },
      command: { type: 'string', description: 'Shell command to execute remotely.' },
      cwd: { type: 'string', description: 'Optional working directory on the remote host.' },
      background: {
        type: 'boolean',
        description: 'Run in background (non-blocking). Returns a job ID to check status later.',
      },
      timeoutMs: {
        type: 'number',
        description:
          'Custom timeout in milliseconds (default: 30000). Only for foreground execution.',
      },
    },
    required: ['command'],
  },
  contract: {
    category: 'ssh',
    capabilities: ['write', 'verify'],
    resourceKinds: ['ssh_host'],
    sideEffects: ['remote_mutation'],
    providesEvidence: ['verification', 'external_run'],
  },
};

export const SSH_BACKGROUND_JOB_STATUS_TOOL: ToolDefinition = {
  name: 'ssh_background_job_status',
  description:
    'Inspect a background SSH job started by ssh_exec with background=true. Returns the current status plus a recent output excerpt when available.',
  input_schema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'Background SSH job ID returned by ssh_exec.' },
    },
    required: ['jobId'],
  },
  contract: {
    category: 'ssh',
    capabilities: ['monitor', 'verify'],
    resourceKinds: ['ssh_host'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification', 'external_run'],
    workflowStages: ['monitor_external_execution', 'verify_evidence'],
  },
};

export const SSH_BACKGROUND_JOB_WAIT_TOOL: ToolDefinition = {
  name: 'ssh_background_job_wait',
  description:
    'Wait for a background SSH job started by ssh_exec with background=true to reach a terminal state, or return when the wait timeout expires.',
  input_schema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'Background SSH job ID returned by ssh_exec.' },
      timeoutMs: {
        type: 'number',
        description: 'Maximum time to wait in milliseconds (default: 30000).',
      },
      pollIntervalMs: {
        type: 'number',
        description: 'Polling interval in milliseconds while waiting (default: 2000).',
      },
    },
    required: ['jobId'],
  },
  contract: {
    category: 'ssh',
    capabilities: ['monitor', 'wait', 'verify'],
    resourceKinds: ['ssh_host'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification', 'external_run'],
    workflowStages: ['monitor_external_execution', 'await_external_execution', 'verify_evidence'],
  },
};

export const SSH_FS_TOOL: ToolDefinition = {
  name: 'ssh_fs',
  description:
    'Perform a remote filesystem operation on a configured SSH target via SFTP. ' +
    'Use action to choose the operation: list a directory, read a file, write a file (parent directories are created), rename/move a path, delete a path (set recursive=true for directories), or create a directory (mkdir). ' +
    'Use this for remote file inspection and editing without a terminal-only workflow.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read', 'write', 'rename', 'delete', 'mkdir'],
        description: 'Filesystem operation to perform.',
      },
      targetId: {
        type: 'string',
        description:
          'SSH target ID from Settings. Optional when exactly one SSH target is enabled.',
      },
      path: {
        type: 'string',
        description:
          'Remote path. Required for list/read/write/delete/mkdir. Defaults to the SSH target root for list.',
      },
      content: {
        type: 'string',
        description: 'Text content to upload. Required for action=write.',
      },
      oldPath: {
        type: 'string',
        description: 'Existing remote path. Required for action=rename.',
      },
      newPath: {
        type: 'string',
        description: 'New remote path. Required for action=rename.',
      },
      recursive: {
        type: 'boolean',
        description: 'Recursively delete a directory tree. Used by action=delete.',
      },
    },
    required: ['action'],
  },
  contract: {
    category: 'ssh',
    capabilities: ['discover', 'read', 'write', 'verify'],
    resourceKinds: ['ssh_host'],
    sideEffects: ['remote_mutation'],
    providesEvidence: ['verification', 'external_run'],
    workflowStages: [
      'discover_resource',
      'inspect_resource',
      'mutate_remote_state',
      'verify_evidence',
    ],
  },
};

export const BUILTIN_SSH_TOOL_DEFINITIONS: ToolDefinition[] = [
  SSH_EXEC_TOOL,
  SSH_BACKGROUND_JOB_STATUS_TOOL,
  SSH_BACKGROUND_JOB_WAIT_TOOL,
  SSH_FS_TOOL,
];
