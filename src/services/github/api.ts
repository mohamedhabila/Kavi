export const GITHUB_API_BASE_URL = 'https://api.github.com';
export const GITHUB_API_VERSION = '2026-03-10';

type GitHubApiResponseType = 'json' | 'text' | 'void';

export class GitHubApiError extends Error {
  status: number;
  responseBody?: string;

  constructor(status: number, message: string, responseBody?: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

function headersInitToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  return { ...(headers as Record<string, string>) };
}

function parseGitHubApiErrorMessage(body: string, fallback: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      message?: string;
      errors?: Array<{ message?: string; code?: string }>;
    };
    const pieces = [String(parsed.message || '').trim()]
      .concat(
        (parsed.errors || []).map((entry) => String(entry.message || entry.code || '').trim()),
      )
      .filter(Boolean);
    return pieces.join(' · ') || fallback;
  } catch {
    return trimmed.slice(0, 500) || fallback;
  }
}

function buildGitHubApiErrorMessage(status: number, statusText: string, body: string): string {
  const detail = parseGitHubApiErrorMessage(body, statusText || `GitHub API error ${status}`);
  return `GitHub API ${status}: ${detail}`;
}

export function getGitHubRequestHeaders(token: string, headers?: HeadersInit): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'KaviMobile/1.0',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...headersInitToRecord(headers),
  };
}

export async function githubApi<T>(
  path: string,
  token: string,
  init?: RequestInit,
  options: { responseType?: GitHubApiResponseType } = {},
): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    ...init,
    headers: getGitHubRequestHeaders(token, init?.headers),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new GitHubApiError(
      response.status,
      buildGitHubApiErrorMessage(response.status, response.statusText, body),
      body.slice(0, 1000),
    );
  }

  if (response.status === 204 || options.responseType === 'void') {
    return undefined as T;
  }

  if (options.responseType === 'text') {
    return (await response.text().catch(() => '')) as T;
  }

  if (typeof response.text !== 'function') {
    if (typeof response.json === 'function') {
      return response.json() as Promise<T>;
    }
    return undefined as T;
  }

  const text = await response.text().catch(() => '');
  if (!text.trim()) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}
