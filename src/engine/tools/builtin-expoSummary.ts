import {
  compactExpoChecks,
  compactExpoFailureLogs,
  compactExpoGraphqlErrors,
  compactExpoOutputExcerpt,
  compactExpoProjectListing,
  compactExpoProjectStatus,
  compactExpoPublicUrls,
  compactExpoSelection,
  compactExpoWorkflowJobs,
  compactExpoWorkflowRun,
  compactExpoWorkflowRuns,
  isRecord,
  summarizeExpoFailureLogs,
  trimExpoAdvisoryText,
  truncateExpoText,
} from './builtin-expoCompaction';

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

  if (
    (payload.status === 'unsupported' ||
      payload.status === 'not_found' ||
      payload.status === 'missing_project_reference' ||
      payload.status === 'invalid_project_reference' ||
      payload.status === 'ambiguous_project_reference') &&
    note
  ) {
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
      if (payload.status === 'redirected_existing_project') {
        const project = compactExpoProjectListing(payload.project);
        const name =
          typeof project?.fullName === 'string'
            ? project.fullName
            : typeof project?.name === 'string'
              ? project.name
              : 'Existing Expo project';
        return guidance
          ? `Using existing project ${name}. ${guidance}`
          : `Using existing project ${name}.`;
      }

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

export function normalizeExpoToolPayload<T extends object>(
  toolName: string,
  value: T,
  options?: {
    preferredFlow?: string;
  },
): Record<string, unknown> {
  const payload = value as Record<string, unknown>;
  const note = trimExpoAdvisoryText(payload.note, 240);
  const guidance = trimExpoAdvisoryText(payload.guidance, 320);
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
  if (typeof payload.suppliedProjectId === 'string' && payload.suppliedProjectId.trim())
    normalized.suppliedProjectId = payload.suppliedProjectId.trim();
  if (typeof payload.argumentName === 'string' && payload.argumentName.trim())
    normalized.argumentName = payload.argumentName.trim();
  if (typeof payload.resourceKind === 'string' && payload.resourceKind.trim())
    normalized.resourceKind = payload.resourceKind.trim();
  if (typeof payload.reason === 'string' && payload.reason.trim())
    normalized.reason = payload.reason.trim();
  if (typeof payload.projectName === 'string' && payload.projectName.trim())
    normalized.projectName = payload.projectName.trim();
  if (typeof payload.mode === 'string' && payload.mode.trim())
    normalized.mode = payload.mode.trim();
  if (options?.preferredFlow) normalized.preferredFlow = options.preferredFlow;
  if (isRecord(payload.automation)) {
    const automation = payload.automation;
    const configPaths =
      typeof automation.workflowFile === 'string' && automation.workflowFile.trim()
        ? [
            automation.workflowFile.trim().includes('/')
              ? automation.workflowFile.trim()
              : `.eas/workflows/${automation.workflowFile.trim()}`,
          ]
        : [];
    const trigger: Record<string, unknown> = {
      source: 'remote_mutation',
      expectedAfter: 'push',
      ...(typeof automation.recommendedBranch === 'string' && automation.recommendedBranch.trim()
        ? { branch: automation.recommendedBranch.trim() }
        : {}),
      ...(configPaths.length > 0 ? { configPaths } : {}),
      ...(typeof automation.autoTriggerOnPush === 'boolean'
        ? { autoTriggerOnSourceMutation: automation.autoTriggerOnPush }
        : {}),
    };
    if (Object.keys(trigger).length > 2 || configPaths.length > 0) {
      normalized.trigger = trigger;
    }
  }
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
  if (typeof payload.nextSuggestedTool === 'string' && payload.nextSuggestedTool.trim()) {
    normalized.nextSuggestedTool = payload.nextSuggestedTool.trim();
  }
  if (isRecord(payload.nextSuggestedArgs) && Object.keys(payload.nextSuggestedArgs).length > 0) {
    normalized.nextSuggestedArgs = payload.nextSuggestedArgs;
  }

  const graphqlErrors = compactExpoGraphqlErrors(payload.errors);
  if (graphqlErrors) normalized.errors = graphqlErrors;
  if (toolName === 'expo_eas_graphql' && payload.data !== undefined) {
    normalized.data = payload.data;
  }

  if (note) normalized.note = note;
  if (guidance) normalized.guidance = guidance;

  return normalized;
}
