const EXPO_ADVISORY_CHAR_LIMIT = 320;
const EXPO_FAILURE_LOG_LIMIT = 3;
const EXPO_FAILURE_LOG_LINE_LIMIT = 4;
const EXPO_FAILURE_LOG_CHAR_LIMIT = 360;
const EXPO_OUTPUT_LINE_LIMIT = 6;
const EXPO_OUTPUT_CHAR_LIMIT = 480;
const EXPO_JOB_LIMIT = 4;
const EXPO_STEP_LIMIT = 4;
const EXPO_RUN_LIMIT = 5;
const EXPO_PUBLIC_URL_LIMIT = 3;
const EXPO_WORKFLOW_FILE_LIMIT = 4;
const EXPO_GRAPHQL_ERROR_LIMIT = 3;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function truncateExpoText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const ellipsis = '...';
  return `${value.slice(0, Math.max(0, maxChars - ellipsis.length)).trimEnd()}${ellipsis}`;
}

export function trimExpoAdvisoryText(
  value: unknown,
  maxChars = EXPO_ADVISORY_CHAR_LIMIT,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? truncateExpoText(trimmed, maxChars) : undefined;
}

function selectExpoRelevantLogLines(value: string, maxLines: number, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return truncateExpoText(trimmed, maxChars);
  }

  const interestingPattern =
    /(error|failed|failure|exception|unable|cannot|can't|could not|not found|err!|traceback|exit code|gradle task|resolve module|missing)/i;
  const interestingLines = lines.filter((line) => interestingPattern.test(line));
  const sourceLines = interestingLines.length > 0 ? interestingLines : lines.slice(-maxLines);
  const deduped = Array.from(new Set(sourceLines));
  return truncateExpoText(deduped.slice(0, maxLines).join('\n'), maxChars);
}

export function compactExpoStringArray(
  value: unknown,
  maxItems = EXPO_WORKFLOW_FILE_LIMIT,
  maxChars = 120,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const compacted = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, maxItems)
    .map((entry) => truncateExpoText(entry.trim(), maxChars));

  return compacted.length > 0 ? compacted : undefined;
}

export function compactExpoReadiness(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  if (typeof value.launchable === 'boolean') {
    result.launchable = value.launchable;
  }
  if (typeof value.reason === 'string' && value.reason.trim()) {
    result.reason = value.reason.trim();
  }
  if (typeof value.label === 'string' && value.label.trim()) {
    result.label = value.label.trim();
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function compactExpoSelection(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  if (typeof value.doNotRepeatWithoutRefresh === 'boolean') {
    result.doNotRepeatWithoutRefresh = value.doNotRepeatWithoutRefresh;
  }
  if (typeof value.defaultProjectId === 'string' && value.defaultProjectId.trim()) {
    result.defaultProjectId = value.defaultProjectId.trim();
  }
  if (typeof value.defaultProjectFullName === 'string' && value.defaultProjectFullName.trim()) {
    result.defaultProjectFullName = value.defaultProjectFullName.trim();
  }
  if (typeof value.nextSuggestedTool === 'string' && value.nextSuggestedTool.trim()) {
    result.nextSuggestedTool = value.nextSuggestedTool.trim();
  }
  if (isRecord(value.nextSuggestedArgs) && Object.keys(value.nextSuggestedArgs).length > 0) {
    result.nextSuggestedArgs = value.nextSuggestedArgs;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function compactExpoProjectListing(project: unknown): Record<string, unknown> | undefined {
  if (!isRecord(project)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  if (typeof project.id === 'string' && project.id.trim()) result.id = project.id.trim();
  if (typeof project.easProjectId === 'string' && project.easProjectId.trim())
    result.easProjectId = project.easProjectId.trim();
  if (typeof project.name === 'string' && project.name.trim()) result.name = project.name.trim();
  if (typeof project.fullName === 'string' && project.fullName.trim())
    result.fullName = project.fullName.trim();
  if (typeof project.owner === 'string' && project.owner.trim())
    result.owner = project.owner.trim();
  if (typeof project.slug === 'string' && project.slug.trim()) result.slug = project.slug.trim();
  if (typeof project.accountId === 'string' && project.accountId.trim())
    result.accountId = project.accountId.trim();
  if (typeof project.accountName === 'string' && project.accountName.trim())
    result.accountName = project.accountName.trim();
  if (typeof project.source === 'string' && project.source.trim())
    result.source = project.source.trim();
  if (typeof project.mode === 'string' && project.mode.trim()) result.mode = project.mode.trim();
  if (typeof project.repoFullName === 'string' && project.repoFullName.trim())
    result.repoFullName = project.repoFullName.trim();
  if (typeof project.repoDefaultBranch === 'string' && project.repoDefaultBranch.trim())
    result.repoDefaultBranch = project.repoDefaultBranch.trim();
  if (typeof project.lastSyncedAt === 'number') result.lastSyncedAt = project.lastSyncedAt;

  const availableWorkflowFiles = compactExpoStringArray(project.availableWorkflowFiles);
  if (availableWorkflowFiles) {
    result.availableWorkflowFiles = availableWorkflowFiles;
  }

  const readiness = compactExpoReadiness(project.readiness);
  if (readiness) {
    result.readiness = readiness;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function compactExpoProjectStatus(project: unknown): Record<string, unknown> | undefined {
  if (!isRecord(project)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  if (typeof project.id === 'string' && project.id.trim()) result.id = project.id.trim();
  if (typeof project.easProjectId === 'string' && project.easProjectId.trim())
    result.easProjectId = project.easProjectId.trim();
  if (typeof project.name === 'string' && project.name.trim()) result.name = project.name.trim();
  if (typeof project.fullName === 'string' && project.fullName.trim())
    result.fullName = project.fullName.trim();
  if (typeof project.mode === 'string' && project.mode.trim()) result.mode = project.mode.trim();
  if (typeof project.source === 'string' && project.source.trim())
    result.source = project.source.trim();
  if (typeof project.repoFullName === 'string' && project.repoFullName.trim())
    result.repoFullName = project.repoFullName.trim();
  if (typeof project.repoDefaultBranch === 'string' && project.repoDefaultBranch.trim())
    result.repoDefaultBranch = project.repoDefaultBranch.trim();
  if (typeof project.workflowFile === 'string' && project.workflowFile.trim())
    result.workflowFile = project.workflowFile.trim();
  if (typeof project.workflowRef === 'string' && project.workflowRef.trim())
    result.workflowRef = project.workflowRef.trim();

  const availableWorkflowFiles = compactExpoStringArray(project.availableWorkflowFiles);
  if (availableWorkflowFiles) {
    result.availableWorkflowFiles = availableWorkflowFiles;
  }

  const platforms = compactExpoStringArray(project.platforms, 4, 40);
  if (platforms) {
    result.platforms = platforms;
  }

  const readiness = compactExpoReadiness(project.readiness);
  if (readiness) {
    result.readiness = readiness;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function compactExpoWorkflowRun(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  if (value.id !== undefined) result.id = value.id;
  if (typeof value.status === 'string' && value.status.trim()) result.status = value.status.trim();
  if (
    (typeof value.conclusion === 'string' && value.conclusion.trim()) ||
    value.conclusion === null
  ) {
    result.conclusion = value.conclusion;
  }
  if (typeof value.url === 'string' && value.url.trim()) result.url = value.url.trim();
  if ((typeof value.createdAt === 'string' && value.createdAt.trim()) || value.createdAt === null) {
    result.createdAt = value.createdAt;
  }
  if ((typeof value.updatedAt === 'string' && value.updatedAt.trim()) || value.updatedAt === null) {
    result.updatedAt = value.updatedAt;
  }
  if (
    (typeof value.headBranch === 'string' && value.headBranch.trim()) ||
    value.headBranch === null
  ) {
    result.headBranch = value.headBranch;
  }
  if ((typeof value.event === 'string' && value.event.trim()) || value.event === null) {
    result.event = value.event;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function compactExpoWorkflowSteps(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const steps = value.filter(isRecord);
  if (steps.length === 0) {
    return undefined;
  }

  const interestingSteps = steps.filter((step) => {
    const conclusion =
      typeof step.conclusion === 'string' ? step.conclusion.trim().toLowerCase() : '';
    const status = typeof step.status === 'string' ? step.status.trim().toLowerCase() : '';
    return (
      (conclusion && conclusion !== 'success') ||
      (status && !['completed', 'success'].includes(status))
    );
  });

  const selectedSteps = (
    interestingSteps.length > 0 ? interestingSteps : steps.slice(-EXPO_STEP_LIMIT)
  ).slice(0, EXPO_STEP_LIMIT);

  return selectedSteps.map((step) => {
    const result: Record<string, unknown> = {};
    if (step.number !== undefined) result.number = step.number;
    if (typeof step.name === 'string' && step.name.trim()) result.name = step.name.trim();
    if (typeof step.status === 'string' && step.status.trim()) result.status = step.status.trim();
    if (
      (typeof step.conclusion === 'string' && step.conclusion.trim()) ||
      step.conclusion === null
    ) {
      result.conclusion = step.conclusion;
    }
    return result;
  });
}

export function compactExpoWorkflowJobs(
  value: unknown,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const jobs = value.filter(isRecord);
  if (jobs.length === 0) {
    return undefined;
  }

  const interestingJobs = jobs.filter((job) => {
    const conclusion =
      typeof job.conclusion === 'string' ? job.conclusion.trim().toLowerCase() : '';
    const status = typeof job.status === 'string' ? job.status.trim().toLowerCase() : '';
    return (
      (conclusion && conclusion !== 'success') ||
      (status && !['completed', 'success'].includes(status))
    );
  });

  const selectedJobs = (interestingJobs.length > 0 ? interestingJobs : jobs).slice(
    0,
    EXPO_JOB_LIMIT,
  );

  return selectedJobs.map((job) => {
    const result: Record<string, unknown> = {};
    if (job.id !== undefined) result.id = job.id;
    if (typeof job.name === 'string' && job.name.trim()) result.name = job.name.trim();
    if (typeof job.status === 'string' && job.status.trim()) result.status = job.status.trim();
    if ((typeof job.conclusion === 'string' && job.conclusion.trim()) || job.conclusion === null) {
      result.conclusion = job.conclusion;
    }
    if (typeof job.url === 'string' && job.url.trim()) result.url = job.url.trim();

    const steps = compactExpoWorkflowSteps(job.steps);
    if (steps) {
      result.steps = steps;
    }

    return result;
  });
}

export function compactExpoWorkflowRuns(
  value: unknown,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const compacted = value
    .slice(0, EXPO_RUN_LIMIT)
    .map((run) => compactExpoWorkflowRun(run))
    .filter((run): run is Record<string, unknown> => !!run);

  return compacted.length > 0 ? compacted : undefined;
}

export function compactExpoFailureLogs(
  value: unknown,
): Array<{ source: string; excerpt: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const compacted = value
    .filter(isRecord)
    .map((entry) => {
      const source = trimExpoAdvisoryText(entry.source, 80) || 'failure';
      const excerpt =
        typeof entry.excerpt === 'string'
          ? selectExpoRelevantLogLines(
              entry.excerpt,
              EXPO_FAILURE_LOG_LINE_LIMIT,
              EXPO_FAILURE_LOG_CHAR_LIMIT,
            )
          : '';

      return excerpt ? { source, excerpt } : null;
    })
    .filter((entry): entry is { source: string; excerpt: string } => !!entry)
    .slice(0, EXPO_FAILURE_LOG_LIMIT);

  return compacted.length > 0 ? compacted : undefined;
}

export function summarizeExpoFailureLogs(
  failureLogs: Array<{ source: string; excerpt: string }> | undefined,
): string | undefined {
  const first = failureLogs?.[0];
  if (!first) {
    return undefined;
  }

  return truncateExpoText(`${first.source}: ${first.excerpt.replace(/\s*\n\s*/g, ' | ')}`, 220);
}

export function compactExpoPublicUrls(
  value: unknown,
): Array<{ label: string; url: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const compacted = value
    .filter(isRecord)
    .map((entry) => {
      const label = trimExpoAdvisoryText(entry.label, 30);
      const url = trimExpoAdvisoryText(entry.url, 200);
      return label && url ? { label, url } : null;
    })
    .filter((entry): entry is { label: string; url: string } => !!entry)
    .slice(0, EXPO_PUBLIC_URL_LIMIT);

  return compacted.length > 0 ? compacted : undefined;
}

export function compactExpoChecks(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const compacted = value
    .filter(isRecord)
    .map((entry) => {
      const result: Record<string, unknown> = {};
      if (typeof entry.stage === 'string' && entry.stage.trim()) result.stage = entry.stage.trim();
      if (typeof entry.ok === 'boolean') result.ok = entry.ok;
      if (typeof entry.message === 'string' && entry.message.trim()) {
        result.message = truncateExpoText(entry.message.trim(), 180);
      }
      return Object.keys(result).length > 0 ? result : null;
    })
    .filter((entry): entry is Record<string, unknown> => !!entry);

  return compacted.length > 0 ? compacted : undefined;
}

export function compactExpoOutputExcerpt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  return selectExpoRelevantLogLines(value, EXPO_OUTPUT_LINE_LIMIT, EXPO_OUTPUT_CHAR_LIMIT);
}

export function compactExpoGraphqlErrors(
  value: unknown,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const compacted = value
    .filter(isRecord)
    .map((entry) => {
      const result: Record<string, unknown> = {};
      if (typeof entry.message === 'string' && entry.message.trim()) {
        result.message = truncateExpoText(entry.message.trim(), 180);
      }
      if (typeof entry.path === 'string' && entry.path.trim()) {
        result.path = entry.path.trim();
      }
      if (typeof entry.code === 'string' && entry.code.trim()) {
        result.code = entry.code.trim();
      }
      return Object.keys(result).length > 0 ? result : null;
    })
    .filter((entry): entry is Record<string, unknown> => !!entry)
    .slice(0, EXPO_GRAPHQL_ERROR_LIMIT);

  return compacted.length > 0 ? compacted : undefined;
}
