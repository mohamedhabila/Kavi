import type { ExpoAccountConfig } from '../../types/remote';
import type { ExpoAccountProjectInfo, ExpoGraphqlProjectNode, ExpoWorkflowInfo } from './contracts';
import { expoGraphqlRequest, getRepoFullNameFromExpoNode } from './providers/expoGraphql';
import { githubApi } from '../github/api';
import {
  getExpoProjectSlug,
  normalizeExpoOwner,
  normalizeExpoProjectRef,
  normalizeRepo,
} from './projectState';
import { tryResolveProjectGithubToken } from './secrets';
import { uniqueWorkflowFiles } from './workflowSelection';

const EXPO_PROJECT_SYNC_PAGE_SIZE = 50;
function mapExpoGraphqlProject(
  project: ExpoGraphqlProjectNode,
  accountId: string,
): ExpoAccountProjectInfo {
  const normalizedFullName = normalizeExpoProjectRef(
    project.fullName ||
      `${normalizeExpoOwner(project.ownerAccount?.name)}/${getExpoProjectSlug(project) || ''}`,
  );
  const fullName =
    normalizedFullName ||
    `@${normalizeExpoOwner(project.ownerAccount?.name)}/${getExpoProjectSlug(project) || ''}`;
  const [ownerPart = '', slugPart = ''] = fullName.replace(/^@/, '').split('/');
  const owner = normalizeExpoOwner(project.ownerAccount?.name) || ownerPart;
  const slug = getExpoProjectSlug(project) || slugPart;

  return {
    projectId: project.id,
    accountId,
    owner,
    slug,
    fullName: `@${owner}/${slug}`,
    name: project.name?.trim() || `${owner}/${slug}`,
    repoFullName: getRepoFullNameFromExpoNode(project),
  };
}

export async function fetchExpoProjectWorkflowsAsync(
  token: string,
  appId: string,
): Promise<ExpoWorkflowInfo[]> {
  const data = await expoGraphqlRequest<{
    app?: {
      byId?: {
        workflows?: Array<{
          id: string;
          name?: string | null;
          fileName?: string | null;
          revisionsPaginated?: {
            edges?: Array<{
              node?: {
                id?: string | null;
              } | null;
            }>;
          } | null;
        }>;
      } | null;
    };
  }>(
    token,
    `
    query ExpoProjectWorkflows($appId: String!) {
      app {
        byId(appId: $appId) {
          id
          workflows {
            id
            name
            fileName
            revisionsPaginated(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      }
    }
  `,
    { appId },
  );

  return (data.app?.byId?.workflows || [])
    .map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      fileName: workflow.fileName?.trim() || '',
      latestRevisionId: workflow.revisionsPaginated?.edges?.[0]?.node?.id || undefined,
    }))
    .filter((workflow) => Boolean(workflow.fileName));
}

async function enrichExpoProjectsWithAutomationAsync(
  token: string,
  projects: ExpoAccountProjectInfo[],
): Promise<ExpoAccountProjectInfo[]> {
  const githubToken = await tryResolveProjectGithubToken({ githubTokenRef: 'GITHUB_TOKEN' });
  const results = await Promise.all(
    projects.map(async (project) => {
      try {
        const [workflows, repoDefaultBranch] = await Promise.all([
          fetchExpoProjectWorkflowsAsync(token, project.projectId),
          githubToken && normalizeRepo(project.repoFullName)
            ? githubApi<{ default_branch?: string }>(
                `/repos/${normalizeRepo(project.repoFullName)}`,
                githubToken,
              )
                .then((repo) => repo.default_branch?.trim() || undefined)
                .catch(() => undefined)
            : Promise.resolve(undefined),
        ]);
        return {
          ...project,
          repoDefaultBranch,
          availableWorkflowFiles: uniqueWorkflowFiles(
            workflows.map((workflow) => workflow.fileName),
          ),
        } satisfies ExpoAccountProjectInfo;
      } catch {
        return project;
      }
    }),
  );

  return results;
}

async function fetchExpoRemoteAccountAsync(
  token: string,
  accountName: string,
): Promise<{ id: string; name: string }> {
  const data = await expoGraphqlRequest<{
    account?: {
      byName?: {
        id?: string | null;
        name?: string | null;
      } | null;
    };
  }>(
    token,
    `
    query ExpoAccountByName($accountName: String!) {
      account {
        byName(accountName: $accountName) {
          id
          name
        }
      }
    }
  `,
    { accountName },
  );

  const remoteAccount = data.account?.byName;
  if (!remoteAccount?.id) {
    throw new Error('expo-account-not-found');
  }

  return {
    id: remoteAccount.id,
    name: remoteAccount.name?.trim() || accountName,
  };
}

export async function findExpoProjectByFullNameAsync(
  token: string,
  fullName: string,
): Promise<ExpoAccountProjectInfo | null> {
  try {
    const data = await expoGraphqlRequest<{
      app?: {
        byFullName?: ExpoGraphqlProjectNode | null;
      };
    }>(
      token,
      `
      query ExpoProjectByFullName($fullName: String!) {
        app {
          byFullName(fullName: $fullName) {
            id
            name
            fullName
            slug
            ownerAccount {
              id
              name
            }
            githubRepository {
              metadata {
                githubRepoOwnerName
                githubRepoName
              }
            }
          }
        }
      }
    `,
      { fullName },
    );

    const project = data.app?.byFullName;
    return project ? mapExpoGraphqlProject(project, '') : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/experience_not_found|project does not exist|not found/i.test(message)) {
      return null;
    }
    throw error;
  }
}

async function fetchExpoAccountProjectsAsync(
  account: ExpoAccountConfig,
  token: string,
): Promise<ExpoAccountProjectInfo[]> {
  const projects: ExpoAccountProjectInfo[] = [];
  let offset = 0;

  while (true) {
    const data = await expoGraphqlRequest<{
      account?: {
        byName?: {
          id?: string | null;
          apps?: ExpoGraphqlProjectNode[] | null;
        } | null;
      };
    }>(
      token,
      `
      query ExpoAccountProjects($accountName: String!, $offset: Int!, $limit: Int!) {
        account {
          byName(accountName: $accountName) {
            id
            apps(offset: $offset, limit: $limit) {
              id
              name
              fullName
              slug
              ownerAccount {
                id
                name
              }
              githubRepository {
                metadata {
                  githubRepoOwnerName
                  githubRepoName
                }
              }
            }
          }
        }
      }
    `,
      {
        accountName: account.owner,
        offset,
        limit: EXPO_PROJECT_SYNC_PAGE_SIZE,
      },
    );

    const page = (data.account?.byName?.apps || []).map((project) =>
      mapExpoGraphqlProject(project, account.id),
    );
    projects.push(...page);

    if (page.length < EXPO_PROJECT_SYNC_PAGE_SIZE) {
      break;
    }

    offset += EXPO_PROJECT_SYNC_PAGE_SIZE;
  }

  return enrichExpoProjectsWithAutomationAsync(token, projects);
}

async function createExpoRemoteProjectAsync(
  token: string,
  remoteAccountId: string,
  projectName: string,
): Promise<string> {
  const data = await expoGraphqlRequest<{
    app?: {
      createApp?: {
        id?: string | null;
      } | null;
    };
  }>(
    token,
    `
    mutation CreateExpoProject($appInput: AppInput!) {
      app {
        createApp(appInput: $appInput) {
          id
        }
      }
    }
  `,
    {
      appInput: {
        accountId: remoteAccountId,
        projectName,
      },
    },
  );

  const projectId = data.app?.createApp?.id;
  if (!projectId) {
    throw new Error('expo-project-create-failed');
  }

  return projectId;
}

export { fetchExpoRemoteAccountAsync, createExpoRemoteProjectAsync, fetchExpoAccountProjectsAsync };
