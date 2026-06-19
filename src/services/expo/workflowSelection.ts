import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';
import type { ExpoWorkflowTemplateSuggestion } from './contracts';
import { normalizeRepo, trimToUndefined } from './projectState';

function uniqueWorkflowFiles(files: string[] | undefined): string[] | undefined {
  if (!files?.length) {
    return undefined;
  }
  return Array.from(
    new Set(
      files.map((file) => trimToUndefined(file)).filter((file): file is string => Boolean(file)),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function scoreWorkflowFile(
  fileName: string,
  action?: 'build' | 'update' | 'submit' | 'deploy-web',
): number {
  const normalized = trimToUndefined(fileName)?.toLowerCase() || '';
  let score = 0;

  if (/deploy-to-production|production|golden/.test(normalized)) score += 100;
  if (/deploy|release/.test(normalized)) score += action === 'deploy-web' ? 60 : 20;
  if (/build/.test(normalized)) score += action === 'build' ? 55 : 10;
  if (/update|publish/.test(normalized)) score += action === 'update' ? 55 : 10;
  if (/submit|store/.test(normalized)) score += action === 'submit' ? 55 : 10;
  if (/hosting|web/.test(normalized)) score += action === 'deploy-web' ? 55 : 5;
  if (/preview/.test(normalized)) score -= 10;

  return score;
}

function selectDefaultWorkflowFile(files: string[] | undefined): string | undefined {
  if (!files?.length) {
    return undefined;
  }
  return [...files].sort(
    (left, right) =>
      scoreWorkflowFile(right) - scoreWorkflowFile(left) || left.localeCompare(right),
  )[0];
}

function selectWorkflowFileForAction(
  project: Pick<ExpoProjectConfig, 'workflowFile' | 'availableWorkflowFiles'>,
  action?: 'build' | 'update' | 'submit' | 'deploy-web',
): string | undefined {
  const configured = trimToUndefined(project.workflowFile);
  if (configured) {
    return configured;
  }

  const available = uniqueWorkflowFiles(project.availableWorkflowFiles);
  if (!available?.length) {
    return undefined;
  }

  return [...available].sort(
    (left, right) =>
      scoreWorkflowFile(right, action) - scoreWorkflowFile(left, action) ||
      left.localeCompare(right),
  )[0];
}

function escapeYamlSingleQuotedString(value: string): string {
  return value.replace(/'/g, "''");
}

export function getExpoRecommendedWorkflowBranch(
  project: Pick<ExpoProjectConfig, 'workflowRef' | 'repoDefaultBranch'>,
): string {
  return (
    trimToUndefined(project.workflowRef) || trimToUndefined(project.repoDefaultBranch) || 'main'
  );
}

function hasExactExpoDeployWorkflow(
  project: Pick<ExpoProjectConfig, 'workflowFile' | 'availableWorkflowFiles'>,
): boolean {
  const files = uniqueWorkflowFiles([
    project.workflowFile || '',
    ...(project.availableWorkflowFiles || []),
  ]);
  return Boolean(files?.some((file) => file.toLowerCase() === '.eas/workflows/deploy.yml'));
}

export function buildExpoDeployWorkflowTemplate(branch: string): ExpoWorkflowTemplateSuggestion {
  const normalizedBranch = trimToUndefined(branch) || 'main';
  const escapedBranch = escapeYamlSingleQuotedString(normalizedBranch);

  return {
    path: '.eas/workflows/deploy.yml',
    branch: normalizedBranch,
    content: [
      'name: Deploy',
      '',
      'on:',
      '  push:',
      `    branches: ['${escapedBranch}']`,
      '',
      'jobs:',
      '  deploy:',
      '    type: deploy',
      '    name: Deploy',
      '    environment: production',
      '    params:',
      '      prod: true',
    ].join('\n'),
    note: 'Manual eas workflow:run is optional. The normal path is to commit this file to the target branch and let EAS Workflows start automatically on each matching push.',
  };
}

function isExpoHostedWorkflowFile(fileName: string | undefined): boolean {
  const normalized = trimToUndefined(fileName)?.toLowerCase();
  return Boolean(normalized && normalized.startsWith('.eas/workflows/'));
}

function canUseExpoHostedWorkflow(
  project: Pick<ExpoProjectConfig, 'repoFullName' | 'workflowFile' | 'availableWorkflowFiles'>,
  account?: Pick<ExpoAccountConfig, 'enabled' | 'tokenRef'>,
): boolean {
  if (!account?.enabled || !account.tokenRef) {
    return false;
  }
  if (!normalizeRepo(project.repoFullName)) {
    return false;
  }
  return isExpoHostedWorkflowFile(selectWorkflowFileForAction(project));
}

export {
  uniqueWorkflowFiles,
  selectDefaultWorkflowFile,
  selectWorkflowFileForAction,
  canUseExpoHostedWorkflow,
  hasExactExpoDeployWorkflow,
};
