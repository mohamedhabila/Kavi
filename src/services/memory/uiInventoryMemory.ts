import { compactUiInventory, type UiStateSummary } from './uiState';

type JsonRecord = Record<string, unknown>;

export interface CompactUiInventoryPayloadInput {
  summary: UiStateSummary;
  goal: string | null;
  trajectoryOutcome: string | null;
  domain: string | null;
  environment: string | null;
  url: string | null;
  sourceRunId?: string;
  stateIndex?: string;
}

export function compactUiInventoryPayload(input: CompactUiInventoryPayloadInput): JsonRecord {
  const inventory = compactUiInventory(input.summary);
  return dropEmpty({
    fieldLabels: inventory.fieldLabels,
    surfaceLabels: inventory.surfaceLabels,
    visibleTextSnippets: inventory.visibleTextSnippets,
    fields: inventory.fields,
    sections: inventory.sections,
    actionControls: inventory.actionControls,
    roleControls: inventory.roleControls,
    contextRoleControls: inventory.contextRoleControls,
    textEntryControls: inventory.textEntryControls,
    searchControls: inventory.searchControls,
    popupControls: inventory.popupControls,
    labelValues: inventory.labelValues,
    tables: inventory.tables,
    controlNames: inventory.controlNames,
    roleCounts: inventory.roleCounts,
    controls: inventory.controls,
    nodeCount: inventory.nodeCount,
    controlCount: inventory.controlCount,
    textEntryCount: inventory.textEntryCount,
    searchControlCount: inventory.searchControlCount,
    url: input.url,
    sourceRunId: input.sourceRunId,
    stateIndex: input.stateIndex,
    goal: input.goal,
    trajectoryOutcome: input.trajectoryOutcome,
    ...(input.domain ? { domain: input.domain } : {}),
    ...(input.environment ? { environment: input.environment } : {}),
  });
}

function dropEmpty(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === null || entry === undefined || entry === '') return false;
      return !Array.isArray(entry) || entry.length > 0;
    }),
  );
}
