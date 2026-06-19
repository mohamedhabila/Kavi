import type { ClawHubListResult, ClawHubSearchResult, ClawHubSkill } from '../../types/clawhub';
import { queryClawHubBrowsePage } from './convexClient';
import { mapClawHubSkill } from './skillMapping';
import { clawHubFetch } from './transport';

type ClawHubSearchPayload = {
  results?: Array<{
    score?: number;
    slug?: string;
    displayName?: string;
    summary?: string | null;
    version?: string | null;
    updatedAt?: number;
  }>;
};

type ClawHubDetailPayload = {
  skill?: any;
  latestVersion?: any;
};

export async function searchClawHub(
  query: string,
  options: { page?: number; pageSize?: number; tags?: string[] } = {},
): Promise<ClawHubSearchResult> {
  const { page = 1, pageSize = 20, tags = [] } = options;
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.max(page, 1) * Math.max(pageSize, 1)),
  });
  if (tags.length > 0) {
    params.set('tags', tags.join(','));
  }

  try {
    const res = await clawHubFetch(`/search?${params.toString()}`);
    if (!res.ok) {
      return { skills: [], total: 0, page, pageSize };
    }

    const data = (await res.json()) as ClawHubSearchPayload;
    return {
      skills: (data.results || []).map(mapClawHubSkill),
      total: data.results?.length || 0,
      page,
      pageSize,
    };
  } catch {
    return { skills: [], total: 0, page, pageSize };
  }
}

export async function listClawHubSkills(
  options: {
    limit?: number;
    cursor?: string | null;
    sort?: 'downloads' | 'trending';
    nonSuspiciousOnly?: boolean;
  } = {},
): Promise<ClawHubListResult> {
  const { limit = 20, cursor, sort = 'downloads', nonSuspiciousOnly = true } = options;

  try {
    const data = await queryClawHubBrowsePage({
      cursor: cursor || undefined,
      numItems: limit,
      sort: sort === 'trending' ? 'installs' : 'downloads',
      dir: 'desc',
      nonSuspiciousOnly,
    });

    return {
      skills: (data.page || []).map(mapClawHubSkill),
      nextCursor: data.hasMore ? data.nextCursor || null : null,
    };
  } catch {
    return { skills: [], nextCursor: null };
  }
}

export async function getFeaturedSkills(): Promise<ClawHubSkill[]> {
  const result = await listClawHubSkills({ limit: 20, sort: 'downloads' });
  return result.skills;
}

export async function getPopularSkills(limit = 20): Promise<ClawHubSkill[]> {
  const result = await listClawHubSkills({ limit, sort: 'trending' });
  return result.skills;
}

export async function getSkillDetail(skillId: string): Promise<ClawHubSkill | null> {
  try {
    const res = await clawHubFetch(`/skills/${encodeURIComponent(skillId)}`);
    if (!res.ok) return null;
    return mapClawHubSkill((await res.json()) as ClawHubDetailPayload);
  } catch {
    return null;
  }
}
