import { isExactMemoryProvenanceId } from '../memoryProvenanceIdentity';
import type { EpisodeSensitivitySourceMessage } from './types';

export const EPISODE_SOURCE_IDENTITY_MANIFEST_VERSION = 1 as const;
const MAX_EPISODE_SOURCE_IDENTITIES = 128;

export type EpisodeSourceIdentityKind = 'message' | 'turn';

export type EpisodeSourceIdentity = Readonly<{
  sourceKind: EpisodeSourceIdentityKind;
  sourceId: string;
}>;

export type EpisodeSourceIdentityManifest = Readonly<{
  version: typeof EPISODE_SOURCE_IDENTITY_MANIFEST_VERSION;
  sources: readonly EpisodeSourceIdentity[];
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function freezeManifest(sources: readonly EpisodeSourceIdentity[]): EpisodeSourceIdentityManifest {
  return Object.freeze({
    version: EPISODE_SOURCE_IDENTITY_MANIFEST_VERSION,
    sources: Object.freeze(sources.map((source) => Object.freeze({ ...source }))),
  });
}

export function buildEpisodeSourceIdentityManifest(
  sourceMessages: ReadonlyArray<EpisodeSensitivitySourceMessage>,
): EpisodeSourceIdentityManifest {
  const sources: EpisodeSourceIdentity[] = [];
  const seen = new Set<string>();
  for (const message of sourceMessages) {
    const sourceKind =
      message.role === 'user' ? 'message' : message.role === 'assistant' ? 'turn' : null;
    if (!sourceKind) continue;
    if (!isExactMemoryProvenanceId(message.id)) {
      throw new Error('episode_source_identity_invalid');
    }
    const key = `${sourceKind}\u0000${message.id}`;
    if (seen.has(key)) throw new Error('episode_source_identity_invalid');
    seen.add(key);
    sources.push({ sourceKind, sourceId: message.id });
  }
  if (sources.length === 0 || sources.length > MAX_EPISODE_SOURCE_IDENTITIES) {
    throw new Error('episode_source_identity_invalid');
  }
  return freezeManifest(sources);
}

export function buildMigratedEpisodeSourceIdentityManifest(params: {
  sourceStartMessageId: string | null;
  sourceEndMessageId: string | null;
}): EpisodeSourceIdentityManifest {
  const sources: EpisodeSourceIdentity[] = [];
  if (isExactMemoryProvenanceId(params.sourceStartMessageId)) {
    sources.push({ sourceKind: 'message', sourceId: params.sourceStartMessageId });
  }
  if (isExactMemoryProvenanceId(params.sourceEndMessageId)) {
    sources.push({ sourceKind: 'turn', sourceId: params.sourceEndMessageId });
  }
  return freezeManifest(sources);
}

export function encodeEpisodeSourceIdentityManifest(
  manifest: EpisodeSourceIdentityManifest,
): string {
  return JSON.stringify(manifest);
}

export function decodeEpisodeSourceIdentityManifest(
  raw: string,
): EpisodeSourceIdentityManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isPlainRecord(parsed) ||
    !hasExactKeys(parsed, ['version', 'sources']) ||
    parsed.version !== EPISODE_SOURCE_IDENTITY_MANIFEST_VERSION ||
    !Array.isArray(parsed.sources) ||
    parsed.sources.length > MAX_EPISODE_SOURCE_IDENTITIES
  ) {
    return null;
  }
  const sources: EpisodeSourceIdentity[] = [];
  const seen = new Set<string>();
  for (const candidate of parsed.sources) {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, ['sourceKind', 'sourceId']) ||
      (candidate.sourceKind !== 'message' && candidate.sourceKind !== 'turn') ||
      !isExactMemoryProvenanceId(candidate.sourceId)
    ) {
      return null;
    }
    const key = `${candidate.sourceKind}\u0000${candidate.sourceId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    sources.push({
      sourceKind: candidate.sourceKind,
      sourceId: candidate.sourceId,
    });
  }
  return freezeManifest(sources);
}

export function episodeSourceIdentityManifestsEqual(
  left: EpisodeSourceIdentityManifest,
  right: EpisodeSourceIdentityManifest,
): boolean {
  return (
    left.version === right.version &&
    left.sources.length === right.sources.length &&
    left.sources.every(
      (source, index) =>
        source.sourceKind === right.sources[index]?.sourceKind &&
        source.sourceId === right.sources[index]?.sourceId,
    )
  );
}
