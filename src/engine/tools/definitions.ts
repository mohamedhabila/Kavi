// ---------------------------------------------------------------------------
// Kavi — Tool Definitions
// ---------------------------------------------------------------------------
// Central registry that merges built-in, extended, web, native, MCP and skill tools.

import { ToolDefinition } from '../../types';
import { WEB_SEARCH_TOOL } from './web-search';
import { WEB_FETCH_TOOL } from './web-fetch';
import {
  FILE_EDIT_TOOL,
  GLOB_SEARCH_TOOL,
  TEXT_SEARCH_TOOL,
  CRON_TOOL,
  IMAGE_GEN_TOOL,
  IMAGE_EDIT_TOOL,
} from './extended';
import {
  AGENT_RUN_EVIDENCE_KIND_VALUES,
  AGENT_RUN_EVIDENCE_RECORDER_VALUES,
  AGENT_RUN_EVIDENCE_STATUS_VALUES,
} from '../../services/agents/evidence';
import { ALL_NATIVE_TOOL_DEFINITIONS } from './native-definitions';
import { ALL_PARITY_TOOL_DEFINITIONS } from './parity-definitions';
import { ALL_BROWSER_TOOL_DEFINITIONS } from './browser-definitions';
import { ALL_WORKSPACE_FILE_TOOL_DEFINITIONS } from './workspace-definitions';
import {
  PYTHON_EXTENSION_EXAMPLES,
  PYTHON_EXTENSION_POLICY,
  PYTHON_EXTENSION_WHEN_NEEDED,
} from '../../services/python/guidance';

// ── Core workspace tools (always available) ──────────────────────────────

const CORE_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read the contents of a file from the conversation workspace. Returns the full text content. ' +
      'Do not use workspace files for session canvas creation or editing unless the user explicitly asks to persist or export files.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write content to a file in the workspace. Creates the file and any intermediate ' +
      "directories if they don't exist. Overwrites the file if it already exists. " +
      'For existing files, prefer file_edit with focused edits unless you intentionally want to replace the whole file. ' +
      'Use this only when the user explicitly wants workspace files; do not create files as an intermediate step for session canvases.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
    strict: true,
  },
  {
    name: 'list_files',
    description:
      'List files and directories in the conversation workspace. Directory names end with /. ' +
      'This is for persisted workspace files, not for session canvas discovery; use canvas_list and canvas_read for canvases.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to workspace root (default: root)',
        },
      },
      required: [],
    },
  },
  {
    name: 'record_workflow_evidence',
    description:
      'Record structured evidence on the active workflow run so the supervisor, workers, and Pilot can reuse verified facts without rereading the full transcript. ' +
      'Use this after important tool results, worker findings, design decisions, blockers, or artifact creation. ' +
      'Worker sessions automatically attach entries to their parent workflow run.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        entries: {
          type: 'array',
          description: 'One or more evidence entries to upsert into the active workflow ledger.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: {
                type: 'string',
                enum: AGENT_RUN_EVIDENCE_KIND_VALUES,
                description: 'Evidence type.',
              },
              status: {
                type: 'string',
                enum: AGENT_RUN_EVIDENCE_STATUS_VALUES,
                description:
                  'Verification state. Use verified for confirmed facts, open for unresolved questions, and resolved when a prior question or risk is closed.',
              },
              recorder: {
                type: 'string',
                enum: AGENT_RUN_EVIDENCE_RECORDER_VALUES,
                description:
                  'Optional recorder override. Defaults to supervisor for the main agent and worker for delegated sessions.',
              },
              title: {
                type: 'string',
                description: 'Short label for the evidence entry.',
              },
              content: {
                type: 'string',
                description:
                  'The substantive fact, finding, decision, blocker, or artifact note to persist.',
              },
              dedupeKey: {
                type: 'string',
                description:
                  'Stable key used to update an existing evidence entry instead of creating a duplicate.',
              },
              sourceName: {
                type: 'string',
                description:
                  'Optional human-readable source label, such as a document name, worker name, or command.',
              },
              sourceUri: {
                type: 'string',
                description: 'Optional URL or canonical source identifier.',
              },
              toolName: {
                type: 'string',
                description: 'Optional tool name that produced this evidence.',
              },
              workerSessionId: {
                type: 'string',
                description:
                  'Optional worker session id. This is filled automatically when a worker records evidence.',
              },
              artifactWorkspacePath: {
                type: 'string',
                description: 'Optional conversation-workspace-relative artifact path.',
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional tags for later filtering.',
              },
            },
            required: ['kind', 'content'],
          },
        },
      },
      required: ['entries'],
    },
    strict: true,
  },
  {
    name: 'read_workflow_evidence',
    description:
      "Read structured evidence from the active workflow run or, inside a worker session, from that worker's parent workflow run. " +
      'Use this before replanning, resuming after Pilot review, or synthesizing a final answer so you can reason from the durable evidence ledger instead of the raw transcript alone.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kinds: {
          type: 'array',
          items: {
            type: 'string',
            enum: AGENT_RUN_EVIDENCE_KIND_VALUES,
          },
          description: 'Optional evidence kinds to include.',
        },
        statuses: {
          type: 'array',
          items: {
            type: 'string',
            enum: AGENT_RUN_EVIDENCE_STATUS_VALUES,
          },
          description: 'Optional evidence statuses to include.',
        },
        recorders: {
          type: 'array',
          items: {
            type: 'string',
            enum: AGENT_RUN_EVIDENCE_RECORDER_VALUES,
          },
          description: 'Optional recorder filters.',
        },
        query: {
          type: 'string',
          description:
            'Optional text query matched against titles, content, sources, tools, workers, and tags.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of matching entries to return. Defaults to 12.',
        },
        includeContent: {
          type: 'boolean',
          description: 'Whether to include full entry content in the response. Default: true.',
        },
      },
      required: [],
    },
    strict: true,
  },
  {
    name: 'javascript',
    description:
      'Execute synchronous JavaScript inline or from a workspace entry file and return the result. ' +
      'The runtime provides standard JS built-ins, `console`, workspace-aware `fs` helpers (`readFile`, `writeFile`, `exists`, `listFiles`, `deleteFile`), `data` helpers for JSON/CSV/YAML, `env`, and `process.argv`/`process.cwd()` plus `__dirname`/`__filename` for file-based runs. ' +
      'Workspace modules can be loaded with CommonJS `require()` using relative paths or workspace-root paths, and changed workspace files are synced back automatically after successful execution. ' +
      'Provide either `code` for inline execution or `path` for a workspace entry script. ' +
      'Limitations: synchronous only, NO async/await, NO Promises, NO setTimeout, NO fetch, NO DOM APIs, NO Node built-ins or npm package resolution. Use CommonJS `require()`, not ESM `import`.',
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Inline JavaScript source code to execute. The return value of the last expression is captured. ' +
            'Example: `const result = [1,2,3].reduce((a,b)=>a+b, 0); result` returns 6. ' +
            'Inline code can call `require("./helper")` and `fs.readFile("data/input.json")` against the conversation workspace.',
        },
        path: {
          type: 'string',
          description:
            'Workspace-relative path to a JavaScript entry file to execute, for example `tools/run.js` or `skills/my-skill/main.js`. ' +
            'Use CommonJS `require()` inside workspace files for multi-file tools.',
        },
        argv: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional command-line style arguments exposed through `process.argv`, for example `["--prompt", "hello"]`.',
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Optional environment variables exposed through `env.get(...)` and `process.env`.',
        },
      },
      oneOf: [{ required: ['code'] }, { required: ['path'] }],
      required: [],
    },
    strict: true,
  },
  {
    name: 'python',
    description:
      'Execute Python code or a workspace Python script in a sandboxed Pyodide (CPython on WASM) environment and return the result. ' +
      `${PYTHON_EXTENSION_WHEN_NEEDED} ${PYTHON_EXTENSION_EXAMPLES} ${PYTHON_EXTENSION_POLICY} ` +
      'Supports most of the Python standard library, auto-loads official Pyodide packages from imports when possible, and installs additional PyPI or wheel-based packages through micropip. ' +
      'Execution runs on a dedicated worker-backed runtime inside a hidden WebView, is serialized on a shared session, and uses bounded reload-and-retry recovery instead of hanging indefinitely. ' +
      'Captures stdout, stderr, tracebacks, and the return value of the last expression for inline code. Top-level `await` is supported for inline code and script files. ' +
      'For both inline code and script files, the conversation workspace is mounted into the runtime, workspace-root imports are available on `sys.path`, and any changed output files are synced back into the conversation workspace. ' +
      'During agent workflow runs, Python code can inspect and append structured workflow evidence via the built-in `kavi.read_workflow_evidence(...)`, `kavi.record_workflow_evidence(...)`, and async native-backed HTTP helpers on the built-in `kavi.http` module or `await pyodide.http.pyfetch(...)`. ' +
      'Preferred HTTP patterns are `from kavi.http import get_json, get_text, post_json`, `data = await get_json(url, params={...}, headers={...}, timeout=30)`, or `response = await kavi.http.get(url); response.raise_for_status(); data = await response.json()`. ' +
      'Capabilities: workspace artifact generation and conversion when supported by Pyodide-compatible packages, data processing, math/science (numpy, pandas, scipy), async HTTP requests to remote hosts through `kavi.http` / `pyfetch`, ' +
      'JSON/CSV/XML parsing, regex, string manipulation, encoding/decoding. ' +
      'Limitations: packages still need Pyodide-compatible wheels or pure-Python wheels; synchronous browser-backed HTTP libraries like `requests`, `urllib.request`, and `pyodide.http.open_url` are not the supported remote-fetch path, so prefer `kavi.http` helpers for remote calls; NO subprocess/os.system, NO threading, NO raw sockets. ' +
      'Provide either `code` for inline execution or `path` for a workspace script file. ' +
      'For simple calculations prefer the javascript tool. Use python when the skill or task specifically requires Python or when a short Pyodide-compatible script can close a gap in the built-in tool surface.',
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Inline Python source code to execute. stdout/stderr are captured. ' +
            'The return value of the last expression is appended to output. ' +
            'Example: `import json; print(json.dumps({"status": "ok"}, indent=2))`',
        },
        path: {
          type: 'string',
          description:
            'Workspace-relative path to a Python script file to execute, for example `skills/my-skill/scripts/run.py` or `scripts/task.py`. ' +
            'The script runs as `__main__` with the conversation workspace as its working directory.',
        },
        argv: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional command-line arguments for a script executed via `path`, for example `["--prompt", "hello"]`.',
        },
        packages: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of package requirements or wheel URLs to install via micropip before execution. ' +
            'Example: ["requests", "beautifulsoup4"] or ["https://example.com/pkg-1.0.0-py3-none-any.whl"]',
        },
        indexUrls: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of custom HTTP(S) package indexes for micropip installs. ' +
            'Use this when a required package is not available from the default index but a Pyodide-compatible wheel exists on another index.',
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Optional environment variables exposed through `os.environ`, for example `{ "GEMINI_API_KEY": "..." }`.',
        },
        timeoutMs: {
          type: 'number',
          description:
            'Optional maximum execution time in milliseconds after the Pyodide runtime is ready. Default: 300000. Increase this for heavy workloads or package installs.',
        },
      },
      oneOf: [{ required: ['code'] }, { required: ['path'] }],
    },
    strict: false,
  },
];

// ── Extended tools (always available) ────────────────────────────────────

const EXTENDED_TOOLS: ToolDefinition[] = [
  FILE_EDIT_TOOL,
  GLOB_SEARCH_TOOL,
  TEXT_SEARCH_TOOL,
  CRON_TOOL,
  IMAGE_GEN_TOOL,
  IMAGE_EDIT_TOOL,
];

// ── Web tools (always available) ─────────────────────────────────────────

const WEB_TOOLS: ToolDefinition[] = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL];

// ── Native device tools (mobile-specific) ────────────────────────────────

const NATIVE_TOOLS: ToolDefinition[] = ALL_NATIVE_TOOL_DEFINITIONS;

// ── Parity tools ──────────────────────────

const PARITY_TOOLS: ToolDefinition[] = ALL_PARITY_TOOL_DEFINITIONS;

// ── Browser automation tools ─────────────────────────────────────────────

const BROWSER_TOOLS: ToolDefinition[] = ALL_BROWSER_TOOL_DEFINITIONS;

// ── Workspace file operation tools ───────────────────────────────────────

const WORKSPACE_FILE_TOOLS: ToolDefinition[] = ALL_WORKSPACE_FILE_TOOL_DEFINITIONS;

// ── Full static tool set ─────────────────────────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  ...CORE_TOOLS,
  ...EXTENDED_TOOLS,
  ...WEB_TOOLS,
  ...NATIVE_TOOLS,
  ...PARITY_TOOLS,
  ...BROWSER_TOOLS,
  ...WORKSPACE_FILE_TOOLS,
];

/**
 * Build the complete tool set including dynamic tools (MCP + Skills).
 * Called by the orchestrator before each LLM call.
 */
export function buildToolDefinitions(
  mcpTools: ToolDefinition[] = [],
  skillTools: ToolDefinition[] = [],
  allowedTools?: Set<string>,
): ToolDefinition[] {
  let all = [...TOOL_DEFINITIONS, ...mcpTools, ...skillTools];

  if (allowedTools) {
    all = all.filter((t) => allowedTools.has(t.name));
  }

  // De-duplicate by name (MCP/Skill overrides win)
  const seen = new Map<string, ToolDefinition>();
  for (const tool of all) {
    seen.set(tool.name, tool);
  }

  return Array.from(seen.values());
}
