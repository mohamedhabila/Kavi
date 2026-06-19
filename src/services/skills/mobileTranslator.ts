// ---------------------------------------------------------------------------
// Kavi — Bundled Python Skill Analysis
// ---------------------------------------------------------------------------
// Analyze packaged Python sidecars so skill metadata can carry explicit
// execution facts instead of inferring runtime behavior from free-form prose.

import type { BundledPythonSkillMetadata } from './types';
import { extractPep723Dependencies, stripPep723MetadataBlock } from '../python/scriptMetadata';

// ── Pattern detection ────────────────────────────────────────────────────

/** Detects Python code that only makes HTTP requests via urllib/requests. */
const PYTHON_HTTP_ONLY_PATTERN = /python\s*(?:<<'?EOF'?|<<"|<< ?\w|(?:-c\s+['"]))/i;

const PYODIDE_ASYNC_HTTP_PATTERN =
  /\b(?:kavi\.http\.(?:fetch|request|get|post|put|patch|delete|head|options|get_text|get_json|post_text|post_json|request_text|request_json)|pyfetch\s*\(|from\s+kavi(?:\.http)?\s+import\s+|import\s+kavi\.http\b)\b/i;
const PYODIDE_UNSUPPORTED_HTTP_PATTERN =
  /\b(?:urllib\.request|requests(?:\.(?:get|post|put|patch|delete|head|options|request|Session)|\b)|http\.client|httpx(?:\.(?:get|post|put|patch|delete|head|options|request|Client|AsyncClient)|\b)|pyodide\.http\.(?:open_url|pyxhr)|open_url\s*\()\b/i;

/** Detects `uv run` or `uv tool` invocations for Python scripts. */
const UV_RUN_PATTERN = /\buv\s+(?:run|tool\s+(?:run|install))\b/i;

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
  const combinedSource = [
    body,
    ...scriptPaths.map((path) => stripPep723MetadataBlock(files[path] || '')),
  ].join('\n\n');

  return {
    scriptPaths,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
    pyodideCompatible: isPyodideCompatibleSkill(combinedSource),
  };
}

/**
 * Check if a skill body uses Python scripts that COULD run in Pyodide
 * (i.e., they don't require native binaries beyond Python itself).
 */
function isPyodideCompatibleSkill(body: string): boolean {
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
