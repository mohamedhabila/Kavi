export const GITHUB_REPO_DESCRIPTION =
  'Repository in owner/repo form. GitHub URLs and git remotes are also accepted.';
export const GITHUB_BRANCH_DESCRIPTION =
  'Plain branch name like feature/test. Do not include refs/heads/.';
export const GITHUB_BASE_BRANCH_DESCRIPTION =
  'Plain base/source branch name like main. Do not include refs/heads/.';
export const GITHUB_REF_DESCRIPTION =
  'Branch, tag, or commit SHA. Full refs like refs/heads/main are accepted and normalized.';
export const GITHUB_PATH_DESCRIPTION =
  'Repository-relative path like src/app.ts. GitHub blob/tree URLs are also accepted and normalized.';
export const GITHUB_WORKFLOW_FILE_DESCRIPTION = 'Workflow file path like .github/workflows/ci.yml.';
export const GITHUB_COMMIT_MODES = new Set(['100644', '100755', '120000']);
