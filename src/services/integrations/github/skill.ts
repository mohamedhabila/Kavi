import type { Skill } from '../../skills/types';
import { createGitHubIssueTools } from './issueTools';
import { createGitHubRepositoryTools } from './repositoryTools';
import { createGitHubWorkflowTools } from './workflowTools';

export function createGitHubSkill(): Skill {
  return {
    id: 'github',
    name: 'GitHub',
    description:
      'GitHub repositories, repo files, branches, commits, issues, pull requests, and workflow status',
    version: '2.0.0',
    tools: [
      ...createGitHubRepositoryTools(),
      ...createGitHubIssueTools(),
      ...createGitHubWorkflowTools(),
    ],
  };
}
