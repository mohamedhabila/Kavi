import type { ClawHubSkill } from '../../types/clawhub';
import { generateId } from '../../utils/id';
import type { SkillEntry, SkillInstallSpec } from '../skills/types';
import { getSkillCompatibility } from '../skills/manifest';
import { useSkillsStore } from '../skills/manager';
import { saveManagedSkillBundle } from '../skills/storage';
import type { SkillBundleFiles } from './bundleParser';
import { parseInstalledSkillData, type InstalledSkillData } from './manifestResolver';
import type { SkillInstallResult } from './installTypes';

type ResolvedInstalledSkillData = Extract<InstalledSkillData, { metadata: unknown }>;

function resolveInstalledSkillData(
  parsed: InstalledSkillData | null,
  compatibilityMessage: string,
): { ok: true; data: ResolvedInstalledSkillData } | { ok: false; error: string } {
  if (!parsed) {
    return { ok: false, error: 'Skill manifest is missing a name.' };
  }
  if ('error' in parsed) {
    return { ok: false, error: parsed.error };
  }

  const compatibility = getSkillCompatibility(parsed.metadata);
  if (!compatibility.compatible) {
    return { ok: false, error: compatibility.reason || compatibilityMessage };
  }

  return { ok: true, data: parsed };
}

export async function installSkillFromBundleFiles(
  bundleFiles: SkillBundleFiles,
  source: SkillInstallSpec,
  fallback: Partial<ClawHubSkill> = {},
): Promise<SkillInstallResult> {
  const content = bundleFiles.textFiles['SKILL.md'];
  if (!content) {
    return { success: false, error: 'Skill bundle is missing SKILL.md.' };
  }

  const parsed = parseInstalledSkillData(content, fallback, {}, bundleFiles.textFiles);
  const resolved = resolveInstalledSkillData(parsed, 'This skill is not compatible with mobile.');
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const entry: SkillEntry = {
    id: generateId(),
    metadata: resolved.data.metadata,
    enabled: true,
    installedAt: Date.now(),
    source,
    systemPrompt: resolved.data.systemPrompt,
    hooks: resolved.data.hooks,
  };

  const managedEntry = await saveManagedSkillBundle(
    entry,
    bundleFiles.textFiles,
    bundleFiles.binaryFiles,
  );
  useSkillsStore.getState().addEntry(managedEntry);
  return { success: true, skillEntry: managedEntry };
}

export async function persistUpdatedSkillEntry(
  entry: SkillEntry,
  parsed: InstalledSkillData,
  bundleFiles: SkillBundleFiles,
  source: SkillInstallSpec,
  compatibilityMessage: string,
): Promise<SkillInstallResult> {
  const resolved = resolveInstalledSkillData(parsed, compatibilityMessage);
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const managedEntry = await saveManagedSkillBundle(
    {
      ...entry,
      metadata: resolved.data.metadata,
      source,
      systemPrompt: resolved.data.systemPrompt || entry.systemPrompt,
      hooks: resolved.data.hooks || entry.hooks,
    },
    bundleFiles.textFiles,
    bundleFiles.binaryFiles,
  );

  useSkillsStore.getState().updateEntry(entry.id, {
    metadata: managedEntry.metadata,
    source: managedEntry.source,
    systemPrompt: managedEntry.systemPrompt,
    hooks: managedEntry.hooks,
  });

  return { success: true, skillEntry: managedEntry };
}
