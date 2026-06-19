import type { ClawHubSkill } from '../../types/clawhub';
import { CLAWHUB_BASE_URL } from './transport';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPublishedSkillVersion(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }

  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.trim());
}

function extractPublishedSkillVersion(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return isPublishedSkillVersion(value) ? value : undefined;
  }

  if (isRecord(value) && typeof value.version === 'string') {
    return isPublishedSkillVersion(value.version) ? value.version : undefined;
  }

  return undefined;
}

export function mapClawHubSkill(raw: any): ClawHubSkill {
  const skill = raw.skill || raw;
  const latestVersion = raw.latestVersion || raw.version || null;
  const slug = skill.slug || raw.slug || raw.id || raw.name || '';
  const version =
    extractPublishedSkillVersion(latestVersion) || extractPublishedSkillVersion(raw.version) || '';

  return {
    id: slug,
    name: skill.displayName || raw.displayName || raw.name || slug,
    description: skill.summary || raw.summary || raw.description || '',
    version,
    author: raw.owner?.displayName || raw.owner?.handle || raw.ownerHandle || raw.author || '',
    tags: Object.keys(skill.tags || raw.tags || {}),
    downloads: Number(skill.stats?.downloads || raw.downloads) || 0,
    rating: Number(skill.stats?.stars || raw.rating) || 0,
    installUrl:
      raw.installUrl ||
      raw.install_url ||
      `${CLAWHUB_BASE_URL}/skills/${encodeURIComponent(slug)}/file?path=SKILL.md`,
  };
}
