import { ToolDefinition } from '../../types/tool';

// ---------------------------------------------------------------------------
// Kavi — Extended Tool Definitions (registry-only)
// ---------------------------------------------------------------------------

export const FILE_EDIT_TOOL: ToolDefinition = {
  name: 'file_edit',
  description:
    'Edit an existing file in the current workspace with focused updates instead of rewriting the entire document. ' +
    'Preferred usage: pass edits as an ordered array of replace, delete, insert_before, or insert_after operations. ' +
    'Each edit must match unique surrounding context, and all edits are applied atomically. ' +
    'Legacy oldText/newText single-replace arguments remain supported for backward compatibility.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        minLength: 1,
        description: 'File path relative to workspace root',
      },
      oldText: {
        type: 'string',
        minLength: 1,
        description:
          'Legacy exact text to find and replace (must match uniquely). Prefer edits[].oldText for new calls.',
      },
      newText: {
        type: 'string',
        description: 'Legacy replacement text. Prefer edits[].newText for new calls.',
      },
      edits: {
        type: 'array',
        minItems: 1,
        description:
          'Ordered focused edits. Prefer this over oldText/newText for multiple changes or insert/delete operations.',
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
    required: ['path'],
  },
  contract: {
    category: 'workspace_files',
    capabilities: ['write', 'verify'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['local_artifact'],
    riskHints: ['idempotent'],
    providesEvidence: ['local_artifact', 'verification'],
    workflowStages: ['persist_artifact', 'verify_evidence'],
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
    'Manage scheduled tasks (cron jobs). Create, list, update, delete, or run tasks. ' +
    'Tasks run on a schedule using cron expressions.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action: create, list, update, delete, run, enable, disable',
      },
      id: { type: 'string', description: 'Task ID (for update/delete/run/enable/disable)' },
      name: { type: 'string', description: 'Task name (for create)' },
      schedule: { type: 'string', description: 'Cron expression (for create/update)' },
      prompt: { type: 'string', description: 'Task prompt/instruction (for create/update)' },
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
    capabilities: ['write'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['local_artifact', 'external_run'],
    riskHints: ['idempotent'],
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
    capabilities: ['write'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['local_artifact', 'external_run'],
    riskHints: ['idempotent'],
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
