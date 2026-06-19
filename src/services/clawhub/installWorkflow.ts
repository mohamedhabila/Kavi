import type { ClawHubSkill } from '../../types/clawhub';
import type { SkillEntry, SkillInstallSpec, SkillMetadata } from '../skills/types';
import { getSkillDetail } from './apiClient';
import { fetchClawHubBundleFiles, type SkillBundleFiles } from './bundleParser';
import { installSkillFromBundleFiles, persistUpdatedSkillEntry } from './installPersistence';
import { parseInstalledSkillData, type InstalledSkillData } from './manifestResolver';
import { fetchReferencedSkillFiles } from './referenceFiles';
import { isPublishedSkillVersion } from './skillMapping';
import { buildClawHubFilePath, fetchClawHubRawSkillFile } from './transport';
import type { SkillInstallResult } from './installTypes';

export type { SkillInstallResult } from './installTypes';

function formatInstallError(err: unknown): SkillInstallResult {
  return { success: false, error: err instanceof Error ? err.message : String(err) };
}

function buildEntryFallback(entry: SkillEntry, version: string): Partial<ClawHubSkill> {
  return {
    name: entry.metadata.name,
    description: entry.metadata.description,
    version,
    author: entry.metadata.author,
    tags: entry.metadata.tags,
  };
}

async function installSkillFromContent(
  content: string,
  source: SkillInstallSpec,
  fallback: Partial<ClawHubSkill> = {},
): Promise<SkillInstallResult> {
  const bundleFiles = await fetchReferencedSkillFiles(content, source);
  return installSkillFromBundleFiles({ textFiles: bundleFiles, binaryFiles: {} }, source, fallback);
}

function parseClawHubSkillFileUrl(
  url: string,
): { slug: string; version?: string; path: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'clawhub.ai') {
      return null;
    }

    const match = parsed.pathname.match(/^\/api\/v1\/skills\/([^/]+)\/file$/i);
    if (!match?.[1]) {
      return null;
    }

    return {
      slug: decodeURIComponent(match[1]),
      version: parsed.searchParams.get('version') || undefined,
      path: parsed.searchParams.get('path') || 'SKILL.md',
    };
  } catch {
    return null;
  }
}

async function installClawHubSkillBundle(
  slug: string,
  version: string,
  fallback: Partial<ClawHubSkill> = {},
): Promise<SkillInstallResult> {
  const bundleFiles = await fetchClawHubBundleFiles(slug, version);
  return installSkillFromBundleFiles(
    bundleFiles,
    {
      source: 'clawhub',
      id: slug,
      url: buildClawHubFilePath(slug, 'SKILL.md'),
      version,
    },
    fallback,
  );
}

export async function installSkillFromUrl(url: string): Promise<SkillInstallResult> {
  const clawHubFileUrl = parseClawHubSkillFileUrl(url);
  if (clawHubFileUrl && /^(?:skill|skills)\.md$/i.test(clawHubFileUrl.path)) {
    try {
      const detail = await getSkillDetail(clawHubFileUrl.slug);
      const version = clawHubFileUrl.version || detail?.version;
      if (!version) {
        return { success: false, error: 'ClawHub did not provide a skill version.' };
      }
      return installClawHubSkillBundle(
        clawHubFileUrl.slug,
        version,
        detail || { id: clawHubFileUrl.slug },
      );
    } catch (err: unknown) {
      return formatInstallError(err);
    }
  }

  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/markdown, text/plain, application/json' },
    });

    if (!res.ok) {
      return { success: false, error: `Failed to fetch skill: HTTP ${res.status}` };
    }

    return installSkillFromContent(await res.text(), {
      source: 'url',
      url,
    });
  } catch (err: unknown) {
    return formatInstallError(err);
  }
}

export async function installSkillFromHub(skill: ClawHubSkill): Promise<SkillInstallResult> {
  try {
    const version = isPublishedSkillVersion(skill.version)
      ? skill.version
      : (await getSkillDetail(skill.id))?.version;
    if (!version) {
      return { success: false, error: 'ClawHub did not provide a skill version.' };
    }

    return installClawHubSkillBundle(skill.id, version, skill);
  } catch (err: unknown) {
    return formatInstallError(err);
  }
}

async function parseClawHubEntryBundle(
  entry: SkillEntry,
  version: string,
  metadataBase: Partial<SkillMetadata>,
): Promise<{ bundleFiles: SkillBundleFiles; parsed: InstalledSkillData }> {
  const fallback = buildEntryFallback(entry, version);

  try {
    const bundleFiles = await fetchClawHubBundleFiles(entry.source.id!, version);
    return {
      bundleFiles,
      parsed: parseInstalledSkillData(
        bundleFiles.textFiles['SKILL.md'],
        fallback,
        metadataBase,
        bundleFiles.textFiles,
      ),
    };
  } catch {
    const content = await fetchClawHubRawSkillFile(entry.source.id!, version, 'SKILL.md');
    const bundleFiles = {
      textFiles: await fetchReferencedSkillFiles(content, {
        ...entry.source,
        url: buildClawHubFilePath(entry.source.id!, 'SKILL.md'),
        version,
      }),
      binaryFiles: {},
    };
    return {
      bundleFiles,
      parsed: parseInstalledSkillData(content, fallback, metadataBase, bundleFiles.textFiles),
    };
  }
}

export async function updateSkillFromHub(
  entry: SkillEntry,
  latestVersion: string,
): Promise<SkillInstallResult> {
  if (entry.source.source !== 'clawhub') {
    return { success: false, error: 'Skill was not installed from ClawHub' };
  }
  if (!entry.source.id) {
    return { success: false, error: 'ClawHub skill ID is unavailable.' };
  }

  try {
    const { bundleFiles, parsed } = await parseClawHubEntryBundle(entry, latestVersion, {
      ...entry.metadata,
      version: latestVersion,
    });
    return persistUpdatedSkillEntry(
      entry,
      parsed,
      bundleFiles,
      {
        ...entry.source,
        url: buildClawHubFilePath(entry.source.id, 'SKILL.md'),
        version: latestVersion,
      },
      'Updated skill is not compatible with mobile.',
    );
  } catch (err: unknown) {
    return formatInstallError(err);
  }
}

export async function refreshSkillEntryFromSource(entry: SkillEntry): Promise<SkillInstallResult> {
  if (entry.source.source === 'clawhub' && entry.source.id) {
    const version = entry.source.version || entry.metadata.version;

    try {
      const { bundleFiles, parsed } = await parseClawHubEntryBundle(entry, version, entry.metadata);
      return persistUpdatedSkillEntry(
        entry,
        parsed,
        bundleFiles,
        {
          ...entry.source,
          url: buildClawHubFilePath(entry.source.id, 'SKILL.md'),
          version,
        },
        'Skill is not compatible with mobile.',
      );
    } catch (err: unknown) {
      return formatInstallError(err);
    }
  }

  if (!entry.source.url) {
    return { success: false, error: 'Skill source URL is unavailable.' };
  }

  try {
    const res = await fetch(entry.source.url, {
      headers: { Accept: 'text/markdown, application/json' },
    });

    if (!res.ok) {
      return { success: false, error: `Failed to refresh skill: HTTP ${res.status}` };
    }

    const content = await res.text();
    const bundleFiles = {
      textFiles: await fetchReferencedSkillFiles(content, entry.source),
      binaryFiles: {},
    };
    const parsed = parseInstalledSkillData(
      content,
      buildEntryFallback(entry, entry.metadata.version),
      entry.metadata,
      bundleFiles.textFiles,
    );
    return persistUpdatedSkillEntry(
      entry,
      parsed,
      bundleFiles,
      entry.source,
      'Skill is not compatible with mobile.',
    );
  } catch (err: unknown) {
    return formatInstallError(err);
  }
}

export async function checkForUpdates(
  installedSkills: SkillEntry[],
): Promise<Array<{ entry: SkillEntry; latestVersion: string }>> {
  const updates: Array<{ entry: SkillEntry; latestVersion: string }> = [];

  for (const entry of installedSkills) {
    if (entry.source.source !== 'clawhub' || !entry.source.id) continue;

    try {
      const detail = await getSkillDetail(entry.source.id);
      if (detail && detail.version !== entry.metadata.version) {
        updates.push({ entry, latestVersion: detail.version });
      }
    } catch {
      // Skip failed checks.
    }
  }

  return updates;
}
