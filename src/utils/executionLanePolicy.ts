import { inferToolCapabilityDescriptor } from '../engine/tools/capabilityRegistry';

export type ExecutionLaneToolCapability =
  | 'mutation'
  | 'monitoring'
  | 'read_only'
  | 'meta'
  | 'computation'
  | 'coordination'
  | 'unknown';

export function normalizeExecutionLaneToolName(toolName: string | undefined): string {
  return typeof toolName === 'string'
    ? toolName.trim().toLowerCase()
    : '';
}

export const EXECUTION_SUPER_AGENT_CORE_TOOL_NAMES = new Set<string>();

export function getExecutionLaneToolCapability(
  toolName: string | undefined,
): ExecutionLaneToolCapability {
  const normalized = normalizeExecutionLaneToolName(toolName);
  if (!normalized) {
    return 'unknown';
  }

  const descriptor = inferToolCapabilityDescriptor({
    name: normalized,
    description: normalized,
  });
  const capabilities = new Set(descriptor.capabilities);
  const sideEffects = new Set(descriptor.sideEffects);
  const workflowStages = new Set(descriptor.workflowStages);

  if (capabilities.has('compute')) {
    return 'computation';
  }

  if (descriptor.category === 'tools') {
    return 'meta';
  }

  if (
    descriptor.category === 'sessions' &&
    sideEffects.has('none') &&
    !capabilities.has('wait')
  ) {
    return 'meta';
  }

  if (
    sideEffects.has('destructive') ||
    sideEffects.has('remote_mutation') ||
    sideEffects.has('external_run') ||
    sideEffects.has('local_artifact') ||
    capabilities.has('write') ||
    capabilities.has('commit') ||
    capabilities.has('push') ||
    capabilities.has('deploy')
  ) {
    return 'mutation';
  }

  if (capabilities.has('coordinate')) {
    return 'coordination';
  }

  const monitorsExternalProgress =
    capabilities.has('monitor') ||
    capabilities.has('wait') ||
    workflowStages.has('monitor_external_execution') ||
    workflowStages.has('await_external_execution');

  const isKnownReadOnlyDescriptor =
    descriptor.category !== 'other' &&
    descriptor.sideEffects.length > 0 &&
    Array.from(sideEffects).every((sideEffect) => sideEffect === 'none') &&
    (capabilities.has('discover') || capabilities.has('read') || capabilities.has('verify')) &&
    !monitorsExternalProgress;

  if (isKnownReadOnlyDescriptor) {
    return 'read_only';
  }

  if (
    monitorsExternalProgress
  ) {
    return 'monitoring';
  }

  return 'unknown';
}

export function isExecutionAdvancingToolName(toolName: string | undefined): boolean {
  const capability = getExecutionLaneToolCapability(toolName);
  return capability === 'mutation' || capability === 'monitoring' || capability === 'computation';
}

export function isExecutionDefaultBlockedToolName(toolName: string | undefined): boolean {
  const normalized = normalizeExecutionLaneToolName(toolName);
  const capability = getExecutionLaneToolCapability(normalized);
  return normalized.length > 0 &&
    (capability === 'computation' ||
      (capability === 'coordination' && !EXECUTION_SUPER_AGENT_CORE_TOOL_NAMES.has(normalized)));
}

export function isExecutionDiscoveryOrMetaToolName(toolName: string | undefined): boolean {
  const capability = getExecutionLaneToolCapability(toolName);
  return capability === 'read_only' || capability === 'meta';
}

export function filterExecutionLaneToolNames(
  toolNames: Iterable<string>,
  options?: {
    allowDefaultBlockedTools?: boolean;
  },
): string[] {
  const filtered: string[] = [];
  for (const toolName of toolNames) {
    const normalized = normalizeExecutionLaneToolName(toolName);
    if (!normalized || isExecutionDiscoveryOrMetaToolName(normalized)) {
      continue;
    }
    if (!options?.allowDefaultBlockedTools && isExecutionDefaultBlockedToolName(normalized)) {
      continue;
    }
    filtered.push(normalized);
  }
  return filtered;
}

export function listExecutionDiscoveryOrMetaToolNames(toolNames: Iterable<string>): string[] {
  const seen = new Set<string>();
  const blocked: string[] = [];
  for (const toolName of toolNames) {
    const normalized = normalizeExecutionLaneToolName(toolName);
    if (!normalized || seen.has(normalized) || !isExecutionDiscoveryOrMetaToolName(normalized)) {
      continue;
    }
    seen.add(normalized);
    blocked.push(normalized);
  }
  return blocked;
}
