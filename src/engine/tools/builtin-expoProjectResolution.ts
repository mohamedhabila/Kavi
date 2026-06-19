import {
  listExpoProjects,
} from '../../services/expo/projectSync';
import { resolveExpoProjectForExecutionTask } from '../../services/expo/projectResolution';
import { resolveExpoProject } from '../../services/expo/projectState';
import { useSettingsStore } from '../../store/useSettingsStore';
import { normalizeExpoToolPayload } from './builtin-expoSummary';

export type ExpoListedProject = Awaited<ReturnType<typeof listExpoProjects>>[number];

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

export function buildExpoListProjectsSelection(projects: ExpoListedProject[]) {
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

type ExpoProjectReferenceStatus =
  | 'missing_project_reference'
  | 'invalid_project_reference'
  | 'ambiguous_project_reference';

async function buildExpoProjectReferenceCorrection(params: {
  toolName: string;
  projectRef?: unknown;
  status: ExpoProjectReferenceStatus;
  reason?: string;
  candidates?: ExpoListedProject[];
}): Promise<string> {
  let candidates = params.candidates;
  if (!candidates) {
    try {
      candidates = await listExpoProjects({});
    } catch {
      candidates = [];
    }
  }

  const selection = buildExpoListProjectsSelection(candidates);
  const nextSuggestedArgs = selection.defaultProjectId
    ? { projectId: selection.defaultProjectId }
    : undefined;
  const suppliedProjectId =
    typeof params.projectRef === 'string' && params.projectRef.trim()
      ? params.projectRef.trim()
      : undefined;
  const note =
    params.status === 'missing_project_reference'
      ? selection.defaultProjectId
        ? `The projectId argument is required. Use the exact projectId "${selection.defaultProjectId}" returned in this payload.`
        : 'The projectId argument is required, but no synced Expo project is available to select.'
      : params.status === 'ambiguous_project_reference'
        ? 'The supplied projectId matches more than one synced Expo project. Choose one exact project id from the returned candidates.'
        : selection.defaultProjectId
          ? `The supplied projectId "${suppliedProjectId || ''}" does not identify a synced Expo project. Use the exact projectId "${selection.defaultProjectId}" returned in this payload.`
          : `The supplied projectId "${suppliedProjectId || ''}" does not identify a synced Expo project, and no synced candidates are available.`;
  const guidance = selection.defaultProjectId
    ? `Call ${params.toolName} again with nextSuggestedArgs exactly as returned. Do not invent project ids or reuse a repository name as projectId.`
    : 'Call expo_eas_list_projects with refresh=true after linking or syncing an Expo project, then retry with an exact returned projectId.';

  return JSON.stringify(
    normalizeExpoToolPayload('expo_eas_list_projects', {
      status: params.status,
      argumentName: 'projectId',
      resourceKind: 'expo_project',
      ...(suppliedProjectId ? { suppliedProjectId } : {}),
      ...(params.reason ? { reason: params.reason } : {}),
      count: candidates.length,
      projects: candidates,
      ...(candidates.length > 0 ? { selection } : {}),
      nextSuggestedTool: selection.defaultProjectId ? params.toolName : 'expo_eas_list_projects',
      ...(nextSuggestedArgs ? { nextSuggestedArgs } : { nextSuggestedArgs: { refresh: true } }),
      note,
      guidance,
    }),
  );
}

export async function resolveExpoProjectForToolCall(
  toolName: string,
  projectRef: unknown,
): Promise<{ project: ReturnType<typeof resolveExpoProject> } | { response: string }> {
  const trimmedRef = typeof projectRef === 'string' ? projectRef.trim() : '';
  if (!trimmedRef) {
    return {
      response: await buildExpoProjectReferenceCorrection({
        toolName,
        projectRef,
        status: 'missing_project_reference',
        reason: 'missing-project-ref',
      }),
    };
  }

  const resolution = await resolveExpoProjectForExecutionTask({
    projectRef: trimmedRef,
    allowSync: true,
  });
  if (resolution.status === 'resolved') {
    return {
      project: resolveExpoProject(resolution.project.id, useSettingsStore.getState()),
    };
  }

  return {
    response: await buildExpoProjectReferenceCorrection({
      toolName,
      projectRef: trimmedRef,
      status:
        resolution.status === 'ambiguous'
          ? 'ambiguous_project_reference'
          : 'invalid_project_reference',
      reason: resolution.reason,
      candidates: resolution.candidates,
    }),
  };
}
