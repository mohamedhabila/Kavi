// ---------------------------------------------------------------------------
// Kavi — Markdown Frontmatter
// ---------------------------------------------------------------------------

import YAML from 'yaml';

export interface FrontmatterResult {
  metadata: Record<string, unknown>;
  content: string;
  raw: string;
}

const FRONTMATTER_OPEN = /^---\s*$/m;
const FRONTMATTER_CLOSE = /^---\s*$/m;

export function parseFrontmatterBlock(text: string): FrontmatterResult {
  const lines = text.split('\n');
  let state: 'before' | 'in-frontmatter' | 'after' = 'before';
  const fmLines: string[] = [];
  const contentLines: string[] = [];
  let fmStart = -1;
  let fmEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (state === 'before') {
      if (FRONTMATTER_OPEN.test(line) && i === 0) {
        state = 'in-frontmatter';
        fmStart = i;
        continue;
      }
      // No frontmatter
      return { metadata: {}, content: text, raw: '' };
    }

    if (state === 'in-frontmatter') {
      if (FRONTMATTER_CLOSE.test(line) && i > fmStart) {
        fmEnd = i;
        state = 'after';
        continue;
      }
      fmLines.push(line);
      continue;
    }

    // state === 'after'
    contentLines.push(line);
  }

  if (fmEnd === -1) {
    // Unclosed frontmatter
    return { metadata: {}, content: text, raw: '' };
  }

  const rawYaml = fmLines.join('\n');
  let metadata: Record<string, unknown> = {};

  try {
    const parsed = YAML.parse(rawYaml);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed;
    }
  } catch {
    // Invalid YAML — return empty metadata
  }

  const content = contentLines.join('\n').replace(/^\n+/, '');
  return { metadata, content, raw: rawYaml };
}

// ── Frontmatter helpers ──────────────────────────────────────────────────

export function getFrontmatterString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  if (typeof value === 'string') return value.trim() || undefined;
  return undefined;
}

export function normalizeStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((s) => s.trim());
  }
  return [];
}
