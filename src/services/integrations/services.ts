// ---------------------------------------------------------------------------
// Kavi — Service Integration Skills (Phase 8)
// ---------------------------------------------------------------------------
// Each service is a skill that registers tools. API keys stored securely.

import { getSecure } from '../storage/SecureStorage';
import type { Skill, SkillToolDefinition, SkillToolExecutionContext } from '../skills/types';
import { registerSkill } from '../skills/manager';
import { sanitizeWorkspaceRelativePath } from '../../engine/tools/fileArgumentUtils';

// ── Helper ───────────────────────────────────────────────────────────────

type ApiToolOptions = {
  strict?: boolean;
  additionalProperties?: boolean;
};

function apiTool(
  name: string,
  description: string,
  properties: Record<string, any>,
  required: string[],
  handler: NonNullable<SkillToolDefinition['handler']>,
  options: ApiToolOptions = {},
): SkillToolDefinition {
  return {
    name,
    description,
    input_schema: {
      type: 'object',
      properties,
      required,
      additionalProperties: options.additionalProperties ?? false,
    },
    strict: options.strict,
    handler,
  };
}

async function apiCall(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  apiKeyName: string;
  authHeader?: string;
}): Promise<any> {
  const apiKey = await getSecure(params.apiKeyName);
  if (!apiKey) throw new Error(`${params.apiKeyName} not configured. Add it in Settings.`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...params.headers,
  };

  if (params.authHeader) {
    headers[params.authHeader] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(params.url, {
    method: params.method || 'GET',
    headers,
    body: params.body ? JSON.stringify(params.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text.slice(0, 500)}`);
  }

  return res.json();
}

class GitHubApiError extends Error {
  status: number;
  responseBody?: string;

  constructor(status: number, message: string, responseBody?: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

type GitHubCommitChange = {
  path: string;
  content?: string;
  delete: boolean;
  mode: string;
};

type GitHubTargetRef = {
  ref: string;
  branch?: string;
  sha?: string;
  pullNumber?: number;
  baseBranch?: string;
};

type GitHubToolErrorContext = {
  toolName: string;
  repo?: string;
  branch?: string;
  ref?: string;
  path?: string;
  phase?: string;
  permissionHint?: string;
  skipRepoProbe?: boolean;
};

type GitHubRepoAccessState = 'accessible' | 'inaccessible' | 'unknown';

const GITHUB_REPO_DESCRIPTION =
  'Repository in owner/repo form. GitHub URLs and git remotes are also accepted.';
const GITHUB_BRANCH_DESCRIPTION =
  'Plain branch name like feature/test. Do not include refs/heads/.';
const GITHUB_BASE_BRANCH_DESCRIPTION =
  'Plain base/source branch name like main. Do not include refs/heads/.';
const GITHUB_REF_DESCRIPTION =
  'Branch, tag, or commit SHA. Full refs like refs/heads/main are accepted and normalized.';
const GITHUB_PATH_DESCRIPTION =
  'Repository-relative path like src/app.ts. GitHub blob/tree URLs are also accepted and normalized.';
const GITHUB_WORKFLOW_FILE_DESCRIPTION = 'Workflow file path like .github/workflows/ci.yml.';
const GITHUB_COMMIT_MODES = new Set(['100644', '100755', '120000']);

function normalizeGitHubInput(value: unknown): string {
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

function normalizeGitHubRepo(repo: unknown): string {
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

function normalizeGitHubPath(path: unknown): string {
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

function normalizeGitHubBranch(branch: unknown, fieldName = 'branch'): string {
  let normalized = normalizeGitHubInput(branch)
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

function normalizeGitHubRef(ref: unknown, fieldName = 'ref'): string {
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

function buildGitHubPath(path: string): string {
  if (!path) {
    return '';
  }
  return `/${path
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

function buildGitHubRefPath(ref: string): string {
  return ref
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function readGitHubStringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
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

function readGitHubNumberArg(args: Record<string, unknown>, keys: string[]): number | undefined {
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

function readGitHubLimitArg(
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

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGitHubErrorMessage(body: string, fallback: string): string {
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
  const detail = parseGitHubErrorMessage(body, statusText || `GitHub API error ${status}`);
  return `GitHub API ${status}: ${detail}`;
}

function isGenericGitHubErrorMessage(message: string): boolean {
  const summary = message.replace(/^GitHub API \d+:\s*/i, '').trim();
  return (
    !summary ||
    /^(not found|resource not found|forbidden|unprocessable entity|validation failed|conflict)$/i.test(
      summary,
    )
  );
}

function formatGitHubErrorTarget(context: GitHubToolErrorContext): string {
  const parts = [
    context.repo ? `repo "${context.repo}"` : undefined,
    context.branch ? `branch "${context.branch}"` : undefined,
    context.ref ? `ref "${context.ref}"` : undefined,
    context.path ? `path "${context.path}"` : undefined,
  ].filter(Boolean);

  return parts.join(', ');
}

async function probeGitHubRepoAccess(repo: string): Promise<GitHubRepoAccessState> {
  try {
    await getGitHubRepoMetadata(repo);
    return 'accessible';
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return 'inaccessible';
    }
    return 'unknown';
  }
}

async function buildGitHubToolError(
  error: unknown,
  context: GitHubToolErrorContext,
): Promise<Error> {
  if (!(error instanceof GitHubApiError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const target = formatGitHubErrorTarget(context) || 'the requested resource';
  const phase = context.phase ? ` while ${context.phase}` : '';
  const detail = isGenericGitHubErrorMessage(error.message) ? '' : ` ${error.message}.`;
  const hints: string[] = [];

  if (error.status === 404) {
    if (context.repo && !context.skipRepoProbe) {
      const access = await probeGitHubRepoAccess(context.repo);
      if (access === 'inaccessible') {
        hints.push(
          'The repository may not exist, or the token may not be granted to this private repository. GitHub often returns 404 when a fine-grained token lacks repo access.',
        );
      } else if (access === 'accessible') {
        if (context.path) {
          hints.push(
            'The repository is reachable, so the path or ref is the most likely missing resource.',
          );
        } else if (context.branch || context.ref) {
          hints.push(
            'The repository is reachable, so the branch or ref is the most likely missing resource or not yet visible.',
          );
        } else {
          hints.push(
            'The repository is reachable, so a referenced Git object is the most likely missing resource.',
          );
        }
      }
    }

    if (context.permissionHint) {
      hints.push(`Required permission: ${context.permissionHint}.`);
    }

    return new Error(
      `GitHub ${context.toolName}${phase} returned 404 for ${target}.${detail}${hints.length ? ` ${hints.join(' ')}` : ''}`.trim(),
    );
  }

  if (error.status === 403) {
    if (context.permissionHint) {
      hints.push(`Required permission: ${context.permissionHint}.`);
    }

    return new Error(
      `GitHub ${context.toolName}${phase} was forbidden for ${target}.${detail}${hints.length ? ` ${hints.join(' ')}` : ''}`.trim(),
    );
  }

  if (error.status === 409) {
    return new Error(
      `GitHub ${context.toolName}${phase} hit a conflict for ${target}.${detail} Refresh the branch state and retry with the latest refs.`.trim(),
    );
  }

  if (error.status === 422) {
    return new Error(
      `GitHub ${context.toolName}${phase} was rejected for ${target}.${detail} Check the argument values and repo state before retrying.`.trim(),
    );
  }

  return new Error(`GitHub ${context.toolName}${phase} failed for ${target}: ${error.message}`);
}

async function withGitHubToolErrorHandling<T>(
  context: GitHubToolErrorContext,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw await buildGitHubToolError(error, context);
  }
}

function isGitHubFailureState(value: string | null | undefined): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return [
    'error',
    'failure',
    'failed',
    'cancelled',
    'timed_out',
    'action_required',
    'startup_failure',
    'stale',
  ].includes(normalized);
}

function isGitHubPendingState(value: string | null | undefined): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ['queued', 'in_progress', 'pending', 'requested', 'waiting'].includes(normalized);
}

function normalizeGitHubRunStatus(run: any): string {
  return String(run?.conclusion || run?.status || run?.state || 'unknown');
}

function summarizeGitHubPipelineState(params: {
  combinedState?: string | null;
  statuses: any[];
  checkRuns: any[];
  workflowRuns: any[];
}): 'success' | 'pending' | 'failure' | 'unknown' {
  if (isGitHubFailureState(params.combinedState)) {
    return 'failure';
  }

  const states = [
    ...params.statuses.map((status) => status?.state),
    ...params.checkRuns.map((run) => run?.conclusion || run?.status),
    ...params.workflowRuns.map((run) => run?.conclusion || run?.status),
  ];

  if (states.some((state) => isGitHubFailureState(state))) {
    return 'failure';
  }
  if (states.some((state) => isGitHubPendingState(state))) {
    return 'pending';
  }
  if (
    params.combinedState === 'success' ||
    states.some(
      (state) =>
        String(state || '')
          .trim()
          .toLowerCase() === 'success',
    )
  ) {
    return 'success';
  }
  return 'unknown';
}

function decodeGitHubContent(content: string): string {
  const sanitized = content.replace(/\n/g, '');
  const bufferCtor = (
    globalThis as {
      Buffer?: { from(data: string, encoding: string): { toString(encoding: string): string } };
    }
  ).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(sanitized, 'base64').toString('utf8');
  }

  const atobFn = (globalThis as { atob?: (data: string) => string }).atob;
  if (typeof atobFn === 'function') {
    const binary = atobFn(sanitized);
    const percentEncoded = Array.from(binary)
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join('');
    return decodeURIComponent(percentEncoded);
  }

  throw new Error('Base64 decoding is not supported in this runtime');
}

async function getGitHubToken(): Promise<string> {
  const token = (await getSecure('GITHUB_TOKEN'))?.trim();
  if (!token) {
    throw new Error('GITHUB_TOKEN not configured. Add it in Settings.');
  }
  return token;
}

async function githubApiCall<T>(repoPath: string, init?: RequestInit): Promise<T> {
  const token = await getGitHubToken();
  const response = await fetch(`https://api.github.com${repoPath}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Kavi/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new GitHubApiError(
      response.status,
      buildGitHubApiErrorMessage(response.status, response.statusText, body),
      body.slice(0, 1000),
    );
  }

  if (response.status === 204) {
    return undefined as T;
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

async function getGitHubRepoMetadata(repo: string): Promise<any> {
  return githubApiCall(`/repos/${repo}`);
}

async function getGitHubDefaultBranch(repo: string): Promise<string> {
  const metadata = await getGitHubRepoMetadata(repo);
  const defaultBranch = metadata?.default_branch;
  if (!defaultBranch || !String(defaultBranch).trim()) {
    throw new Error(`GitHub repo ${repo} does not have a default branch`);
  }
  return String(defaultBranch).trim();
}

async function getGitHubCommit(repo: string, ref: string): Promise<any> {
  return githubApiCall(`/repos/${repo}/commits/${encodeURIComponent(ref)}`);
}

async function resolveGitHubTargetRef(
  repo: string,
  args: Record<string, unknown>,
): Promise<GitHubTargetRef> {
  const pullNumber = readGitHubNumberArg(args, ['pullNumber', 'prNumber', 'pull_request']);
  if (pullNumber) {
    const pull = await githubApiCall<any>(`/repos/${repo}/pulls/${pullNumber}`);
    return {
      ref: pull.head?.sha || pull.head?.ref,
      branch: pull.head?.ref,
      sha: pull.head?.sha,
      pullNumber,
      baseBranch: pull.base?.ref,
    };
  }

  const explicitBranchArg = readGitHubStringArg(args, ['branch', 'head']);
  const explicitBranch = explicitBranchArg
    ? normalizeGitHubBranch(explicitBranchArg, 'branch')
    : undefined;
  const explicitRefArg = readGitHubStringArg(args, ['ref', 'sha']);
  const explicitRef = explicitRefArg ? normalizeGitHubRef(explicitRefArg, 'ref') : explicitBranch;
  if (explicitRef) {
    const commit = await getGitHubCommit(repo, explicitRef);
    return {
      ref: explicitRef,
      branch: explicitBranch,
      sha: commit?.sha,
    };
  }

  const defaultBranch = await getGitHubDefaultBranch(repo);
  const commit = await getGitHubCommit(repo, defaultBranch);
  return {
    ref: defaultBranch,
    branch: defaultBranch,
    sha: commit?.sha,
  };
}

async function listGitHubWorkflowRuns(repo: string, args: Record<string, unknown>): Promise<any[]> {
  const target = await resolveGitHubTargetRef(repo, args);
  const query = new URLSearchParams();
  query.set('per_page', String(readGitHubLimitArg(args, ['limit', 'perPage'], 10, 100)));
  const status = readGitHubStringArg(args, ['status']);
  const event = readGitHubStringArg(args, ['event']);
  const workflowFileArg = readGitHubStringArg(args, ['workflowFile', 'workflow']);
  const workflowFile = workflowFileArg ? normalizeGitHubPath(workflowFileArg) : undefined;

  if (target.branch) {
    query.set('branch', target.branch);
  }
  if (target.sha) {
    query.set('head_sha', target.sha);
  }
  if (status) {
    query.set('status', status);
  }
  if (event) {
    query.set('event', event);
  }

  const basePath = workflowFile
    ? `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs`
    : `/repos/${repo}/actions/runs`;
  const response = await githubApiCall<{ workflow_runs?: any[] }>(
    `${basePath}?${query.toString()}`,
  );
  return response.workflow_runs || [];
}

async function getGitHubBranchHeadSha(repo: string, branch: string): Promise<string> {
  const ref = await githubApiCall<{ object?: { sha?: string } }>(
    `/repos/${repo}/git/ref/${buildGitHubRefPath(`heads/${branch}`)}`,
  );
  const sha = ref.object?.sha;
  if (!sha) {
    throw new Error(`GitHub branch ${branch} does not have a head SHA`);
  }
  return sha;
}

async function getGitHubBranchHeadShaWithRetry(
  repo: string,
  branch: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<string> {
  const attempts = Math.max(1, options.attempts || 4);
  const delayMs = Math.max(50, options.delayMs || 250);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await getGitHubBranchHeadSha(repo, branch);
    } catch (error) {
      lastError = error;
      if (!(error instanceof GitHubApiError) || error.status !== 404 || attempt === attempts) {
        throw error;
      }
      await sleepAsync(delayMs * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`GitHub branch ${branch} does not have a head SHA`);
}

async function reconcileGitHubBranchCreation(repo: string, branch: string): Promise<boolean> {
  try {
    await getGitHubBranchHeadShaWithRetry(repo, branch, { attempts: 3, delayMs: 200 });
    return true;
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

async function ensureGitHubBranch(
  repo: string,
  branch: string,
  fromBranch?: string,
): Promise<{ created: boolean; baseBranch: string; sha?: string }> {
  try {
    const sha = await getGitHubBranchHeadSha(repo, branch);
    return { created: false, baseBranch: fromBranch || (await getGitHubDefaultBranch(repo)), sha };
  } catch (error: unknown) {
    if (!(error instanceof GitHubApiError) || error.status !== 404) {
      throw error;
    }
  }

  const baseBranch = fromBranch || (await getGitHubDefaultBranch(repo));
  const baseSha = await getGitHubBranchHeadSha(
    repo,
    normalizeGitHubBranch(baseBranch, 'base branch'),
  );
  try {
    await githubApiCall(`/repos/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
  } catch (error: unknown) {
    if (error instanceof GitHubApiError && [409, 422].includes(error.status)) {
      const branchExists = await reconcileGitHubBranchCreation(repo, branch);
      if (branchExists) {
        return { created: false, baseBranch };
      }
    }
    if (
      !(error instanceof GitHubApiError) ||
      error.status !== 422 ||
      !/already exists/i.test(error.message)
    ) {
      throw error;
    }
    return { created: false, baseBranch };
  }

  // Branch was created. Verify HEAD SHA but don't fail if GitHub's eventual
  // consistency causes transient 404s — report success with baseSha instead.
  try {
    const sha = await getGitHubBranchHeadShaWithRetry(repo, branch, { attempts: 4, delayMs: 200 });
    return { created: true, baseBranch, sha };
  } catch {
    return { created: true, baseBranch, sha: baseSha };
  }
}

async function findExistingGitHubPullRequest(
  repo: string,
  head: string,
  base: string,
): Promise<any | null> {
  const [owner] = repo.split('/');
  const query = new URLSearchParams();
  query.set('state', 'open');
  query.set('head', `${owner}:${head}`);
  query.set('base', base);
  query.set('per_page', '1');

  const pulls = await githubApiCall<any[]>(`/repos/${repo}/pulls?${query.toString()}`);
  return pulls[0] || null;
}

function normalizeGitHubCommitMode(mode: unknown): string {
  const normalized = String(mode || '100644').trim();
  if (!GITHUB_COMMIT_MODES.has(normalized)) {
    throw new Error('GitHub commit mode must be one of 100644, 100755, 120000');
  }
  return normalized;
}

function normalizeConversationWorkspaceFilePath(filePath: unknown): string {
  if (typeof filePath !== 'string') {
    throw new Error('GitHub commit filePath must be a string');
  }

  const normalized = sanitizeWorkspaceRelativePath(filePath);
  if (!normalized) {
    throw new Error('GitHub commit filePath must not be empty');
  }

  return normalized;
}

async function resolveGitHubCommitChangeContent(
  path: string,
  item: Record<string, unknown>,
  deleteFlag: boolean,
  executionContext: SkillToolExecutionContext,
): Promise<string | undefined> {
  const hasContent = item.content != null;
  const hasFilePath = item.filePath != null;

  if (deleteFlag) {
    if (hasContent || hasFilePath) {
      throw new Error(
        `GitHub commit change for ${path} cannot include content or filePath when delete=true`,
      );
    }
    return undefined;
  }

  if (hasContent === hasFilePath) {
    throw new Error(
      `GitHub commit change for ${path} must include exactly one of content or filePath unless delete=true`,
    );
  }

  if (hasContent) {
    return String(item.content);
  }

  const filePath = normalizeConversationWorkspaceFilePath(item.filePath);
  if (!executionContext.readConversationFile) {
    throw new Error(
      `GitHub commit change for ${path} uses filePath "${filePath}" but no conversation workspace is available. Use content instead or invoke the tool from an active conversation.`,
    );
  }

  try {
    return await executionContext.readConversationFile(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `GitHub commit change for ${path} could not read conversation workspace file "${filePath}": ${message}`,
    );
  }
}

async function normalizeGitHubCommitChanges(
  changes: unknown,
  executionContext: SkillToolExecutionContext = {},
): Promise<GitHubCommitChange[]> {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error('GitHub commit requires a non-empty changes array');
  }

  const seenPaths = new Set<string>();
  return Promise.all(
    changes.map(async (change, index) => {
      const item = change && typeof change === 'object' ? (change as Record<string, unknown>) : {};
      const path = normalizeGitHubPath(item.path);
      if (!path) {
        throw new Error(`GitHub commit change at index ${index} is missing a path`);
      }
      if (seenPaths.has(path)) {
        throw new Error(`GitHub commit contains duplicate path: ${path}`);
      }
      seenPaths.add(path);

      const deleteFlag = Boolean(item.delete);
      const content = await resolveGitHubCommitChangeContent(
        path,
        item,
        deleteFlag,
        executionContext,
      );

      return {
        path,
        content,
        delete: deleteFlag,
        mode: normalizeGitHubCommitMode(item.mode),
      };
    }),
  );
}

// ── Weather Skill ────────────────────────────────────────────────────────

export function createWeatherSkill(): Skill {
  return {
    id: 'weather',
    name: 'Weather',
    description: 'Current weather and forecasts',
    version: '1.0.0',
    tools: [
      apiTool(
        'current',
        'Get current weather for a location',
        {
          location: { type: 'string', description: 'City name or coordinates' },
          units: { type: 'string', description: '"metric" (default) or "imperial"' },
        },
        ['location'],
        async (args) => {
          const units = args.units || 'metric';
          const key = await getSecure('OPENWEATHER_API_KEY');
          if (!key) throw new Error('OPENWEATHER_API_KEY not configured');
          const res = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(args.location)}&units=${units}&appid=${key}`,
          );
          if (!res.ok) throw new Error(`Weather API: ${res.status}`);
          const data = await res.json();
          return JSON.stringify({
            location: data.name,
            temp: data.main?.temp,
            feels_like: data.main?.feels_like,
            humidity: data.main?.humidity,
            description: data.weather?.[0]?.description,
            wind: data.wind,
          });
        },
      ),
      apiTool(
        'forecast',
        'Get 5-day weather forecast',
        {
          location: { type: 'string', description: 'City name' },
          units: { type: 'string', description: '"metric" or "imperial"' },
        },
        ['location'],
        async (args) => {
          const units = args.units || 'metric';
          const key = await getSecure('OPENWEATHER_API_KEY');
          if (!key) throw new Error('OPENWEATHER_API_KEY not configured');
          const res = await fetch(
            `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(args.location)}&units=${units}&appid=${key}&cnt=40`,
          );
          if (!res.ok) throw new Error(`Weather API: ${res.status}`);
          const data = await res.json();
          const forecasts = (data.list || [])
            .filter((_: any, i: number) => i % 8 === 0)
            .map((f: any) => ({
              date: f.dt_txt,
              temp: f.main?.temp,
              description: f.weather?.[0]?.description,
            }));
          return JSON.stringify({ location: data.city?.name, forecasts });
        },
      ),
    ],
  };
}

// ── GitHub Skill ─────────────────────────────────────────────────────────

export function createGitHubSkill(): Skill {
  return {
    id: 'github',
    name: 'GitHub',
    description:
      'GitHub repositories, private repo files, branches, commits, issues, and pull requests',
    version: '1.0.0',
    tools: [
      apiTool(
        'repos',
        'List repositories that the configured GitHub token can access. Use this first when the repository is unknown.',
        {
          sort: {
            type: 'string',
            enum: ['updated', 'stars', 'name'],
            description: 'Sort order for the repository list.',
          },
          limit: { type: 'number', description: 'Max results (default: 10)' },
        },
        [],
        async (args) => {
          const limit = readGitHubLimitArg(args, ['limit', 'perPage'], 10, 100);
          const data = await githubApiCall<any[]>(
            `/user/repos?sort=${args.sort || 'updated'}&per_page=${limit}`,
          );
          return JSON.stringify(
            data.map((r: any) => ({
              name: r.full_name,
              description: r.description,
              stars: r.stargazers_count,
              language: r.language,
              updated: r.updated_at,
              url: r.html_url,
              defaultBranch: r.default_branch,
              private: r.private,
            })),
          );
        },
      ),
      apiTool(
        'branches',
        'List branches for a GitHub repository. Use this when you need an exact branch name before editing files or opening a pull request.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          limit: { type: 'number', description: 'Max results (default: 20)' },
        },
        ['repo'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          return withGitHubToolErrorHandling(
            {
              toolName: 'branches',
              repo,
              permissionHint: 'Contents: read',
            },
            async () => {
              const limit = readGitHubLimitArg(args, ['limit', 'perPage'], 20, 100);
              const data = await githubApiCall<any[]>(`/repos/${repo}/branches?per_page=${limit}`);
              return JSON.stringify(
                data.map((branch: any) => ({
                  name: branch.name,
                  protected: branch.protected,
                  sha: branch.commit?.sha,
                  url: branch.commit?.url,
                })),
              );
            },
          );
        },
      ),
      apiTool(
        'list_files',
        'List files in a GitHub repository directory. Use repo-relative paths and an optional branch/tag/SHA ref when the default branch is not correct.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          path: {
            type: 'string',
            description: `${GITHUB_PATH_DESCRIPTION} Leave empty or null to list the repository root.`,
          },
          ref: { type: 'string', description: GITHUB_REF_DESCRIPTION },
        },
        ['repo'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          const path = normalizeGitHubPath(args.path);
          const ref = args.ref ? normalizeGitHubRef(args.ref, 'ref') : undefined;
          return withGitHubToolErrorHandling(
            {
              toolName: 'list_files',
              repo,
              path: path || undefined,
              ref,
              permissionHint: 'Contents: read',
            },
            async () => {
              const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
              const data = await githubApiCall<any>(
                `/repos/${repo}/contents${buildGitHubPath(path)}${query}`,
              );
              const entries = Array.isArray(data) ? data : [data];
              return JSON.stringify(
                entries.map((entry: any) => ({
                  name: entry.name,
                  path: entry.path,
                  type: entry.type,
                  sha: entry.sha,
                  size: entry.size,
                  url: entry.html_url,
                })),
              );
            },
          );
        },
        { strict: true },
      ),
      apiTool(
        'read_file',
        'Read a text file from a GitHub repository. Use repo-relative paths and an optional ref when the default branch is not correct.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          path: { type: 'string', description: GITHUB_PATH_DESCRIPTION },
          ref: { type: 'string', description: GITHUB_REF_DESCRIPTION },
        },
        ['repo', 'path'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          const path = normalizeGitHubPath(args.path);
          const ref = readGitHubStringArg(args, ['ref', 'branch'])
            ? normalizeGitHubRef(readGitHubStringArg(args, ['ref', 'branch']), 'ref')
            : undefined;
          return withGitHubToolErrorHandling(
            {
              toolName: 'read_file',
              repo,
              path,
              ref,
              permissionHint: 'Contents: read',
            },
            async () => {
              const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
              const data = await githubApiCall<any>(
                `/repos/${repo}/contents${buildGitHubPath(path)}${query}`,
              );
              if (Array.isArray(data) || data.type !== 'file') {
                throw new Error(`GitHub path ${path} is not a file`);
              }
              if (data.encoding !== 'base64' || typeof data.content !== 'string') {
                throw new Error(`GitHub file ${path} did not return base64 content`);
              }
              return JSON.stringify({
                path: data.path,
                sha: data.sha,
                size: data.size,
                ref: ref || null,
                content: decodeGitHubContent(data.content),
                url: data.html_url,
              });
            },
          );
        },
        { strict: true },
      ),
      apiTool(
        'create_branch',
        'Create a branch in a GitHub repository. Pass plain branch names like feature/test, not refs/heads/feature/test.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          branch: { type: 'string', description: GITHUB_BRANCH_DESCRIPTION },
          baseBranch: {
            type: 'string',
            description: `${GITHUB_BASE_BRANCH_DESCRIPTION} Leave null to start from the repository default branch.`,
          },
        },
        ['repo', 'branch'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          const branch = normalizeGitHubBranch(args.branch);
          const sourceBranchArg = readGitHubStringArg(args, [
            'from',
            'base',
            'baseBranch',
            'fromBranch',
          ]);
          const fromBranch = sourceBranchArg
            ? normalizeGitHubBranch(sourceBranchArg, 'source branch')
            : undefined;
          const context: GitHubToolErrorContext = {
            toolName: 'create_branch',
            repo,
            branch,
            permissionHint: 'Contents: write',
            phase: 'resolving the target branch',
          };
          return withGitHubToolErrorHandling(context, async () => {
            context.phase = 'creating or locating the target branch';
            const result = await ensureGitHubBranch(repo, branch, fromBranch);
            context.phase = 'verifying the new branch head';
            const sha =
              result.sha ||
              (await getGitHubBranchHeadShaWithRetry(repo, branch, {
                attempts: 5,
                delayMs: 300,
              }).catch(() => 'pending'));
            return JSON.stringify({
              repo,
              branch,
              baseBranch: result.baseBranch,
              created: result.created,
              sha,
            });
          });
        },
        { strict: true },
      ),
      apiTool(
        'commit_files',
        'Create a single atomic commit on a branch with one or more file changes. Pass a plain branch name, a commit message, and repo-relative file paths. For create or update changes, prefer filePath after editing a local conversation workspace file; use content only for inline text.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          branch: { type: 'string', description: GITHUB_BRANCH_DESCRIPTION },
          baseBranch: {
            type: 'string',
            description: `${GITHUB_BASE_BRANCH_DESCRIPTION} Used only if the target branch does not exist yet.`,
          },
          message: { type: 'string', description: 'Commit message for the new commit.' },
          changes: {
            type: 'array',
            minItems: 1,
            description:
              'One or more file changes applied together in a single commit. Each item needs a repo path and exactly one of content, filePath, or delete=true. Prefer filePath after local workspace edits.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', description: GITHUB_PATH_DESCRIPTION },
                content: {
                  type: 'string',
                  description:
                    'UTF-8 file contents for create/update. Use this for inline content only. Do not provide with filePath or delete=true.',
                },
                filePath: {
                  type: 'string',
                  description:
                    'Conversation-workspace file path to read UTF-8 content from before creating or updating the GitHub file. Prefer this after local edits. Do not provide with content or delete=true.',
                },
                delete: {
                  type: 'boolean',
                  description:
                    'Set true to delete the file instead of writing new content. Do not provide content or filePath when delete=true.',
                },
                mode: {
                  type: 'string',
                  enum: ['100644', '100755', '120000'],
                  description:
                    'Git file mode. Use 100644 for normal text files unless you intentionally need another mode.',
                },
              },
              required: ['path'],
            },
          },
        },
        ['repo', 'branch', 'message', 'changes'],
        async (args, executionContext = {}) => {
          const repo = normalizeGitHubRepo(args.repo);
          const branch = normalizeGitHubBranch(
            readGitHubStringArg(args, ['branch', 'head']) || args.branch,
          );
          const message = String(args.message || '').trim();
          if (!message) {
            throw new Error('GitHub commit message is required');
          }

          const changes = await normalizeGitHubCommitChanges(args.changes, executionContext);
          const workflowTouched = changes.some((change) =>
            change.path.startsWith('.github/workflows/'),
          );
          const baseBranchArg = readGitHubStringArg(args, [
            'base',
            'baseBranch',
            'from',
            'fromBranch',
          ]);
          const context: GitHubToolErrorContext = {
            toolName: 'commit_files',
            repo,
            branch,
            permissionHint: workflowTouched
              ? 'Contents: write and Workflows: write when modifying .github/workflows/'
              : 'Contents: write',
            phase: 'resolving the target branch',
          };
          return withGitHubToolErrorHandling(context, async () => {
            context.phase = 'creating or locating the target branch';
            const ensuredBranch = await ensureGitHubBranch(
              repo,
              branch,
              baseBranchArg ? normalizeGitHubBranch(baseBranchArg, 'base branch') : undefined,
            );
            context.phase = 'reading the current branch head';
            const headSha =
              ensuredBranch.sha ||
              (await getGitHubBranchHeadShaWithRetry(repo, branch, { attempts: 5, delayMs: 300 }));
            context.phase = 'reading the current commit tree';
            const headCommit = await githubApiCall<{ tree?: { sha?: string } }>(
              `/repos/${repo}/git/commits/${headSha}`,
            );
            const baseTreeSha = headCommit.tree?.sha;
            if (!baseTreeSha) {
              throw new Error(`GitHub branch ${branch} does not have a tree SHA`);
            }

            context.phase = 'creating blobs for changed files';
            const tree = await Promise.all(
              changes.map(async (change) => {
                if (change.delete) {
                  return { path: change.path, mode: change.mode, type: 'blob', sha: null };
                }

                const blob = await githubApiCall<{ sha: string }>(`/repos/${repo}/git/blobs`, {
                  method: 'POST',
                  body: JSON.stringify({ content: change.content, encoding: 'utf-8' }),
                });
                return { path: change.path, mode: change.mode, type: 'blob', sha: blob.sha };
              }),
            );

            let nextTree: { sha: string };
            context.phase = 'creating the next tree';
            try {
              nextTree = await githubApiCall<{ sha: string }>(`/repos/${repo}/git/trees`, {
                method: 'POST',
                body: JSON.stringify({ base_tree: baseTreeSha, tree }),
              });
            } catch (treeErr) {
              if (treeErr instanceof GitHubApiError && treeErr.status === 403 && workflowTouched) {
                throw new GitHubApiError(
                  403,
                  `${treeErr.message}. Committing to .github/workflows/ requires the 'Workflows' permission on the GitHub token. Update the token permissions in GitHub Settings > Fine-grained tokens.`,
                  treeErr.responseBody,
                );
              }
              throw treeErr;
            }

            context.phase = 'creating the commit object';
            const commit = await githubApiCall<{ sha: string; html_url?: string }>(
              `/repos/${repo}/git/commits`,
              {
                method: 'POST',
                body: JSON.stringify({ message, tree: nextTree.sha, parents: [headSha] }),
              },
            );
            context.phase = 'updating the branch reference';
            await githubApiCall(
              `/repos/${repo}/git/refs/${buildGitHubRefPath(`heads/${branch}`)}`,
              {
                method: 'PATCH',
                body: JSON.stringify({ sha: commit.sha, force: false }),
              },
            );

            return JSON.stringify({
              repo,
              branch,
              baseBranch: ensuredBranch.baseBranch,
              branchCreated: ensuredBranch.created,
              commitSha: commit.sha,
              url: commit.html_url,
              changedFiles: changes.map((change) => change.path),
            });
          });
        },
        { strict: true },
      ),
      apiTool(
        'issues',
        'List GitHub issues for a repository. Pull requests are excluded from the result.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          state: {
            type: 'string',
            enum: ['open', 'closed', 'all'],
            description: 'Issue state filter.',
          },
          limit: { type: 'number', description: 'Max results (default: 10)' },
        },
        ['repo'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          return withGitHubToolErrorHandling(
            {
              toolName: 'issues',
              repo,
              permissionHint: 'Issues: read',
            },
            async () => {
              const limit = readGitHubLimitArg(args, ['limit', 'perPage'], 10, 100);
              const data = await githubApiCall<any[]>(
                `/repos/${repo}/issues?state=${args.state || 'open'}&per_page=${limit}`,
              );
              return JSON.stringify(
                data
                  .filter((issue: any) => !issue.pull_request)
                  .map((i: any) => ({
                    number: i.number,
                    title: i.title,
                    state: i.state,
                    author: i.user?.login,
                    labels: i.labels?.map((l: any) => l.name),
                    created: i.created_at,
                    url: i.html_url,
                  })),
              );
            },
          );
        },
      ),
      apiTool(
        'create_issue',
        'Create a GitHub issue in a repository.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          title: { type: 'string', description: 'Issue title' },
          body: { type: 'string', description: 'Issue body (markdown)' },
          labels: { type: 'string', description: 'Comma-separated labels' },
        },
        ['repo', 'title'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          return withGitHubToolErrorHandling(
            {
              toolName: 'create_issue',
              repo,
              permissionHint: 'Issues: write',
            },
            async () => {
              const data = await githubApiCall<any>(`/repos/${repo}/issues`, {
                method: 'POST',
                body: JSON.stringify({
                  title: args.title,
                  body: args.body || '',
                  labels: args.labels ? args.labels.split(',').map((l: string) => l.trim()) : [],
                }),
              });
              return JSON.stringify({ number: data.number, url: data.html_url, state: data.state });
            },
          );
        },
        { strict: true },
      ),
      apiTool(
        'create_pull_request',
        'Create a pull request from a head branch into a base branch. Pass plain branch names, not refs/heads/...',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          title: { type: 'string', description: 'Pull request title' },
          head: { type: 'string', description: GITHUB_BRANCH_DESCRIPTION },
          base: {
            type: 'string',
            description: `${GITHUB_BASE_BRANCH_DESCRIPTION} Leave null to use the repository default branch.`,
          },
          body: { type: 'string', description: 'Pull request body (markdown)' },
        },
        ['repo', 'title', 'head'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          const head = normalizeGitHubBranch(
            readGitHubStringArg(args, ['head', 'branch']) || args.head,
            'head branch',
          );
          const baseBranchArg = readGitHubStringArg(args, ['base', 'baseBranch']);
          return withGitHubToolErrorHandling(
            {
              toolName: 'create_pull_request',
              repo,
              branch: head,
              permissionHint: 'Pull requests: write',
            },
            async () => {
              const base = baseBranchArg
                ? normalizeGitHubBranch(baseBranchArg, 'base branch')
                : await getGitHubDefaultBranch(repo);
              let data: any;
              let created = true;
              try {
                data = await githubApiCall<any>(`/repos/${repo}/pulls`, {
                  method: 'POST',
                  body: JSON.stringify({ title: args.title, head, base, body: args.body || '' }),
                });
              } catch (error) {
                if (
                  !(error instanceof GitHubApiError) ||
                  error.status !== 422 ||
                  !/pull request already exists/i.test(error.message)
                ) {
                  throw error;
                }

                data = await findExistingGitHubPullRequest(repo, head, base);
                if (!data) {
                  throw error;
                }
                created = false;
              }
              return JSON.stringify({
                number: data.number,
                title: data.title,
                state: data.state,
                head: data.head?.ref,
                base: data.base?.ref,
                url: data.html_url,
                created,
              });
            },
          );
        },
        { strict: true },
      ),
      apiTool(
        'workflow_runs',
        'List GitHub Actions workflow runs for a branch, ref, or pull request.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          workflowFile: {
            type: 'string',
            description: `Optional ${GITHUB_WORKFLOW_FILE_DESCRIPTION}`,
          },
          branch: { type: 'string', description: GITHUB_BRANCH_DESCRIPTION },
          ref: { type: 'string', description: GITHUB_REF_DESCRIPTION },
          pullNumber: { type: 'number', description: 'Pull request number to inspect' },
          status: { type: 'string', description: 'Optional workflow run status filter' },
          event: { type: 'string', description: 'Optional workflow event filter' },
          limit: { type: 'number', description: 'Max results (default: 10)' },
        },
        ['repo'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          return withGitHubToolErrorHandling(
            {
              toolName: 'workflow_runs',
              repo,
              branch: readGitHubStringArg(args, ['branch', 'head'])
                ? normalizeGitHubBranch(readGitHubStringArg(args, ['branch', 'head']), 'branch')
                : undefined,
              ref: readGitHubStringArg(args, ['ref', 'sha'])
                ? normalizeGitHubRef(readGitHubStringArg(args, ['ref', 'sha']), 'ref')
                : undefined,
              permissionHint: 'Actions: read',
            },
            async () => {
              const target = await resolveGitHubTargetRef(repo, args);
              const runs = await listGitHubWorkflowRuns(repo, args);
              return JSON.stringify({
                repo,
                ref: target.ref,
                branch: target.branch || null,
                sha: target.sha || null,
                pullNumber: target.pullNumber || null,
                runs: runs.map((run: any) => ({
                  id: run.id,
                  name: run.name,
                  displayTitle: run.display_title,
                  event: run.event,
                  status: run.status,
                  conclusion: run.conclusion,
                  workflowId: run.workflow_id,
                  headBranch: run.head_branch,
                  headSha: run.head_sha,
                  url: run.html_url,
                  createdAt: run.created_at,
                  updatedAt: run.updated_at,
                })),
              });
            },
          );
        },
      ),
      apiTool(
        'checks_status',
        'Fetch combined commit status, check runs, and workflow runs for a branch, ref, or pull request.',
        {
          repo: { type: 'string', description: GITHUB_REPO_DESCRIPTION },
          branch: { type: 'string', description: GITHUB_BRANCH_DESCRIPTION },
          ref: { type: 'string', description: GITHUB_REF_DESCRIPTION },
          pullNumber: { type: 'number', description: 'Pull request number to inspect' },
          workflowFile: {
            type: 'string',
            description: `Optional ${GITHUB_WORKFLOW_FILE_DESCRIPTION}`,
          },
          limit: { type: 'number', description: 'Max check and workflow entries (default: 20)' },
        },
        ['repo'],
        async (args) => {
          const repo = normalizeGitHubRepo(args.repo);
          return withGitHubToolErrorHandling(
            {
              toolName: 'checks_status',
              repo,
              branch: readGitHubStringArg(args, ['branch', 'head'])
                ? normalizeGitHubBranch(readGitHubStringArg(args, ['branch', 'head']), 'branch')
                : undefined,
              ref: readGitHubStringArg(args, ['ref', 'sha'])
                ? normalizeGitHubRef(readGitHubStringArg(args, ['ref', 'sha']), 'ref')
                : undefined,
              permissionHint: 'Checks: read, Commit statuses: read, and Actions: read',
            },
            async () => {
              const target = await resolveGitHubTargetRef(repo, args);
              const limit = readGitHubNumberArg(args, ['limit', 'perPage']) || 20;
              const [combinedStatus, checkRunsResponse, workflowRuns] = await Promise.all([
                githubApiCall<any>(
                  `/repos/${repo}/commits/${encodeURIComponent(target.ref)}/status`,
                ),
                githubApiCall<any>(
                  `/repos/${repo}/commits/${encodeURIComponent(target.ref)}/check-runs?per_page=${limit}`,
                ),
                listGitHubWorkflowRuns(repo, {
                  ...args,
                  branch: target.branch,
                  ref: target.ref,
                  limit,
                }),
              ]);

              const statuses = combinedStatus?.statuses || [];
              const checkRuns = checkRunsResponse?.check_runs || [];
              const state = summarizeGitHubPipelineState({
                combinedState: combinedStatus?.state,
                statuses,
                checkRuns,
                workflowRuns,
              });

              return JSON.stringify({
                repo,
                ref: target.ref,
                branch: target.branch || null,
                sha: target.sha || combinedStatus?.sha || null,
                pullNumber: target.pullNumber || null,
                baseBranch: target.baseBranch || null,
                state,
                summary: {
                  statuses: {
                    total: statuses.length,
                    failing: statuses.filter((status: any) => isGitHubFailureState(status?.state))
                      .length,
                    pending: statuses.filter((status: any) => isGitHubPendingState(status?.state))
                      .length,
                  },
                  checkRuns: {
                    total: checkRuns.length,
                    failing: checkRuns.filter((run: any) =>
                      isGitHubFailureState(run?.conclusion || run?.status),
                    ).length,
                    pending: checkRuns.filter((run: any) =>
                      isGitHubPendingState(run?.conclusion || run?.status),
                    ).length,
                  },
                  workflowRuns: {
                    total: workflowRuns.length,
                    failing: workflowRuns.filter((run: any) =>
                      isGitHubFailureState(normalizeGitHubRunStatus(run)),
                    ).length,
                    pending: workflowRuns.filter((run: any) =>
                      isGitHubPendingState(normalizeGitHubRunStatus(run)),
                    ).length,
                  },
                },
                combinedStatus: {
                  state: combinedStatus?.state || 'unknown',
                  statuses: statuses.map((status: any) => ({
                    context: status.context,
                    state: status.state,
                    description: status.description,
                    targetUrl: status.target_url,
                    updatedAt: status.updated_at,
                  })),
                },
                checkRuns: checkRuns.map((run: any) => ({
                  id: run.id,
                  name: run.name,
                  status: run.status,
                  conclusion: run.conclusion,
                  startedAt: run.started_at,
                  completedAt: run.completed_at,
                  detailsUrl: run.details_url,
                })),
                workflowRuns: workflowRuns.map((run: any) => ({
                  id: run.id,
                  name: run.name,
                  displayTitle: run.display_title,
                  event: run.event,
                  status: run.status,
                  conclusion: run.conclusion,
                  headBranch: run.head_branch,
                  headSha: run.head_sha,
                  url: run.html_url,
                  createdAt: run.created_at,
                  updatedAt: run.updated_at,
                })),
              });
            },
          );
        },
      ),
    ],
  };
}

// ── Finance Skill ────────────────────────────────────────────────────────

export function createFinanceSkill(): Skill {
  return {
    id: 'finance',
    name: 'Finance',
    description: 'Stock quotes, crypto prices, currency conversion',
    version: '1.0.0',
    tools: [
      apiTool(
        'stock_quote',
        'Get current stock price',
        {
          symbol: { type: 'string', description: 'Stock ticker (e.g. AAPL, GOOG)' },
        },
        ['symbol'],
        async (args) => {
          const key = await getSecure('ALPHA_VANTAGE_API_KEY');
          if (!key) throw new Error('ALPHA_VANTAGE_API_KEY not configured');
          const res = await fetch(
            `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(args.symbol)}&apikey=${key}`,
          );
          if (!res.ok) throw new Error(`Finance API: ${res.status}`);
          const data = await res.json();
          const quote = data['Global Quote'] || {};
          return JSON.stringify({
            symbol: quote['01. symbol'],
            price: quote['05. price'],
            change: quote['09. change'],
            changePercent: quote['10. change percent'],
            volume: quote['06. volume'],
          });
        },
      ),
      apiTool(
        'crypto_price',
        'Get cryptocurrency price',
        {
          symbol: { type: 'string', description: 'Crypto symbol (e.g. BTC, ETH)' },
          currency: { type: 'string', description: 'Fiat currency (default: USD)' },
        },
        ['symbol'],
        async (args) => {
          const currency = (args.currency || 'USD').toUpperCase();
          const res = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(args.symbol.toLowerCase())}&vs_currencies=${currency.toLowerCase()}`,
          );
          if (!res.ok) throw new Error(`CoinGecko API: ${res.status}`);
          const data = await res.json();
          return JSON.stringify(data);
        },
      ),
    ],
  };
}

// ── Productivity Skill ────────────────────────────────────────────────────

export function createProductivitySkill(): Skill {
  return {
    id: 'productivity',
    name: 'Productivity',
    description: 'Timers, reminders, unit conversion, and task management',
    version: '1.0.0',
    tools: [
      apiTool(
        'timer',
        'Set a countdown timer',
        {
          seconds: { type: 'number', description: 'Duration in seconds' },
          label: { type: 'string', description: 'Timer label (optional)' },
        },
        ['seconds'],
        async (args) => {
          const seconds = Math.min(Math.max(1, args.seconds), 3600);
          return JSON.stringify({
            status: 'timer_set',
            seconds,
            label: args.label || 'Timer',
            expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
          });
        },
      ),
      apiTool(
        'unit_convert',
        'Convert between units',
        {
          value: { type: 'number', description: 'Value to convert' },
          from: { type: 'string', description: 'Source unit (e.g. km, lb, °C)' },
          to: { type: 'string', description: 'Target unit (e.g. mi, kg, °F)' },
        },
        ['value', 'from', 'to'],
        async (args) => {
          const conversions: Record<string, Record<string, number | null>> = {
            km: { mi: 0.621371, m: 1000, ft: 3280.84 },
            mi: { km: 1.60934, m: 1609.34, ft: 5280 },
            kg: { lb: 2.20462, g: 1000, oz: 35.274 },
            lb: { kg: 0.453592, g: 453.592, oz: 16 },
            m: { ft: 3.28084, km: 0.001, mi: 0.000621371, cm: 100, in: 39.3701 },
            ft: { m: 0.3048, km: 0.0003048, mi: 0.000189394, cm: 30.48, in: 12 },
            '°C': { '°F': null }, // handled separately above
            '°F': { '°C': null },
            l: { gal: 0.264172, ml: 1000 },
            gal: { l: 3.78541, ml: 3785.41 },
          };

          const from = args.from.toLowerCase().replace('celsius', '°C').replace('fahrenheit', '°F');
          const to = args.to.toLowerCase().replace('celsius', '°C').replace('fahrenheit', '°F');

          if (from === '°c' && to === '°f') {
            return JSON.stringify({
              value: args.value,
              from,
              to,
              result: (args.value * 9) / 5 + 32,
            });
          }
          if (from === '°f' && to === '°c') {
            return JSON.stringify({
              value: args.value,
              from,
              to,
              result: ((args.value - 32) * 5) / 9,
            });
          }

          const factor = conversions[from]?.[to];
          if (!factor) return JSON.stringify({ error: `Unsupported conversion: ${from} → ${to}` });

          return JSON.stringify({
            value: args.value,
            from: args.from,
            to: args.to,
            result: args.value * factor,
          });
        },
      ),
      apiTool(
        'calculate',
        'Evaluate a mathematical expression',
        {
          expression: { type: 'string', description: 'Math expression (e.g. "2^10 + sqrt(144)")' },
        },
        ['expression'],
        async (args) => {
          try {
            // Safe evaluation: strict allowlist of math characters/functions only
            const sanitized = args.expression.replace(/[^0-9+\-*/.()%^ sqrtloginabceMPIE,\s]/g, '');
            // Reject if sanitization removed significant content (possible injection attempt)
            if (
              sanitized.replace(/\s/g, '').length <
              args.expression.replace(/\s/g, '').length * 0.8
            ) {
              return JSON.stringify({ error: 'Expression contains unsupported characters' });
            }
            const jsExpr = sanitized
              .replace(/\^/g, '**')
              .replace(/sqrt\(/g, 'Math.sqrt(')
              .replace(/log\(/g, 'Math.log10(')
              .replace(/ln\(/g, 'Math.log(')
              .replace(/sin\(/g, 'Math.sin(')
              .replace(/cos\(/g, 'Math.cos(')
              .replace(/abs\(/g, 'Math.abs(')
              .replace(/PI/g, 'Math.PI')
              .replace(/E(?![a-z])/g, 'Math.E');
            const result = new Function(`"use strict"; return (${jsExpr})`)();
            if (typeof result !== 'number' || !isFinite(result)) {
              return JSON.stringify({ error: 'Expression did not produce a finite number' });
            }
            return JSON.stringify({ expression: args.expression, result });
          } catch (err: unknown) {
            return JSON.stringify({
              error: `Invalid expression: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        },
      ),
    ],
  };
}

// ── Communication Skill ──────────────────────────────────────────────────

export function createCommunicationSkill(): Skill {
  return {
    id: 'communication',
    name: 'Communication',
    description: 'Email drafting, message templates, and translation',
    version: '1.0.0',
    systemPrompt:
      'You have access to communication tools for drafting emails, generating message templates, and translating text.',
    tools: [
      apiTool(
        'draft_email',
        'Generate a professional email draft',
        {
          to: { type: 'string', description: 'Recipient name or context' },
          subject: { type: 'string', description: 'Email subject' },
          context: { type: 'string', description: 'What the email should be about' },
          tone: { type: 'string', description: '"formal", "casual", "friendly" (default: formal)' },
        },
        ['subject', 'context'],
        async (args) => {
          return JSON.stringify({
            status: 'draft_generated',
            to: args.to || '(recipient)',
            subject: args.subject,
            tone: args.tone || 'formal',
            note: 'The email draft should be composed by the LLM using this context.',
            context: args.context,
          });
        },
      ),
      apiTool(
        'translate',
        'Translate text between languages',
        {
          text: { type: 'string', description: 'Text to translate' },
          from: { type: 'string', description: 'Source language (auto-detect if omitted)' },
          to: { type: 'string', description: 'Target language' },
        },
        ['text', 'to'],
        async (args) => {
          // Uses the LLM itself for translation (no external API needed)
          return JSON.stringify({
            status: 'translate_request',
            text: args.text.slice(0, 5000),
            from: args.from || 'auto',
            to: args.to,
            note: 'The LLM should translate this text inline.',
          });
        },
      ),
    ],
  };
}

// ── Media Skill ──────────────────────────────────────────────────────────

export function createMediaSkill(): Skill {
  return {
    id: 'media',
    name: 'Media',
    description: 'Image description, QR code generation, color palette tools',
    version: '1.0.0',
    tools: [
      apiTool(
        'describe_image',
        'Describe an image from a URL using vision',
        {
          url: { type: 'string', description: 'Image URL' },
          detail: { type: 'string', description: '"brief" or "detailed" (default: brief)' },
        },
        ['url'],
        async (args) => {
          return JSON.stringify({
            status: 'describe_request',
            url: args.url,
            detail: args.detail || 'brief',
            note: 'Use the vision model to describe this image.',
          });
        },
      ),
      apiTool(
        'generate_qr',
        'Generate a QR code for a given text or URL',
        {
          data: { type: 'string', description: 'Data to encode in the QR code' },
          size: { type: 'number', description: 'Image size in pixels (default: 256)' },
        },
        ['data'],
        async (args) => {
          const size = args.size || 256;
          const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(args.data)}`;
          return JSON.stringify({ status: 'generated', url, data: args.data, size });
        },
      ),
      apiTool(
        'color_palette',
        'Generate a color palette',
        {
          count: { type: 'number', description: 'Number of colors (default: 5)' },
          theme: { type: 'string', description: 'Theme/mood for the palette (optional)' },
        },
        [],
        async (args) => {
          return JSON.stringify({
            status: 'palette_request',
            count: args.count || 5,
            theme: args.theme || 'harmonious',
            note: 'The LLM should generate a color palette based on the theme.',
          });
        },
      ),
    ],
  };
}

// ── Knowledge Skill ──────────────────────────────────────────────────────

export function createKnowledgeSkill(): Skill {
  return {
    id: 'knowledge',
    name: 'Knowledge',
    description: 'Wikipedia summaries, definitions, and fact checking',
    version: '1.0.0',
    tools: [
      apiTool(
        'wikipedia_summary',
        'Get a Wikipedia summary for a topic',
        {
          topic: { type: 'string', description: 'Topic to look up' },
        },
        ['topic'],
        async (args) => {
          try {
            const res = await fetch(
              `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(args.topic)}`,
              { headers: { 'User-Agent': 'Kavi/1.0' } },
            );
            if (!res.ok) return JSON.stringify({ error: `Wikipedia: ${res.status}` });
            const data = await res.json();
            return JSON.stringify({
              title: data.title,
              extract: data.extract?.slice(0, 2000),
              thumbnail: data.thumbnail?.source,
              url: data.content_urls?.desktop?.page,
            });
          } catch (err: unknown) {
            return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      ),
      apiTool(
        'define_word',
        'Get dictionary definition of a word',
        {
          word: { type: 'string', description: 'Word to define' },
        },
        ['word'],
        async (args) => {
          try {
            const res = await fetch(
              `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(args.word)}`,
            );
            if (!res.ok) return JSON.stringify({ error: `Dictionary: ${res.status}` });
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) {
              return JSON.stringify({ error: 'Word not found' });
            }
            const entry = data[0];
            return JSON.stringify({
              word: entry.word,
              phonetic: entry.phonetic,
              meanings: entry.meanings?.slice(0, 3).map((m: any) => ({
                partOfSpeech: m.partOfSpeech,
                definitions: m.definitions?.slice(0, 2).map((d: any) => d.definition),
              })),
            });
          } catch (err: unknown) {
            return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      ),
    ],
  };
}

// ── Register all built-in service skills ─────────────────────────────────

export function registerBuiltInServiceSkills(): void {
  registerSkill(createWeatherSkill());
  registerSkill(createGitHubSkill());
  registerSkill(createFinanceSkill());
  registerSkill(createProductivitySkill());
  registerSkill(createCommunicationSkill());
  registerSkill(createMediaSkill());
  registerSkill(createKnowledgeSkill());
}
