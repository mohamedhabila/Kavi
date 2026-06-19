export interface ClawHubSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  downloads: number;
  rating: number;
  installUrl: string;
}

export interface ClawHubSearchResult {
  skills: ClawHubSkill[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ClawHubListResult {
  skills: ClawHubSkill[];
  nextCursor: string | null;
}
