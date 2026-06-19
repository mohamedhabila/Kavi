import { GITHUB_COMMIT_MODES } from './constants';

export function normalizeGitHubInput(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function normalizeGitHubRepo(repo: unknown): string {
  let normalized = normalizeGitHubInput(repo);
  if (!normalized) {
    throw new Error('GitHub repo must be in the form owner/repo');
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      if (/^(www\.)?github\.com$/i.test(url.hostname)) {
        normalized = url.pathname;
      }
    } catch {
      // Fall through to string normalization.
    }
  }

  normalized = normalized
    .replace(/^ssh:\/\/git@github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '');

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2) {
    normalized = `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`;
  }

  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
    throw new Error('GitHub repo must be in the form owner/repo');
  }
  return normalized;
}

export function normalizeGitHubPath(path: unknown): string {
  let normalized = normalizeGitHubInput(path);
  if (!normalized) {
    return '';
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      if (/^(www\.)?github\.com$/i.test(url.hostname)) {
        const parts = url.pathname
          .replace(/^\/+|\/+$/g, '')
          .split('/')
          .filter(Boolean);
        if (parts.length >= 5 && (parts[2] === 'blob' || parts[2] === 'tree')) {
          normalized = parts.slice(4).join('/');
        } else if (parts.length >= 3) {
          normalized = parts.slice(2).join('/');
        } else {
          normalized = '';
        }
      }
    } catch {
      // Fall through to string normalization.
    }
  }

  normalized = normalized
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }

  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error('GitHub path cannot include ".." segments');
  }

  return normalized;
}

export function normalizeGitHubBranch(branch: unknown, fieldName = 'branch'): string {
  const normalized = normalizeGitHubInput(branch)
    .split(/[?#]/, 1)[0]
    .replace(/^refs\/heads\//i, '')
    .replace(/^heads\//i, '')
    .replace(/^origin\//i, '');

  if (!normalized) {
    throw new Error(`GitHub ${fieldName} is required`);
  }

  if (/^refs\/tags\//i.test(normalized)) {
    throw new Error(`GitHub ${fieldName} must be a branch name, not a tag ref`);
  }

  if (/\s/.test(normalized)) {
    throw new Error(`GitHub ${fieldName} must not contain whitespace`);
  }

  return normalized;
}

export function normalizeGitHubRef(ref: unknown, fieldName = 'ref'): string {
  const normalized = normalizeGitHubInput(ref)
    .split(/[?#]/, 1)[0]
    .replace(/^refs\/heads\//i, '')
    .replace(/^heads\//i, '')
    .replace(/^refs\/tags\//i, '')
    .replace(/^tags\//i, '');

  if (!normalized) {
    throw new Error(`GitHub ${fieldName} is required`);
  }

  return normalized;
}

export function buildGitHubPath(path: string): string {
  if (!path) {
    return '';
  }
  return `/${path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

export function buildGitHubRefPath(ref: string): string {
  return ref
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export function readGitHubStringArg(
  args: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (value == null) {
      continue;
    }
    const normalized = String(value).trim();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export function readGitHubNumberArg(
  args: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = args[key];
    if (value == null || value === '') {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

export function readGitHubLimitArg(
  args: Record<string, unknown>,
  keys: string[],
  defaultValue: number,
  maxValue: number,
): number {
  const parsed = readGitHubNumberArg(args, keys);
  if (!parsed) {
    return defaultValue;
  }
  return Math.max(1, Math.min(parsed, maxValue));
}

export function normalizeGitHubCommitMode(mode: unknown): string {
  const normalized = String(mode || '100644').trim();
  if (!GITHUB_COMMIT_MODES.has(normalized)) {
    throw new Error('GitHub commit mode must be one of 100644, 100755, 120000');
  }
  return normalized;
}
