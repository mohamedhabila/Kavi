import { workflowProductionSatisfiesConsumption } from './toolWorkflowContracts';
import type { ToolCatalogSearchToolEntry } from './builtin-tool-catalogTypes';

export type ToolCatalogWorkflowEdge = {
  producer: string;
  consumer: string;
  resourceKinds: string[];
  producerCallableNow: boolean;
  consumerCallableNow: boolean;
};

export function buildToolCatalogWorkflowEdges(
  tools: ReadonlyArray<ToolCatalogSearchToolEntry>,
): ToolCatalogWorkflowEdge[] {
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const edges = new Map<string, ToolCatalogWorkflowEdge>();

  for (const producer of tools) {
    const producerSummary = producer.capabilitySummary;
    if (!producerSummary) continue;
    const candidateConsumers = new Set(
      producerSummary.precedes.filter((name) => toolByName.has(name)),
    );

    for (const consumer of tools) {
      if (consumer.name === producer.name || !consumer.capabilitySummary) continue;
      if (
        consumer.capabilitySummary.consumes.some((consumption) =>
          producerSummary.produces.some((production) =>
            workflowProductionSatisfiesConsumption(production, consumption),
          ),
        )
      ) {
        candidateConsumers.add(consumer.name);
      }
    }

    for (const consumerName of candidateConsumers) {
      const consumer = toolByName.get(consumerName);
      if (!consumer?.capabilitySummary) continue;
      const resourceKinds = Array.from(
        new Set(
          producerSummary.produces
            .filter((production) =>
              consumer.capabilitySummary!.consumes.some((consumption) =>
                workflowProductionSatisfiesConsumption(production, consumption),
              ),
            )
            .map((production) => production.kind),
        ),
      ).sort();
      edges.set(`${producer.name}:${consumer.name}`, {
        producer: producer.name,
        consumer: consumer.name,
        resourceKinds,
        producerCallableNow: producer.activation.callableNow,
        consumerCallableNow: consumer.activation.callableNow,
      });
    }
  }

  return Array.from(edges.values()).sort(
    (left, right) =>
      left.producer.localeCompare(right.producer) ||
      left.consumer.localeCompare(right.consumer),
  );
}
