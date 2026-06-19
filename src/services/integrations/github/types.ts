export type GitHubCommitChange = {
  path: string;
  content?: string;
  delete: boolean;
  mode: string;
};

export type GitHubTargetRef = {
  ref: string;
  branch?: string;
  sha?: string;
  pullNumber?: number;
  baseBranch?: string;
};

export type GitHubToolErrorContext = {
  toolName: string;
  repo?: string;
  branch?: string;
  ref?: string;
  path?: string;
  phase?: string;
  permissionHint?: string;
  skipRepoProbe?: boolean;
};

export type GitHubRepoAccessState = 'accessible' | 'inaccessible' | 'unknown';
