import type { AgentRunEvidenceEntry } from '../../types/agentRun';
import { isSessionToolName } from '../../engine/tools/sessionToolKinds';
import {
  inferToolCapabilityDescriptor,
  type ToolCapabilityDescriptor,
} from '../../engine/tools/capabilityRegistry';
import { normalizeToolName } from '../../engine/tools/toolNameNormalization';

function normalizeSourceName(sourceName: string | undefined): string | undefined {
  const normalized = sourceName?.trim();
  return normalized ? normalizeToolName(normalized) : undefined;
}

export function isSessionToolSourceName(sourceName: string | undefined): boolean {
  return isSessionToolName(normalizeSourceName(sourceName));
}

export function isApprovalGradeSourceName(sourceName: string | undefined): boolean {
  const normalized = normalizeSourceName(sourceName);
  return !!normalized && !isSessionToolSourceName(normalized);
}

export type OperationalEvidenceKind = 'artifact' | 'external_run';

function hasResultPreview(preview: string | undefined): boolean {
  return typeof preview === 'string' && preview.trim().length > 0;
}

function isOpaqueDynamicToolSourceName(sourceName: string): boolean {
  return sourceName.startsWith('mcp__') || sourceName.startsWith('skill__');
}

function descriptorRepresentsArtifactEvidence(descriptor: ToolCapabilityDescriptor): boolean {
  if (descriptor.sideEffects.includes('local_artifact')) {
    return true;
  }

  return (
    descriptor.category === 'ssh' &&
    descriptor.capabilities.includes('write') &&
    !descriptor.workflowStages.some((stage) =>
      [
        'start_external_execution',
        'continue_external_execution',
        'monitor_external_execution',
        'await_external_execution',
      ].includes(stage),
    )
  );
}

function descriptorRepresentsExternalRunEvidence(descriptor: ToolCapabilityDescriptor): boolean {
  if (descriptor.sideEffects.includes('external_run')) {
    return true;
  }

  if (
    descriptor.workflowStages.some((stage) =>
      [
        'start_external_execution',
        'continue_external_execution',
        'monitor_external_execution',
        'await_external_execution',
      ].includes(stage),
    )
  ) {
    return true;
  }

  return descriptor.providesEvidence.some((evidenceKind) =>
    ['external_run', 'github_workflow', 'eas_workflow_triggered', 'eas_workflow_terminal'].includes(
      evidenceKind,
    ),
  );
}

export function getOperationalEvidenceKind(params: {
  sourceName: string | undefined;
  preview?: string | undefined;
  includeOpaqueDynamicToolResults?: boolean;
}): OperationalEvidenceKind | undefined {
  const normalized = normalizeSourceName(params.sourceName);
  if (!normalized || !isApprovalGradeSourceName(normalized)) {
    return undefined;
  }

  const descriptor = inferToolCapabilityDescriptor({
    name: normalized,
    description: normalized,
  });
  if (descriptorRepresentsArtifactEvidence(descriptor)) {
    return 'artifact';
  }
  if (descriptorRepresentsExternalRunEvidence(descriptor)) {
    return 'external_run';
  }

  if (
    descriptor.category === 'other' &&
    descriptor.source === 'built-in' &&
    !isOpaqueDynamicToolSourceName(normalized)
  ) {
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
  return (
    getOperationalEvidenceKind({
      sourceName,
      preview,
      includeOpaqueDynamicToolResults: options?.includeOpaqueDynamicToolResults,
    }) === 'artifact'
  );
}

export function isExternalRunEvidenceSourceName(
  sourceName: string | undefined,
  preview?: string | undefined,
  options?: { includeOpaqueDynamicToolResults?: boolean },
): boolean {
  return (
    getOperationalEvidenceKind({
      sourceName,
      preview,
      includeOpaqueDynamicToolResults: options?.includeOpaqueDynamicToolResults,
    }) === 'external_run'
  );
}

export function isOperationalEvidenceSourceName(
  sourceName: string | undefined,
  preview?: string | undefined,
  options?: { includeOpaqueDynamicToolResults?: boolean },
): boolean {
  return (
    getOperationalEvidenceKind({
      sourceName,
      preview,
      includeOpaqueDynamicToolResults: options?.includeOpaqueDynamicToolResults,
    }) !== undefined
  );
}

export function hasOperationalEvidenceFromSources(params: {
  toolsUsed?: ReadonlyArray<string>;
  resultPreviewSourceNames?: ReadonlyArray<string>;
  resultPreviewEntries?: ReadonlyArray<{ sourceName?: string; preview?: string }>;
  lastSubstantiveResultSourceName?: string;
  structuredEvidenceEntries?: ReadonlyArray<
    Pick<AgentRunEvidenceEntry, 'status' | 'sourceName' | 'toolName'>
  >;
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

  if (
    (params.resultPreviewSourceNames ?? []).some((sourceName) =>
      isOperationalEvidenceSourceName(sourceName),
    )
  ) {
    return true;
  }

  if (isOperationalEvidenceSourceName(params.lastSubstantiveResultSourceName)) {
    return true;
  }

  return (params.structuredEvidenceEntries ?? []).some(
    (entry) =>
      (entry.status === 'verified' || entry.status === 'resolved') &&
      (isOperationalEvidenceSourceName(entry.toolName) ||
        isOperationalEvidenceSourceName(entry.sourceName)),
  );
}
