import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName, normalizeToolNameList } from './toolNameNormalization';

export type ToolWorkflowProduction = {
  kind: string;
  field?: string;
};

export type ToolWorkflowConsumption = ToolWorkflowProduction & {
  required?: boolean;
};

export type NormalizedToolWorkflowContract = {
  produces: ToolWorkflowProduction[];
  consumes: ToolWorkflowConsumption[];
  precedes: string[];
  requiresPermissionEvidence: string[];
};

export type ToolWorkflowContractIssue = {
  toolName: string;
  code: 'dangling_consumer' | 'dangling_precedes' | 'dangling_permission_evidence';
  detail: string;
};

function normalizeWorkflowToken(value: string | undefined): string {
  return (value ?? '').trim();
}

function normalizeProductionList(
  values: ReadonlyArray<ToolWorkflowProduction> | undefined,
): ToolWorkflowProduction[] {
  const seen = new Set<string>();
  const normalized: ToolWorkflowProduction[] = [];

  for (const value of values ?? []) {
    const kind = normalizeWorkflowToken(value.kind);
    const field = normalizeWorkflowToken(value.field);
    if (!kind) {
      continue;
    }
    const key = `${kind}\u0000${field}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      kind,
      ...(field ? { field } : {}),
    });
  }

  return normalized;
}

function normalizeConsumptionList(
  values: ReadonlyArray<ToolWorkflowConsumption> | undefined,
): ToolWorkflowConsumption[] {
  const seen = new Set<string>();
  const normalized: ToolWorkflowConsumption[] = [];

  for (const value of values ?? []) {
    const kind = normalizeWorkflowToken(value.kind);
    const field = normalizeWorkflowToken(value.field);
    if (!kind) {
      continue;
    }
    const required = value.required === false ? false : undefined;
    const key = `${kind}\u0000${field}\u0000${required === false ? 'optional' : 'required'}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      kind,
      ...(field ? { field } : {}),
      ...(required === false ? { required: false } : {}),
    });
  }

  return normalized;
}

function normalizeStringList(values: ReadonlyArray<string> | undefined): string[] {
  return Array.from(
    new Set((values ?? []).map((value) => normalizeWorkflowToken(value)).filter(Boolean)),
  );
}

export function normalizeToolWorkflowContract(
  contract: ToolDefinition['contract'] | undefined,
): NormalizedToolWorkflowContract {
  return {
    produces: normalizeProductionList(contract?.produces),
    consumes: normalizeConsumptionList(contract?.consumes),
    precedes: normalizeToolNameList(contract?.precedes),
    requiresPermissionEvidence: normalizeStringList(contract?.requiresPermissionEvidence),
  };
}

export function workflowProductionSatisfiesConsumption(
  production: ToolWorkflowProduction,
  consumption: ToolWorkflowConsumption,
): boolean {
  if (production.kind !== consumption.kind) {
    return false;
  }
  if (!consumption.field || !production.field) {
    return true;
  }
  return production.field === consumption.field;
}

function buildContractByToolName(
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'contract'>>,
): Map<string, NormalizedToolWorkflowContract> {
  return new Map(
    tools.map((tool) => [
      normalizeToolName(tool.name),
      normalizeToolWorkflowContract(tool.contract),
    ]),
  );
}

export function getToolWorkflowContractIssues(
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'contract'>>,
): ToolWorkflowContractIssue[] {
  const issues: ToolWorkflowContractIssue[] = [];
  const toolNames = new Set(tools.map((tool) => normalizeToolName(tool.name)).filter(Boolean));
  const contractByToolName = buildContractByToolName(tools);
  const allProductions = Array.from(contractByToolName.entries()).flatMap(
    ([producerName, contract]) =>
      contract.produces.map((production) => ({ producerName, production })),
  );

  for (const [toolName, contract] of contractByToolName) {
    for (const precedent of contract.precedes) {
      if (!toolNames.has(precedent)) {
        issues.push({
          toolName,
          code: 'dangling_precedes',
          detail: `${toolName} precedes unknown tool ${precedent}`,
        });
      }
    }

    for (const consumption of contract.consumes) {
      if (consumption.required === false) {
        continue;
      }
      const hasProducer = allProductions.some(({ producerName, production }) => {
        return (
          producerName !== toolName &&
          workflowProductionSatisfiesConsumption(production, consumption)
        );
      });
      if (!hasProducer) {
        issues.push({
          toolName,
          code: 'dangling_consumer',
          detail: `${toolName} consumes ${consumption.kind}${
            consumption.field ? `.${consumption.field}` : ''
          } without a producer`,
        });
      }
    }

    for (const permission of contract.requiresPermissionEvidence) {
      const hasProducer = allProductions.some(({ producerName, production }) => {
        return (
          producerName !== toolName &&
          production.kind === 'permission_state' &&
          (!production.field || production.field === permission)
        );
      });
      if (!hasProducer) {
        issues.push({
          toolName,
          code: 'dangling_permission_evidence',
          detail: `${toolName} requires permission evidence ${permission} without a permission_state producer`,
        });
      }
    }
  }

  return issues;
}
