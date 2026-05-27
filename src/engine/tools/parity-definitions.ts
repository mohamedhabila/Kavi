// ---------------------------------------------------------------------------
// Kavi — Parity Tool Definitions (for Kavi feature parity)
// ---------------------------------------------------------------------------
// New tools: canvas, sessions, pdf_read, camera_snap, audio_transcribe,
// memory_search (embedding-based), hooks management.

import { ToolDefinition } from '../../types';

// ── Canvas / A2UI Tools ──────────────────────────────────────────────────

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
};

// ── Sub-Agent Session Tools ──────────────────────────────────────────────

export const SESSION_SPAWN_TOOL: ToolDefinition = {
  name: 'sessions_spawn',
  description:
    'Spawn an isolated sub-agent session to perform a delegated task. ' +
    'By default it launches in the background so the agent can poll status and continue other work. ' +
    'If the tool returns status="running" and you cannot proceed until that worker finishes, your next blocking step should usually be sessions_wait for that sessionId. ' +
    'Use sessions_wait when you need the final worker output before proceeding, and sessions_status when you need live inspection while it is still running. ' +
    'When a structured multi-workstream plan exists, pass workstreamId for every plan-linked worker so the runtime can enforce dependency order; use dependsOnWorkstreams only for ad hoc workers that must wait on prior work. ' +
    'Only launch multiple workers in the same turn when they are truly independent at launch time. ' +
    'Sub-agents are intentionally untimed and keep running until completion unless you cancel them for drift or redundancy. ' +
    'Workers also use a generous internal iteration budget; do not micromanage loop caps from the supervisor.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Task instructions for the sub-agent' },
      workstreamId: {
        type: 'string',
        description:
          'Optional stable workstream id for this worker. When a structured plan exists, pass the matching workstreamId so the runtime can enforce dependency-aware scheduling.',
      },
      dependsOnWorkstreams: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional prerequisite workstream ids or titles that must already be complete before this worker can start. Use this for ad hoc workers or extra gating beyond the captured plan.',
      },
      model: { type: 'string', description: 'Model override (optional)' },
      systemPrompt: {
        type: 'string',
        description:
          'Custom system prompt for the sub-agent persona (optional — overrides default sub-agent prompt)',
        maxLength: 50000,
      },
      name: {
        type: 'string',
        description:
          'Descriptive name for the sub-agent (e.g., "Backend Architect", "QA Reviewer")',
        maxLength: 256,
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Restrict the sub-agent to only these tools (optional — empty means all allowed tools). If sandboxPolicy is safe-only, the effective set is the intersection of this list and safe-only tools.',
      },
      inheritMemory: {
        type: 'boolean',
        description: 'Whether to inherit parent memory (default: true)',
      },
      sandboxPolicy: {
        type: 'string',
        description: 'Sub-agent sandbox policy: full, safe-only, or inherit (optional)',
      },
      announce: {
        type: 'boolean',
        description: 'Whether to emit sub-agent lifecycle announcements (default: true)',
      },
      waitForCompletion: {
        type: 'boolean',
        description:
          'When true, wait for the worker result in this tool call instead of returning immediately with a running session id. Prefer false for long-running work.',
      },
      waitTimeoutMs: {
        type: 'number',
        description:
          'Optional maximum time to wait when waitForCompletion=true. If omitted, a bounded default wait window is used; if it elapses, the tool returns while the worker continues in the background.',
      },
    },
    required: ['prompt'],
  },
};

export const SESSION_LIST_TOOL: ToolDefinition = {
  name: 'sessions_list',
  description:
    'List all active and recent sub-agent sessions. Reuse the returned session ids and switch to sessions_wait, sessions_status, or sessions_output for known sessions instead of repeatedly listing them.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const SESSION_SEND_TOOL: ToolDefinition = {
  name: 'sessions_send',
  description:
    'Follow up on a finished sub-agent session by respawning it with prior output as context. ' +
    'By default the follow-up worker launches in the background so you can keep working and later call sessions_wait when you need its output or sessions_status when you need live inspection. ' +
    'Follow-up workers also remain untimed by default and reuse the generous internal iteration budget instead of a supervisor-provided loop cap. For running workers, inspect sessions_status or cancel and respawn instead.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Target session ID' },
      message: { type: 'string', description: 'Message to send' },
      waitForCompletion: {
        type: 'boolean',
        description:
          'When true, wait for the follow-up worker result in this tool call instead of returning immediately with a running session id. Prefer false for substantial follow-up work.',
      },
      waitTimeoutMs: {
        type: 'number',
        description:
          'Optional maximum time to wait when waitForCompletion=true. If omitted, a bounded default wait window is used; if it elapses, the tool returns while the follow-up worker continues in the background.',
      },
    },
    required: ['sessionId', 'message'],
  },
};

export const SESSION_HISTORY_TOOL: ToolDefinition = {
  name: 'sessions_history',
  description:
    'Retrieve conversation history from a sub-agent session. ' +
    'Use sessions_output instead when you only need the terminal final output and not the reasoning trace. ' +
    'Returns sanitized messages capped at 80KB.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID to fetch history for' },
      maxMessages: {
        type: 'number',
        description: 'Maximum number of messages to return (default: 50)',
      },
    },
    required: ['sessionId'],
  },
};

export const SESSION_OUTPUT_TOOL: ToolDefinition = {
  name: 'sessions_output',
  description:
    'Retrieve the full final output from a terminal sub-agent session without returning its transcript history. ' +
    'Use this when the supervisor needs to fetch a terminal worker deliverable without waiting, or to recall it later after a prior sessions_wait result is no longer in working context. If you just received the same completed session from sessions_wait, do not call sessions_output again immediately unless you need to recall the deliverable later. If that deliverable should become the visible user answer directly, prefer sessions_surface_output instead of restating it manually. After you have the needed terminal deliverable, continue from it or finalize instead of polling sessions_status or sessions_list for the same completed session. ' +
    'Use sessions_history only when you need to trace the worker transcript, reasoning path, or tool-by-tool decisions.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Terminal session ID whose final output should be returned.',
      },
    },
    required: ['sessionId'],
  },
};

export const SESSION_SURFACE_OUTPUT_TOOL: ToolDefinition = {
  name: 'sessions_surface_output',
  description:
    'Surface the final output from a terminal sub-agent session directly as the supervisor-visible answer without retyping it. ' +
    'Use this when the worker already produced the exact user-facing deliverable and you want the runtime to present that content as the visible assistant answer candidate. ' +
    'Optional prefix and suffix are inserted verbatim so the supervisor can wrap the worker output with brief framing. ' +
    'Optional startMarker and endMarker let you surface only a bounded section of the worker output; if fallbackToFullOutput is not set to false, missing markers fall back to the full terminal output instead of failing. ' +
    'After calling this tool, do not restate the same surfaced content again in normal assistant text unless you are adding materially new information.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Terminal session ID whose final output should be surfaced to the user.',
      },
      prefix: {
        type: 'string',
        description:
          'Optional text inserted verbatim before the surfaced worker output, such as a short heading or framing sentence.',
      },
      suffix: {
        type: 'string',
        description:
          'Optional text inserted verbatim after the surfaced worker output, such as a short conclusion or next-step note.',
      },
      startMarker: {
        type: 'string',
        description:
          'Optional marker string that defines where the surfaced slice should start inside the worker output.',
      },
      endMarker: {
        type: 'string',
        description:
          'Optional marker string that defines where the surfaced slice should end inside the worker output.',
      },
      includeStartMarker: {
        type: 'boolean',
        description:
          'When true, include startMarker itself in the surfaced output. Defaults to false.',
      },
      includeEndMarker: {
        type: 'boolean',
        description:
          'When true, include endMarker itself in the surfaced output. Defaults to false.',
      },
      maxChars: {
        type: 'number',
        description:
          'Optional maximum number of worker-output characters to surface before prefix/suffix are applied.',
      },
      fallbackToFullOutput: {
        type: 'boolean',
        description:
          'When true or omitted, missing markers fall back to the full worker output. Set false to fail instead.',
      },
      trim: {
        type: 'boolean',
        description:
          'When true or omitted, trim leading and trailing whitespace from the selected worker output before wrapping it.',
      },
    },
    required: ['sessionId'],
  },
};

export const SESSION_STATUS_TOOL: ToolDefinition = {
  name: 'sessions_status',
  description:
    'Get the current status of a sub-agent session, including launchState, live currentActivity, the active tool, recent verified findings, liveness/idle timing, and whether the worker can be cancelled.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID to check' },
    },
    required: ['sessionId'],
  },
};

export const SESSION_WAIT_TOOL: ToolDefinition = {
  name: 'sessions_wait',
  description:
    'Block until one or more sub-agent sessions reach terminal states and return their outputs. ' +
    'Prefer this when the supervisor cannot proceed until worker results are ready. ' +
    'Use this instead of alternating sessions_status plus wait when you already need the final worker outputs to continue. ' +
    'Provide sessionId for one worker, sessionIds for several workers, or omit both to wait for all currently running child sessions in the current conversation. ' +
    'Each completed session entry already includes the same output payload that sessions_output would return, including when you wait for several workers together, so only call sessions_output later if you need to recall a terminal deliverable without waiting. ' +
    'Optionally set waitTimeoutMs to override the 3-minute default wait window while unfinished workers continue in the background.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Optional single session ID to wait for.' },
      sessionIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of session IDs to wait for together. Omit to wait for all currently running child sessions in the current conversation.',
      },
      waitTimeoutMs: {
        type: 'number',
        description:
          'Optional maximum total time to wait. If omitted, a 3-minute default wait window is used. If it elapses, the tool returns running sessions as pending while they continue in the background.',
      },
    },
    required: [],
  },
};

export const SESSION_CANCEL_TOOL: ToolDefinition = {
  name: 'sessions_cancel',
  description:
    'Cancel a running sub-agent session when it is drifting, redundant, or needs correction. ' +
    'After cancellation, inspect sessions_status and respawn with refined instructions if needed.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Running session ID to cancel' },
      reason: {
        type: 'string',
        description: 'Optional short reason to record with the cancellation request.',
      },
    },
    required: ['sessionId'],
  },
};

export const SESSION_YIELD_TOOL: ToolDefinition = {
  name: 'sessions_yield',
  description:
    'Record a supervisor checkpoint for currently running sub-agents. ' +
    'While sub-agents are still running this is checkpoint-only in the mobile runtime; if no running sub-agents remain it confirms the supervisor can finalize instead of waiting again.',
  input_schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Optional short status message describing what the agent is waiting for.',
      },
    },
    required: [],
  },
};

export const WAIT_TOOL: ToolDefinition = {
  name: 'wait',
  description:
    'Pause briefly before the next tool call. Useful when polling long-running workflows or sub-agent sessions.',
  input_schema: {
    type: 'object',
    properties: {
      ms: {
        type: 'number',
        description: 'Delay in milliseconds, clamped to 100-60000 (default: 1000)',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for the wait, echoed back in the result',
      },
    },
    required: [],
  },
};

// ── PDF Analysis Tool ────────────────────────────────────────────────────

export const PDF_READ_TOOL: ToolDefinition = {
  name: 'pdf_read',
  description: 'Extract text content from a PDF file. Reads PDFs from workspace or a URL.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'PDF file path (relative to workspace) or URL' },
      pages: { type: 'string', description: 'Page range, e.g. "1-5" or "all" (default: all)' },
    },
    required: ['path'],
  },
};

// ── Camera Snap Tool ─────────────────────────────────────────────────────

export const CAMERA_SNAP_TOOL: ToolDefinition = {
  name: 'camera_snap',
  description: 'Take a photo using the device camera and return it as a base64-encoded image.',
  input_schema: {
    type: 'object',
    properties: {
      camera: {
        type: 'string',
        description: 'Camera to use: "front" or "back" (default: back)',
      },
      quality: {
        type: 'number',
        description: 'Image quality 0-1 (default: 0.7)',
      },
    },
    required: [],
  },
};

// ── Audio Transcription Tool ─────────────────────────────────────────────

export const AUDIO_TRANSCRIBE_TOOL: ToolDefinition = {
  name: 'audio_transcribe',
  description:
    'Record audio from the microphone for a specified duration, then transcribe the recording to text using Whisper API.',
  input_schema: {
    type: 'object',
    properties: {
      durationMs: {
        type: 'number',
        description: 'Recording duration in milliseconds (default: 5000)',
      },
      language: {
        type: 'string',
        description: 'Expected language code, e.g. "en" (optional)',
      },
    },
    required: [],
  },
};

// ── Embedding Memory Search Tool ─────────────────────────────────────────

export const MEMORY_SEARCH_TOOL: ToolDefinition = {
  name: 'memory_search',
  description:
    'Search conversation memory, global memory, or both using memory-aware search. ' +
    'Results label which scope each match came from so you can decide whether the information is conversation-local or durable across conversations.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      scope: {
        type: 'string',
        enum: ['all', 'conversation', 'global'],
        description: 'Which memory scope to search. Default: "all".',
      },
      maxResults: { type: 'number', description: 'Maximum results to return (default: 10)' },
    },
    required: ['query'],
  },
};

// ── Living-memory fact/block tools ──────────────────────────

export const MEMORY_RECALL_TOOL: ToolDefinition = {
  name: 'memory_recall',
  description:
    'Recall structured facts from the living-memory fact store. Filter by subject (entity name), predicate (relation), or pinnedOnly. ' +
    'Returns the current set of valid facts plus optionally invalidated/historical rows when includeHistory is true. ' +
    'Use this when you need exact, structured recall of what is known about a subject — for fuzzy or unstructured search across notes/messages, prefer memory_search.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Entity name to filter by (e.g. "user", "project-x").' },
      predicate: { type: 'string', description: 'Relation/predicate to filter by (e.g. "prefers", "deadline").' },
      scope: {
        type: 'string',
        enum: ['global', 'project', 'conversation', 'session', 'persona'],
        description: 'Optional fact scope filter.',
      },
      originConversationId: { type: 'string', description: 'Optional source conversation id filter.' },
      originTaskId: { type: 'string', description: 'Optional source task/run id filter.' },
      all: { type: 'boolean', description: 'When true, list all valid facts without another filter.' },
      pinnedOnly: { type: 'boolean', description: 'Return only pinned facts.' },
      limit: { type: 'number', description: 'Max facts to return (default 50, hard cap 100).' },
      includeHistory: { type: 'boolean', description: 'Include invalidated/superseded facts.' },
    },
    required: [],
  },
};

export const MEMORY_REMEMBER_TOOL: ToolDefinition = {
  name: 'memory_remember',
  description:
    'Record a structured fact (subject, predicate, value) in the living-memory fact store. ' +
    'Set supersedePrior=true to invalidate any currently-valid fact for the same (subject, predicate) before writing the new one — use this when you are correcting or updating a value rather than adding a parallel fact. ' +
    'Use a high confidence (≥ 0.85) only when you have direct user confirmation; otherwise leave confidence at the default to mark the fact as a candidate.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Entity name (e.g. "user", "project-x").' },
      subjectType: {
        type: 'string',
        enum: ['self', 'person', 'project', 'concept', 'system'],
        description: 'Defaults to "self" when subject is "user", otherwise "concept".',
      },
      predicate: { type: 'string', description: 'Relation name.' },
      value: { type: 'string', description: 'Object text (≤ 200 chars).' },
      confidence: { type: 'number', description: '0..1; ≥ 0.85 marks a verified fact.' },
      scope: {
        type: 'string',
        enum: ['global', 'project', 'conversation', 'session', 'persona'],
        description: 'Where this fact belongs. Use global only for stable profile/preferences.',
      },
      originConversationId: { type: 'string', description: 'Conversation where the fact was learned.' },
      originTaskId: { type: 'string', description: 'Agent task/run where the fact was learned.' },
      sourceMessageId: { type: 'string', description: 'Message id that supports this fact.' },
      sourceSummary: { type: 'string', description: 'Short evidence note or reason.' },
      importance: { type: 'number', description: '0..1 importance used for recall and decay.' },
      supersedePrior: { type: 'boolean', description: 'Invalidate any prior valid fact for (subject, predicate) first.' },
      pinned: { type: 'boolean', description: 'Pin the new fact so it always appears in the focus header.' },
    },
    required: ['subject', 'predicate', 'value'],
  },
};

export const MEMORY_PIN_TOOL: ToolDefinition = {
  name: 'memory_pin',
  description: 'Pin a fact by id so it is always included in the focus header surfaced to the model.',
  input_schema: {
    type: 'object',
    properties: { factId: { type: 'string', description: 'ID returned by memory_recall or memory_remember.' } },
    required: ['factId'],
  },
};

export const MEMORY_UNPIN_TOOL: ToolDefinition = {
  name: 'memory_unpin',
  description: 'Remove a pin from a fact so it competes with other facts for focus-header inclusion.',
  input_schema: {
    type: 'object',
    properties: { factId: { type: 'string' } },
    required: ['factId'],
  },
};

export const MEMORY_FORGET_TOOL: ToolDefinition = {
  name: 'memory_forget',
  description:
    'Forget a fact. mode="invalidate" (default behaviour for corrections) closes the fact at now without removing the row, preserving the audit trail. mode="delete" soft-deletes the fact entirely. ' +
    'Prefer "invalidate" when the user contradicts a previous fact; reserve "delete" for facts the user explicitly asks to be removed.',
  input_schema: {
    type: 'object',
    properties: {
      factId: { type: 'string' },
      mode: { type: 'string', enum: ['invalidate', 'delete'], description: 'Default "delete".' },
    },
    required: ['factId'],
  },
};

export const MEMORY_MANAGE_TOOL: ToolDefinition = {
  name: 'memory_manage',
  description:
    'Manage a fact by id. ' +
    'Use action=pin to keep a fact in the focus header, action=unpin to release it, ' +
    'or action=forget to invalidate (default for corrections, preserves audit trail) or delete it.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['pin', 'unpin', 'forget'],
        description: 'Operation to perform.',
      },
      factId: { type: 'string', description: 'ID returned by memory_recall or memory_remember.' },
      mode: {
        type: 'string',
        enum: ['invalidate', 'delete'],
        description: 'For action=forget: "invalidate" (default) closes the fact, "delete" soft-deletes it.',
      },
    },
    required: ['action', 'factId'],
  },
};

export const MEMORY_BLOCK_READ_TOOL: ToolDefinition = {
  name: 'memory_block_read',
  description:
    'Read one or all editable memory blocks. Blocks are short, model-editable scratch surfaces (persona, scratchpad, etc.) that always appear in the focus header. Omit label to list all blocks.',
  input_schema: {
    type: 'object',
    properties: { label: { type: 'string', description: 'Block label (e.g. "persona", "scratchpad"). Omit to list all blocks.' } },
    required: [],
  },
};

export const MEMORY_BLOCK_EDIT_TOOL: ToolDefinition = {
  name: 'memory_block_edit',
  description:
    'Edit a memory block. With replace=true (default) the block content is overwritten; with replace=false the new content is appended on a new line. Block content is truncated at the block char limit.',
  input_schema: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      content: { type: 'string' },
      replace: { type: 'boolean', description: 'Default true (overwrite).' },
    },
    required: ['label', 'content'],
  },
};

export const MEMORY_BLOCK_TOOL: ToolDefinition = {
  name: 'memory_block',
  description:
    'Read or edit an editable memory block. ' +
    'Use action=read (omit label to list all blocks) to fetch block contents, ' +
    'or action=edit to overwrite (replace=true, default) or append (replace=false) content.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'edit'],
        description: 'Operation to perform.',
      },
      label: {
        type: 'string',
        description: 'Block label (e.g. "persona", "scratchpad"). Required for action=edit; optional for action=read.',
      },
      content: { type: 'string', description: 'New content. Required for action=edit.' },
      replace: { type: 'boolean', description: 'For action=edit: true (default) overwrites, false appends on a new line.' },
    },
    required: ['action'],
  },
};

// ── SSH Remote Tools ────────────────────────────────────────────────────

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
};

// ── Expo / EAS Tools ────────────────────────────────────────────────────

export const EXPO_EAS_CREATE_PROJECT_TOOL: ToolDefinition = {
  name: 'expo_eas_create_project',
  description:
    'Create an Expo/EAS project record in a linked Expo account. This tool first resolves existing linked projects and redirects to them unless confirmedCreateNewProject is true. Use creation only when project resolution proves no suitable project exists or the user explicitly asks for a separate new Expo project. After creation, the default production path is to connect the GitHub repo, add .eas/workflows/*.yml on the target branch, push a commit, and monitor the auto-triggered workflow instead of manually dispatching Expo actions.',
  input_schema: {
    type: 'object',
    properties: {
      accountId: {
        type: 'string',
        description:
          'Optional linked Expo account ID. Omit when exactly one Expo account is linked.',
      },
      name: { type: 'string', description: 'Human-readable project name.' },
      slug: {
        type: 'string',
        description:
          'Optional Expo/EAS project slug. When omitted, a slug is derived from the name.',
      },
      confirmedCreateNewProject: {
        type: 'boolean',
        description:
          'Set true only after confirming no suitable existing linked Expo project should be used, or when the user explicitly requested a separate new Expo project.',
      },
    },
    required: ['name'],
  },
};

export const EXPO_EAS_LIST_PROJECTS_TOOL: ToolDefinition = {
  name: 'expo_eas_list_projects',
  description:
    'List linked Expo/EAS projects and their automation readiness. Call this once to discover projectId values, then move to expo_eas_status or expo_eas_probe. Do not repeat it with the same arguments unless you need refresh=true or a different account. For GitHub-linked projects, prefer repo changes + .eas/workflows/*.yml + commit/push + expo_eas_workflow_* monitoring instead of manual Expo action tools.',
  input_schema: {
    type: 'object',
    properties: {
      accountId: {
        type: 'string',
        description: 'Optional linked Expo account ID to limit results.',
      },
      refresh: {
        type: 'boolean',
        description: 'When true, refresh linked account projects from Expo before listing them.',
      },
    },
    required: [],
  },
};

export const EXPO_EAS_STATUS_TOOL: ToolDefinition = {
  name: 'expo_eas_status',
  description:
    'Inspect a synced Expo/EAS project, returning linked account, execution mode, readiness, and automation metadata. Use this before deployment work to verify the repo link, workflow file, branch, and the commit-driven EAS Workflows path.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
    },
    required: ['projectId'],
  },
};

export const EXPO_EAS_PROBE_TOOL: ToolDefinition = {
  name: 'expo_eas_probe',
  description:
    'Validate that a synced Expo/EAS project is actually runnable. In Expo workflow mode this checks the linked repo and .eas/workflows automation so agents can rely on commit-driven runs; direct SSH and GitHub workflow modes are fallbacks.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
    },
    required: ['projectId'],
  },
};

export const EXPO_EAS_BUILD_TOOL: ToolDefinition = {
  name: 'expo_eas_build',
  description:
    'Manually trigger an Expo EAS build for a synced project. Use this only when the user explicitly wants a manual rerun, backfill, no-commit execution, or when commit-triggered automation is unavailable. For normal GitHub-linked projects, edit the repo, ensure .eas/workflows/*.yml exists on the branch, push a commit, and monitor the auto-triggered workflow with expo_eas_workflow_* tools.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      platform: { type: 'string', description: 'android, ios, or all. Defaults to android.' },
      profile: { type: 'string', description: 'Optional EAS build profile.' },
      waitForCompletion: {
        type: 'boolean',
        description: 'When true, wait for workflow completion in GitHub mode.',
      },
      waitTimeoutMs: { type: 'number', description: 'Optional wait timeout for workflow mode.' },
    },
    required: ['projectId'],
  },
};

export const EXPO_EAS_UPDATE_TOOL: ToolDefinition = {
  name: 'expo_eas_update',
  description:
    'Manually trigger an Expo EAS update for a synced project. Use this only for explicit manual reruns, backfills, or no-commit executions. The default GitHub-linked path is repo changes + .eas/workflows/*.yml + commit/push + expo_eas_workflow_* monitoring.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      branch: {
        type: 'string',
        description: 'Optional update branch. Defaults to the project default update branch.',
      },
      message: { type: 'string', description: 'Optional update message.' },
      waitForCompletion: {
        type: 'boolean',
        description: 'When true, wait for workflow completion in GitHub mode.',
      },
      waitTimeoutMs: { type: 'number', description: 'Optional wait timeout for workflow mode.' },
    },
    required: ['projectId'],
  },
};

export const EXPO_EAS_SUBMIT_TOOL: ToolDefinition = {
  name: 'expo_eas_submit',
  description:
    'Manually trigger an Expo EAS submit for a synced project. Use this only for explicit manual reruns, backfills, or no-commit executions. The default GitHub-linked path is repo changes + .eas/workflows/*.yml + commit/push + expo_eas_workflow_* monitoring.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      platform: { type: 'string', description: 'android or ios. Defaults to android.' },
      profile: { type: 'string', description: 'Optional EAS submit profile.' },
      waitForCompletion: {
        type: 'boolean',
        description: 'When true, wait for workflow completion in GitHub mode.',
      },
      waitTimeoutMs: { type: 'number', description: 'Optional wait timeout for workflow mode.' },
    },
    required: ['projectId'],
  },
};

export const EXPO_EAS_DEPLOY_WEB_TOOL: ToolDefinition = {
  name: 'expo_eas_deploy_web',
  description:
    'Manually trigger an Expo web hosting deploy for a synced project. Use this only for explicit manual reruns, backfills, or no-commit executions. If the target branch already carries .eas/workflows/deploy.yml, prefer committing the repo change and monitoring the automatically triggered run instead of calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      alias: {
        type: 'string',
        description: 'Optional hosting alias, such as production or preview.',
      },
      waitForCompletion: {
        type: 'boolean',
        description: 'When true, wait for workflow completion in GitHub mode.',
      },
      waitTimeoutMs: { type: 'number', description: 'Optional wait timeout for workflow mode.' },
    },
    required: ['projectId'],
  },
};

export const EXPO_EAS_WORKFLOW_RUNS_TOOL: ToolDefinition = {
  name: 'expo_eas_workflow_runs',
  description:
    'List recent workflow runs for a synced Expo project. Use this after pushing a commit to the branch that contains the .eas/workflows file, or when you need the latest run id before inspecting or waiting on a workflow.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of workflow runs to return (default: 5, max: 20).',
      },
    },
    required: ['projectId'],
  },
};

export const EXPO_EAS_WORKFLOW_STATUS_TOOL: ToolDefinition = {
  name: 'expo_eas_workflow_status',
  description:
    'Inspect a workflow run for a synced Expo project. Use this to debug the automatically triggered run from a recent commit; it returns normalized status, detailed job and step status when available, and failure log excerpts suitable for agentic debugging.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      workflowRunId: {
        type: 'string',
        description:
          'Optional workflow run id. Include this when inspecting execution evidence for a specific mutation; otherwise first list runs and correlate the desired run.',
      },
      includeJobs: {
        type: 'boolean',
        description: 'Whether to include job and step data when available (default: true).',
      },
      includeLogs: {
        type: 'boolean',
        description:
          'Whether to include failure log excerpts and attempt to resolve a log archive URL when the backend supports it (default: true). Leave this enabled for build debugging; the returned failureLogs should be treated as the primary root-cause signal.',
      },
    },
    required: ['projectId'],
  },
};

export const EXPO_EAS_WORKFLOW_WAIT_TOOL: ToolDefinition = {
  name: 'expo_eas_workflow_wait',
  description:
    'Poll an Expo or GitHub-backed workflow run until it reaches a terminal state or the timeout is hit. Use this after the repo-triggered workflow starts so the agent can stay on the monitor -> fix -> commit loop. When a build fails, inspect failureLogs first and treat missing dependency installation as the default hypothesis unless the logs show a different root cause.',
  input_schema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description:
          'Project reference from expo_eas_list_projects. Accepts the synced project ID, EAS project ID, or @owner/slug.',
      },
      workflowRunId: {
        type: 'string',
        description:
          'Workflow run id to wait on. Required for safe waits; list and correlate runs first instead of waiting on an ambiguous latest run.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Maximum wait time in milliseconds (default: 600000).',
      },
      pollIntervalMs: {
        type: 'number',
        description: 'Polling interval in milliseconds (default: 5000).',
      },
      includeJobs: {
        type: 'boolean',
        description: 'Whether to include job and step data in the final snapshot when available.',
      },
      includeLogs: {
        type: 'boolean',
        description:
          'Whether to include failure log excerpts and attempt to resolve a log archive URL in the final snapshot (default: true). Keep this enabled so the final result includes build-stage evidence for agentic repair loops.',
      },
    },
    required: ['projectId', 'workflowRunId'],
  },
};

export const EXPO_EAS_GRAPHQL_TOOL: ToolDefinition = {
  name: 'expo_eas_graphql',
  description:
    'Run an authenticated raw Expo GraphQL query against expo.dev. Use this only for advanced EAS fields not covered by the normalized status and monitoring tools, such as schema introspection, branches, channels, builds, updates, submissions, deployments, and workflow internals. When projectId is omitted, the tool will try to infer the target account from common variables such as appId, fullName, or owner+slug.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The GraphQL query or mutation document to execute.' },
      variables: { type: 'object', description: 'Optional GraphQL variables object.' },
      projectId: {
        type: 'string',
        description:
          'Optional project reference used to resolve the Expo account token automatically.',
      },
      accountId: {
        type: 'string',
        description: 'Optional Expo account id used when no projectId is supplied.',
      },
    },
    required: ['query'],
  },
};

// ── Tool Catalog Tool ────────────────────────────────────────────────────

export const TOOL_CATALOG_TOOL: ToolDefinition = {
  name: 'tool_catalog',
  description:
    'Search available built-in tools, connected MCP tools, and installed skills by natural-language query or category. Use query when you know the task you need to perform but not the right tool name, especially when you need a capability bridge such as Python-backed export, conversion, or custom generation beyond the obvious first-class tools; use category when you already know the domain and want the full callable list. Search and category results make the matched tools callable on the next turn, while the overview call is only a lightweight directory.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Optional natural-language description of the capability you need, such as "run a command on a remote server", "inspect a website", or "search Expo workflow logs". This searches tool names, descriptions, MCP server names, skill names, and category guidance.',
      },
      category: {
        type: 'string',
        description:
          'Optional category filter: files, browser, workspace, web, canvas, ssh, expo, sessions, agents, calendar, contacts, native, media, memory, automation, code, pdf, interaction, mcp, skills. Combine with query to search inside one domain, or use alone to browse a full category.',
      },
      maxResults: {
        type: 'number',
        description:
          'Optional maximum number of search matches to return when query is provided (default: 6, max: 10).',
      },
    },
    required: [],
  },
};

export const POLL_CREATE_TOOL: ToolDefinition = {
  name: 'poll_create',
  description:
    'Create an interactive decision poll inside the conversation so the user can choose between options.',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Poll question shown to the user' },
      options: {
        type: 'array',
        description: 'List of poll option labels',
        items: { type: 'string' },
      },
      allowMultiple: {
        type: 'boolean',
        description: 'Allow selecting multiple options (default: false)',
      },
      durationMs: {
        type: 'number',
        description: 'Optional suggested duration in milliseconds',
      },
    },
    required: ['question', 'options'],
  },
};

// ── Text-to-Speech Tool ──────────────────────────────────────────────────

export const SPEAK_TOOL: ToolDefinition = {
  name: 'speak',
  description:
    'Speak text aloud using text-to-speech. Supports system, OpenAI, and ElevenLabs TTS backends.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to speak' },
      provider: {
        type: 'string',
        description: 'TTS provider: system, openai, or elevenlabs (default: system)',
      },
    },
    required: ['text'],
  },
};

// ── Agent Management Tools ───────────────────────────────────────────────

export const AGENTS_LIST_TOOL: ToolDefinition = {
  name: 'agents_list',
  description: 'List all available agent personas and their capabilities.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const AGENTS_SWITCH_TOOL: ToolDefinition = {
  name: 'agents_switch',
  description: 'Switch the active agent persona. Changes system prompt and model routing.',
  input_schema: {
    type: 'object',
    properties: {
      personaId: { type: 'string', description: 'ID of the persona to activate' },
    },
    required: ['personaId'],
  },
};

export const AGENTS_CONFIGURE_TOOL: ToolDefinition = {
  name: 'agents_configure',
  description:
    "Configure an agent persona's properties like name, model, system prompt, or temperature.",
  input_schema: {
    type: 'object',
    properties: {
      personaId: { type: 'string', description: 'ID of the persona to configure' },
      name: { type: 'string', description: 'New display name (optional)' },
      description: { type: 'string', description: 'New description (optional)' },
      model: { type: 'string', description: 'Model override (optional)' },
      providerId: { type: 'string', description: 'Provider override (optional)' },
      systemPrompt: { type: 'string', description: 'Custom system prompt (optional)' },
      temperature: { type: 'number', description: 'Temperature 0-2 (optional)' },
      thinkingLevel: {
        type: 'string',
        description: 'Thinking level override: off, low, medium, or high (optional)',
      },
    },
    required: ['personaId'],
  },
};

export const AGENTS_TOOL: ToolDefinition = {
  name: 'agents',
  description:
    'Manage agent personas. ' +
    'Use action=list to enumerate available personas, action=switch to activate a persona by id, ' +
    'or action=configure to update name/model/systemPrompt/temperature/thinkingLevel.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'switch', 'configure'],
        description: 'Operation to perform.',
      },
      personaId: {
        type: 'string',
        description: 'Persona id. Required for action=switch and action=configure.',
      },
      name: { type: 'string', description: 'New display name (action=configure).' },
      description: { type: 'string', description: 'New description (action=configure).' },
      model: { type: 'string', description: 'Model override (action=configure).' },
      providerId: { type: 'string', description: 'Provider override (action=configure).' },
      systemPrompt: { type: 'string', description: 'Custom system prompt (action=configure).' },
      temperature: { type: 'number', description: 'Temperature 0-2 (action=configure).' },
      thinkingLevel: {
        type: 'string',
        description: 'Thinking level override: off, low, medium, or high (action=configure).',
      },
    },
    required: ['action'],
  },
};

// ── All parity tools ─────────────────────────────────────────────────────

export const ALL_PARITY_TOOL_DEFINITIONS: ToolDefinition[] = [
  CANVAS_LIST_TOOL,
  CANVAS_READ_TOOL,
  CANVAS_CREATE_TOOL,
  CANVAS_UPDATE_TOOL,
  CANVAS_DELETE_TOOL,
  CANVAS_NAVIGATE_TOOL,
  CANVAS_EVAL_TOOL,
  CANVAS_SNAPSHOT_TOOL,
  SESSION_SPAWN_TOOL,
  SESSION_LIST_TOOL,
  SESSION_SEND_TOOL,
  SESSION_HISTORY_TOOL,
  SESSION_OUTPUT_TOOL,
  SESSION_SURFACE_OUTPUT_TOOL,
  SESSION_STATUS_TOOL,
  SESSION_WAIT_TOOL,
  SESSION_CANCEL_TOOL,
  SESSION_YIELD_TOOL,
  WAIT_TOOL,
  PDF_READ_TOOL,
  CAMERA_SNAP_TOOL,
  AUDIO_TRANSCRIBE_TOOL,
  MEMORY_SEARCH_TOOL,
  MEMORY_RECALL_TOOL,
  MEMORY_REMEMBER_TOOL,
  MEMORY_MANAGE_TOOL,
  MEMORY_BLOCK_TOOL,
  SSH_EXEC_TOOL,
  SSH_BACKGROUND_JOB_STATUS_TOOL,
  SSH_BACKGROUND_JOB_WAIT_TOOL,
  SSH_FS_TOOL,
  EXPO_EAS_CREATE_PROJECT_TOOL,
  EXPO_EAS_LIST_PROJECTS_TOOL,
  EXPO_EAS_STATUS_TOOL,
  EXPO_EAS_PROBE_TOOL,
  EXPO_EAS_BUILD_TOOL,
  EXPO_EAS_UPDATE_TOOL,
  EXPO_EAS_SUBMIT_TOOL,
  EXPO_EAS_DEPLOY_WEB_TOOL,
  EXPO_EAS_WORKFLOW_RUNS_TOOL,
  EXPO_EAS_WORKFLOW_STATUS_TOOL,
  EXPO_EAS_WORKFLOW_WAIT_TOOL,
  EXPO_EAS_GRAPHQL_TOOL,
  TOOL_CATALOG_TOOL,
  POLL_CREATE_TOOL,
  SPEAK_TOOL,
  AGENTS_TOOL,
];
