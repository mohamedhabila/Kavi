import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName } from './toolNameNormalization';
import { TOOL_DEFINITIONS } from './definitions';
import { ALL_NATIVE_TOOL_DEFINITIONS } from './native/definitions';
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
  | 'delete'
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
  | 'unknown'
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
  'delete',
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
  'unknown',
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

export function inferToolCapabilityDescriptor(
  tool: Pick<ToolDefinition, 'name' | 'description' | 'contract'>,
): ToolCapabilityDescriptor {
  const explicit =
    explicitDescriptor(tool) ?? explicitDescriptor(canonicalBuiltInContractTool(tool) ?? tool);
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
    sideEffects: resolveSource(normalizedName) === 'built-in' ? ['none'] : ['unknown'],
  });
}
