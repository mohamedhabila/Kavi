import { unzipSync } from 'fflate';
import type {
  ExpoHostedWorkflowErrorEntry,
  ExpoWorkflowFailureLog,
  ExpoWorkflowJobStatus,
} from '../contracts';
import type { ExpoProjectConfig } from '../../../types/remote';
import { getGitHubRequestHeaders } from '../../github/api';
import { trimToUndefined } from '../projectState';
import {
  decodeWorkflowTextBytes,
  excerptWorkflowLogText,
  fetchDecompressedText,
  normalizeLogToken,
} from './workflowText';

const WORKFLOW_LOG_ERROR_PATTERNS = [
  /(^|\s)(error|errors|fatal|exception|traceback)(\s|:|$)/i,
  /(^|\s)(failed|failure|failing)(\s|:|$)/i,
  /(^|\s)(assertionerror|typeerror|referenceerror|syntaxerror|module not found)(\s|:|$)/i,
  /(^|\s)(npm ERR!|yarn error|gradle.*failed|xcodebuild: error|command failed)(\s|:|$)/i,
];

function scoreGitHubFailureLog(
  path: string,
  text: string,
  failedJobs: Set<string>,
  failedSteps: Set<string>,
): number {
  const normalizedPath = normalizeLogToken(path);
  let score = 0;

  for (const failedJob of failedJobs) {
    if (failedJob && normalizedPath.includes(failedJob)) {
      score += 8;
    }
  }

  for (const failedStep of failedSteps) {
    if (failedStep && normalizedPath.includes(failedStep)) {
      score += 6;
    }
  }

  const errorMatches = WORKFLOW_LOG_ERROR_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
  score += errorMatches * 4;

  if (/\b(exit code|returned non-zero|command failed)\b/i.test(text)) {
    score += 3;
  }

  return score;
}

async function fetchGitHubWorkflowFailureLogs(
  repo: string,
  runId: string | number,
  token: string,
  jobs?: ExpoWorkflowJobStatus[],
): Promise<ExpoWorkflowFailureLog[] | undefined> {
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/logs`, {
    method: 'GET',
    headers: getGitHubRequestHeaders(token),
  });

  if (!response.ok) {
    return undefined;
  }

  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return undefined;
  }

  const failedJobs = new Set(
    (jobs || [])
      .filter((job) => Boolean(job.conclusion && job.conclusion !== 'success'))
      .map((job) => normalizeLogToken(job.name))
      .filter(Boolean),
  );
  const failedSteps = new Set(
    (jobs || [])
      .flatMap((job) => job.steps || [])
      .filter((step) => Boolean(step.conclusion && step.conclusion !== 'success'))
      .map((step) => normalizeLogToken(step.name))
      .filter(Boolean),
  );

  const rankedLogs = Object.entries(archive)
    .filter(([path, bytes]) => /\.txt$/i.test(path) && bytes.length > 0)
    .map(([path, bytes]) => {
      const text = decodeWorkflowTextBytes(bytes);
      return {
        path,
        excerpt: excerptWorkflowLogText(text),
        score: scoreGitHubFailureLog(path, text, failedJobs, failedSteps),
      };
    })
    .filter((entry) => Boolean(entry.excerpt))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  const selected = rankedLogs.filter((entry) => entry.score > 0).slice(0, 3);
  const fallback = !selected.length && rankedLogs.length ? rankedLogs.slice(-1) : selected;

  if (!fallback.length) {
    return undefined;
  }

  return fallback.map((entry) => ({
    source: entry.path,
    excerpt: entry.excerpt,
  }));
}

function getExpoWorkflowDispatchInputs(
  project: ExpoProjectConfig,
  action: 'build' | 'update' | 'submit' | 'deploy-web',
  args: {
    platform?: 'android' | 'ios' | 'all';
    profile?: string;
    branch?: string;
    message?: string;
    alias?: string;
  },
): Record<string, unknown> {
  return {
    action,
    platform: args.platform || 'android',
    profile: args.profile || project.defaultBuildProfile || 'production',
    branch: args.branch || project.defaultUpdateBranch || 'production',
    message: args.message || `Triggered from Kavi for ${project.name}`,
    alias: args.alias || 'production',
  };
}

function normalizeExpoWorkflowGitRef(value: string | undefined): string | undefined {
  const normalized = trimToUndefined(value)
    ?.replace(/^refs\/heads\//i, '')
    .replace(/^heads\//i, '')
    .replace(/^origin\//i, '');
  return normalized || undefined;
}

function normalizeWorkflowConclusion(value?: string | null): string | undefined {
  const normalized = trimToUndefined(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (['success', 'succeeded', 'completed', 'pass', 'passed'].includes(normalized)) {
    return 'success';
  }
  if (['fail', 'failed', 'failure', 'error', 'errored'].includes(normalized)) {
    return 'failure';
  }
  if (['cancelled', 'canceled', 'skipped'].includes(normalized)) {
    return normalized;
  }
  return normalized;
}

function isFailureConclusion(value?: string | null): boolean {
  return normalizeWorkflowConclusion(value) === 'failure';
}

function isFailureStatus(value?: string | null): boolean {
  return ['FAILURE', 'FAILED', 'ERRORED', 'ERROR'].includes(
    trimToUndefined(value)?.toUpperCase() || '',
  );
}

function humanizeWorkflowPhase(value?: string | null): string | undefined {
  const normalized = trimToUndefined(value);
  if (!normalized) {
    return undefined;
  }
  return normalized
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function extractFailureLogsFromErrorEntries(
  entries:
    | Array<ExpoHostedWorkflowErrorEntry | { message?: string | null; errorCode?: string | null }>
    | undefined
    | null,
  fallbackSource: string,
): ExpoWorkflowFailureLog[] | undefined {
  const failureLogs = (entries || [])
    .map((entry) => {
      const source =
        trimToUndefined('title' in entry ? entry.title : undefined) ||
        trimToUndefined('errorCode' in entry ? entry.errorCode : undefined) ||
        fallbackSource;
      const excerpt = [
        trimToUndefined('title' in entry ? entry.title : undefined),
        trimToUndefined(entry.message),
      ]
        .filter(Boolean)
        .join('\n')
        .trim();
      if (!excerpt) {
        return null;
      }

      return { source, excerpt } satisfies ExpoWorkflowFailureLog;
    })
    .filter((entry): entry is ExpoWorkflowFailureLog => Boolean(entry));

  return failureLogs.length ? failureLogs : undefined;
}

function mergeFailureLogs(
  ...groups: Array<ExpoWorkflowFailureLog[] | undefined>
): ExpoWorkflowFailureLog[] | undefined {
  const merged: ExpoWorkflowFailureLog[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const entry of group || []) {
      const key = `${entry.source}\n${entry.excerpt}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(entry);
      if (merged.length >= 6) {
        return merged;
      }
    }
  }

  return merged.length ? merged : undefined;
}

function hasLikelyMissingDependencySignal(
  failureLogs: ExpoWorkflowFailureLog[] | undefined,
): boolean {
  const haystack = (failureLogs || [])
    .map((entry) => `${entry.source}\n${entry.excerpt}`)
    .join('\n');
  return /(cannot find module|module not found|unable to resolve module|node_modules|npm err!( code e404)? .*not found|yarn error.*not found|pnpm.*not found|package .* not found|could not resolve|cocoapods could not find compatible versions|pod install|gradle.*could not resolve)/i.test(
    haystack,
  );
}

function getExpoBuildFailureGuidance(
  failureLogs: ExpoWorkflowFailureLog[] | undefined,
  buildStageLogsIncluded: boolean,
): string | undefined {
  if (!failureLogs?.length) {
    return undefined;
  }

  const dependencyHint = hasLikelyMissingDependencySignal(failureLogs)
    ? 'The failure excerpts already point at missing or unresolved dependencies. Verify the package is declared and that the workflow installs dependencies before building.'
    : 'The most frequent Expo build failure is missing or stale dependencies. Verify the workflow ran eas/install_node_modules or the correct npm, yarn, or pnpm install step before the failing build stage.';

  return buildStageLogsIncluded
    ? `Build-stage failure excerpts are included inline. ${dependencyHint}`
    : `Failure excerpts are included inline. ${dependencyHint}`;
}

export {
  fetchDecompressedText,
  fetchGitHubWorkflowFailureLogs,
  getExpoBuildFailureGuidance,
  getExpoWorkflowDispatchInputs,
  normalizeExpoWorkflowGitRef,
  normalizeWorkflowConclusion,
  isFailureConclusion,
  isFailureStatus,
  humanizeWorkflowPhase,
  extractFailureLogsFromErrorEntries,
  mergeFailureLogs,
};
