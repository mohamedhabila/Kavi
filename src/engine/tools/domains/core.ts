// ---------------------------------------------------------------------------
// Kavi — Core Tool Definitions
// ---------------------------------------------------------------------------
// Workspace file I/O, code execution, session spawn, and goal updates.

import { ToolDefinition } from '../../../types/tool';
import { SESSION_SPAWN_TOOL } from '../builtin-definitions-sessions';
import { UPDATE_GOALS_TOOL } from '../goal-definitions';
import {
  PYTHON_EXTENSION_EXAMPLES,
  PYTHON_EXTENSION_POLICY,
  PYTHON_EXTENSION_WHEN_NEEDED,
} from '../../../services/python/guidance';

export const CORE_DOMAIN_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read the contents of a file from the current workspace. Returns the full text content. ' +
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
    contract: {
      category: 'workspace_files',
      capabilities: ['read', 'verify'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['none'],
      riskHints: ['read_only', 'idempotent'],
      providesEvidence: ['verification'],
      workflowStages: ['inspect_resource', 'verify_evidence'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write content to a file in the current workspace. Creates the file and any intermediate ' +
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
    contract: {
      category: 'workspace_files',
      capabilities: ['write', 'verify'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['local_artifact'],
      riskHints: ['idempotent'],
      providesEvidence: ['local_artifact', 'verification'],
      workflowStages: ['persist_artifact', 'verify_evidence'],
    },
    strict: true,
  },
  SESSION_SPAWN_TOOL,
  {
    name: 'list_files',
    description:
      'List files and directories in the current workspace. Directory names end with /. ' +
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
    contract: {
      category: 'workspace_files',
      capabilities: ['discover', 'read'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['none'],
      riskHints: ['read_only', 'idempotent'],
      providesEvidence: ['verification'],
      workflowStages: ['discover_resource', 'inspect_resource'],
    },
  },
  {
    name: 'javascript',
    description:
      'Execute synchronous JavaScript inline or from a workspace entry file and return the result. ' +
      'The runtime provides standard JS built-ins, `console`, a workspace-aware `fs` bridge both as the global `fs` object and `require("fs")` / `require("node:fs")` (including `readFile`, `readFileSync`, `writeFile`, `writeFileSync`, `exists`, `existsSync`, `listFiles`, and `deleteFile` / `unlinkSync`), `data` helpers for JSON/CSV/YAML, `env`, and `process.argv`/`process.cwd()` plus `__dirname`/`__filename` for file-based runs. ' +
      'Workspace modules can be loaded with CommonJS `require()` using relative paths or workspace-root paths, and changed workspace files are synced back automatically after successful execution. ' +
      'Provide either `code` for inline execution or `path` for a workspace entry script. ' +
      'Limitations: synchronous only, NO async/await, NO Promises, NO setTimeout, NO fetch, NO DOM APIs, and NO real Node built-ins or npm package resolution beyond the workspace bridge helpers. Use CommonJS `require()`, not ESM `import`.',
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'Inline JavaScript source code to execute. The return value of the last expression is captured. ' +
            'Example: `const result = [1,2,3].reduce((a,b)=>a+b, 0); result` returns 6. ' +
            'Inline code can call `require("./helper")`, `fs.readFile("data/input.json")`, or `require("fs").readFileSync("data/input.json", "utf8")` against the conversation workspace.',
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
    contract: {
      category: 'code',
      capabilities: ['compute'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['none'],
      riskHints: ['idempotent'],
      providesEvidence: ['verification'],
      workflowStages: ['verify_evidence'],
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
      'During agent workflow runs, Python code can use async native-backed HTTP helpers on the built-in `kavi.http` module or `await pyodide.http.pyfetch(...)`. ' +
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
    contract: {
      category: 'code',
      capabilities: ['compute'],
      resourceKinds: ['conversation_workspace'],
      sideEffects: ['none'],
      riskHints: ['idempotent'],
      providesEvidence: ['verification'],
      workflowStages: ['verify_evidence'],
    },
    strict: false,
  },
  UPDATE_GOALS_TOOL,
];
