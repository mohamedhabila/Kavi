export const PARTIAL_REPORT_SCHEMA_VERSION: 'e2e-partial-report-v2';
export const SCENARIO_ENTRY_SCHEMA_VERSION: 'e2e-run-report-scenario-v2';

export type CurrentPartialReport<TEntry> = {
  schemaVersion: typeof PARTIAL_REPORT_SCHEMA_VERSION;
  entries: TEntry[];
};

export function assertScenarioEntry<TEntry>(entry: TEntry, index: number): TEntry;
export function parsePartialReport<TEntry>(value: unknown): CurrentPartialReport<TEntry>;
export function readPartialReportFile<TEntry>(partialPath: string): CurrentPartialReport<TEntry>;
export function writePartialReportFile<TEntry>(partialPath: string, entries: TEntry[]): void;
