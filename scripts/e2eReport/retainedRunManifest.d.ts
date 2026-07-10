export const RETAINED_RUN_MANIFEST_FILE: 'artifact-manifest.json';
export const RETAINED_RUN_MANIFEST_SCHEMA_VERSION: 'e2e-retained-run-manifest-v1';

export type RetainedRunManifest = {
  schemaVersion: typeof RETAINED_RUN_MANIFEST_SCHEMA_VERSION;
  runId: string;
  generatedAt: string;
  files: Array<{ relativePath: string; sha256: string }>;
};

export function buildRetainedRunManifest(
  runDir: string,
  runId: string,
  generatedAt: string,
): RetainedRunManifest;
export function sha256(value: string | Buffer): string;
export function validateRetainedRunDirectory(
  retentionDir: string,
  indexEntry: Readonly<Record<string, unknown>>,
): boolean;
