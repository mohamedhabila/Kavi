import { normalizeSearchText, normalizeSearchUrlPathCandidate } from './resultText';

const MACHINE_READABLE_PATH_EXTENSIONS = new Set([
  'atom',
  'csv',
  'json',
  'rss',
  'tsv',
  'xml',
  'yaml',
  'yml',
]);
const TEMPLATE_URL_TOKEN_PATTERN =
  /(?:%7b[a-z0-9_.-]+(?:%7d)?|\{[a-z0-9_.-]+(?:\})?|your_[a-z0-9_]+)/i;
const VERSIONED_API_PATH_SEGMENT_PATTERN = /^v\d[\w.-]*$/i;

export function looksLikeMachineReadableApiPath(path: string | undefined): boolean {
  const normalizedPath = normalizeSearchUrlPathCandidate(path);
  if (!normalizedPath) {
    return false;
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  const firstSegment = segments[0];
  if (!firstSegment || !VERSIONED_API_PATH_SEGMENT_PATTERN.test(firstSegment)) {
    return false;
  }

  return true;
}

export function hasMachineReadablePathExtension(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.search) {
      return true;
    }

    if (parsed.pathname.includes('$')) {
      return true;
    }

    const segments = parsed.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    const lastSegment = segments.at(-1);
    if (!lastSegment) {
      return false;
    }

    const extensionMatch = lastSegment.match(/\.([a-z0-9]+)$/i);
    if (!extensionMatch) {
      return false;
    }

    return MACHINE_READABLE_PATH_EXTENSIONS.has(extensionMatch[1].toLowerCase());
  } catch {
    return false;
  }
}

export function looksLikeMachineReadableApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const hasApiHost =
      hostname.startsWith('api.') ||
      hostname === 'googleapis.com' ||
      hostname.endsWith('.googleapis.com');
    if (!hasApiHost) {
      return false;
    }

    const pathname = parsed.pathname || '/';
    if (looksLikeMachineReadableApiPath(pathname)) {
      return true;
    }

    return pathname.includes(':');
  } catch {
    return false;
  }
}

export function looksLikeTemplateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const decodedUrl = decodeURIComponent(parsed.toString());
    return TEMPLATE_URL_TOKEN_PATTERN.test(decodedUrl);
  } catch {
    return TEMPLATE_URL_TOKEN_PATTERN.test(url);
  }
}

export function isTopLevelDocumentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/' || parsed.pathname === '';
  } catch {
    return false;
  }
}

export function getUrlPathSpecificity(url: string): number {
  try {
    const parsed = new URL(url);
    return parsed.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean).length;
  } catch {
    return 0;
  }
}

export function normalizeHostnameCandidate(value: string | undefined): string | undefined {
  const normalized = normalizeSearchText(value)
    ?.replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  if (!normalized) {
    return undefined;
  }

  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized) ? normalized.toLowerCase() : undefined;
}
