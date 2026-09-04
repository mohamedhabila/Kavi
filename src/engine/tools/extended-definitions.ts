import { ToolDefinition } from '../../types/tool';

// ---------------------------------------------------------------------------
// Kavi — Extended Tool Definitions (registry-only)
// ---------------------------------------------------------------------------

export const FILE_EDIT_TOOL: ToolDefinition = {
  name: 'file_edit',
  description:
    'Edit an existing file in the current workspace with focused updates instead of rewriting the entire document. ' +
    'Pass edits as an ordered array of replace, delete, insert_before, or insert_after operations. ' +
    'Each edit must match unique surrounding context; all edits are validated before one file write.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        minLength: 1,
        description: 'File path relative to workspace root',
      },
      edits: {
        type: 'array',
        minItems: 1,
        description: 'Ordered focused edits to apply atomically.',
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              description:
                'Operation: replace, delete, insert_before, or insert_after. Defaults to replace.',
            },
            oldText: {
              type: 'string',
              minLength: 1,
              description:
                'Exact anchor or target text. It must match uniquely in the latest file content.',
            },
            newText: {
              type: 'string',
              description:
                'Replacement or inserted text. Omit or use an empty string when op is delete.',
            },
          },
          required: ['oldText'],
        },
      },
    },
    required: ['path', 'edits'],
  },
  strict: true,
  contract: {
    category: 'workspace_files',
    capabilities: ['write'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['local_artifact'],
    providesEvidence: ['local_artifact'],
    workflowStages: ['persist_artifact'],
  },
};

export const GLOB_SEARCH_TOOL: ToolDefinition = {
  name: 'glob_search',
  description:
    'Search for files matching a pattern in the current workspace. Supports * and ** wildcards. ' +
    'Returns a list of matching file paths.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. "*.ts", "src/**/*.js")' },
      path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
    },
    required: ['pattern'],
  },
  contract: {
    category: 'workspace_files',
    capabilities: ['discover', 'read'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource'],
  },
};

export const TEXT_SEARCH_TOOL: ToolDefinition = {
  name: 'text_search',
  description:
    'Search for text content across files in the current workspace. Returns matching lines with file paths and line numbers.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regex pattern to search for' },
      path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
      isRegex: {
        type: 'boolean',
        description: 'Whether query is a regex pattern (default: false)',
      },
    },
    required: ['query'],
  },
  contract: {
    category: 'workspace_files',
    capabilities: ['discover', 'read'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource', 'inspect_resource'],
  },
};

export const CRON_TOOL: ToolDefinition = {
  name: 'cron',
  description:
    'Manage scheduled automation tasks (cron jobs) that resume a conversation and run a prompt. ' +
    'Create, list, update, delete, or run tasks. ' +
    'For a person\'s reminder (e.g. "remind me to call mom at 6pm") use the reminder tool instead — ' +
    'it delivers a real OS notification even while the app is closed, rather than resuming a ' +
    'conversation. Use cron for an automated assistant task that should run a prompt on a schedule. ' +
    'Existing tasks can be selected by ID or exact name; a name is accepted only when it uniquely identifies one task. Request clarification when no unique match remains. ' +
    'When the app is not active, tasks use a tap-to-wake notification and run after foreground activation.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'update', 'delete', 'run', 'enable', 'disable'],
        description: 'Action to perform.',
      },
      id: {
        type: 'string',
        description:
          'Precise task ID for update/delete/run/enable/disable. An exact unique name can be used instead.',
      },
      name: {
        type: 'string',
        description:
          'Task name for create, or exact existing task name selector for update/delete/run/enable/disable.',
      },
      newName: { type: 'string', description: 'Replacement task name for update.' },
      schedule: {
        description:
          'Schedule for create/update: a structured object — {"kind":"cron","expr":"<5-field cron ' +
          'expression>","tz":"<IANA timezone>"} for recurring cron expressions, ' +
          '{"kind":"at","at":"<ISO-8601 date-time>"} for a one-time run (the task is disabled ' +
          'automatically after it fires), or {"kind":"every","seconds":<number>} for a fixed interval. ' +
          'Deprecated: a bare cron-expression string is still accepted for one more release, treated as ' +
          '{"kind":"cron","expr":<string>} — prefer the structured object.',
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['cron', 'at', 'every'] },
              expr: { type: 'string', description: '5-field cron expression. Required for kind "cron".' },
              at: { type: 'string', description: 'ISO-8601 date-time. Required for kind "at".' },
              seconds: { type: 'number', description: 'Interval in seconds. Required for kind "every".' },
              tz: { type: 'string', description: 'IANA time zone for a "cron" schedule.' },
            },
            required: ['kind'],
          },
        ],
      },
      prompt: { type: 'string', description: 'Task prompt/instruction (for create/update)' },
      mode: {
        type: 'string',
        enum: ['agentic', 'chitchat'],
        description: 'Durable conversation mode for execution (default: agentic)',
      },
      timezone: { type: 'string', description: 'Timezone (default: device timezone)' },
    },
    required: ['action'],
  },
  contract: {
    category: 'automation',
    capabilities: ['coordinate', 'monitor'],
    resourceKinds: ['device'],
    sideEffects: ['local_artifact'],
    riskHints: ['idempotent'],
    providesEvidence: ['verification'],
    workflowStages: ['start_external_execution', 'monitor_external_execution'],
  },
};

export const IMAGE_GEN_TOOL: ToolDefinition = {
  name: 'image_generate',
  description:
    'Generate an image using the active provider and save it to a local file or temporary remote URL.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Image description/prompt' },
      model: {
        type: 'string',
        description: 'Optional image model override, e.g. gpt-image-2 or gemini-3.1-flash-image',
      },
      size: {
        type: 'string',
        description: 'Image size, e.g. 1024x1024, 1024x1536, 1536x1024, 1792x1024, 1024x1792',
      },
      quality: {
        type: 'string',
        description: 'Generation quality, e.g. standard, hd, low, medium, high, auto',
      },
      format: { type: 'string', description: 'Output format: png, jpeg, or webp' },
      background: {
        type: 'string',
        description: 'Background: transparent, opaque, or auto (GPT image models)',
      },
      style: { type: 'string', description: 'Style for DALL-E 3: vivid or natural' },
    },
    required: ['prompt'],
  },
  strict: true,
  contract: {
    category: 'media',
    capabilities: ['write', 'verify'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['local_artifact', 'external_run'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['prepare_artifact', 'persist_artifact', 'verify_evidence'],
  },
};

export const IMAGE_EDIT_TOOL: ToolDefinition = {
  name: 'image_edit',
  description:
    'Edit one or more existing images from the conversation workspace using a text instruction. ' +
    'Use imagePath for the primary image and imagePaths for additional references. ' +
    'Returns a saved edited image file.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'Editing instruction describing exactly what to change and what must stay the same',
      },
      imagePath: {
        type: 'string',
        description: 'Primary input image path relative to the conversation workspace',
      },
      imagePaths: {
        type: 'array',
        description:
          'Additional input image paths relative to the conversation workspace. The first image remains the main canvas when provided with imagePath.',
        items: { type: 'string' },
      },
      maskPath: {
        type: 'string',
        description:
          'Optional mask image path relative to the conversation workspace. Best supported by GPT Image models.',
      },
      model: {
        type: 'string',
        description: 'Optional image model override, e.g. gpt-image-2 or gemini-3.1-flash-image',
      },
      size: {
        type: 'string',
        description:
          'Requested output size or aspect ratio, e.g. auto, 1024x1024, 1024x1536, 16:9, 1K, or 2K',
      },
      quality: { type: 'string', description: 'Output quality, e.g. low, medium, high, or auto' },
      format: { type: 'string', description: 'Output format: png, jpeg, or webp' },
      background: {
        type: 'string',
        description: 'Background: transparent, opaque, or auto (GPT image models)',
      },
      inputFidelity: {
        type: 'string',
        description: 'Input fidelity: high or low (GPT image models)',
      },
      moderation: {
        type: 'string',
        description: 'Moderation level: auto or low (GPT image models)',
      },
      outputCompression: {
        type: 'number',
        description: 'Compression level 0-100 for jpeg or webp output (GPT image models)',
      },
    },
    required: ['prompt'],
  },
  strict: true,
  contract: {
    category: 'media',
    capabilities: ['write', 'verify'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['local_artifact', 'external_run'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['prepare_artifact', 'persist_artifact', 'verify_evidence'],
  },
};

export const EXTENDED_TOOL_DEFINITIONS = [
  FILE_EDIT_TOOL,
  GLOB_SEARCH_TOOL,
  TEXT_SEARCH_TOOL,
  CRON_TOOL,
  IMAGE_GEN_TOOL,
  IMAGE_EDIT_TOOL,
] as const;
