// ---------------------------------------------------------------------------
// Kavi — Mobile Skill Translator
// ---------------------------------------------------------------------------
// Pattern-based translation of desktop CLI skill instructions to mobile tool
// equivalents. Generates concrete "Mobile Execution Guide" sections that help
// the LLM map shell commands to available mobile tools.

import type { BundledPythonSkillMetadata } from './types';
import { extractPep723Dependencies } from '../python/scriptMetadata';

// ── Pattern detection ────────────────────────────────────────────────────

/** Detects Python code that only makes HTTP requests via urllib/requests. */
const PYTHON_HTTP_ONLY_PATTERN = /python\s*(?:<<'?EOF'?|<<"|<< ?\w|(?:-c\s+['"]))/i;

const PYTHON_HTTP_LIBS =
  /\b(?:urllib\.request|requests\.(?:get|post|put|patch|delete|head|options)|http\.client|httpx)\b/i;
const PYODIDE_ASYNC_HTTP_PATTERN =
  /\b(?:kavi\.http\.(?:fetch|request|get|post|put|patch|delete|head|options|get_text|get_json|post_text|post_json|request_text|request_json)|pyfetch\s*\(|from\s+kavi(?:\.http)?\s+import\s+|import\s+kavi\.http\b)\b/i;
const PYODIDE_UNSUPPORTED_HTTP_PATTERN =
  /\b(?:urllib\.request|requests(?:\.(?:get|post|put|patch|delete|head|options|request|Session)|\b)|http\.client|httpx(?:\.(?:get|post|put|patch|delete|head|options|request|Client|AsyncClient)|\b)|pyodide\.http\.(?:open_url|pyxhr)|open_url\s*\()\b/i;

const PYTHON_NON_HTTP_MARKERS =
  /\b(?:subprocess|os\.system|sys\.exit|multiprocessing|threading|socket\.|open\s*\(|pathlib\.|shutil\b|tempfile\b|sqlite3\b|os\.path)/i;

/** Detects curl commands. */
const CURL_PATTERN = /\bcurl\s+(?:-[sSkLfogONwXHdAe]|\s|"|'|`|http)/i;

/** Detects jq piped after curl or standalone. */
const JQ_PIPE_PATTERN = /\|\s*jq\s+['".]/i;

/** Detects environment variable usage. */
const ENV_VAR_PATTERN = /\$\{?([A-Z][A-Z0-9_]+)\}?/g;

/** Detects `uv run` or `uv tool` invocations for Python scripts. */
const UV_RUN_PATTERN = /\buv\s+(?:run|tool\s+(?:run|install))\b/i;

/** Detects generic shell pipe constructs. */
const SHELL_PIPE_PATTERN = /\|\s*(?:grep|awk|sed|sort|uniq|head|tail|wc|cut|tr)\b/;

/** Detects Python code blocks. */
const PYTHON_BLOCK_PATTERN = /```(?:python|py)\b/i;

/** Detects raw Python source from sidecar .py files. */
const RAW_PYTHON_SOURCE_PATTERN =
  /^\s*(?:from\s+[A-Za-z0-9_.]+\s+import\s+|import\s+[A-Za-z0-9_.]+|def\s+[A-Za-z0-9_]+\(|class\s+[A-Za-z0-9_]+(?:\(|:)|if\s+__name__\s*==\s*['"]__main__['"])/m;

/** Detects .py paths mentioned in shell snippets or prose. */
const PYTHON_SCRIPT_PATH_PATTERN = /([~./A-Za-z0-9_-]+\.py)\b/g;

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.filter((value) => Boolean(value && value.trim())).map((value) => value.trim())),
  ).sort();
}

function normalizeBundledPythonPath(value: string): string | null {
  let normalized = (value || '')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/[),:;]+$/g, '')
    .replace(/\\/g, '/');

  const skillScopedMatch = normalized.match(/(?:^|\/)skills\/[^/]+\/(.+\.py)$/i);
  if (skillScopedMatch?.[1]) {
    normalized = skillScopedMatch[1];
  }

  normalized = normalized.replace(/^\.\//, '').replace(/^\/+/, '');

  if (!normalized || normalized.includes('..')) {
    return null;
  }

  return normalized;
}

function extractReferencedBundledPythonPaths(body: string): string[] {
  if (!body) {
    return [];
  }

  const matches = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(PYTHON_SCRIPT_PATH_PATTERN.source, 'g');

  while ((match = pattern.exec(body)) !== null) {
    const normalized = normalizeBundledPythonPath(match[1]);
    if (normalized) {
      matches.add(normalized);
    }
  }

  return Array.from(matches).sort();
}

function resolveReferencedBundledPythonPaths(
  body: string,
  files: Record<string, string>,
): string[] {
  const pythonFiles = Object.keys(files)
    .filter((path) => /\.py$/i.test(path))
    .sort();

  if (pythonFiles.length === 0) {
    return [];
  }

  const references = extractReferencedBundledPythonPaths(body);
  if (references.length === 0) {
    return pythonFiles;
  }

  const matched = new Set<string>();

  for (const reference of references) {
    const exact = pythonFiles.find((path) => path.toLowerCase() === reference.toLowerCase());
    if (exact) {
      matched.add(exact);
      continue;
    }

    const suffix = `/${reference.toLowerCase()}`;
    const suffixMatch = pythonFiles.find(
      (path) =>
        path.toLowerCase().endsWith(suffix) ||
        reference.toLowerCase().endsWith(`/${path.toLowerCase()}`),
    );
    if (suffixMatch) {
      matched.add(suffixMatch);
    }
  }

  return matched.size > 0 ? Array.from(matched).sort() : pythonFiles;
}

export function analyzeBundledPythonSkill(
  body: string,
  files: Record<string, string>,
): BundledPythonSkillMetadata | undefined {
  const scriptPaths = resolveReferencedBundledPythonPaths(body, files);
  if (scriptPaths.length === 0) {
    return undefined;
  }

  const dependencies = uniqueStrings(
    scriptPaths.flatMap((path) => extractPep723Dependencies(files[path] || '')),
  );
  const combinedSource = [body, ...scriptPaths.map((path) => files[path] || '')].join('\n\n');

  return {
    scriptPaths,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
    pyodideCompatible: isPyodideCompatibleSkill(combinedSource),
  };
}

// ── Categorization ───────────────────────────────────────────────────────

export type SkillPattern =
  | 'python-http'
  | 'curl-api'
  | 'curl-jq'
  | 'python-script'
  | 'shell-pipe'
  | 'generic-shell';

export interface SkillPatternMatch {
  pattern: SkillPattern;
  /** Short description of what was detected. */
  label: string;
}

/**
 * Detect which CLI patterns a skill body uses.
 * Returns all detected patterns (a skill may use multiple).
 */
export function detectSkillPatterns(body: string): SkillPatternMatch[] {
  if (!body) return [];

  const matches: SkillPatternMatch[] = [];

  // Python HTTP-only (urllib.request / requests library)
  if (
    (PYTHON_HTTP_ONLY_PATTERN.test(body) || PYTHON_BLOCK_PATTERN.test(body)) &&
    PYTHON_HTTP_LIBS.test(body) &&
    !PYTHON_NON_HTTP_MARKERS.test(body)
  ) {
    matches.push({ pattern: 'python-http', label: 'Python HTTP calls (urllib/requests)' });
  }

  // Python script via uv run
  if (UV_RUN_PATTERN.test(body)) {
    matches.push({ pattern: 'python-script', label: 'Python script (uv run)' });
  }

  // curl + jq
  if (CURL_PATTERN.test(body) && JQ_PIPE_PATTERN.test(body)) {
    matches.push({ pattern: 'curl-jq', label: 'curl piped to jq' });
  } else if (CURL_PATTERN.test(body)) {
    matches.push({ pattern: 'curl-api', label: 'curl HTTP calls' });
  }

  // Shell pipe constructs
  if (SHELL_PIPE_PATTERN.test(body)) {
    matches.push({ pattern: 'shell-pipe', label: 'Shell pipe chains' });
  }

  // Generic shell (bash/sh blocks without more specific matches)
  if (matches.length === 0 && /```(?:bash|sh|shell)\b/i.test(body)) {
    matches.push({ pattern: 'generic-shell', label: 'Shell commands' });
  }

  return matches;
}

// ── Translation guide generation ─────────────────────────────────────────

const TRANSLATION_GUIDES: Record<SkillPattern, string> = {
  'python-http': [
    '## Mobile Execution Guide — Python HTTP → web_fetch',
    '',
    'This skill uses Python `urllib.request` / `requests` for HTTP calls.',
    'On mobile, use the `web_fetch` tool instead:',
    '',
    '**Pattern**: `urllib.request.Request(url, data, method)` with headers',
    '→ `web_fetch` with `{ url, method, headers: { "Authorization": "Bearer $KEY", "Content-Type": "application/json" }, body: JSON.stringify(payload) }`',
    '',
    '**Environment variables**: Read API keys from memory or stored secrets.',
    'For `os.environ["KEY"]` → the key is pre-injected into the tool context.',
    '',
    '**JSON processing**: Use the `javascript` tool for any JSON parsing/filtering:',
    '`javascript({ code: "JSON.parse(input).results.map(r => r.name)" })`',
  ].join('\n'),

  'curl-api': [
    '## Mobile Execution Guide — curl → web_fetch',
    '',
    'This skill uses `curl` for HTTP API calls. On mobile, use `web_fetch`:',
    '',
    '| curl flag | web_fetch equivalent |',
    '|-----------|---------------------|',
    '| `-X POST` | `method: "POST"` |',
    '| `-H "Key: Value"` | `headers: { "Key": "Value" }` |',
    '| `-d \'{"json":true}\'` | `body: \'{"json":true}\'` |',
    '| `-s` (silent) | (default behavior) |',
    '| URL argument | `url: "https://..."` |',
    '',
    '**Example**: `curl -s -H "Authorization: Bearer $TOKEN" https://api.example.com/data`',
    '→ `web_fetch({ url: "https://api.example.com/data", headers: { "Authorization": "Bearer <token>" } })`',
  ].join('\n'),

  'curl-jq': [
    '## Mobile Execution Guide — curl + jq → web_fetch + javascript',
    '',
    'This skill pipes `curl` output through `jq` for JSON filtering.',
    'On mobile, use `web_fetch` for the request, then `javascript` for filtering:',
    '',
    '**Step 1**: `web_fetch({ url: "...", headers: {...} })` — get the JSON response',
    '**Step 2**: `javascript({ code: "const data = JSON.parse(input); data.items.filter(i => i.active)" })` — filter/transform',
    '',
    '**Common jq → JavaScript mappings**:',
    '| jq expression | JavaScript equivalent |',
    '|--------------|----------------------|',
    '| `.field` | `data.field` |',
    '| `.[] \\| .name` | `data.map(d => d.name)` |',
    '| `select(.active)` | `data.filter(d => d.active)` |',
    '| `length` | `data.length` |',
    '| `keys` | `Object.keys(data)` |',
  ].join('\n'),

  'python-script': [
    '## Mobile Execution Guide — Python Script (uv run)',
    '',
    'This skill runs Python scripts via `uv run`. On mobile, these scripts',
    'can execute in the embedded Python sandbox (Pyodide/WebAssembly) if they',
    'use only standard library + supported packages.',
    '',
    'Use the `python` tool to run the installed script file directly:',
    '`python({ path: "skills/<skill-dir>/scripts/tool.py", argv: ["--flag", "value"] })`',
    '',
    'If you only have inline source, prefer the built-in helpers: `python({ code: "from kavi.http import get_json\ndata = await get_json(\"https://api.example.com\", params={\"q\": \"cats\"}, timeout=30)\nprint(data)" })`.',
    'Use `env` for secrets the script expects from environment variables.',
    '',
    'If the script only makes HTTP calls, you can also translate to `web_fetch`.',
    'If the script requires native binaries or unsupported packages, it must',
    'run on an SSH target or workspace.',
  ].join('\n'),

  'shell-pipe': [
    '## Mobile Execution Guide — Shell Pipes',
    '',
    'This skill uses shell pipe constructs (grep, awk, sed, etc.).',
    'On mobile, use the `javascript` tool for equivalent text processing:',
    '',
    '| Shell | JavaScript equivalent |',
    '|-------|----------------------|',
    '| `grep "pattern"` | `lines.filter(l => /pattern/.test(l))` |',
    "| `awk '{print $1}'` | `lines.map(l => l.split(/\\s+/)[0])` |",
    '| `sort` | `lines.sort()` |',
    '| `uniq` | `[...new Set(lines)]` |',
    '| `head -n 10` | `lines.slice(0, 10)` |',
    '| `wc -l` | `lines.length` |',
    '| `cut -d, -f1` | `lines.map(l => l.split(",")[0])` |',
  ].join('\n'),

  'generic-shell': [
    '## Mobile Execution Guide — Shell Commands',
    '',
    'This skill uses shell commands that may not be available on mobile.',
    'On mobile, translate commands to equivalent tools:',
    '',
    '| Desktop command | Mobile tool |',
    '|----------------|-------------|',
    '| `curl URL` | `web_fetch({ url: "..." })` |',
    '| `cat file` | `read_file({ path: "..." })` |',
    '| `echo "text" > file` | `write_file({ path: "...", content: "..." })` |',
    '| `ls dir` | `list_files({ path: "..." })` |',
    '| `python -c "..."` | `javascript({ code: "..." })` or `python({ code: "..." })` |',
    '| `jq .field` | `javascript({ code: "JSON.parse(input).field" })` |',
  ].join('\n'),
};

/**
 * Build a mobile execution guide for a skill body based on detected patterns.
 * Returns the guide text, or empty string if no patterns detected.
 */
export function buildMobileExecutionGuide(body: string): string {
  const patterns = detectSkillPatterns(body);
  if (patterns.length === 0) return '';

  const guides = patterns.map((match) => TRANSLATION_GUIDES[match.pattern]);
  return '\n\n---\n\n' + guides.join('\n\n---\n\n') + '\n';
}

/**
 * Extract referenced environment variable names from a skill body.
 */
export function extractReferencedEnvVars(body: string): string[] {
  if (!body) return [];
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  const pattern = new RegExp(ENV_VAR_PATTERN.source, 'g');
  while ((match = pattern.exec(body)) !== null) {
    vars.add(match[1]);
  }
  return Array.from(vars).sort();
}

/**
 * Check if a skill body uses only HTTP-based Python (no subprocess, no
 * system calls, no threading). These skills can be fully served by
 * web_fetch on mobile without needing Python execution.
 */
export function isHttpOnlyPythonSkill(body: string): boolean {
  if (!body) return false;

  const hasPython =
    PYTHON_HTTP_ONLY_PATTERN.test(body) ||
    PYTHON_BLOCK_PATTERN.test(body) ||
    RAW_PYTHON_SOURCE_PATTERN.test(body);
  if (!hasPython) return false;

  const hasHttpLib = PYTHON_HTTP_LIBS.test(body) || PYODIDE_ASYNC_HTTP_PATTERN.test(body);
  const hasNonHttp = PYTHON_NON_HTTP_MARKERS.test(body);
  const hasUvRun = UV_RUN_PATTERN.test(body);

  return hasHttpLib && !hasNonHttp && !hasUvRun;
}

/**
 * Check if a skill body uses Python scripts that COULD run in Pyodide
 * (i.e., they don't require native binaries beyond Python itself).
 */
export function isPyodideCompatibleSkill(body: string): boolean {
  if (!body) return false;

  const hasPython =
    PYTHON_HTTP_ONLY_PATTERN.test(body) ||
    PYTHON_BLOCK_PATTERN.test(body) ||
    UV_RUN_PATTERN.test(body) ||
    RAW_PYTHON_SOURCE_PATTERN.test(body);
  if (!hasPython) return false;

  // Check for markers that would prevent Pyodide execution
  const nonPyodideMarkers =
    /\b(?:subprocess|os\.system|multiprocessing|threading\.Thread|socket\.(?:socket|create_connection)|ctypes|cffi|tkinter|curses)\b/i;
  if (nonPyodideMarkers.test(body)) {
    return false;
  }

  if (PYODIDE_UNSUPPORTED_HTTP_PATTERN.test(body)) {
    return PYODIDE_ASYNC_HTTP_PATTERN.test(body);
  }

  return true;
}
