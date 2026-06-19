import type { ClawHubSkill } from '../../types/clawhub';
import type { SkillHookSpec, SkillMetadata } from '../skills/types';
import { parseFrontmatterBlock } from '../markdown/frontmatter';
import { buildSkillMetadataFromFrontmatter } from '../skills/manifest';
import { analyzeBundledPythonSkill } from '../skills/mobileTranslator';

export type InstalledSkillData =
  | { metadata: SkillMetadata; systemPrompt?: string; hooks?: SkillHookSpec[] }
  | { error: string };

export function parseInstalledSkillData(
  content: string,
  fallback: Partial<ClawHubSkill>,
  metadataBase: Partial<SkillMetadata> = {},
  bundleFiles?: Record<string, string>,
): InstalledSkillData {
  const { metadata, content: body } = parseFrontmatterBlock(content);
  const skillMetadata = buildSkillMetadataFromFrontmatter(metadata, {
    ...metadataBase,
    name: fallback.name || metadataBase.name,
    description: fallback.description || metadataBase.description,
    version: fallback.version || metadataBase.version || '0.0.0',
    author: fallback.author || metadataBase.author,
    tags: fallback.tags || metadataBase.tags,
    primaryEnv: metadataBase.primaryEnv,
    skillKey: metadataBase.skillKey,
  });

  if (!skillMetadata) {
    return { error: 'Skill manifest is missing a name.' };
  }

  const bundledPython = bundleFiles ? analyzeBundledPythonSkill(content, bundleFiles) : undefined;
  if (bundledPython) {
    skillMetadata.bundledPython = bundledPython;
  }

  return {
    metadata: skillMetadata,
    systemPrompt: body.trim() || undefined,
    hooks: parseSkillHooks(metadata.hooks),
  };
}

function parseSkillHooks(raw: unknown): SkillHookSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const hooks: SkillHookSpec[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || !item) continue;
    const event = typeof item.event === 'string' ? item.event : undefined;
    const prompt = typeof item.prompt === 'string' ? item.prompt : undefined;
    if (!event || !prompt) continue;

    hooks.push({
      event,
      action: typeof item.action === 'string' ? item.action : undefined,
      prompt,
    });
  }

  return hooks.length > 0 ? hooks : undefined;
}
