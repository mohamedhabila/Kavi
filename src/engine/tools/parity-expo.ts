import { useSettingsStore } from '../../store/useSettingsStore';
import {
  createExpoProject,
  getExpoAutomationSummary,
  getExpoProjectDisplayOwner,
  getExpoProjectExecutionMode,
  getExpoProjectReadiness,
  getExpoProjectReadinessLabel,
  inspectExpoWorkflowRun,
  listExpoWorkflowRuns,
  listExpoProjects,
  probeExpoProject,
  runExpoGraphqlQuery,
  resolveExpoAccount,
  resolveExpoProject,
  runExpoProjectAction,
  waitForExpoWorkflowRun,
} from '../../services/expo/eas';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getExpoProjectAutomationContext(projectId: string) {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProject(projectId, settings);
  const account = resolveExpoAccount(project.accountId, settings);

  return {
    project,
    account,
    automation: getExpoAutomationSummary(project, account),
  };
}

function withExpoAutomation<T extends object>(
  projectId: string,
  payload: T,
): T & {
  preferredFlow: ReturnType<typeof getExpoAutomationSummary>['preferredFlow'];
  automation: ReturnType<typeof getExpoAutomationSummary>;
} {
  const { automation } = getExpoProjectAutomationContext(projectId);
  return {
    ...payload,
    preferredFlow: automation.preferredFlow,
    automation,
  };
}

function getExpoAutomationGuidance(
  automation: ReturnType<typeof getExpoAutomationSummary>,
): string {
  return automation.recommendedFlow.join(' ');
}

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

function truncateExpoText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const ellipsis = '...';
  return `${value.slice(0, Math.max(0, maxChars - ellipsis.length)).trimEnd()}${ellipsis}`;
}

function trimExpoAdvisoryText(
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

function compactExpoStringArray(
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

function compactExpoReadiness(value: unknown): Record<string, unknown> | undefined {
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

function compactExpoSelection(value: unknown): Record<string, unknown> | undefined {
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

function compactExpoProjectListing(project: unknown): Record<string, unknown> | undefined {
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

function compactExpoProjectStatus(project: unknown): Record<string, unknown> | undefined {
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

function compactExpoWorkflowRun(value: unknown): Record<string, unknown> | undefined {
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

function compactExpoWorkflowJobs(value: unknown): Array<Record<string, unknown>> | undefined {
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

function compactExpoWorkflowRuns(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const compacted = value
    .slice(0, EXPO_RUN_LIMIT)
    .map((run) => compactExpoWorkflowRun(run))
    .filter((run): run is Record<string, unknown> => !!run);

  return compacted.length > 0 ? compacted : undefined;
}

function compactExpoFailureLogs(
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

function summarizeExpoFailureLogs(
  failureLogs: Array<{ source: string; excerpt: string }> | undefined,
): string | undefined {
  const first = failureLogs?.[0];
  if (!first) {
    return undefined;
  }

  return truncateExpoText(`${first.source}: ${first.excerpt.replace(/\s*\n\s*/g, ' | ')}`, 220);
}

function compactExpoPublicUrls(value: unknown): Array<{ label: string; url: string }> | undefined {
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

function compactExpoChecks(value: unknown): Array<Record<string, unknown>> | undefined {
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

function compactExpoOutputExcerpt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  return selectExpoRelevantLogLines(value, EXPO_OUTPUT_LINE_LIMIT, EXPO_OUTPUT_CHAR_LIMIT);
}

function compactExpoGraphqlErrors(value: unknown): Array<Record<string, unknown>> | undefined {
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

function getExpoToolActionLabel(toolName: string): string {
  switch (toolName) {
    case 'expo_eas_build':
      return 'build';
    case 'expo_eas_update':
      return 'update';
    case 'expo_eas_submit':
      return 'submit';
    case 'expo_eas_deploy_web':
      return 'deploy';
    default:
      return 'expo';
  }
}

function buildExpoResultSummary<T extends object>(toolName: string, value: T): string | undefined {
  const payload = value as Record<string, unknown>;
  const note = trimExpoAdvisoryText(payload.note, 220);
  const guidance = trimExpoAdvisoryText(payload.guidance, 220);
  const failureLogs = compactExpoFailureLogs(payload.failureLogs);
  const failureSummary = summarizeExpoFailureLogs(failureLogs);
  const workflowRun = compactExpoWorkflowRun(payload.workflowRun);

  if ((payload.status === 'unsupported' || payload.status === 'not_found') && note) {
    return note;
  }

  switch (toolName) {
    case 'expo_eas_list_projects': {
      const count =
        typeof payload.count === 'number'
          ? payload.count
          : Array.isArray(payload.projects)
            ? payload.projects.length
            : 0;
      const selection = compactExpoSelection(payload.selection);
      if (count <= 0) {
        return guidance || 'No synced Expo projects found.';
      }
      if (typeof selection?.defaultProjectId === 'string') {
        return `Found ${count} Expo project${count === 1 ? '' : 's'}. Default project: ${selection.defaultProjectId}.`;
      }
      return `Found ${count} Expo project${count === 1 ? '' : 's'}.`;
    }

    case 'expo_eas_create_project': {
      const project = compactExpoProjectListing(payload.project);
      const name =
        typeof project?.fullName === 'string'
          ? project.fullName
          : typeof project?.name === 'string'
            ? project.name
            : 'Expo project';
      return guidance ? `${name} created. ${guidance}` : `${name} created.`;
    }

    case 'expo_eas_status': {
      const project = compactExpoProjectStatus(payload.project);
      const name =
        typeof project?.fullName === 'string'
          ? project.fullName
          : typeof project?.name === 'string'
            ? project.name
            : 'Expo project';
      const readiness =
        isRecord(project?.readiness) && typeof project?.readiness?.label === 'string'
          ? project.readiness.label
          : undefined;
      return readiness ? `${name}: ${readiness}.` : `${name} status available.`;
    }

    case 'expo_eas_probe':
      return typeof payload.message === 'string' && payload.message.trim()
        ? truncateExpoText(payload.message.trim(), 220)
        : payload.ok === true
          ? 'Expo project probe succeeded.'
          : 'Expo project probe failed.';

    case 'expo_eas_build':
    case 'expo_eas_update':
    case 'expo_eas_submit':
    case 'expo_eas_deploy_web': {
      const action = getExpoToolActionLabel(toolName);
      if (workflowRun) {
        const status = typeof workflowRun.status === 'string' ? workflowRun.status : 'started';
        const conclusion =
          typeof workflowRun.conclusion === 'string' && workflowRun.conclusion.trim()
            ? ` (${workflowRun.conclusion})`
            : '';
        const runLabel = workflowRun.id !== undefined ? ` ${String(workflowRun.id)}` : '';
        return `${action[0].toUpperCase()}${action.slice(1)} workflow${runLabel}: ${status}${conclusion}.${failureSummary ? ` ${failureSummary}` : ''}`;
      }

      const outputExcerpt = compactExpoOutputExcerpt(payload.outputExcerpt ?? payload.output);
      if (outputExcerpt) {
        return `${action[0].toUpperCase()}${action.slice(1)} output: ${truncateExpoText(outputExcerpt.replace(/\s*\n\s*/g, ' | '), 220)}`;
      }

      return note || guidance || `${action[0].toUpperCase()}${action.slice(1)} result available.`;
    }

    case 'expo_eas_workflow_runs': {
      const runs = compactExpoWorkflowRuns(payload.runs);
      if (runs?.length) {
        const latest = runs[0];
        const status = typeof latest.status === 'string' ? latest.status : 'unknown';
        const conclusion =
          typeof latest.conclusion === 'string' && latest.conclusion.trim()
            ? ` (${latest.conclusion})`
            : '';
        return `Latest workflow run ${String(latest.id)}: ${status}${conclusion}.`;
      }
      return note || guidance || 'No workflow runs found.';
    }

    case 'expo_eas_workflow_status':
    case 'expo_eas_workflow_wait': {
      if (workflowRun) {
        const status = typeof workflowRun.status === 'string' ? workflowRun.status : 'unknown';
        const conclusion =
          typeof workflowRun.conclusion === 'string' && workflowRun.conclusion.trim()
            ? ` (${workflowRun.conclusion})`
            : '';
        const waited =
          typeof payload.waitedMs === 'number'
            ? ` after ${Math.round(payload.waitedMs / 1000)}s`
            : '';
        const timeoutSuffix =
          payload.timedOut === true ? ' Timed out before a terminal state.' : '';
        return `Workflow ${String(workflowRun.id)}: ${status}${conclusion}${waited}.${timeoutSuffix}${failureSummary ? ` ${failureSummary}` : ''}`.trim();
      }
      return failureSummary || note || guidance || 'Workflow status available.';
    }

    case 'expo_eas_graphql': {
      const errors = compactExpoGraphqlErrors(payload.errors);
      if (errors?.length && typeof errors[0].message === 'string') {
        return `Expo GraphQL returned ${errors.length} error${errors.length === 1 ? '' : 's'}: ${errors[0].message}`;
      }
      return guidance || 'Expo GraphQL result available.';
    }

    default:
      return failureSummary || note || guidance || 'Expo result available.';
  }
}

function normalizeExpoToolPayload<T extends object>(
  toolName: string,
  value: T,
  options?: {
    preferredFlow?: ReturnType<typeof getExpoAutomationSummary>['preferredFlow'];
  },
): Record<string, unknown> {
  const payload = value as Record<string, unknown>;
  const note = trimExpoAdvisoryText(payload.note, 240);
  const guidance = trimExpoAdvisoryText(payload.guidance, EXPO_ADVISORY_CHAR_LIMIT);
  const outputExcerpt = compactExpoOutputExcerpt(payload.output);
  const failureLogs = compactExpoFailureLogs(payload.failureLogs);
  const summary = buildExpoResultSummary(toolName, {
    ...payload,
    ...(note ? { note } : {}),
    ...(guidance ? { guidance } : {}),
    ...(outputExcerpt ? { outputExcerpt } : {}),
    ...(failureLogs ? { failureLogs } : {}),
  });
  const normalized: Record<string, unknown> = {};

  if (summary) normalized.summary = summary;
  if (typeof payload.status === 'string') normalized.status = payload.status;
  if (typeof payload.ok === 'boolean') normalized.ok = payload.ok;
  if (typeof payload.message === 'string' && payload.message.trim()) {
    normalized.message = truncateExpoText(payload.message.trim(), 220);
  }
  if (typeof payload.count === 'number') normalized.count = payload.count;
  if (typeof payload.projectId === 'string' && payload.projectId.trim())
    normalized.projectId = payload.projectId.trim();
  if (typeof payload.projectName === 'string' && payload.projectName.trim())
    normalized.projectName = payload.projectName.trim();
  if (typeof payload.mode === 'string' && payload.mode.trim())
    normalized.mode = payload.mode.trim();
  if (options?.preferredFlow) normalized.preferredFlow = options.preferredFlow;
  if (typeof payload.jobId === 'string' && payload.jobId.trim())
    normalized.jobId = payload.jobId.trim();
  if (typeof payload.command === 'string' && payload.command.trim()) {
    normalized.command = truncateExpoText(payload.command.trim(), 220);
  }

  const selection = compactExpoSelection(payload.selection);
  if (selection) normalized.selection = selection;

  if (Array.isArray(payload.projects)) {
    const projects = payload.projects
      .map((project) => compactExpoProjectListing(project))
      .filter((project): project is Record<string, unknown> => !!project);
    if (projects.length > 0) {
      normalized.projects = projects;
    }
  }

  if (payload.project !== undefined) {
    const project =
      toolName === 'expo_eas_status'
        ? compactExpoProjectStatus(payload.project)
        : compactExpoProjectListing(payload.project);
    if (project) {
      normalized.project = project;
    }
  }

  const checks = compactExpoChecks(payload.checks);
  if (checks) normalized.checks = checks;

  const workflowRun = compactExpoWorkflowRun(payload.workflowRun);
  if (workflowRun) normalized.workflowRun = workflowRun;

  const runs = compactExpoWorkflowRuns(payload.runs);
  if (runs) normalized.runs = runs;

  const jobs = compactExpoWorkflowJobs(payload.jobs);
  if (jobs) normalized.jobs = jobs;

  if (typeof payload.logArchiveUrl === 'string' && payload.logArchiveUrl.trim()) {
    normalized.logArchiveUrl = payload.logArchiveUrl.trim();
  }
  if (outputExcerpt) normalized.outputExcerpt = outputExcerpt;
  if (failureLogs) normalized.failureLogs = failureLogs;

  const publicUrls = compactExpoPublicUrls(payload.publicUrls);
  if (publicUrls) normalized.publicUrls = publicUrls;

  if (typeof payload.checkedAt === 'number') normalized.checkedAt = payload.checkedAt;
  if (typeof payload.waitedMs === 'number') normalized.waitedMs = payload.waitedMs;
  if (typeof payload.timedOut === 'boolean') normalized.timedOut = payload.timedOut;
  if (typeof payload.partial === 'boolean') normalized.partial = payload.partial;

  const graphqlErrors = compactExpoGraphqlErrors(payload.errors);
  if (graphqlErrors) normalized.errors = graphqlErrors;
  if (toolName === 'expo_eas_graphql' && payload.data !== undefined) {
    normalized.data = payload.data;
  }

  if (note) normalized.note = note;
  if (guidance) normalized.guidance = guidance;

  return normalized;
}

type ExpoListedProject = Awaited<ReturnType<typeof listExpoProjects>>[number];

function selectSuggestedExpoProject(projects: ExpoListedProject[]): ExpoListedProject | undefined {
  const readyProjects = projects.filter((project) => project.readiness.launchable);
  if (readyProjects.length === 1) {
    return readyProjects[0];
  }
  if (projects.length === 1) {
    return projects[0];
  }
  return undefined;
}

function buildExpoListProjectsSelection(projects: ExpoListedProject[]) {
  const suggestedProject = selectSuggestedExpoProject(projects);
  return {
    doNotRepeatWithoutRefresh: true,
    ...(suggestedProject
      ? {
          defaultProjectId: suggestedProject.id,
          defaultProjectFullName: suggestedProject.fullName,
          nextSuggestedTool: 'expo_eas_status',
          nextSuggestedArgs: {
            projectId: suggestedProject.id,
          },
        }
      : {}),
  };
}

export async function executeExpoEasListProjects(args: {
  accountId?: string;
  refresh?: boolean;
}): Promise<string> {
  const projects = await listExpoProjects({
    accountId: args.accountId,
    refresh: args.refresh,
  });
  const selection = buildExpoListProjectsSelection(projects);

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_list_projects',
      {
        status: 'ok',
        count: projects.length,
        projects,
        ...(projects.length > 0 ? { selection } : {}),
        guidance: projects.length
          ? selection.defaultProjectId
            ? `Do not call expo_eas_list_projects again with the same arguments unless you need refresh=true or a different account. Reuse projectId "${selection.defaultProjectId}" (or ${selection.defaultProjectFullName}) in expo_eas_status, expo_eas_probe, or the expo_eas_workflow_* monitoring tools.`
            : 'Do not call expo_eas_list_projects again with the same arguments unless you need refresh=true or a different account. Choose one returned project and inspect it with expo_eas_status before taking further Expo actions.'
          : 'No synced Expo projects were found. Link an Expo account with a valid token, then either call expo_eas_create_project to create one or create/link a project in Expo and call expo_eas_list_projects with refresh=true.',
      },
      {
        preferredFlow: 'commit-driven-eas-workflow',
      },
    ),
  );
}

export async function executeExpoEasCreateProject(args: {
  accountId?: string;
  name: string;
  slug?: string;
}): Promise<string> {
  const project = await createExpoProject(args);
  const automation = getExpoProjectAutomationContext(project.id).automation;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_create_project',
      {
        status: 'ok',
        project,
        guidance: project.readiness.launchable
          ? getExpoAutomationGuidance(automation)
          : 'Project created and synced. If it is not launchable yet, link the GitHub repository in Expo and add .eas/workflows/*.yml on the target branch, or configure direct SSH execution as a fallback.',
      },
      {
        preferredFlow: automation.preferredFlow,
      },
    ),
  );
}

export async function executeExpoEasStatus(args: { projectId: string }): Promise<string> {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProject(args.projectId, settings);
  const account = resolveExpoAccount(project.accountId, settings);
  const readiness = getExpoProjectReadiness(project, account, settings);
  const automation = getExpoAutomationSummary(project, account);

  const projectGuidance = readiness.launchable
    ? automation.preferredFlow === 'commit-driven-eas-workflow'
      ? `Project is ready for repository-driven EAS Workflows. Keep ${automation.workflowFile || '.eas/workflows/*.yml'} on the target branch, push a commit to ${automation.recommendedBranch} or another matched branch, then monitor the automatically triggered run.`
      : getExpoAutomationGuidance(automation)
    : readiness.reason === 'missing-linked-repo'
      ? 'Link a GitHub repository to this Expo project in the Expo dashboard so EAS Workflows can react to commits, or configure direct SSH execution as a fallback.'
      : readiness.reason === 'missing-workflow-file'
        ? 'Add .eas/workflows/deploy.yml for EAS Hosting or another required .eas/workflows/*.yml file on the target branch, then push a commit and monitor the resulting run.'
        : undefined;

  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_status',
      {
        status: 'ok',
        guidance: getExpoAutomationGuidance(automation),
        ...(projectGuidance ? { note: projectGuidance } : {}),
        project: {
          id: project.id,
          easProjectId: project.easProjectId,
          name: project.name,
          fullName: `@${getExpoProjectDisplayOwner(project, account)}/${project.slug}`,
          mode: getExpoProjectExecutionMode(project, account),
          source: project.source,
          repoDefaultBranch: project.repoDefaultBranch,
          availableWorkflowFiles: project.availableWorkflowFiles,
          platforms: project.platforms || ['android', 'ios', 'web'],
          repoFullName: project.repoFullName,
          workflowFile: project.workflowFile,
          workflowRef: project.workflowRef,
          readiness: {
            launchable: readiness.launchable,
            reason: readiness.reason,
            label: getExpoProjectReadinessLabel(readiness),
          },
        },
      },
      {
        preferredFlow: automation.preferredFlow,
      },
    ),
  );
}

export async function executeExpoEasProbe(args: { projectId: string }): Promise<string> {
  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_probe',
      withExpoAutomation(args.projectId, {
        ...(await probeExpoProject(args.projectId)),
        guidance: getExpoAutomationGuidance(
          getExpoProjectAutomationContext(args.projectId).automation,
        ),
      }),
      {
        preferredFlow: getExpoProjectAutomationContext(args.projectId).automation.preferredFlow,
      },
    ),
  );
}

export async function executeExpoEasBuild(args: {
  projectId: string;
  platform?: 'android' | 'ios' | 'all';
  profile?: string;
  waitForCompletion?: boolean;
  waitTimeoutMs?: number;
}): Promise<string> {
  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_build',
      withExpoAutomation(args.projectId, await runExpoProjectAction(args.projectId, 'build', args)),
      { preferredFlow: getExpoProjectAutomationContext(args.projectId).automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasUpdate(args: {
  projectId: string;
  branch?: string;
  message?: string;
  waitForCompletion?: boolean;
  waitTimeoutMs?: number;
}): Promise<string> {
  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_update',
      withExpoAutomation(
        args.projectId,
        await runExpoProjectAction(args.projectId, 'update', args),
      ),
      { preferredFlow: getExpoProjectAutomationContext(args.projectId).automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasSubmit(args: {
  projectId: string;
  platform?: 'android' | 'ios' | 'all';
  profile?: string;
  waitForCompletion?: boolean;
  waitTimeoutMs?: number;
}): Promise<string> {
  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_submit',
      withExpoAutomation(
        args.projectId,
        await runExpoProjectAction(args.projectId, 'submit', args),
      ),
      { preferredFlow: getExpoProjectAutomationContext(args.projectId).automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasDeployWeb(args: {
  projectId: string;
  alias?: string;
  waitForCompletion?: boolean;
  waitTimeoutMs?: number;
}): Promise<string> {
  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_deploy_web',
      withExpoAutomation(
        args.projectId,
        await runExpoProjectAction(args.projectId, 'deploy-web', args),
      ),
      { preferredFlow: getExpoProjectAutomationContext(args.projectId).automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasWorkflowRuns(args: {
  projectId: string;
  limit?: number;
}): Promise<string> {
  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_workflow_runs',
      withExpoAutomation(args.projectId, await listExpoWorkflowRuns(args.projectId, args)),
      { preferredFlow: getExpoProjectAutomationContext(args.projectId).automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasWorkflowStatus(args: {
  projectId: string;
  workflowRunId?: string;
  includeJobs?: boolean;
  includeLogs?: boolean;
}): Promise<string> {
  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_workflow_status',
      withExpoAutomation(args.projectId, await inspectExpoWorkflowRun(args.projectId, args)),
      { preferredFlow: getExpoProjectAutomationContext(args.projectId).automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasWorkflowWait(args: {
  projectId: string;
  workflowRunId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  includeJobs?: boolean;
  includeLogs?: boolean;
}): Promise<string> {
  return JSON.stringify(
    normalizeExpoToolPayload(
      'expo_eas_workflow_wait',
      withExpoAutomation(args.projectId, await waitForExpoWorkflowRun(args.projectId, args)),
      { preferredFlow: getExpoProjectAutomationContext(args.projectId).automation.preferredFlow },
    ),
  );
}

export async function executeExpoEasGraphql(args: {
  query: string;
  variables?: Record<string, unknown>;
  projectId?: string;
  accountId?: string;
}): Promise<string> {
  const result = await runExpoGraphqlQuery(args);
  const automationProjectId = args.projectId || result.projectId;
  return JSON.stringify(
    automationProjectId
      ? normalizeExpoToolPayload(
          'expo_eas_graphql',
          withExpoAutomation(automationProjectId, result),
          {
            preferredFlow:
              getExpoProjectAutomationContext(automationProjectId).automation.preferredFlow,
          },
        )
      : normalizeExpoToolPayload('expo_eas_graphql', result),
  );
}
