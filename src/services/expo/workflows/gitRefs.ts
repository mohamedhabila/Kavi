import type { ExpoProjectConfig } from '../../../types/remote';
import { expoGraphqlRequest } from '../providers/expoGraphql';
import { githubApi } from '../../github/api';
import { normalizeRepo, trimToUndefined } from '../projectState';
function getExpoGitRefCandidates(
  project: Pick<ExpoProjectConfig, 'workflowRef' | 'repoDefaultBranch'>,
): string[] {
  return Array.from(
    new Set(
      [
        trimToUndefined(project.workflowRef),
        trimToUndefined(project.repoDefaultBranch),
        'main',
        'master',
        'develop',
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

async function resolveExpoProjectGitRefAsync(
  project: ExpoProjectConfig,
  githubToken?: string,
): Promise<{ ref: string; repoDefaultBranch?: string }> {
  const configuredRef = trimToUndefined(project.workflowRef);
  if (configuredRef) {
    return { ref: configuredRef, repoDefaultBranch: trimToUndefined(project.repoDefaultBranch) };
  }

  const repoDefaultBranch = trimToUndefined(project.repoDefaultBranch);
  if (repoDefaultBranch) {
    return { ref: repoDefaultBranch, repoDefaultBranch };
  }

  const repo = normalizeRepo(project.repoFullName);
  if (repo && githubToken) {
    const metadata = await githubApi<{ default_branch?: string }>(`/repos/${repo}`, githubToken);
    const detectedDefaultBranch = metadata.default_branch?.trim();
    if (detectedDefaultBranch) {
      return { ref: detectedDefaultBranch, repoDefaultBranch: detectedDefaultBranch };
    }
  }

  return { ref: 'main' };
}

async function resolveExpoWorkflowRevisionFromGitRefsAsync(
  token: string,
  appId: string,
  fileName: string,
  gitRefs: string[],
): Promise<{ workflowRevisionId: string; gitRef: string }> {
  let lastError: unknown;

  for (const gitRef of Array.from(
    new Set(
      gitRefs
        .map((value) => trimToUndefined(value))
        .filter((value): value is string => Boolean(value)),
    ),
  )) {
    try {
      const workflowRevisionData = await expoGraphqlRequest<{
        workflowRevision?: {
          getOrCreateWorkflowRevisionFromGitRef?: {
            id?: string | null;
          } | null;
        };
      }>(
        token,
        `
        mutation GetOrCreateWorkflowRevisionFromGitRef($appId: ID!, $fileName: String!, $gitRef: String!) {
          workflowRevision {
            getOrCreateWorkflowRevisionFromGitRef(appId: $appId, fileName: $fileName, gitRef: $gitRef) {
              id
            }
          }
        }
      `,
        {
          appId,
          fileName,
          gitRef,
        },
      );

      const workflowRevisionId =
        workflowRevisionData.workflowRevision?.getOrCreateWorkflowRevisionFromGitRef?.id;
      if (workflowRevisionId) {
        return { workflowRevisionId, gitRef };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(
    `Workflow revision not found for ${fileName} on branches: ${gitRefs.join(', ')}. Set the correct branch in project settings (Workflow Ref).`,
  );
}

export {
  getExpoGitRefCandidates,
  resolveExpoProjectGitRefAsync,
  resolveExpoWorkflowRevisionFromGitRefsAsync,
};
