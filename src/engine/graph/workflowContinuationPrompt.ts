import type { ToolDefinition } from '../../types/tool';
import { normalizeToolName } from '../tools/toolNameNormalization';
import {
  normalizeToolWorkflowContract,
  workflowProductionSatisfiesConsumption,
} from '../tools/toolWorkflowContracts';

const MAX_WORKFLOW_CONTINUATIONS = 8;

type WorkflowContinuation = {
  producerName: string;
  successorName: string;
  resourceKinds: string[];
};

function collectContinuationResourceKinds(
  producer: ReturnType<typeof normalizeToolWorkflowContract>,
  successor: ReturnType<typeof normalizeToolWorkflowContract>,
): string[] {
  return Array.from(
    new Set(
      producer.produces
        .filter((production) =>
          successor.consumes.some((consumption) =>
            workflowProductionSatisfiesConsumption(production, consumption),
          ),
        )
        .map((production) => production.kind),
    ),
  ).sort();
}

export function buildWorkflowContinuationPrompt(params: {
  allTools: ReadonlyArray<ToolDefinition>;
  completedToolNames: ReadonlySet<string>;
  selectedToolNames: ReadonlySet<string>;
}): string | null {
  const toolByName = new Map(
    params.allTools
      .map((tool): [string, ToolDefinition] => [normalizeToolName(tool.name), tool])
      .filter(([name]) => Boolean(name)),
  );
  const completedToolNames = new Set(
    Array.from(params.completedToolNames).map(normalizeToolName).filter(Boolean),
  );
  const selectedToolNames = new Set(
    Array.from(params.selectedToolNames).map(normalizeToolName).filter(Boolean),
  );
  const continuations = new Map<string, WorkflowContinuation>();

  for (const producerName of completedToolNames) {
    const producerTool = toolByName.get(producerName);
    if (!producerTool) continue;
    const producerContract = normalizeToolWorkflowContract(producerTool.contract);
    const successorNames = new Set(
      producerContract.precedes.map(normalizeToolName).filter(Boolean),
    );

    for (const successorName of selectedToolNames) {
      if (successorName === producerName || completedToolNames.has(successorName)) {
        continue;
      }
      const successorTool = toolByName.get(successorName);
      if (!successorTool) continue;
      const successorContract = normalizeToolWorkflowContract(successorTool.contract);
      if (
        successorContract.consumes.some((consumption) =>
          producerContract.produces.some((production) =>
            workflowProductionSatisfiesConsumption(production, consumption),
          ),
        )
      ) {
        successorNames.add(successorName);
      }
    }

    for (const successorName of successorNames) {
      if (!selectedToolNames.has(successorName) || completedToolNames.has(successorName)) {
        continue;
      }
      const successorTool = toolByName.get(successorName);
      if (!successorTool) continue;
      const successorContract = normalizeToolWorkflowContract(successorTool.contract);
      continuations.set(`${producerName}:${successorName}`, {
        producerName,
        successorName,
        resourceKinds: collectContinuationResourceKinds(
          producerContract,
          successorContract,
        ),
      });
    }
  }

  const ordered = Array.from(continuations.values())
    .sort(
      (left, right) =>
        left.producerName.localeCompare(right.producerName) ||
        left.successorName.localeCompare(right.successorName),
    )
    .slice(0, MAX_WORKFLOW_CONTINUATIONS);
  if (ordered.length === 0) return null;

  return [
    '## Available Workflow Continuations',
    'Code-owned tool contracts expose these next-step tools from completed work:',
    ...ordered.map(
      (continuation) =>
        `- ${continuation.producerName} → ${continuation.successorName}${
          continuation.resourceKinds.length > 0
            ? ` (${continuation.resourceKinds.join(', ')})`
            : ''
        }`,
    ),
    'These successor tools are available on this turn. If the current user request requires a listed continuation, execute it before final delivery and use exact identifiers from the preceding tool result. Do not report a listed successor as unavailable.',
  ].join('\n');
}
