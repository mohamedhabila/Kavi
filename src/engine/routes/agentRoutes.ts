import type { AgentRunRouteState, ToolDefinition } from '../../types';
import {
  buildToolCapabilityRegistry,
  descriptorSatisfiesRequirement,
  findToolDescriptorByName,
  inferToolCapabilityDescriptor,
  selectToolNamesForCapabilityRequirements,
  type ToolCapability,
  type ToolCapabilityDescriptor,
  type ToolCapabilityRequirement,
  type ToolWorkflowStage,
} from '../tools/capabilityRegistry';
import { normalizeToolName } from '../tools/toolNameNormalization';

export type WorkflowRouteId = 'capability-workflow';

export interface WorkflowRoutePhaseSpec {
  id: string;
  title: string;
  stage: ToolWorkflowStage;
  requiredCapabilities: ToolCapabilityRequirement[];
}

export interface WorkflowRouteActivation {
  routeId: WorkflowRouteId;
  title: string;
  phases: WorkflowRoutePhaseSpec[];
  requiredToolNames: string[];
  requiredWorkflowRequirementKeys: string[];
  workflowRequirementLabelsByKey: Record<string, string>;
  workflowRequirementToolNamesByKey: Record<string, string[]>;
  guidance: string;
}

export interface WorkflowRoutePlannerSignal {
  routeMode?: 'execution' | 'discovery' | 'research';
  requiredToolCategories?: ReadonlySet<string>;
  requiredCapabilities?: ReadonlySet<ToolCapability>;
  plannedToolNames?: ReadonlySet<string>;
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>;
}

export interface WorkflowRouteToolResult {
  toolName: string;
  result: string;
  status: 'completed' | 'failed';
  timestamp: number;
}

const STAGE_ORDER: ToolWorkflowStage[] = [
  'discover_resource',
  'inspect_resource',
  'prepare_artifact',
  'persist_artifact',
  'mutate_remote_state',
  'start_external_execution',
  'monitor_external_execution',
  'await_external_execution',
  'verify_evidence',
  'guarded_resource_creation',
];

const STAGE_TITLES: Record<ToolWorkflowStage, string> = {
  discover_resource: 'Discover required resources',
  inspect_resource: 'Inspect current state',
  prepare_artifact: 'Prepare artifacts',
  persist_artifact: 'Persist artifacts',
  mutate_remote_state: 'Apply remote side effects',
  start_external_execution: 'Start external execution',
  monitor_external_execution: 'Monitor external execution',
  await_external_execution: 'Wait for external execution',
  verify_evidence: 'Verify evidence',
  guarded_resource_creation: 'Create resource only after resolution',
};

const SIDE_EFFECT_CAPABILITIES = new Set<ToolCapability>([
  'write',
  'commit',
  'push',
  'deploy',
  'monitor',
  'wait',
  'verify',
]);

const NON_SPECIFIC_EVIDENCE_KINDS = new Set(['verification', 'blocker']);
const REQUIRED_OBSERVED_CAPABILITIES = new Set<ToolCapability>([
  'write',
  'commit',
  'push',
  'deploy',
]);
const EVIDENCE_REQUIRED_WORKFLOW_STAGES = new Set<ToolWorkflowStage>([
  'discover_resource',
  'inspect_resource',
  'prepare_artifact',
  'persist_artifact',
  'mutate_remote_state',
  'start_external_execution',
  'monitor_external_execution',
  'await_external_execution',
  'verify_evidence',
  'guarded_resource_creation',
]);

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter((value) => value.trim().length > 0)));
}

function normalizeCategory(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function descriptorRequiresExecution(descriptor: ToolCapabilityDescriptor): boolean {
  return (
    descriptor.sideEffects.some((sideEffect) => sideEffect !== 'none') ||
    descriptor.capabilities.some((capability) => SIDE_EFFECT_CAPABILITIES.has(capability)) ||
    descriptor.providesEvidence.length > 0
  );
}

function descriptorNeedsResourceResolution(descriptor: ToolCapabilityDescriptor): boolean {
  return descriptorRequiresExecution(descriptor) ||
    descriptor.workflowStages.some(
      (stage) => stage !== 'discover_resource' && stage !== 'inspect_resource',
    );
}

function addResourceResolutionRequirements(
  requirements: ToolCapabilityRequirement[],
  descriptor: ToolCapabilityDescriptor,
  availableDescriptors?: ReadonlyArray<ToolCapabilityDescriptor>,
): void {
  if (!descriptorNeedsResourceResolution(descriptor)) {
    return;
  }

  for (const resourceKind of descriptor.resourceKinds) {
    if (resourceKind === 'unknown') {
      continue;
    }
    const canDiscover =
      !availableDescriptors ||
      availableDescriptors.some(
        (candidate) =>
          candidate.category === descriptor.category &&
          candidate.resourceKinds.includes(resourceKind) &&
          candidate.capabilities.includes('discover') &&
          candidate.workflowStages.includes('discover_resource'),
      );
    const canRead =
      !availableDescriptors ||
      availableDescriptors.some(
        (candidate) =>
          candidate.category === descriptor.category &&
          candidate.resourceKinds.includes(resourceKind) &&
          candidate.capabilities.includes('read') &&
          candidate.workflowStages.includes('inspect_resource'),
      );
    if (canDiscover) {
      requirements.push({
        category: descriptor.category,
        capability: 'discover',
        resourceKind,
        workflowStage: 'discover_resource',
      });
    }
    if (canRead) {
      requirements.push({
        category: descriptor.category,
        capability: 'read',
        resourceKind,
        workflowStage: 'inspect_resource',
      });
    }
  }
}

function descriptorProvidesSpecificEvidence(descriptor: ToolCapabilityDescriptor): boolean {
  return descriptor.providesEvidence.some(
    (evidenceKind) => !NON_SPECIFIC_EVIDENCE_KINDS.has(evidenceKind),
  );
}

function addDescriptorWorkflowRequirements(
  requirements: ToolCapabilityRequirement[],
  descriptor: ToolCapabilityDescriptor,
  options?: {
    capabilities?: ReadonlySet<ToolCapability>;
    stages?: ReadonlySet<ToolWorkflowStage>;
  },
): void {
  const capabilities = descriptor.capabilities.filter(
    (capability) =>
      SIDE_EFFECT_CAPABILITIES.has(capability) &&
      (!options?.capabilities || options.capabilities.has(capability)),
  );
  const stages = descriptor.workflowStages.filter(
    (stage) => !options?.stages || options.stages.has(stage),
  );

  for (const stage of stages) {
    for (const capability of capabilities) {
      requirements.push({
        category: descriptor.category,
        capability,
        workflowStage: stage,
      });
    }
  }
}

function addCategoryExecutionLifecycleRequirements(
  requirements: ToolCapabilityRequirement[],
  categories: ReadonlyArray<string>,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  plannedDescriptors: ReadonlyArray<ToolCapabilityDescriptor>,
): void {
  const registry = buildToolCapabilityRegistry(tools);

  for (const category of categories) {
    const descriptors = Array.from(registry.values()).filter(
      (descriptor) => normalizeCategory(descriptor.category) === category,
    );

    for (const descriptor of descriptors) {
      addResourceResolutionRequirements(requirements, descriptor, descriptors);
    }

    const hasLocalArtifactWriter = descriptors.some(
      (descriptor) =>
        descriptor.sideEffects.includes('local_artifact') &&
        descriptor.capabilities.includes('write'),
    );
    if (hasLocalArtifactWriter) {
      requirements.push({
        category,
        capability: 'write',
        resourceKind: 'conversation_workspace',
        workflowStage: 'prepare_artifact',
      });
      requirements.push({
        category,
        capability: 'write',
        resourceKind: 'conversation_workspace',
        workflowStage: 'persist_artifact',
      });
    }

    const remoteMutationDescriptors = descriptors.filter(
      (descriptor) =>
        descriptor.sideEffects.includes('remote_mutation') &&
        !descriptor.workflowStages.includes('guarded_resource_creation') &&
        descriptorProvidesSpecificEvidence(descriptor),
    );
    for (const descriptor of remoteMutationDescriptors) {
      addDescriptorWorkflowRequirements(requirements, descriptor, {
        stages: new Set(['persist_artifact', 'mutate_remote_state', 'verify_evidence']),
      });
    }

    const externalEvidenceDescriptors = descriptors.filter(
      (descriptor) =>
        descriptor.sideEffects.includes('none') &&
        shouldRequirePassiveExternalEvidenceDescriptor(
          category,
          descriptor,
          plannedDescriptors,
        ) &&
        descriptorProvidesSpecificEvidence(descriptor) &&
        descriptor.capabilities.some((capability) =>
          capability === 'monitor' || capability === 'wait' || capability === 'verify',
        ),
    );
    for (const descriptor of externalEvidenceDescriptors) {
      addDescriptorWorkflowRequirements(requirements, descriptor, {
        capabilities: new Set(['monitor', 'wait', 'verify']),
        stages: new Set([
          'monitor_external_execution',
          'await_external_execution',
          'verify_evidence',
        ]),
      });
    }
  }
}

function descriptorHasExecutionProducerSideEffect(descriptor: ToolCapabilityDescriptor): boolean {
  return descriptor.sideEffects.some(
    (sideEffect) =>
      sideEffect === 'local_artifact' ||
      sideEffect === 'remote_mutation' ||
      sideEffect === 'external_run',
  );
}

function descriptorIsConversationScopedOnly(descriptor: ToolCapabilityDescriptor): boolean {
  return descriptor.resourceKinds.every(
    (resourceKind) => resourceKind === 'conversation_workspace' || resourceKind === 'unknown',
  );
}

function shouldRequirePassiveExternalEvidenceDescriptor(
  category: string,
  descriptor: ToolCapabilityDescriptor,
  plannedDescriptors: ReadonlyArray<ToolCapabilityDescriptor>,
): boolean {
  if (!descriptorIsConversationScopedOnly(descriptor)) {
    return true;
  }

  return plannedDescriptors.some(
    (plannedDescriptor) =>
      normalizeCategory(plannedDescriptor.category) === category &&
      descriptorHasExecutionProducerSideEffect(plannedDescriptor) &&
      descriptorProvidesSpecificEvidence(plannedDescriptor),
  );
}

function getPlannedToolDescriptors(signal: WorkflowRoutePlannerSignal): ToolCapabilityDescriptor[] {
  return Array.from(signal.plannedToolNames ?? [])
    .map((toolName) => findToolDescriptorByName(signal.tools, toolName))
    .filter((descriptor): descriptor is ToolCapabilityDescriptor => Boolean(descriptor));
}

function buildCapabilityRequirements(
  signal: WorkflowRoutePlannerSignal,
  plannedDescriptors: ToolCapabilityDescriptor[],
): ToolCapabilityRequirement[] {
  const requirements: ToolCapabilityRequirement[] = [];
  const requiredCategories = Array.from(signal.requiredToolCategories ?? [])
    .map(normalizeCategory)
    .filter((category): category is string => Boolean(category));
  const availableDescriptors = Array.from(buildToolCapabilityRegistry(signal.tools).values());

  for (const capability of signal.requiredCapabilities ?? []) {
    if (SIDE_EFFECT_CAPABILITIES.has(capability) || capability === 'discover' || capability === 'read') {
      if (requiredCategories.length > 0) {
        for (const category of requiredCategories) {
          requirements.push({ category, capability });
        }
      } else {
        requirements.push({ capability });
      }
    }
  }

  if (signal.routeMode === 'execution') {
    addCategoryExecutionLifecycleRequirements(
      requirements,
      requiredCategories,
      signal.tools,
      plannedDescriptors,
    );
  }

  for (const descriptor of plannedDescriptors) {
    if (!descriptorRequiresExecution(descriptor)) {
      continue;
    }
    addResourceResolutionRequirements(requirements, descriptor, availableDescriptors);
    for (const capability of descriptor.capabilities) {
      if (SIDE_EFFECT_CAPABILITIES.has(capability)) {
        requirements.push({ category: descriptor.category, capability });
      }
    }
    for (const workflowStage of descriptor.workflowStages) {
      requirements.push({ category: descriptor.category, workflowStage });
    }
  }

  return requirements;
}

function dedupeRequirements(
  requirements: ReadonlyArray<ToolCapabilityRequirement>,
): ToolCapabilityRequirement[] {
  const seen = new Set<string>();
  const deduped: ToolCapabilityRequirement[] = [];
  for (const requirement of requirements) {
    const key = JSON.stringify({
      category: requirement.category,
      capability: requirement.capability,
      resourceKind: requirement.resourceKind,
      evidenceKind: requirement.evidenceKind,
      workflowStage: requirement.workflowStage,
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(requirement);
  }
  return deduped;
}

function buildWorkflowPhasesFromDescriptors(
  descriptors: ReadonlyArray<ToolCapabilityDescriptor>,
  requirements: ReadonlyArray<ToolCapabilityRequirement>,
): WorkflowRoutePhaseSpec[] {
  const stages = new Set<ToolWorkflowStage>();
  for (const requirement of requirements) {
    if (requirement.workflowStage) {
      stages.add(requirement.workflowStage);
    }
  }
  for (const descriptor of descriptors) {
    for (const stage of descriptor.workflowStages) {
      stages.add(stage);
    }
  }

  return STAGE_ORDER
    .filter((stage) => stages.has(stage))
    .map((stage) => ({
      id: stage,
      title: STAGE_TITLES[stage],
      stage,
      requiredCapabilities: requirements.filter(
        (requirement) => requirement.workflowStage === stage,
      ),
    }));
}

function buildGenericWorkflowGuidance(params: {
  requiredCapabilities: ReadonlySet<ToolCapability>;
  requiredCategories: ReadonlySet<string>;
  requiredToolNames: string[];
}): string {
  const capabilities = Array.from(params.requiredCapabilities);
  const categories = Array.from(params.requiredCategories).filter(Boolean);
  return [
    '## Active Capability Workflow',
    'Treat tool use as a capability graph, not a keyword match. Complete the user-visible side effects and collect evidence from tools whose contracts cover the required capabilities.',
    capabilities.length > 0
      ? `Required capabilities: ${capabilities.join(', ')}.`
      : 'No explicit required capabilities were emitted; infer next actions from the selected tool contracts and verified evidence.',
    categories.length > 0
      ? `Required tool families: ${categories.join(', ')}.`
      : undefined,
    params.requiredToolNames.length > 0
      ? `Contract-matched tools available this turn: ${params.requiredToolNames.join(', ')}.`
      : 'A required capability is not loaded yet. Use the capability catalog to discover an exact tool instead of guessing.',
    'A local artifact or read-only result cannot satisfy a requested remote mutation, external execution, or verification unless a tool result explicitly provides that evidence.',
    'Use guarded resource-creation tools only after resource discovery cannot resolve an existing suitable resource or the user explicitly requested a new resource.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function resolveWorkflowRouteActivation(
  signal: WorkflowRoutePlannerSignal,
): WorkflowRouteActivation | undefined {
  if (signal.routeMode !== 'execution') {
    return undefined;
  }

  const plannedDescriptors = getPlannedToolDescriptors(signal);
  const registry = buildToolCapabilityRegistry(signal.tools);
  const initialRequirements = dedupeRequirements(buildCapabilityRequirements(signal, plannedDescriptors));
  const initialSelectedToolNames = selectToolNamesForCapabilityRequirements(
    signal.tools,
    initialRequirements,
  );
  const initialSelectedDescriptors = initialSelectedToolNames
    .map((toolName) => registry.get(normalizeToolName(toolName)))
    .filter((descriptor): descriptor is ToolCapabilityDescriptor => Boolean(descriptor));
  const requirements = dedupeRequirements([
    ...initialRequirements,
    ...initialSelectedDescriptors.flatMap((descriptor) => {
      const addedRequirements: ToolCapabilityRequirement[] = [];
      addResourceResolutionRequirements(addedRequirements, descriptor, Array.from(registry.values()));
      return addedRequirements;
    }),
  ]);
  const selectedToolNames = selectToolNamesForCapabilityRequirements(signal.tools, requirements);
  const selectedDescriptors = selectedToolNames
    .map((toolName) => registry.get(normalizeToolName(toolName)))
    .filter((descriptor): descriptor is ToolCapabilityDescriptor => Boolean(descriptor));
  const allDescriptors = [...plannedDescriptors, ...selectedDescriptors];
  const hasExecutionRequirement =
    requirements.some((requirement) =>
      requirement.capability ? SIDE_EFFECT_CAPABILITIES.has(requirement.capability) : false,
    ) || allDescriptors.some(descriptorRequiresExecution);

  if (!hasExecutionRequirement) {
    return undefined;
  }

  const phases = buildWorkflowPhasesFromDescriptors(allDescriptors, requirements);
  if (phases.length === 0) {
    return undefined;
  }
  const requirementIndex = buildWorkflowRequirementIndex({
    phases,
    selectedDescriptors: allDescriptors,
  });

  const requiredCategories = new Set(
    Array.from(signal.requiredToolCategories ?? [])
      .map(normalizeCategory)
      .filter((category): category is string => Boolean(category)),
  );

  return {
    routeId: 'capability-workflow',
    title: 'Capability workflow',
    phases,
    requiredToolNames: selectedToolNames,
    ...requirementIndex,
    guidance: buildGenericWorkflowGuidance({
      requiredCapabilities: signal.requiredCapabilities ?? new Set<ToolCapability>(),
      requiredCategories,
      requiredToolNames: selectedToolNames,
    }),
  };
}

export function buildInitialWorkflowRouteState(
  activation: WorkflowRouteActivation,
  timestamp: number,
): AgentRunRouteState {
  const phases = activation.phases.map((phase, index) => ({
    id: phase.id,
    title: phase.title,
    status: index === 0 ? ('active' as const) : ('pending' as const),
    requiredCapabilities: phase.requiredCapabilities.map((requirement) => ({ ...requirement })),
    updatedAt: timestamp,
  }));

  return {
    routeId: activation.routeId,
    title: activation.title,
    status: 'active',
    currentPhaseId: phases[0]?.id ?? 'capability-workflow',
    phases,
    requiredToolNames: activation.requiredToolNames,
    facts: {
      requiredWorkflowRequirementKeys: [...activation.requiredWorkflowRequirementKeys],
      workflowRequirementLabelsByKey: { ...activation.workflowRequirementLabelsByKey },
      workflowRequirementToolNamesByKey: Object.fromEntries(
        Object.entries(activation.workflowRequirementToolNamesByKey).map(([key, value]) => [
          key,
          [...value],
        ]),
      ),
    },
    updatedAt: timestamp,
  };
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function getDescriptorForTool(
  toolName: string,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): ToolCapabilityDescriptor {
  return (
    findToolDescriptorByName(tools, toolName) ??
    inferToolCapabilityDescriptor({ name: normalizeToolName(toolName), description: toolName })
  );
}

function resultHasTerminalEvidence(result: string): boolean {
  const parsed = parseJsonObject(result);
  if (!parsed) {
    return false;
  }

  return [parsed.status, parsed.conclusion, parsed.result, parsed.state].some(
    (value) =>
      typeof value === 'string' &&
      ['completed', 'success', 'succeeded', 'failed', 'cancelled', 'timed_out'].includes(
        value.toLowerCase(),
      ),
  );
}

type WorkflowResultDisposition =
  | { kind: 'ok' }
  | { kind: 'recoverable'; detail: string }
  | { kind: 'blocked'; detail: string };

const HARD_BLOCK_RESULT_STATES = new Set([
  'missing_configuration',
  'missing_permission',
  'permission_denied',
  'requires_approval',
  'unauthorized',
  'forbidden',
]);

function summarizeToolResultDetail(result: string): string {
  const normalized = result.trim();
  return (normalized || 'Tool returned no usable result.').slice(0, 240);
}

function classifyWorkflowResultDisposition(
  result: string,
  status: WorkflowRouteToolResult['status'],
): WorkflowResultDisposition {
  if (status === 'failed') {
    return { kind: 'recoverable', detail: summarizeToolResultDetail(result) };
  }

  const parsed = parseJsonObject(result);
  if (!parsed) {
    return result.trim().startsWith('Error:')
      ? { kind: 'recoverable', detail: summarizeToolResultDetail(result) }
      : { kind: 'ok' };
  }

  const state = [parsed.status, parsed.state, parsed.result, parsed.conclusion]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase())
    .find((value) =>
      [
        'blocked',
        'error',
        'failed',
        'cancelled',
        'timed_out',
        'not_found',
        'ambiguous',
        'missing_configuration',
        'missing_permission',
        'permission_denied',
        'requires_approval',
        'unauthorized',
        'forbidden',
      ].includes(value),
    );
  if (!state) {
    return { kind: 'ok' };
  }

  const detail =
    typeof parsed.message === 'string'
      ? parsed.message
      : typeof parsed.guidance === 'string'
        ? parsed.guidance
        : typeof parsed.error === 'string'
          ? parsed.error
          : `Tool result status: ${state}`;

  if (HARD_BLOCK_RESULT_STATES.has(state)) {
    return { kind: 'blocked', detail: detail.slice(0, 240) };
  }

  if (
    (state === 'failed' || state === 'cancelled' || state === 'timed_out') &&
    resultHasTerminalEvidence(result) &&
    typeof parsed.error !== 'string'
  ) {
    return { kind: 'ok' };
  }

  return { kind: 'recoverable', detail: detail.slice(0, 240) };
}

function workflowRequirementKey(requirement: ToolCapabilityRequirement): string {
  return JSON.stringify({
    category: requirement.category,
    capability: requirement.capability,
    resourceKind: requirement.resourceKind,
    evidenceKind: requirement.evidenceKind,
    workflowStage: requirement.workflowStage,
  });
}

function workflowRequirementRequiresCompletionEvidence(
  requirement: ToolCapabilityRequirement,
): boolean {
  if (requirement.evidenceKind) {
    return true;
  }

  if (requirement.capability && SIDE_EFFECT_CAPABILITIES.has(requirement.capability)) {
    return true;
  }

  return requirement.workflowStage
    ? EVIDENCE_REQUIRED_WORKFLOW_STAGES.has(requirement.workflowStage)
    : false;
}

function formatWorkflowRequirementLabel(
  requirement: ToolCapabilityRequirement,
  phase?: WorkflowRoutePhaseSpec,
): string {
  return [
    phase?.title,
    requirement.category ? `category ${requirement.category}` : undefined,
    requirement.capability ? `capability ${requirement.capability}` : undefined,
    requirement.resourceKind ? `resource ${requirement.resourceKind}` : undefined,
    requirement.evidenceKind ? `evidence ${requirement.evidenceKind}` : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' / ');
}

function buildWorkflowRequirementIndex(params: {
  phases: ReadonlyArray<WorkflowRoutePhaseSpec>;
  selectedDescriptors: ReadonlyArray<ToolCapabilityDescriptor>;
}): {
  requiredWorkflowRequirementKeys: string[];
  workflowRequirementLabelsByKey: Record<string, string>;
  workflowRequirementToolNamesByKey: Record<string, string[]>;
} {
  const keys: string[] = [];
  const labelsByKey: Record<string, string> = {};
  const toolNamesByKey: Record<string, string[]> = {};

  for (const phase of params.phases) {
    for (const requirement of phase.requiredCapabilities) {
      if (!workflowRequirementRequiresCompletionEvidence(requirement)) {
        continue;
      }

      const key = workflowRequirementKey(requirement);
      if (!keys.includes(key)) {
        keys.push(key);
      }
      labelsByKey[key] = labelsByKey[key] || formatWorkflowRequirementLabel(requirement, phase);
      const matchingToolNames = params.selectedDescriptors
        .filter((descriptor) => descriptorSatisfiesRequirement(descriptor, requirement))
        .map((descriptor) => descriptor.name)
        .filter(Boolean);
      toolNamesByKey[key] = uniqueStrings([...(toolNamesByKey[key] ?? []), ...matchingToolNames]);
    }
  }

  return {
    requiredWorkflowRequirementKeys: keys,
    workflowRequirementLabelsByKey: labelsByKey,
    workflowRequirementToolNamesByKey: toolNamesByKey,
  };
}

function readCompletedWorkflowRequirementKeys(state: AgentRunRouteState): Set<string> {
  const rawKeys = state.facts?.completedWorkflowRequirementKeys;
  return new Set(
    Array.isArray(rawKeys)
      ? rawKeys.filter((key): key is string => typeof key === 'string' && key.length > 0)
      : [],
  );
}

function readRequiredWorkflowRequirementKeys(state: AgentRunRouteState): string[] {
  const rawKeys = state.facts?.requiredWorkflowRequirementKeys;
  return Array.isArray(rawKeys)
    ? uniqueStrings(rawKeys.filter((key): key is string => typeof key === 'string'))
    : [];
}

function readWorkflowRequirementLabelsByKey(state: AgentRunRouteState): Record<string, string> {
  const rawLabels = state.facts?.workflowRequirementLabelsByKey;
  if (!rawLabels || typeof rawLabels !== 'object' || Array.isArray(rawLabels)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawLabels).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'string',
    ),
  );
}

function readWorkflowRequirementToolNamesByKey(
  state: AgentRunRouteState,
): Record<string, string[]> {
  const rawToolNames = state.facts?.workflowRequirementToolNamesByKey;
  if (!rawToolNames || typeof rawToolNames !== 'object' || Array.isArray(rawToolNames)) {
    return {};
  }

  const normalized: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rawToolNames)) {
    if (!Array.isArray(value)) {
      continue;
    }
    normalized[key] = uniqueStrings(
      value.filter((toolName): toolName is string => typeof toolName === 'string'),
    );
  }
  return normalized;
}

function buildObservedToolNameSet(observedToolNames?: Iterable<string>): Set<string> {
  return new Set(
    Array.from(observedToolNames ?? [])
      .map((toolName) => normalizeToolName(toolName))
      .filter(Boolean),
  );
}

function getMissingWorkflowRequirementKeys(
  state: AgentRunRouteState,
  _observedToolNames?: Iterable<string>,
): string[] {
  const requiredRequirementKeys = readRequiredWorkflowRequirementKeys(state);
  if (requiredRequirementKeys.length === 0) {
    return [];
  }

  const completedRequirementKeys = readCompletedWorkflowRequirementKeys(state);
  return requiredRequirementKeys.filter((key) => {
    return !completedRequirementKeys.has(key);
  });
}

function canToolResultSatisfyWorkflowRequirement(
  descriptor: ToolCapabilityDescriptor,
  requirement: ToolCapabilityRequirement,
  toolResult: WorkflowRouteToolResult,
): boolean {
  if (!descriptorSatisfiesRequirement(descriptor, requirement)) {
    return false;
  }

  if (toolResult.status !== 'completed') {
    return false;
  }

  if (
    (requirement.workflowStage === 'await_external_execution' ||
      requirement.workflowStage === 'verify_evidence') &&
    descriptor.capabilities.includes('wait') &&
    !resultHasTerminalEvidence(toolResult.result)
  ) {
    return false;
  }

  return true;
}

function advancePhasesFromCompletedRequirements(params: {
  state: AgentRunRouteState;
  activation: WorkflowRouteActivation;
  completedRequirementKeys: Set<string>;
  descriptor: ToolCapabilityDescriptor;
  toolResult: WorkflowRouteToolResult;
}): AgentRunRouteState {
  const phaseSpecsById = new Map(params.activation.phases.map((phase) => [phase.id, phase]));
  const completedStages = new Set(params.descriptor.workflowStages);
  const phases = params.state.phases.map((phase) => {
    const spec = phaseSpecsById.get(phase.id);
    const completedByRequirements =
      spec && spec.requiredCapabilities.length > 0
        ? spec.requiredCapabilities.every((requirement) =>
            params.completedRequirementKeys.has(workflowRequirementKey(requirement)),
          )
        : false;
    const completedByStage =
      (!spec || spec.requiredCapabilities.length === 0) &&
      completedStages.has(phase.id as ToolWorkflowStage);

    if (completedByRequirements || completedByStage) {
      return {
        ...phase,
        status: 'completed' as const,
        detail: `${params.toolResult.toolName} satisfied ${phase.title}.`,
        updatedAt: params.toolResult.timestamp,
      };
    }

    return {
      ...phase,
      status: phase.status === 'completed' ? ('completed' as const) : ('pending' as const),
    };
  });

  const nextActivePhase = phases.find((phase) => phase.status !== 'completed');
  const advancedPhases = nextActivePhase
    ? phases.map((phase) =>
        phase.id === nextActivePhase.id
          ? { ...phase, status: 'active' as const, updatedAt: params.toolResult.timestamp }
          : phase,
      )
    : phases;

  return {
    ...params.state,
    status: nextActivePhase ? 'active' : 'completed',
    currentPhaseId: nextActivePhase?.id ?? params.state.currentPhaseId,
    phases: advancedPhases,
    facts: {
      ...(params.state.facts ?? {}),
      completedWorkflowRequirementKeys: Array.from(params.completedRequirementKeys),
      lastAdvancedByTool: params.toolResult.toolName,
    },
    updatedAt: params.toolResult.timestamp,
  };
}

export function advanceWorkflowRouteStateFromToolResult(
  state: AgentRunRouteState | undefined,
  toolResult: WorkflowRouteToolResult,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  activation?: WorkflowRouteActivation,
): AgentRunRouteState | undefined {
  if (!state || state.routeId !== 'capability-workflow') {
    return state;
  }

  const descriptor = getDescriptorForTool(toolResult.toolName, tools);
  if (descriptor.workflowStages.length === 0) {
    return state;
  }

  const disposition = classifyWorkflowResultDisposition(toolResult.result, toolResult.status);
  if (disposition.kind === 'blocked') {
    const phases = state.phases.map((phase) =>
      phase.id === state.currentPhaseId
        ? {
            ...phase,
            status: 'blocked' as const,
            detail: disposition.detail,
            updatedAt: toolResult.timestamp,
          }
        : phase,
    );
    return {
      ...state,
      status: 'blocked',
      phases,
      blockers: Array.from(new Set([...(state.blockers ?? []), disposition.detail])),
      updatedAt: toolResult.timestamp,
    };
  }

  if (disposition.kind === 'recoverable') {
    const phases = state.phases.map((phase) =>
      phase.id === state.currentPhaseId
        ? {
            ...phase,
            status: 'active' as const,
            detail: disposition.detail,
            updatedAt: toolResult.timestamp,
          }
        : phase,
    );
    const recoverableErrorCount =
      typeof state.facts?.recoverableErrorCount === 'number'
        ? state.facts.recoverableErrorCount + 1
        : 1;

    return {
      ...state,
      status: 'active',
      phases,
      facts: {
        ...(state.facts ?? {}),
        recoverableErrorCount,
        lastRecoverableToolError: disposition.detail,
        lastRecoverableToolName: toolResult.toolName,
      },
      updatedAt: toolResult.timestamp,
    };
  }

  if (activation && activation.routeId === state.routeId) {
    const completedRequirementKeys = readCompletedWorkflowRequirementKeys(state);
    for (const phase of activation.phases) {
      for (const requirement of phase.requiredCapabilities) {
        if (canToolResultSatisfyWorkflowRequirement(descriptor, requirement, toolResult)) {
          completedRequirementKeys.add(workflowRequirementKey(requirement));
        }
      }
    }

    return advancePhasesFromCompletedRequirements({
      state,
      activation,
      completedRequirementKeys,
      descriptor,
      toolResult,
    });
  }

  const completedStages = new Set(descriptor.workflowStages);
  if (descriptor.capabilities.includes('wait') && !resultHasTerminalEvidence(toolResult.result)) {
    completedStages.delete('await_external_execution');
    completedStages.delete('verify_evidence');
  }

  const phases = state.phases.map((phase) =>
    completedStages.has(phase.id as ToolWorkflowStage)
      ? {
          ...phase,
          status: 'completed' as const,
          detail: `${toolResult.toolName} completed.`,
          updatedAt: toolResult.timestamp,
        }
      : phase,
  );
  const nextActivePhase = phases.find((phase) => phase.status === 'pending');
  const advancedPhases = nextActivePhase
    ? phases.map((phase) =>
        phase.id === nextActivePhase.id
          ? { ...phase, status: 'active' as const, updatedAt: toolResult.timestamp }
          : phase,
      )
    : phases;

  return {
    ...state,
    status: nextActivePhase ? 'active' : 'completed',
    currentPhaseId: nextActivePhase?.id ?? state.currentPhaseId,
    phases: advancedPhases,
    facts: {
      ...(state.facts ?? {}),
      lastAdvancedByTool: toolResult.toolName,
    },
    updatedAt: toolResult.timestamp,
  };
}

function buildSeededWorkflowRouteState(
  activation: WorkflowRouteActivation,
  seedState: AgentRunRouteState | undefined,
  timestamp: number,
): AgentRunRouteState {
  const initialState = buildInitialWorkflowRouteState(activation, timestamp);
  if (!seedState || seedState.routeId !== activation.routeId) {
    return initialState;
  }

  const seedCompletedRequirementKeys = Array.isArray(
    seedState.facts?.completedWorkflowRequirementKeys,
  )
    ? { completedWorkflowRequirementKeys: [...seedState.facts.completedWorkflowRequirementKeys] }
    : {};

  return {
    ...initialState,
    blockers: seedState.blockers?.length ? [...seedState.blockers] : initialState.blockers,
    facts: {
      ...(seedState.facts ?? {}),
      ...(initialState.facts ?? {}),
      ...seedCompletedRequirementKeys,
    },
  };
}

export function replayWorkflowRouteStateFromToolResults(
  activation: WorkflowRouteActivation,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  toolResults: ReadonlyArray<WorkflowRouteToolResult>,
  options?: {
    seedState?: AgentRunRouteState;
    timestamp?: number;
  },
): AgentRunRouteState {
  let state = buildSeededWorkflowRouteState(
    activation,
    options?.seedState,
    options?.timestamp ?? Date.now(),
  );

  for (const toolResult of toolResults) {
    const nextState = advanceWorkflowRouteStateFromToolResult(
      state,
      toolResult,
      tools,
      activation,
    );
    if (nextState) {
      state = nextState;
    }
  }

  return state;
}

export function selectToolNamesForWorkflowRoutePhase(
  activation: WorkflowRouteActivation | undefined,
  state: AgentRunRouteState | undefined,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): string[] {
  if (!activation || !state || state.routeId !== activation.routeId || state.status !== 'active') {
    return [];
  }

  const currentPhase = activation.phases.find((phase) => phase.id === state.currentPhaseId);
  if (!currentPhase) {
    return activation.requiredToolNames;
  }

  const registry = buildToolCapabilityRegistry(tools);
  const completedRequirementKeys = readCompletedWorkflowRequirementKeys(state);
  const outstandingRequirements = currentPhase.requiredCapabilities.filter(
    (requirement) => !completedRequirementKeys.has(workflowRequirementKey(requirement)),
  );
  const phaseToolNames = activation.requiredToolNames.filter((toolName) => {
    const descriptor = registry.get(normalizeToolName(toolName));
    if (!descriptor?.workflowStages.includes(currentPhase.stage)) {
      return false;
    }

    if (currentPhase.requiredCapabilities.length === 0) {
      return true;
    }

    return outstandingRequirements.some((requirement) =>
      descriptorSatisfiesRequirement(descriptor, requirement),
    );
  });

  const requirementToolNames = selectToolNamesForCapabilityRequirements(
    tools,
    outstandingRequirements,
  );

  const selected = uniqueStrings([...phaseToolNames, ...requirementToolNames]);
  return selected.length > 0 ? selected : [];
}

export function selectToolNamesForWorkflowRouteTurn(
  activation: WorkflowRouteActivation | undefined,
  state: AgentRunRouteState | undefined,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  observedToolNames?: Iterable<string>,
): string[] {
  if (!activation || !state || state.routeId !== activation.routeId || state.status !== 'active') {
    return [];
  }

  const phaseToolNames = selectToolNamesForWorkflowRoutePhase(activation, state, tools);
  if (phaseToolNames.length > 0) {
    return phaseToolNames;
  }

  const observed = new Set(
    Array.from(observedToolNames ?? [])
      .map((toolName) => normalizeToolName(toolName))
      .filter(Boolean),
  );
  const completedRequirementKeys = readCompletedWorkflowRequirementKeys(state);
  const outstandingRequirements = activation.phases
    .filter((phase) => {
      const routePhase = state.phases.find((candidate) => candidate.id === phase.id);
      return routePhase?.status === 'active' || routePhase?.status === 'pending';
    })
    .flatMap((phase) => phase.requiredCapabilities)
    .filter((requirement) => !completedRequirementKeys.has(workflowRequirementKey(requirement)));
  const fallbackToolNames = activation.requiredToolNames.filter((toolName) => {
    const normalizedToolName = normalizeToolName(toolName);
    if (!normalizedToolName || observed.has(normalizedToolName)) {
      return false;
    }
    const descriptor = getDescriptorForTool(normalizedToolName, tools);
    return (
      descriptorRequiresObservedToolUse(descriptor) &&
      outstandingRequirements.some((requirement) =>
        descriptorSatisfiesRequirement(descriptor, requirement),
      )
    );
  });

  return uniqueStrings(fallbackToolNames);
}

export function buildWorkflowRouteRuntimeGuidance(
  activation: WorkflowRouteActivation | undefined,
  state: AgentRunRouteState | undefined,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): string | undefined {
  if (!activation || !state || state.routeId !== activation.routeId || state.status !== 'active') {
    return undefined;
  }

  const currentPhase = activation.phases.find((phase) => phase.id === state.currentPhaseId);
  const phaseToolNames = selectToolNamesForWorkflowRoutePhase(activation, state, tools);
  const lastRecoverableError =
    typeof state.facts?.lastRecoverableToolError === 'string'
      ? state.facts.lastRecoverableToolError.trim()
      : '';
  const lastRecoverableToolName =
    typeof state.facts?.lastRecoverableToolName === 'string'
      ? state.facts.lastRecoverableToolName.trim()
      : '';

  return [
    '## Capability Workflow State',
    currentPhase
      ? `Current phase: ${currentPhase.title}. Complete this phase before later workflow phases.`
      : undefined,
    phaseToolNames.length > 0
      ? `Use phase-appropriate tools now: ${phaseToolNames.join(', ')}.`
      : 'No phase-specific tool is loaded yet; discover a matching capability instead of guessing identifiers or arguments.',
    'Phase order is guidance for evidence quality, not a permission boundary. If inspection shows a requested artifact or state is absent, use loaded write, mutation, or monitoring tools that satisfy the next required capability instead of asking the user to re-authorize the already requested work.',
    'When the user has already requested artifact creation or remote execution, an absent file/resource reported by read-only inspection is workflow input, not a reason to ask for permission. Create the requested artifacts or resolve the missing prerequisite autonomously unless multiple externally visible choices remain genuinely ambiguous.',
    lastRecoverableError
      ? `Previous recoverable tool issue${lastRecoverableToolName ? ` from ${lastRecoverableToolName}` : ''}: ${lastRecoverableError}`
      : undefined,
    lastRecoverableError
      ? 'Treat the issue as feedback for the next action: correct the arguments, resolve missing prerequisites with discovery or read tools, or choose another contract-matched tool. Do not retry the same arguments.'
      : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function shouldHoldWorkflowRouteFinalization(
  state: AgentRunRouteState | undefined,
  observedToolNames?: Iterable<string>,
): boolean {
  if (!state || state.routeId !== 'capability-workflow' || state.status === 'blocked') {
    return false;
  }

  const requiredRequirementKeys = readRequiredWorkflowRequirementKeys(state);
  if (requiredRequirementKeys.length > 0) {
    return getMissingWorkflowRequirementKeys(state, observedToolNames).length > 0;
  }

  const missingRequiredTools = getMissingRequiredWorkflowToolNames(state, observedToolNames);
  if (state.status !== 'active') {
    return missingRequiredTools.length > 0;
  }

  return (
    state.phases.some((phase) => phase.status === 'active' || phase.status === 'pending') ||
    missingRequiredTools.length > 0
  );
}

function descriptorRequiresObservedToolUse(descriptor: ToolCapabilityDescriptor): boolean {
  if (descriptor.workflowStages.includes('guarded_resource_creation')) {
    return false;
  }

  if (descriptor.sideEffects.some((sideEffect) => sideEffect !== 'none')) {
    return true;
  }

  if (descriptor.capabilities.some((capability) => REQUIRED_OBSERVED_CAPABILITIES.has(capability))) {
    return true;
  }

  return descriptor.providesEvidence.some(
    (evidenceKind) => !NON_SPECIFIC_EVIDENCE_KINDS.has(evidenceKind),
  );
}

export function getMissingRequiredWorkflowToolNames(
  state: AgentRunRouteState | undefined,
  observedToolNames?: Iterable<string>,
): string[] {
  if (!state || state.routeId !== 'capability-workflow') {
    return [];
  }

  const requiredRequirementKeys = readRequiredWorkflowRequirementKeys(state);
  if (requiredRequirementKeys.length > 0) {
    const labelsByKey = readWorkflowRequirementLabelsByKey(state);
    const toolNamesByKey = readWorkflowRequirementToolNamesByKey(state);
    return getMissingWorkflowRequirementKeys(state, observedToolNames).map((key) => {
      const candidateToolNames = toolNamesByKey[key] ?? [];
      if (candidateToolNames.length > 0) {
        return candidateToolNames.join(' or ');
      }
      return labelsByKey[key] || key;
    });
  }

  if (!observedToolNames) {
    return [];
  }

  const observed = buildObservedToolNameSet(observedToolNames);
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const toolName of state.requiredToolNames ?? []) {
    const normalizedToolName = normalizeToolName(toolName);
    if (!normalizedToolName || seen.has(normalizedToolName) || observed.has(normalizedToolName)) {
      continue;
    }
    seen.add(normalizedToolName);

    const descriptor = inferToolCapabilityDescriptor({
      name: normalizedToolName,
      description: normalizedToolName,
    });
    if (descriptorRequiresObservedToolUse(descriptor)) {
      missing.push(normalizedToolName);
    }
  }

  return missing;
}

export function buildWorkflowRouteFinalizationHoldGuidance(
  activation: WorkflowRouteActivation | undefined,
  state: AgentRunRouteState | undefined,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): string {
  const runtimeGuidance = buildWorkflowRouteRuntimeGuidance(activation, state, tools);

  return [
    '[SYSTEM WORKFLOW HOLD]',
    'The assistant attempted to finalize while the capability workflow still has incomplete active or pending phases.',
    'Do not hand this draft to final review yet. Continue the existing workflow from the current phase and use contract-matched tools before writing a final answer.',
    runtimeGuidance,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}
