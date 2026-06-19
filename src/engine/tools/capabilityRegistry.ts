import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName } from './toolNameNormalization';
import { TOOL_DEFINITIONS } from './definitions';
import { ALL_NATIVE_TOOL_DEFINITIONS } from './native/definitions';
import { getGitHubToolContract } from '../../services/integrations/github/toolContracts';
import {
  hasExplicitToolContract,
  normalizeExplicitToolContractList,
} from './toolCapabilityContract';
import {
  normalizeToolWorkflowContract,
  type ToolWorkflowConsumption,
  type ToolWorkflowProduction,
} from './toolWorkflowContracts';

export type ToolCapability =
  | 'discover'
  | 'read'
  | 'write'
  | 'commit'
  | 'push'
  | 'deploy'
  | 'monitor'
  | 'wait'
  | 'verify'
  | 'coordinate'
  | 'compute';

export type ToolResourceKind =
  | 'conversation_workspace'
  | 'github_repo'
  | 'github_branch'
  | 'github_workflow'
  | 'expo_account'
  | 'expo_project'
  | 'eas_workflow'
  | 'ssh_host'
  | 'browser'
  | 'canvas'
  | 'memory'
  | 'device'
  | 'unknown';

export type ToolSideEffect =
  | 'none'
  | 'local_artifact'
  | 'remote_mutation'
  | 'external_run'
  | 'destructive';

export type ToolRiskHint =
  | 'read_only'
  | 'destructive'
  | 'idempotent'
  | 'open_world'
  | 'trusted_metadata'
  | 'requires_approval';

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ToolEvidenceKind =
  | 'local_artifact'
  | 'github_commit'
  | 'github_push'
  | 'github_branch'
  | 'github_workflow'
  | 'expo_project'
  | 'expo_project_ready'
  | 'eas_workflow_triggered'
  | 'eas_workflow_terminal'
  | 'external_run'
  | 'verification'
  | 'blocker';

export type ToolWorkflowStage =
  | 'discover_resource'
  | 'inspect_resource'
  | 'prepare_artifact'
  | 'persist_artifact'
  | 'mutate_remote_state'
  | 'start_external_execution'
  | 'continue_external_execution'
  | 'monitor_external_execution'
  | 'await_external_execution'
  | 'verify_evidence'
  | 'guarded_resource_creation';

export interface ToolCapabilityRequirement {
  category?: string;
  capability?: ToolCapability;
  resourceKind?: ToolResourceKind;
  evidenceKind?: ToolEvidenceKind;
  workflowStage?: ToolWorkflowStage;
}

export interface ToolCapabilityDescriptor {
  name: string;
  source: 'built-in' | 'skill' | 'mcp';
  namespace?: string;
  category: string;
  capabilities: ToolCapability[];
  resourceKinds: ToolResourceKind[];
  sideEffects: ToolSideEffect[];
  riskHints: ToolRiskHint[];
  riskLevel?: ToolRiskLevel;
  prerequisites: string[];
  permissionPrerequisites: string[];
  recoverableErrors: string[];
  providesEvidence: ToolEvidenceKind[];
  workflowStages: ToolWorkflowStage[];
  produces: ToolWorkflowProduction[];
  consumes: ToolWorkflowConsumption[];
  precedes: string[];
  requiresPermissionEvidence: string[];
  inputExamples?: Array<Record<string, unknown>>;
  outputSchema?: Record<string, unknown>;
  description?: string;
}

const EMPTY_DESCRIPTOR_ARRAY: never[] = [];
const TOOL_CAPABILITY_VALUES = new Set<ToolCapability>([
  'discover',
  'read',
  'write',
  'commit',
  'push',
  'deploy',
  'monitor',
  'wait',
  'verify',
  'coordinate',
  'compute',
]);
const TOOL_RESOURCE_KIND_VALUES = new Set<ToolResourceKind>([
  'conversation_workspace',
  'github_repo',
  'github_branch',
  'github_workflow',
  'expo_account',
  'expo_project',
  'eas_workflow',
  'ssh_host',
  'browser',
  'canvas',
  'memory',
  'device',
  'unknown',
]);
const TOOL_SIDE_EFFECT_VALUES = new Set<ToolSideEffect>([
  'none',
  'local_artifact',
  'remote_mutation',
  'external_run',
  'destructive',
]);
const TOOL_RISK_HINT_VALUES = new Set<ToolRiskHint>([
  'read_only',
  'destructive',
  'idempotent',
  'open_world',
  'trusted_metadata',
  'requires_approval',
]);
const TOOL_RISK_LEVEL_VALUES = new Set<ToolRiskLevel>(['low', 'medium', 'high', 'critical']);
const TOOL_EVIDENCE_KIND_VALUES = new Set<ToolEvidenceKind>([
  'local_artifact',
  'github_commit',
  'github_push',
  'github_branch',
  'github_workflow',
  'expo_project',
  'expo_project_ready',
  'eas_workflow_triggered',
  'eas_workflow_terminal',
  'external_run',
  'verification',
  'blocker',
]);
const TOOL_WORKFLOW_STAGE_VALUES = new Set<ToolWorkflowStage>([
  'discover_resource',
  'inspect_resource',
  'prepare_artifact',
  'persist_artifact',
  'mutate_remote_state',
  'start_external_execution',
  'continue_external_execution',
  'monitor_external_execution',
  'await_external_execution',
  'verify_evidence',
  'guarded_resource_creation',
]);
const CANONICAL_BUILT_IN_TOOL_DEFINITIONS_WITH_CONTRACT = new Map(
  [...TOOL_DEFINITIONS, ...ALL_NATIVE_TOOL_DEFINITIONS]
    .filter((tool) => hasExplicitToolContract(tool))
    .map((tool) => [normalizeToolName(tool.name), tool]),
);

function unique<T>(values: Iterable<T | undefined | null>): T[] {
  return Array.from(new Set(Array.from(values).filter((value): value is T => value != null)));
}

function resolveSource(normalizedName: string): ToolCapabilityDescriptor['source'] {
  if (normalizedName.startsWith('skill__')) {
    return 'skill';
  }
  if (normalizedName.startsWith('mcp__')) {
    return 'mcp';
  }
  return 'built-in';
}

function resolveNamespace(normalizedName: string): string | undefined {
  if (!normalizedName.includes('__')) {
    return undefined;
  }

  const [source, namespace] = normalizedName.split('__');
  return source && namespace ? namespace : undefined;
}

function baseDescriptor(
  tool: Pick<ToolDefinition, 'name' | 'description'>,
  patch: Partial<Omit<ToolCapabilityDescriptor, 'name' | 'source' | 'namespace'>>,
): ToolCapabilityDescriptor {
  const name = normalizeToolName(tool.name);
  return {
    name,
    source: resolveSource(name),
    namespace: resolveNamespace(name),
    category: patch.category || 'other',
    capabilities: unique(patch.capabilities ?? EMPTY_DESCRIPTOR_ARRAY),
    resourceKinds: unique(patch.resourceKinds ?? ['unknown']),
    sideEffects: unique(patch.sideEffects ?? ['none']),
    riskHints: unique(patch.riskHints ?? EMPTY_DESCRIPTOR_ARRAY),
    riskLevel: patch.riskLevel,
    prerequisites: unique(patch.prerequisites ?? EMPTY_DESCRIPTOR_ARRAY),
    permissionPrerequisites: unique(patch.permissionPrerequisites ?? EMPTY_DESCRIPTOR_ARRAY),
    recoverableErrors: unique(patch.recoverableErrors ?? EMPTY_DESCRIPTOR_ARRAY),
    providesEvidence: unique(patch.providesEvidence ?? EMPTY_DESCRIPTOR_ARRAY),
    workflowStages: unique(patch.workflowStages ?? EMPTY_DESCRIPTOR_ARRAY),
    produces: unique(patch.produces ?? EMPTY_DESCRIPTOR_ARRAY),
    consumes: unique(patch.consumes ?? EMPTY_DESCRIPTOR_ARRAY),
    precedes: unique(patch.precedes ?? EMPTY_DESCRIPTOR_ARRAY),
    requiresPermissionEvidence: unique(patch.requiresPermissionEvidence ?? EMPTY_DESCRIPTOR_ARRAY),
    inputExamples: patch.inputExamples,
    outputSchema: patch.outputSchema,
    description: tool.description,
  };
}

function explicitDescriptor(
  tool: Pick<ToolDefinition, 'name' | 'description' | 'contract'>,
): ToolCapabilityDescriptor | undefined {
  if (!hasExplicitToolContract(tool)) {
    return undefined;
  }

  const contract = tool.contract!;
  const category = contract.category?.trim();
  const workflowContract = normalizeToolWorkflowContract(contract);
  return baseDescriptor(tool, {
    ...(category ? { category } : {}),
    capabilities: normalizeExplicitToolContractList<ToolCapability>(
      contract.capabilities,
      TOOL_CAPABILITY_VALUES,
    ),
    resourceKinds: normalizeExplicitToolContractList<ToolResourceKind>(
      contract.resourceKinds,
      TOOL_RESOURCE_KIND_VALUES,
    ),
    sideEffects: normalizeExplicitToolContractList<ToolSideEffect>(
      contract.sideEffects,
      TOOL_SIDE_EFFECT_VALUES,
    ),
    riskHints: normalizeExplicitToolContractList<ToolRiskHint>(
      contract.riskHints,
      TOOL_RISK_HINT_VALUES,
    ),
    riskLevel:
      contract.riskLevel && TOOL_RISK_LEVEL_VALUES.has(contract.riskLevel)
        ? contract.riskLevel
        : undefined,
    prerequisites: unique(contract.prerequisites ?? EMPTY_DESCRIPTOR_ARRAY),
    permissionPrerequisites: unique(contract.permissionPrerequisites ?? EMPTY_DESCRIPTOR_ARRAY),
    recoverableErrors: unique(contract.recoverableErrors ?? EMPTY_DESCRIPTOR_ARRAY),
    providesEvidence: normalizeExplicitToolContractList<ToolEvidenceKind>(
      contract.providesEvidence,
      TOOL_EVIDENCE_KIND_VALUES,
    ),
    workflowStages: normalizeExplicitToolContractList<ToolWorkflowStage>(
      contract.workflowStages,
      TOOL_WORKFLOW_STAGE_VALUES,
    ),
    produces: workflowContract.produces,
    consumes: workflowContract.consumes,
    precedes: workflowContract.precedes,
    requiresPermissionEvidence: workflowContract.requiresPermissionEvidence,
    inputExamples: contract.inputExamples,
    outputSchema: contract.outputSchema,
  });
}

function canonicalBuiltInContractTool(
  tool: Pick<ToolDefinition, 'name' | 'description' | 'contract'>,
): Pick<ToolDefinition, 'name' | 'description' | 'contract'> | undefined {
  const normalizedName = normalizeToolName(tool.name);
  if (resolveSource(normalizedName) !== 'built-in') {
    return undefined;
  }
  return CANONICAL_BUILT_IN_TOOL_DEFINITIONS_WITH_CONTRACT.get(normalizedName);
}

function canonicalKnownDynamicContractTool(
  tool: Pick<ToolDefinition, 'name' | 'description' | 'contract'>,
): Pick<ToolDefinition, 'name' | 'description' | 'contract'> | undefined {
  const normalizedName = normalizeToolName(tool.name);
  const parts = normalizedName.split('__');
  if (parts.length !== 3) {
    return undefined;
  }

  const [source, namespace, leafName] = parts;
  if ((source !== 'skill' && source !== 'mcp') || namespace !== 'github') {
    return undefined;
  }

  const contract = getGitHubToolContract(leafName);
  if (!contract) {
    return undefined;
  }

  return {
    name: normalizedName,
    description: tool.description,
    contract,
  };
}

export function inferToolCapabilityDescriptor(
  tool: Pick<ToolDefinition, 'name' | 'description' | 'contract'>,
): ToolCapabilityDescriptor {
  const explicit =
    explicitDescriptor(tool) ??
    explicitDescriptor(
      canonicalBuiltInContractTool(tool) ?? canonicalKnownDynamicContractTool(tool) ?? tool,
    );
  if (explicit) {
    return explicit;
  }

  const normalizedName = normalizeToolName(tool.name);

  return baseDescriptor(tool, {
    category:
      resolveSource(normalizedName) === 'skill'
        ? 'skills'
        : resolveSource(normalizedName) === 'mcp'
          ? 'mcp'
          : 'other',
    capabilities: ['discover'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
  });
}

export function buildToolCapabilityRegistry(
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): Map<string, ToolCapabilityDescriptor> {
  return new Map(
    tools.map((tool) => {
      const descriptor = inferToolCapabilityDescriptor(tool);
      return [descriptor.name, descriptor];
    }),
  );
}

export function descriptorSatisfiesRequirement(
  descriptor: ToolCapabilityDescriptor,
  requirement: ToolCapabilityRequirement,
): boolean {
  return (
    (!requirement.capability || descriptor.capabilities.includes(requirement.capability)) &&
    (!requirement.resourceKind || descriptor.resourceKinds.includes(requirement.resourceKind)) &&
    (!requirement.evidenceKind || descriptor.providesEvidence.includes(requirement.evidenceKind)) &&
    (!requirement.category || descriptor.category === requirement.category) &&
    (!requirement.workflowStage || descriptor.workflowStages.includes(requirement.workflowStage))
  );
}

function scoreDescriptorForRequirement(
  descriptor: ToolCapabilityDescriptor,
  requirement: ToolCapabilityRequirement,
): number {
  let score = 0;
  if (requirement.workflowStage && descriptor.workflowStages.includes(requirement.workflowStage))
    score += 12;
  if (requirement.category && descriptor.category === requirement.category) score += 6;
  if (requirement.capability && descriptor.capabilities.includes(requirement.capability))
    score += 8;
  if (requirement.resourceKind && descriptor.resourceKinds.includes(requirement.resourceKind))
    score += 6;
  if (requirement.evidenceKind && descriptor.providesEvidence.includes(requirement.evidenceKind))
    score += 6;
  if (
    requirement.workflowStage === 'discover_resource' &&
    descriptor.capabilities.includes('discover')
  ) {
    score += 4;
  }
  if (
    requirement.workflowStage === 'inspect_resource' &&
    !descriptor.capabilities.includes('discover')
  ) {
    score += 4;
  }
  if (descriptor.riskHints.includes('read_only')) score += 1;
  if (descriptor.sideEffects.includes('destructive')) score -= 6;
  return score;
}

export function selectToolNamesForCapabilityRequirements(
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  requirements: ReadonlyArray<ToolCapabilityRequirement>,
  options?: {
    excludeToolNames?: ReadonlyArray<string>;
  },
): string[] {
  const registry = buildToolCapabilityRegistry(tools);
  const selected: string[] = [];
  const seen = new Set<string>();
  const excludedToolNames = new Set(
    (options?.excludeToolNames ?? [])
      .map((toolName) => normalizeToolName(toolName))
      .filter(Boolean),
  );

  for (const requirement of requirements) {
    const candidates = Array.from(registry.values())
      .filter(
        (descriptor) =>
          !excludedToolNames.has(descriptor.name) &&
          descriptorSatisfiesRequirement(descriptor, requirement),
      )
      .map((descriptor, index) => ({
        descriptor,
        index,
        score: scoreDescriptorForRequirement(descriptor, requirement),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    const strongestScore = candidates[0]?.score;
    const strongestCandidates =
      strongestScore == null
        ? []
        : candidates.filter((candidate) => candidate.score === strongestScore);

    for (const candidate of strongestCandidates) {
      if (seen.has(candidate.descriptor.name)) {
        continue;
      }
      seen.add(candidate.descriptor.name);
      selected.push(candidate.descriptor.name);
    }
  }

  return selected;
}

export function findToolDescriptorByName(
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  toolName: string | undefined,
): ToolCapabilityDescriptor | undefined {
  const normalizedName = normalizeToolName(toolName || '');
  if (!normalizedName) {
    return undefined;
  }
  const tool = tools.find((candidate) => normalizeToolName(candidate.name) === normalizedName);
  return tool ? inferToolCapabilityDescriptor(tool) : undefined;
}
