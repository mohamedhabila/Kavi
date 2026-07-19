import {
  isEffectFreeToolPolicy,
  resolveRuntimeExternalToolEffectPolicy,
  resolveToolEffectPolicy,
} from '../durability/toolEffectPolicy';
import { TOOL_DEFINITIONS } from '../tools/definitions';
import { inferToolCapabilityDescriptor } from '../tools/capabilityRegistry';
import { normalizeToolName, resolveRegisteredToolName } from '../tools/toolNameNormalization';
import { normalizeToolWorkflowContract } from '../tools/toolWorkflowContracts';
import type { ToolDefinition } from '../../types/tool';
import type {
  CodeOwnedToolContractIdentity,
  RuntimeExternalToolContractIdentity,
  RuntimeExternalToolEffectClass,
  RuntimeExternalToolSource,
  ToolContractIdentity,
  ToolEffectDigest,
} from '../../types/toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from './toolEffectReceiptContracts';
import { sha256HexUtf8Async } from '../../utils/sha256Async';

const CODE_OWNED_IDENTITY_VERSION = 1 as const;
const RUNTIME_EXTERNAL_IDENTITY_VERSION = 2 as const;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const UNSAFE_DECLARATION_TEXT_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

const CODE_OWNED_TOOL_BY_NAME = new Map(
  TOOL_DEFINITIONS.map((tool) => [normalizeToolName(tool.name), tool] as const),
);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBoundedIdentityPart(value: unknown, maximumLength = 512): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function isBoundedDeclarationText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim().length > 0 &&
    !UNSAFE_DECLARATION_TEXT_PATTERN.test(value)
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  throw new TypeError('Tool contract identity contains a non-canonical value.');
}

async function digestContractComponent(
  domain: string,
  value: unknown,
  identityVersion: 1 | 2 = CODE_OWNED_IDENTITY_VERSION,
): Promise<ToolEffectDigest> {
  const canonical = JSON.stringify({
    domain,
    identityVersion,
    value: canonicalize(value),
  });
  const digest = await sha256HexUtf8Async(canonical);
  return `sha256:${digest.toLowerCase()}`;
}

function capabilityMaterial(tool: ToolDefinition): Record<string, unknown> {
  const descriptor = inferToolCapabilityDescriptor(tool);
  return {
    name: descriptor.name,
    source: descriptor.source,
    namespace: descriptor.namespace,
    category: descriptor.category,
    capabilities: descriptor.capabilities,
    resourceKinds: descriptor.resourceKinds,
    riskHints: descriptor.riskHints,
    riskLevel: descriptor.riskLevel,
    prerequisites: descriptor.prerequisites,
    permissionPrerequisites: descriptor.permissionPrerequisites,
    recoverableErrors: descriptor.recoverableErrors,
    providesEvidence: descriptor.providesEvidence,
    inputExamples: descriptor.inputExamples,
    outputSchema: descriptor.outputSchema,
  };
}

function workflowMaterial(tool: ToolDefinition): Record<string, unknown> {
  const descriptor = inferToolCapabilityDescriptor(tool);
  const workflow = normalizeToolWorkflowContract(tool.contract);
  return {
    name: descriptor.name,
    workflowStages: descriptor.workflowStages,
    produces: workflow.produces,
    consumes: workflow.consumes,
    precedes: workflow.precedes,
    requiresPermissionEvidence: workflow.requiresPermissionEvidence,
  };
}

function resolveEligibleCodeOwnedTool(rawToolName: string): ToolDefinition | undefined {
  const toolName = resolveRegisteredToolName(rawToolName);
  const tool = CODE_OWNED_TOOL_BY_NAME.get(toolName);
  if (!tool?.contract) {
    return undefined;
  }
  const effectContract = getCodeOwnedToolEffectContract(toolName);
  const executionPolicy = resolveToolEffectPolicy(toolName);
  if (!effectContract || executionPolicy.source !== 'builtin') {
    return undefined;
  }
  return tool;
}

/**
 * Returns a contract identity only for a reviewed first-party registry entry.
 * Dynamic MCP/skill declarations and caller-supplied schemas cannot mint one.
 */
export async function buildCodeOwnedToolContractIdentity(
  rawToolName: string,
): Promise<CodeOwnedToolContractIdentity | undefined> {
  const tool = resolveEligibleCodeOwnedTool(rawToolName);
  if (!tool) {
    return undefined;
  }
  const toolName = normalizeToolName(tool.name);
  const effectContract = getCodeOwnedToolEffectContract(toolName)!;
  const executionPolicy = resolveToolEffectPolicy(toolName);
  const [
    schemaDigest,
    capabilityContractDigest,
    workflowContractDigest,
    effectContractDigest,
    executionPolicyDigest,
  ] = await Promise.all([
    digestContractComponent('kavi.tool.schema', {
      name: toolName,
      description: tool.description,
      inputSchema: tool.input_schema,
      strict: tool.strict ?? 'auto',
    }),
    digestContractComponent('kavi.tool.capability', capabilityMaterial(tool)),
    digestContractComponent('kavi.tool.workflow', workflowMaterial(tool)),
    digestContractComponent('kavi.tool.effect', {
      name: toolName,
      contract: effectContract,
    }),
    digestContractComponent('kavi.tool.execution-policy', executionPolicy),
  ]);

  return Object.freeze({
    kind: 'code_owned' as const,
    version: CODE_OWNED_IDENTITY_VERSION,
    toolName,
    schemaDigest,
    capabilityContractDigest,
    workflowContractDigest,
    effectContractDigest,
    executionPolicyDigest,
  });
}

export type RuntimeExternalToolProvenance =
  | Readonly<{
      source: 'mcp';
      namespace: string;
      connectionGeneration: number;
      toolRegistryGeneration: number;
      runtimeProcessEpoch: string;
      targetIdentity: string;
      sseTargetIdentity?: string;
      transport: 'auto' | 'streamable-http' | 'sse';
      trustSource?: 'manual' | 'official-registry';
      registryName?: string;
      toolAnnotationsTrusted?: true;
    }>
  | Readonly<{
      source: 'skill';
      namespace: string;
      registrationGeneration: number;
      runtimeProcessEpoch: string;
      name: string;
      version: string;
      author?: string;
    }>;

export type RuntimeExternalToolEvidence = Readonly<{
  declaration: ToolDefinition;
  provenance: RuntimeExternalToolProvenance;
}>;

function resolveRuntimeExternalEffectClass(
  toolName: string,
  evidence: RuntimeExternalToolEvidence,
): RuntimeExternalToolEffectClass {
  if (
    evidence.provenance.source !== 'mcp' ||
    evidence.provenance.toolAnnotationsTrusted !== true
  ) {
    return 'unknown';
  }
  const policy = resolveRuntimeExternalToolEffectPolicy(toolName, evidence.declaration, true);
  if (!policy || policy.effects.includes('unknown')) {
    return 'unknown';
  }
  return isEffectFreeToolPolicy(policy) ? 'none' : 'potentially_effectful';
}

function parseRuntimeExternalToolName(
  toolName: string,
): { source: RuntimeExternalToolSource; namespace: string } | undefined {
  const mcp = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/u);
  if (mcp && isBoundedIdentityPart(mcp[1], 256) && isBoundedIdentityPart(mcp[2], 256)) {
    return { source: 'mcp', namespace: mcp[1] };
  }
  const skill = toolName.split('__');
  if (
    skill.length === 3 &&
    skill[0] === 'skill' &&
    isBoundedIdentityPart(skill[1], 256) &&
    isBoundedIdentityPart(skill[2], 256)
  ) {
    return { source: 'skill', namespace: skill[1] };
  }
  return undefined;
}

function isValidRuntimeProvenance(provenance: RuntimeExternalToolProvenance): boolean {
  if (
    !isBoundedIdentityPart(provenance.namespace, 256) ||
    !isBoundedIdentityPart(provenance.source, 16) ||
    !isBoundedIdentityPart(provenance.runtimeProcessEpoch, 128)
  ) {
    return false;
  }
  if (provenance.source === 'mcp') {
    return (
      Number.isSafeInteger(provenance.connectionGeneration) &&
      provenance.connectionGeneration >= 1 &&
      Number.isSafeInteger(provenance.toolRegistryGeneration) &&
      provenance.toolRegistryGeneration >= 1 &&
      isBoundedIdentityPart(provenance.targetIdentity, 2_048) &&
      (provenance.sseTargetIdentity === undefined ||
        isBoundedIdentityPart(provenance.sseTargetIdentity, 2_048)) &&
      ['auto', 'streamable-http', 'sse'].includes(provenance.transport) &&
      (provenance.trustSource === undefined ||
        provenance.trustSource === 'manual' ||
        provenance.trustSource === 'official-registry') &&
      (provenance.registryName === undefined ||
        isBoundedIdentityPart(provenance.registryName, 256)) &&
      (provenance.toolAnnotationsTrusted === undefined ||
        provenance.toolAnnotationsTrusted === true)
    );
  }
  return (
    Number.isSafeInteger(provenance.registrationGeneration) &&
    provenance.registrationGeneration >= 1 &&
    isBoundedIdentityPart(provenance.name, 256) &&
    isBoundedIdentityPart(provenance.version, 128) &&
    (provenance.author === undefined || isBoundedIdentityPart(provenance.author, 256))
  );
}

/**
 * Seals the exact dynamic declaration and runtime provenance selected by the
 * app. Trusted integration annotations can certify only whether the call is
 * effect-free; provider outcomes remain unverified and never become a
 * code-owned contract.
 */
export async function buildRuntimeExternalToolContractIdentity(
  rawToolName: string,
  evidence: RuntimeExternalToolEvidence,
): Promise<RuntimeExternalToolContractIdentity | undefined> {
  const toolName = normalizeToolName(rawToolName);
  const parsed = parseRuntimeExternalToolName(toolName);
  if (
    !parsed ||
    resolveEligibleCodeOwnedTool(toolName) ||
    !evidence ||
    !evidence.declaration ||
    normalizeToolName(evidence.declaration.name) !== toolName ||
    !isBoundedDeclarationText(evidence.declaration.description, 16_384) ||
    !isPlainRecord(evidence.declaration.input_schema) ||
    evidence.provenance.source !== parsed.source ||
    evidence.provenance.namespace !== parsed.namespace ||
    !isValidRuntimeProvenance(evidence.provenance)
  ) {
    return undefined;
  }
  const effectClass = resolveRuntimeExternalEffectClass(toolName, evidence);
  const [declarationDigest, executionBindingDigest] = await Promise.all([
    digestContractComponent(
      'kavi.tool.runtime-external-declaration',
      {
        name: toolName,
        description: evidence.declaration.description,
        inputSchema: evidence.declaration.input_schema,
        strict: evidence.declaration.strict ?? 'auto',
        declaredContract: evidence.declaration.contract ?? null,
      },
      RUNTIME_EXTERNAL_IDENTITY_VERSION,
    ),
    digestContractComponent(
      'kavi.tool.runtime-external-execution-binding',
      evidence.provenance,
      RUNTIME_EXTERNAL_IDENTITY_VERSION,
    ),
  ]);
  return Object.freeze({
    kind: 'runtime_external' as const,
    version: RUNTIME_EXTERNAL_IDENTITY_VERSION,
    toolName,
    source: parsed.source,
    namespace: parsed.namespace,
    effectClass,
    declarationDigest,
    executionBindingDigest,
  });
}

export async function digestToolContractIdentity(
  identity: ToolContractIdentity,
): Promise<ToolEffectDigest> {
  return digestContractComponent('kavi.tool.contract-identity', identity, identity.version);
}

export async function buildToolContractIdentity(
  toolName: string,
  runtimeExternalEvidence?: RuntimeExternalToolEvidence,
): Promise<ToolContractIdentity | undefined> {
  return (
    (await buildCodeOwnedToolContractIdentity(toolName)) ??
    (runtimeExternalEvidence
      ? await buildRuntimeExternalToolContractIdentity(toolName, runtimeExternalEvidence)
      : undefined)
  );
}

export function codeOwnedToolContractIdentitiesEqual(
  left: CodeOwnedToolContractIdentity,
  right: CodeOwnedToolContractIdentity,
): boolean {
  return (
    left.kind === right.kind &&
    left.version === right.version &&
    left.toolName === right.toolName &&
    left.schemaDigest === right.schemaDigest &&
    left.capabilityContractDigest === right.capabilityContractDigest &&
    left.workflowContractDigest === right.workflowContractDigest &&
    left.effectContractDigest === right.effectContractDigest &&
    left.executionPolicyDigest === right.executionPolicyDigest
  );
}

export function toolContractIdentitiesEqual(
  left: ToolContractIdentity,
  right: ToolContractIdentity,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'code_owned' && right.kind === 'code_owned') {
    return codeOwnedToolContractIdentitiesEqual(left, right);
  }
  if (left.kind === 'runtime_external' && right.kind === 'runtime_external') {
    return (
      left.version === right.version &&
      left.toolName === right.toolName &&
      left.source === right.source &&
      left.namespace === right.namespace &&
      left.effectClass === right.effectClass &&
      left.declarationDigest === right.declarationDigest &&
      left.executionBindingDigest === right.executionBindingDigest
    );
  }
  return false;
}

export async function matchesCurrentCodeOwnedToolContractIdentity(
  identity: CodeOwnedToolContractIdentity,
): Promise<boolean> {
  const current = await buildCodeOwnedToolContractIdentity(identity.toolName);
  return Boolean(current && codeOwnedToolContractIdentitiesEqual(current, identity));
}
