import type {
  ExpoHostedWorkflowJobRecord,
  ExpoHostedWorkflowLogGroup,
  ExpoWorkflowFailureLog,
  ExpoWorkflowJobStep,
  ExpoWorkflowJobStatus,
} from "../contracts";
import { expoGraphqlRequest } from "../providers/expoGraphql";
import {
  extractFailureLogsFromErrorEntries,
  humanizeWorkflowPhase,
  isFailureConclusion,
  isFailureStatus,
  mergeFailureLogs,
  normalizeWorkflowConclusion,
} from "../logs/workflowFailures";
import {
  excerptWorkflowLogText,
  fetchDecompressedText,
  normalizeLogToken,
} from "../logs/workflowText";
import { trimToUndefined } from "../projectState";

const WORKFLOW_LOG_ERROR_PATTERNS = [
  /(^|\\s)(error|errors|fatal|exception|traceback)(\\s|:|$)/i,
  /(^|\\s)(failed|failure|failing)(\\s|:|$)/i,
  /(^|\\s)(assertionerror|typeerror|referenceerror|syntaxerror|module not found)(\\s|:|$)/i,
  /(^|\\s)(npm ERR!|yarn error|gradle.*failed|xcodebuild: error|command failed)(\\s|:|$)/i,
];
async function fetchExpoBuildLogFilesByIdAsync(
  token: string,
  buildId: string,
): Promise<string[] | undefined> {
  const data = await expoGraphqlRequest<{
    builds: {
      byId: {
        id: string;
        logFiles?: string[] | null;
      };
    };
  }>(
    token,
    `
    query ExpoBuildLogFilesById($buildId: ID!) {
      builds {
        byId(buildId: $buildId) {
          id
          logFiles
        }
      }
    }
  `,
    { buildId },
  );

  return data.builds.byId.logFiles || undefined;
}

function getExpoHostedWorkflowBuildId(job: ExpoHostedWorkflowJobRecord): string | undefined {
  const outputBuildId =
    job.outputs && typeof job.outputs.build_id === 'string'
      ? trimToUndefined(job.outputs.build_id)
      : undefined;
  return outputBuildId || trimToUndefined(job.turtleBuild?.id);
}

async function fetchExpoHostedWorkflowJobRawLogsAsync(
  token: string,
  job: ExpoHostedWorkflowJobRecord,
): Promise<string | undefined> {
  const turtleLogUrl = trimToUndefined(job.turtleJobRun?.logFileUrls?.[0]);
  const turtleLogs = await fetchDecompressedText(turtleLogUrl);
  if (turtleLogs) {
    return turtleLogs;
  }

  const directBuildLogUrl = trimToUndefined(job.turtleBuild?.logFiles?.[0]);
  const directBuildLogs = await fetchDecompressedText(directBuildLogUrl);
  if (directBuildLogs) {
    return directBuildLogs;
  }

  const buildId = getExpoHostedWorkflowBuildId(job);
  if (!buildId) {
    return undefined;
  }

  const buildLogFiles = await fetchExpoBuildLogFilesByIdAsync(token, buildId).catch(
    () => undefined,
  );
  return fetchDecompressedText(buildLogFiles?.[0]);
}

function parseExpoHostedWorkflowLogs(rawLogs: string): ExpoHostedWorkflowLogGroup[] {
  const groups = new Map<string, ExpoHostedWorkflowLogGroup>();
  let groupIndex = 0;

  rawLogs.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) {
      return;
    }

    try {
      const parsed = JSON.parse(line) as {
        time?: string | null;
        msg?: string | null;
        message?: string | null;
        result?: string | null;
        marker?: string | null;
        err?: unknown;
        phase?: string | null;
        buildStepId?: string | null;
        buildStepDisplayName?: string | null;
      };

      const key =
        trimToUndefined(parsed.buildStepId) ||
        trimToUndefined(parsed.buildStepDisplayName) ||
        trimToUndefined(parsed.phase) ||
        `raw-${groupIndex}`;
      const label =
        trimToUndefined(parsed.buildStepDisplayName) ||
        trimToUndefined(parsed.buildStepId) ||
        humanizeWorkflowPhase(parsed.phase) ||
        'Workflow log';
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          logLines: [],
        });
        groupIndex += 1;
      }

      const group = groups.get(key)!;
      const time = trimToUndefined(parsed.time) || null;
      group.startedAt = group.startedAt || time;
      group.completedAt = time || group.completedAt || null;

      const conclusion = normalizeWorkflowConclusion(parsed.result);
      if (conclusion && /end-step|END_PHASE/i.test(trimToUndefined(parsed.marker) || '')) {
        group.conclusion = conclusion;
      }

      group.logLines.push({
        time,
        msg: trimToUndefined(parsed.msg) || trimToUndefined(parsed.message) || '',
        result: trimToUndefined(parsed.result) || null,
        marker: trimToUndefined(parsed.marker) || null,
        err: parsed.err,
      });
    } catch {
      // Expo returns JSONL here. Ignore any malformed lines the same way the CLI does.
    }
  });

  return Array.from(groups.values()).filter((group) => group.logLines.length > 0);
}

function scoreExpoHostedWorkflowLogGroup(
  job: ExpoHostedWorkflowJobRecord,
  group: ExpoHostedWorkflowLogGroup,
): number {
  const normalizedLabel = normalizeLogToken(group.label);
  const text = group.logLines
    .map((line) => [line.msg, line.err ? JSON.stringify(line.err) : ''].filter(Boolean).join('\n'))
    .join('\n');
  let score = 0;

  if (isFailureConclusion(group.conclusion)) {
    score += 12;
  }
  if (isFailureStatus(job.status)) {
    score += 4;
  }
  if (normalizeLogToken(job.type).includes('build')) {
    score += 3;
  }
  if (
    normalizedLabel.includes('install dependencies') ||
    normalizedLabel.includes('node modules')
  ) {
    score += 8;
  }
  if (
    normalizedLabel.includes('build') ||
    normalizedLabel.includes('gradle') ||
    normalizedLabel.includes('xcode')
  ) {
    score += 6;
  }
  if (normalizedLabel.includes('expo doctor') || normalizedLabel.includes('prebuild')) {
    score += 4;
  }
  if (group.logLines.some((line) => line.err)) {
    score += 4;
  }

  score +=
    WORKFLOW_LOG_ERROR_PATTERNS.reduce(
      (count: number, pattern: RegExp) => count + (pattern.test(text) ? 1 : 0),
      0,
    ) * 4;
  return score;
}

function buildExpoHostedWorkflowGroupExcerpt(group: ExpoHostedWorkflowLogGroup): string {
  const text = group.logLines
    .map((line) => {
      const prefix = trimToUndefined(line.time);
      const errorPayload = line.err ? `\n${JSON.stringify(line.err)}` : '';
      return [prefix, line.msg].filter(Boolean).join(' ') + errorPayload;
    })
    .filter(Boolean)
    .join('\n');
  return excerptWorkflowLogText(text);
}

function buildExpoHostedWorkflowSteps(
  groups: ExpoHostedWorkflowLogGroup[],
): ExpoWorkflowJobStep[] | undefined {
  const steps = groups.map((group) => ({
    name: group.label,
    status: group.conclusion ? 'completed' : undefined,
    conclusion: group.conclusion,
    startedAt: group.startedAt || null,
    completedAt: group.completedAt || null,
  }));
  return steps.length ? steps : undefined;
}

function extractExpoHostedWorkflowJobFailureLogs(
  job: ExpoHostedWorkflowJobRecord,
  groups: ExpoHostedWorkflowLogGroup[],
  rawLogs?: string,
): ExpoWorkflowFailureLog[] | undefined {
  const rankedGroups = groups
    .map((group) => ({
      group,
      excerpt: buildExpoHostedWorkflowGroupExcerpt(group),
      score: scoreExpoHostedWorkflowLogGroup(job, group),
    }))
    .filter((entry) => Boolean(entry.excerpt))
    .sort(
      (left, right) =>
        right.score - left.score || left.group.label.localeCompare(right.group.label),
    );

  const selectedGroups = rankedGroups.filter((entry) => entry.score > 0).slice(0, 3);
  if (selectedGroups.length) {
    return selectedGroups.map((entry) => ({
      source: `${trimToUndefined(job.name) || 'Build'} / ${entry.group.label}`,
      excerpt: entry.excerpt,
    }));
  }

  const normalizedRawLogs = trimToUndefined(rawLogs);
  const fallbackExcerpt = normalizedRawLogs ? excerptWorkflowLogText(normalizedRawLogs) : undefined;
  if (!fallbackExcerpt) {
    return undefined;
  }

  return [
    {
      source: trimToUndefined(job.name) || 'Build',
      excerpt: fallbackExcerpt,
    },
  ];
}

async function inspectExpoHostedWorkflowJobAsync(
  token: string,
  job: ExpoHostedWorkflowJobRecord,
  options: { includeSteps: boolean; includeLogs: boolean },
): Promise<{ status: ExpoWorkflowJobStatus; failureLogs?: ExpoWorkflowFailureLog[] }> {
  const shouldFetchLogs = options.includeSteps || options.includeLogs;
  const rawLogs = shouldFetchLogs
    ? await fetchExpoHostedWorkflowJobRawLogsAsync(token, job).catch(() => undefined)
    : undefined;
  const groups = rawLogs ? parseExpoHostedWorkflowLogs(rawLogs) : [];
  const status: ExpoWorkflowJobStatus = {
    id: job.id,
    name: trimToUndefined(job.name) || trimToUndefined(job.key) || 'workflow-job',
    status: trimToUndefined(job.status) || null,
    conclusion: isFailureStatus(job.status)
      ? 'failure'
      : normalizeWorkflowConclusion(job.status) || null,
    startedAt: job.createdAt || null,
    completedAt: job.updatedAt || null,
    steps: options.includeSteps ? buildExpoHostedWorkflowSteps(groups) : undefined,
  };

  const failureLogs = options.includeLogs
    ? mergeFailureLogs(
        extractExpoHostedWorkflowJobFailureLogs(job, groups, rawLogs),
        extractFailureLogsFromErrorEntries(job.errors, status.name),
        extractFailureLogsFromErrorEntries(job.turtleJobRun?.errors, `${status.name} job error`),
        mergeFailureLogs(
          extractFailureLogsFromErrorEntries(
            job.turtleBuild?.error ? [job.turtleBuild.error] : undefined,
            `${status.name} build error`,
          ),
        ),
      )
    : undefined;

  return { status, failureLogs };
}

export { inspectExpoHostedWorkflowJobAsync };
