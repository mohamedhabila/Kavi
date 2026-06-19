import { ToolDefinition } from '../../types/tool';

type ToolContract = NonNullable<ToolDefinition['contract']>;

function canvasReadContract(overrides: Partial<ToolContract> = {}): ToolContract {
  return {
    category: 'canvas',
    capabilities: ['discover', 'read', 'verify'],
    resourceKinds: ['canvas'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'idempotent'],
    providesEvidence: ['verification', 'local_artifact'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
    ...overrides,
  };
}

function canvasWriteContract(overrides: Partial<ToolContract> = {}): ToolContract {
  return {
    category: 'canvas',
    capabilities: ['write', 'verify'],
    resourceKinds: ['canvas'],
    sideEffects: ['local_artifact'],
    providesEvidence: ['verification', 'local_artifact'],
    workflowStages: ['prepare_artifact', 'persist_artifact', 'verify_evidence'],
    ...overrides,
  };
}

export const CANVAS_CREATE_TOOL: ToolDefinition = {
  name: 'canvas_create',
  description:
    'Create a new interactive canvas surface in the current session. ' +
    'You can either pass structured components (for simple UI) or HTML sources via content, filePath, or directoryPath (for complex/custom layouts). ' +
    'Use this for prototypes, previews, games, dashboards, forms, and any interactive UI. ' +
    'Preferred payloads: {"title":"Preview","directoryPath":"canvas/app"} for a multi-file HTML/CSS/JS app, {"title":"Preview","filePath":"canvas/preview.html"} for a single local HTML entry file, {"title":"Preview","content":"<html>...</html>"} for inline HTML, or {"title":"Preview","components":[...]} for structured UI. Local HTML sources are copied into a persisted local site bundle once at creation time so the canvas opens later like a simple browser without re-reading the workspace. directoryPath may also take entryFile when multiple HTML files exist. Common aliases like html, rawHtml, body, markup, and source are accepted, but content, filePath, and directoryPath are the canonical HTML source fields and only one can be provided.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Surface title shown to the user' },
      content: {
        type: 'string',
        description:
          'Raw HTML content to render directly. When provided, components are ignored. Use this for complex interactive content like games, charts, or custom layouts.',
      },
      filePath: {
        type: 'string',
        description:
          'Conversation-workspace path to an .html or .htm file to load as the canvas entry file. Supported HTML/CSS/JS files from that local site are copied into a persisted bundle once. Prefer directoryPath for multi-file canvases. Do not provide with content or directoryPath.',
      },
      directoryPath: {
        type: 'string',
        description:
          'Conversation-workspace directory containing a local HTML/CSS/JS app. The handler scans the directory recursively, identifies supported files, and copies them into a persisted local site bundle once. Prefer this for multi-file canvases. Do not provide with content or filePath.',
      },
      entryFile: {
        type: 'string',
        description:
          'Optional HTML entry file to use when directoryPath contains multiple .html files. Relative paths resolve from directoryPath.',
      },
      catalogId: { type: 'string', description: 'Component catalog identifier (optional)' },
      components: {
        type: 'array',
        description: 'Array of structured UI components to render. Ignored if content is provided.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique component ID' },
            type: {
              type: 'string',
              description:
                'Component type: text, heading, button, input, textarea, image, card, row, list, badge, progress, divider, container, select, checkbox, radio, form, table',
            },
            props: {
              type: 'object',
              description: 'Component properties (text, label, src, value, etc.)',
            },
            children: {
              type: 'array',
              description: 'Nested child components',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string' },
                  props: { type: 'object' },
                },
                required: ['id', 'type'],
              },
            },
          },
          required: ['id', 'type'],
        },
      },
      dataModel: { type: 'object', description: 'Initial data model for data bindings (optional)' },
    },
    required: ['title'],
  },
  contract: canvasWriteContract(),
};

export const CANVAS_UPDATE_TOOL: ToolDefinition = {
  name: 'canvas_update',
  description:
    "Update an existing session canvas surface's content, components, or data model. " +
    'Use this to revise a canvas created in the current conversation instead of creating files or a replacement surface. ' +
    'Prefer focused updates: use contentEdits for raw HTML canvases, componentOperations for structured component trees, and dataOperations for data-model changes. ' +
    'When you already edited a local HTML workspace file or directory, prefer filePath or directoryPath over resending the full content. ' +
    'Reserve full content or components replacement for resets, imports, or large rewrites. ' +
    'Re-use the exact surfaceId returned by canvas_create or canvas_list. If you do not have it, call canvas_list first. filePath must point to an .html or .htm file in the conversation workspace. directoryPath must point to a directory containing a local HTML app. Local HTML sources are recopied into a persisted local site bundle once per update so the canvas keeps opening like a simple browser without re-reading the workspace. Aliases like canvasId, id, surface, canvas, html, rawHtml, body, markup, and source are accepted, but surfaceId, content, filePath, and directoryPath are the canonical fields. content, filePath, and directoryPath are mutually exclusive, and contentEdits cannot be combined with filePath or directoryPath.',
  input_schema: {
    type: 'object',
    properties: {
      surfaceId: { type: 'string', description: 'Surface ID to update' },
      content: {
        type: 'string',
        description:
          'Full raw HTML replacement. Prefer contentEdits for focused changes to an existing HTML canvas.',
      },
      filePath: {
        type: 'string',
        description:
          'Conversation-workspace path to an .html or .htm file whose local HTML/CSS/JS site bundle should replace the current HTML canvas source. Prefer directoryPath for multi-file app updates. Do not provide with content, directoryPath, or contentEdits.',
      },
      directoryPath: {
        type: 'string',
        description:
          'Conversation-workspace directory containing a local HTML/CSS/JS app whose recursively discovered supported files should replace the current HTML canvas source. Prefer this for multi-file app updates. Do not provide with content, filePath, or contentEdits.',
      },
      entryFile: {
        type: 'string',
        description:
          'Optional HTML entry file to use when directoryPath contains multiple .html files. Relative paths resolve from directoryPath.',
      },
      contentEdits: {
        type: 'array',
        description:
          'Ordered focused edits for an HTML-mode canvas. Inspect with canvas_read first, then patch only the changed sections.',
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
              description:
                'Exact anchor or target text. It must match uniquely in the stored HTML source.',
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
      components: {
        type: 'array',
        description:
          'Full component tree replacement. Prefer componentOperations for focused updates to an existing component canvas.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            props: { type: 'object' },
          },
          required: ['id', 'type'],
        },
      },
      componentOperations: {
        type: 'array',
        description:
          'JSON-Patch-style add/replace/remove operations for the component tree. Paths use RFC 6901 syntax like /0/props/text.',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', description: 'Operation: add, replace, or remove' },
            path: {
              type: 'string',
              description: 'RFC 6901 path into the component tree, e.g. /0/props/text',
            },
            value: { description: 'New value for add or replace operations' },
          },
          required: ['op', 'path'],
        },
      },
      dataOperations: {
        type: 'array',
        description: 'JSON-Patch-style add/replace/remove operations on the data model',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', description: 'Operation: add, replace, remove' },
            path: { type: 'string', description: 'JSON path (e.g. /title)' },
            value: { description: 'New value (for add/replace)' },
          },
          required: ['op', 'path'],
        },
      },
    },
    required: ['surfaceId'],
  },
  contract: canvasWriteContract(),
};

export const CANVAS_DELETE_TOOL: ToolDefinition = {
  name: 'canvas_delete',
  description:
    'Delete a canvas surface. Prefer the exact surfaceId returned by canvas_create or canvas_list. If you are unsure which surface is active, call canvas_list first.',
  input_schema: {
    type: 'object',
    properties: {
      surfaceId: { type: 'string', description: 'Surface ID to delete' },
    },
    required: ['surfaceId'],
  },
  contract: {
    category: 'canvas',
    capabilities: ['write', 'verify'],
    resourceKinds: ['canvas'],
    sideEffects: ['destructive'],
    riskHints: ['destructive'],
    providesEvidence: ['verification', 'local_artifact'],
    workflowStages: ['persist_artifact'],
  },
};

export const CANVAS_NAVIGATE_TOOL: ToolDefinition = {
  name: 'canvas_navigate',
  description:
    'Navigate a canvas surface to a remote http or https URL. ' +
    'Do not use this for local files, generated HTML files, or session content; use canvas_create or canvas_update for that. ' +
    'Prefer the exact surfaceId from canvas_create or canvas_list.',
  input_schema: {
    type: 'object',
    properties: {
      surfaceId: { type: 'string', description: 'Surface ID to navigate' },
      url: { type: 'string', description: 'URL to navigate the surface to' },
    },
    required: ['surfaceId', 'url'],
  },
  contract: canvasWriteContract(),
};

export const CANVAS_EVAL_TOOL: ToolDefinition = {
  name: 'canvas_eval',
  description:
    "Execute JavaScript code within a canvas surface's WebView and return the result. " +
    'The canvas must be open and loaded. Use this to modify the DOM, trigger interactions, or run computations within the canvas. ' +
    'Prefer canvas_read for routine inspection of stored content or live DOM. ' +
    'Always pass the script in the script field as a string. Aliases like code and expression are accepted, but script is canonical. After canvas_create or canvas_update, call canvas_eval immediately so the preview is opened and refreshed.',
  input_schema: {
    type: 'object',
    properties: {
      surfaceId: { type: 'string', description: 'Surface ID to evaluate code in' },
      script: {
        type: 'string',
        description:
          'JavaScript code to execute. The return value of the last expression is captured.',
      },
    },
    required: ['surfaceId', 'script'],
  },
  contract: canvasWriteContract(),
};

export const CANVAS_READ_TOOL: ToolDefinition = {
  name: 'canvas_read',
  description:
    'Read the content of a session canvas surface. ' +
    'Use this to inspect stored HTML, generated component HTML, or the live DOM of a loaded canvas without writing custom JavaScript. ' +
    'Prefer this over canvas_eval when you only need to inspect the current canvas state. ' +
    'Use mode="source" for stored session content, mode="dom" for the live rendered DOM, or omit mode to use the best available read path automatically.',
  input_schema: {
    type: 'object',
    properties: {
      surfaceId: {
        type: 'string',
        description:
          'Surface ID to read. Reuse the exact surfaceId returned by canvas_create or canvas_list.',
      },
      mode: { type: 'string', description: 'Read mode: auto (default), source, or dom.' },
      maxChars: {
        type: 'number',
        description: 'Maximum content characters to return (default: 20000, max: 120000).',
      },
    },
    required: ['surfaceId'],
  },
  contract: canvasReadContract(),
};

export const CANVAS_SNAPSHOT_TOOL: ToolDefinition = {
  name: 'canvas_snapshot',
  description:
    'Capture an image snapshot of the current canvas surface. ' +
    'The canvas must be open and loaded. Returns a base64 data URI for the rendered image. ' +
    'Prefer the exact surfaceId from canvas_create or canvas_list.',
  input_schema: {
    type: 'object',
    properties: {
      surfaceId: { type: 'string', description: 'Surface ID to snapshot' },
      format: { type: 'string', description: 'Output format: png or jpeg (default: png)' },
      quality: { type: 'number', description: 'JPEG quality 0-1 (default: 0.8)' },
    },
    required: ['surfaceId'],
  },
  contract: canvasReadContract(),
};

export const CANVAS_LIST_TOOL: ToolDefinition = {
  name: 'canvas_list',
  description:
    'List all active canvas surfaces in the current session. Call this before creating a new canvas to check if one already exists that can be updated instead, and before update/delete/navigate/eval when you need the correct surfaceId. Returns surface IDs, titles, focus state, and states.',
  input_schema: {
    type: 'object',
    properties: {
      includeDestroyed: {
        type: 'boolean',
        description: 'Include destroyed surfaces in the response (default: false)',
      },
    },
    required: [],
  },
  contract: canvasReadContract({
    workflowStages: ['discover_resource'],
  }),
};

export const BUILTIN_CANVAS_TOOL_DEFINITIONS: ToolDefinition[] = [
  CANVAS_LIST_TOOL,
  CANVAS_READ_TOOL,
  CANVAS_CREATE_TOOL,
  CANVAS_UPDATE_TOOL,
  CANVAS_DELETE_TOOL,
  CANVAS_NAVIGATE_TOOL,
  CANVAS_EVAL_TOOL,
  CANVAS_SNAPSHOT_TOOL,
];
