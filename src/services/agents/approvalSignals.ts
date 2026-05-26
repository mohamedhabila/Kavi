import type { AgentRunEvidenceEntry } from '../../types';
import { inferToolCapabilityDescriptor } from '../../engine/tools/capabilityRegistry';
import { getToolManagerCategoryForToolName } from '../../engine/tools/toolManager';
import { normalizeToolName } from '../../engine/tools/toolNameNormalization';

const SESSION_COORDINATION_SOURCE_NAME_PATTERN = /^(sessions_(spawn|send|status|history|output|surface_output|list|wait|cancel|yield)|wait)$/i;
const WORKFLOW_LEDGER_SOURCE_NAME_PATTERN = /^(record_workflow_evidence|read_workflow_evidence)$/i;
const ARTIFACT_MUTATION_SOURCE_NAMES = new Set([
  'write_file',
  'file_edit',
  'workspace_write_file',
  'workspace_mkdir',
  'workspace_rename',
  'workspace_delete',
  'workspace_fs',
  'ssh_write_file',
  'ssh_rename_path',
  'ssh_delete_path',
  'ssh_make_directory',
  'ssh_fs',
  'canvas_create',
  'canvas_update',
  'canvas_delete',
  'calendar_create_event',
  'contacts_edit',
  'contacts_create',
  'contacts_form',
  'contacts_share',
  'clipboard_write',
  'share',
  'share_text',
  'share_url',
  'share_file',
  'share_contact',
]);
const EXTERNAL_RUN_SOURCE_NAMES = new Set([
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_press_key',
  'browser_select',
  'browser_drag',
  'browser_upload',
  'browser_fill_form',
  'browser_dialog',
  'browser_evaluate',
  'ssh_exec',
  'ssh_background_job_status',
  'ssh_background_job_wait',
  'workspace_launch_browser',
  'workspace_delegate_task',
  'expo_eas_build',
  'expo_eas_update',
  'expo_eas_submit',
  'expo_eas_deploy_web',
  'expo_eas_workflow_runs',
  'expo_eas_workflow_status',
  'expo_eas_workflow_wait',
  'email_compose',
  'sms_compose',
  'phone_call',
  'open_url',
  'maps_open',
  'notification_send',
  'notification_schedule',
]);

function normalizeSourceName(sourceName: string | undefined): string | undefined {
  const normalized = sourceName?.trim();
  return normalized ? normalizeToolName(normalized) : undefined;
}

function isToolLikeEvidenceSourceName(sourceName: string | undefined): boolean {
  const normalized = normalizeSourceName(sourceName);
  if (!normalized) {
    return false;
  }

  return (
    normalized.startsWith('mcp__') ||
    normalized.startsWith('skill__') ||
    ARTIFACT_MUTATION_SOURCE_NAMES.has(normalized) ||
    EXTERNAL_RUN_SOURCE_NAMES.has(normalized) ||
    getToolManagerCategoryForToolName(normalized) !== 'other'
  );
}

export function isSessionCoordinationSourceName(sourceName: string | undefined): boolean {
  return SESSION_COORDINATION_SOURCE_NAME_PATTERN.test(normalizeSourceName(sourceName) || '');
}

export function isApprovalGradeSourceName(sourceName: string | undefined): boolean {
  const normalized = normalizeSourceName(sourceName);
  return !!normalized && !isSessionCoordinationSourceName(normalized);
}

export type OperationalEvidenceKind = 'artifact' | 'external_run';

function hasResultPreview(preview: string | undefined): boolean {
  return typeof preview === 'string' && preview.trim().length > 0;
}

function isOpaqueDynamicToolSourceName(sourceName: string): boolean {
  return sourceName.startsWith('mcp__') || sourceName.startsWith('skill__');
}

export function getOperationalEvidenceKind(params: {
  sourceName: string | undefined;
  preview?: string | undefined;
  includeOpaqueDynamicToolResults?: boolean;
}): OperationalEvidenceKind | undefined {
  const normalized = normalizeSourceName(params.sourceName);
  if (
    !normalized ||
    !isApprovalGradeSourceName(normalized) ||
    WORKFLOW_LEDGER_SOURCE_NAME_PATTERN.test(normalized)
  ) {
    return undefined;
  }

  if (ARTIFACT_MUTATION_SOURCE_NAMES.has(normalized)) {
    return 'artifact';
  }

  if (EXTERNAL_RUN_SOURCE_NAMES.has(normalized)) {
    return 'external_run';
  }

  const descriptor = inferToolCapabilityDescriptor({
    name: normalized,
    description: normalized,
  });
  if (descriptor.sideEffects.includes('local_artifact')) {
    return 'artifact';
  }
  if (
    descriptor.sideEffects.some((sideEffect) =>
      sideEffect === 'remote_mutation' || sideEffect === 'external_run',
    ) ||
    descriptor.providesEvidence.some((evidenceKind) =>
      evidenceKind !== 'verification' && evidenceKind !== 'blocker',
    )
  ) {
    return 'external_run';
  }

  if (!isToolLikeEvidenceSourceName(normalized)) {
    return undefined;
  }

  if (
    params.includeOpaqueDynamicToolResults &&
    isOpaqueDynamicToolSourceName(normalized) &&
    hasResultPreview(params.preview)
  ) {
    return 'external_run';
  }

  return undefined;
}

export function isArtifactEvidenceSourceName(
  sourceName: string | undefined,
  preview?: string | undefined,
  options?: { includeOpaqueDynamicToolResults?: boolean },
): boolean {
  return getOperationalEvidenceKind({
    sourceName,
    preview,
    includeOpaqueDynamicToolResults: options?.includeOpaqueDynamicToolResults,
  }) === 'artifact';
}

export function isExternalRunEvidenceSourceName(
  sourceName: string | undefined,
  preview?: string | undefined,
  options?: { includeOpaqueDynamicToolResults?: boolean },
): boolean {
  return getOperationalEvidenceKind({
    sourceName,
    preview,
    includeOpaqueDynamicToolResults: options?.includeOpaqueDynamicToolResults,
  }) === 'external_run';
}

export function isOperationalEvidenceSourceName(
  sourceName: string | undefined,
  preview?: string | undefined,
  options?: { includeOpaqueDynamicToolResults?: boolean },
): boolean {
  return getOperationalEvidenceKind({
    sourceName,
    preview,
    includeOpaqueDynamicToolResults: options?.includeOpaqueDynamicToolResults,
  }) !== undefined;
}

export function hasOperationalEvidenceFromSources(params: {
  toolsUsed?: ReadonlyArray<string>;
  resultPreviewSourceNames?: ReadonlyArray<string>;
  resultPreviewEntries?: ReadonlyArray<{ sourceName?: string; preview?: string }>;
  lastSubstantiveResultSourceName?: string;
  structuredEvidenceEntries?: ReadonlyArray<Pick<AgentRunEvidenceEntry, 'status' | 'sourceName' | 'toolName'>>;
  includeOpaqueDynamicToolResults?: boolean;
}): boolean {
  if ((params.toolsUsed ?? []).some((toolName) => isOperationalEvidenceSourceName(toolName))) {
    return true;
  }

  if (
    (params.resultPreviewEntries ?? []).some((entry) =>
      isOperationalEvidenceSourceName(entry.sourceName, entry.preview, {
        includeOpaqueDynamicToolResults: params.includeOpaqueDynamicToolResults,
      }),
    )
  ) {
    return true;
  }

  if ((params.resultPreviewSourceNames ?? []).some((sourceName) => isOperationalEvidenceSourceName(sourceName))) {
    return true;
  }

  if (isOperationalEvidenceSourceName(params.lastSubstantiveResultSourceName)) {
    return true;
  }

  return (params.structuredEvidenceEntries ?? []).some(
    (entry) =>
      (entry.status === 'verified' || entry.status === 'resolved') &&
      (isOperationalEvidenceSourceName(entry.toolName) || isOperationalEvidenceSourceName(entry.sourceName)),
  );
}
