import { getSecure } from '../storage/SecureStorage';
import { executeSshCommand } from '../ssh/connector';
import { addRemoteArtifact, startRemoteJob, updateRemoteJob } from '../remote/store';
import { i18n } from '../../i18n';
import { useSettingsStore } from '../../store/useSettingsStore';
import type {
  AppSettings,
  ExpoAccountConfig,
  ExpoProjectConfig,
  RemoteJobRecord,
  SshTargetConfig,
} from '../../types';
import { decompressSync, strFromU8, unzipSync } from 'fflate';

const brotliJs = require('brotli-js') as {
  decompressArray(input: Uint8Array): ArrayLike<number>;
};

export type ExpoProjectReadinessReason =
  | 'disabled'
  | 'missing-account'
  | 'missing-owner'
  | 'missing-slug'
  | 'missing-expo-token'
  | 'missing-linked-repo'
  | 'missing-ssh-target'
  | 'missing-project-path'
  | 'missing-workflow-file'
  | 'missing-github-token'
  | 'ready';

export interface ExpoProjectReadiness {
  launchable: boolean;
  reason: ExpoProjectReadinessReason;
}

export interface ExpoCommandResult {
  mode: ExpoProjectConfig['mode'];
  jobId?: string;
  command?: string;
  output?: string;
  workflowRun?: {
    id: string | number;
    url: string;
    status: string;
    conclusion?: string | null;
  };
  publicUrls?: ExpoPublicUrl[];
  guidance?: string;
  note?: string;
}

export interface ExpoPublicUrl {
  label: 'web' | 'preview' | 'custom-domain';
  url: string;
}

export interface ExpoWorkflowJobStep {
  number?: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ExpoWorkflowJobStatus {
  id: string | number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  url?: string | null;
  steps?: ExpoWorkflowJobStep[];
}

export interface ExpoWorkflowRunInspectionResult {
  status: 'ok' | 'not_found' | 'unsupported';
  projectId: string;
  projectName: string;
  mode: ExpoProjectConfig['mode'];
  workflowRun?: ExpoCommandResult['workflowRun'] & {
    createdAt?: string | null;
    updatedAt?: string | null;
    headBranch?: string | null;
    event?: string | null;
  };
  jobs?: ExpoWorkflowJobStatus[];
  logArchiveUrl?: string;
  failureLogs?: ExpoWorkflowFailureLog[];
  publicUrls?: ExpoPublicUrl[];
  note?: string;
  guidance?: string;
}

export interface ExpoWorkflowFailureLog {
  source: string;
  excerpt: string;
}

export interface ExpoWorkflowRunListResult {
  status: 'ok' | 'unsupported';
  projectId: string;
  projectName: string;
  mode: ExpoProjectConfig['mode'];
  runs: Array<ExpoWorkflowRunInspectionResult['workflowRun']>;
  publicUrls?: ExpoPublicUrl[];
  note?: string;
  guidance?: string;
}

export type ExpoProjectCheckStage = 'config' | 'secret' | 'ssh' | 'project' | 'workflow';

export interface ExpoProjectCheck {
  stage: ExpoProjectCheckStage;
  ok: boolean;
  message: string;
}

export interface ExpoProjectProbeResult {
  ok: boolean;
  message: string;
  checkedAt: number;
  checks: ExpoProjectCheck[];
  workflowRun?: ExpoCommandResult['workflowRun'];
}

export interface ExpoAccountProjectInfo {
  projectId: string;
  accountId: string;
  owner: string;
  slug: string;
  fullName: string;
  name: string;
  repoFullName?: string;
  repoDefaultBranch?: string;
  availableWorkflowFiles?: string[];
}

export interface ExpoAccountProjectsSyncResult {
  accountId: string;
  syncedAt: number;
  projectCount: number;
  projects: ExpoAccountProjectInfo[];
}

export interface ExpoProjectListing {
  id: string;
  easProjectId?: string;
  name: string;
  fullName: string;
  owner: string;
  slug: string;
  accountId: string;
  accountName?: string;
  source?: ExpoProjectConfig['source'];
  mode: ExpoProjectConfig['mode'];
  repoFullName?: string;
  repoDefaultBranch?: string;
  availableWorkflowFiles?: string[];
  readiness: ExpoProjectReadiness & { label: string };
  lastSyncedAt?: number;
}

export interface ExpoWorkflowTemplateSuggestion {
  path: string;
  branch: string;
  content: string;
  note?: string;
}

export interface ExpoAutomationSummary {
  preferredFlow: 'commit-driven-eas-workflow' | 'github-workflow-dispatch' | 'direct-ssh-cli';
  autoTriggerOnPush: boolean;
  repoLinked: boolean;
  workflowFile?: string;
  recommendedBranch: string;
  recommendedMonitoringTools: string[];
  manualActionTools: string[];
  recommendedFlow: string[];
  deployWorkflow?: ExpoWorkflowTemplateSuggestion;
}

interface ExpoWorkflowInfo {
  id: string;
  name?: string | null;
  fileName: string;
  latestRevisionId?: string;
}

interface ExpoHostedWorkflowErrorEntry {
  title?: string | null;
  message?: string | null;
}

interface ExpoHostedWorkflowBuildRecord {
  id?: string | null;
  status?: string | null;
  logFiles?: string[] | null;
  error?: {
    errorCode?: string | null;
    message?: string | null;
    docsUrl?: string | null;
  } | null;
}

interface ExpoHostedWorkflowJobRecord {
  id: string;
  key?: string | null;
  name?: string | null;
  status?: string | null;
  type?: string | null;
  outputs?: Record<string, unknown> | null;
  errors?: ExpoHostedWorkflowErrorEntry[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  turtleJobRun?: {
    id?: string | null;
    logFileUrls?: string[] | null;
    errors?: Array<{
      errorCode?: string | null;
      message?: string | null;
    }> | null;
  } | null;
  turtleBuild?: ExpoHostedWorkflowBuildRecord | null;
}

interface ExpoHostedWorkflowRunRecord {
  id: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  errors?: ExpoHostedWorkflowErrorEntry[] | null;
  jobs?: ExpoHostedWorkflowJobRecord[] | null;
}

interface ExpoHostedWorkflowLogLine {
  time?: string | null;
  msg: string;
  result?: string | null;
  marker?: string | null;
  err?: unknown;
}

interface ExpoHostedWorkflowLogGroup {
  key: string;
  label: string;
  conclusion?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  logLines: ExpoHostedWorkflowLogLine[];
}

interface ExpoGraphqlProjectNode {
  id: string;
  name?: string | null;
  fullName?: string | null;
  slug?: string | null;
  ownerAccount?: {
    id?: string | null;
    name?: string | null;
  } | null;
  githubRepository?: {
    metadata?: {
      githubRepoOwnerName?: string | null;
      githubRepoName?: string | null;
    } | null;
  } | null;
}

interface ExpoGraphqlErrorEntry {
  message?: string | null;
  path?: Array<string | number> | null;
  extensions?: Record<string, unknown> | null;
}

interface ExpoGraphqlEnvelope<T> {
  data?: T | null;
  errors?: ExpoGraphqlErrorEntry[] | null;
}

const EXPO_GRAPHQL_URL = 'https://api.expo.dev/graphql';
const EXPO_PROJECT_SYNC_PAGE_SIZE = 50;
const EXPO_MONITORING_TOOL_NAMES = [
  'expo_eas_workflow_runs',
  'expo_eas_workflow_status',
  'expo_eas_workflow_wait',
] as const;
const EXPO_MANUAL_ACTION_TOOL_NAMES = [
  'expo_eas_build',
  'expo_eas_update',
  'expo_eas_submit',
  'expo_eas_deploy_web',
] as const;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function trimToUndefined(value?: string | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

function normalizeRepo(value?: string): string | undefined {
  return trimToUndefined(value);
}

function slugifyExpoProjectName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'expo-project';
}

function normalizeExpoOwner(value?: string | null): string {
  return trimToUndefined(value)?.replace(/^@+/, '') || '';
}

function normalizeExpoProjectRef(value: string): string {
  const trimmed = trimToUndefined(value);
  if (!trimmed) {
    return '';
  }
  return trimmed.startsWith('@') ? trimmed.toLowerCase() : `@${trimmed.toLowerCase()}`;
}

function getExpoProjectSlug(project: { slug?: string | null }): string | undefined {
  return trimToUndefined(project.slug);
}

function requireExpoProjectPath(project: Pick<ExpoProjectConfig, 'projectPath'>): string {
  const projectPath = trimToUndefined(project.projectPath);
  if (!projectPath) {
    throw new Error('missing-project-path');
  }
  return projectPath;
}

function requireGitHubWorkflowRepo(project: Pick<ExpoProjectConfig, 'repoFullName'>): string {
  const repo = normalizeRepo(project.repoFullName);
  if (!repo) {
    throw new Error('missing-linked-repo');
  }
  return repo;
}

function requireGitHubWorkflowFile(project: Pick<ExpoProjectConfig, 'workflowFile'>): string {
  const workflowFile = trimToUndefined(project.workflowFile);
  if (!workflowFile) {
    throw new Error('missing-workflow-file');
  }
  return workflowFile;
}

function getExpoAccounts(
  settings?: Partial<Pick<AppSettings, 'expoAccounts'>>,
): ExpoAccountConfig[] {
  return settings?.expoAccounts || useSettingsStore.getState().expoAccounts || [];
}

function getExpoProjects(
  settings?: Partial<Pick<AppSettings, 'expoProjects'>>,
): ExpoProjectConfig[] {
  return settings?.expoProjects || useSettingsStore.getState().expoProjects || [];
}

function getSshTargets(settings?: Partial<Pick<AppSettings, 'sshTargets'>>): SshTargetConfig[] {
  return settings?.sshTargets || useSettingsStore.getState().sshTargets || [];
}

export function getExpoProjectDisplayOwner(
  project: ExpoProjectConfig,
  account?: ExpoAccountConfig,
): string {
  return normalizeExpoOwner(project.owner) || normalizeExpoOwner(account?.owner) || 'owner';
}

export function getExpoProjectFullName(
  project: ExpoProjectConfig,
  account?: ExpoAccountConfig,
): string {
  return `@${getExpoProjectDisplayOwner(project, account)}/${getExpoProjectSlug(project) || 'unknown-project'}`;
}

export async function hasConfiguredGithubToken(): Promise<boolean> {
  return Boolean((await getSecure('GITHUB_TOKEN'))?.trim());
}

async function resolveConfiguredSecretValue(
  secretRef: string | undefined,
  missingReason: string,
): Promise<string> {
  const value = secretRef ? await getSecure(secretRef) : '';
  if (!value?.trim()) {
    throw new Error(missingReason);
  }
  return value.trim();
}

async function resolveExpoAccountToken(account: ExpoAccountConfig): Promise<string> {
  return resolveConfiguredSecretValue(account.tokenRef, 'missing-expo-token');
}

async function resolveProjectGithubToken(project: ExpoProjectConfig): Promise<string> {
  return resolveConfiguredSecretValue(
    project.githubTokenRef || 'GITHUB_TOKEN',
    'missing-github-token',
  );
}

async function tryResolveProjectGithubToken(
  project: Pick<ExpoProjectConfig, 'githubTokenRef'>,
): Promise<string | undefined> {
  try {
    return await resolveConfiguredSecretValue(
      project.githubTokenRef || 'GITHUB_TOKEN',
      'missing-github-token',
    );
  } catch {
    return undefined;
  }
}

function formatExpoGraphqlErrors(errors?: ExpoGraphqlErrorEntry[] | null): Array<{
  message: string;
  path?: string;
  code?: string;
}> {
  return (errors || []).map((entry) => {
    const message = trimToUndefined(entry.message) || 'expo-graphql-error';
    const path =
      Array.isArray(entry.path) && entry.path.length > 0
        ? entry.path.map((segment) => String(segment)).join('.')
        : undefined;
    const extensions =
      entry.extensions && typeof entry.extensions === 'object' && !Array.isArray(entry.extensions)
        ? (entry.extensions as Record<string, unknown>)
        : undefined;
    const rawCode =
      typeof extensions?.code === 'string'
        ? extensions.code
        : typeof extensions?.errorCode === 'string'
          ? extensions.errorCode
          : undefined;
    const code = trimToUndefined(rawCode);

    return {
      message,
      ...(path ? { path } : {}),
      ...(code ? { code } : {}),
    };
  });
}

function describeExpoGraphqlErrors(errors?: ExpoGraphqlErrorEntry[] | null): string | undefined {
  const formatted = formatExpoGraphqlErrors(errors);
  if (formatted.length === 0) {
    return undefined;
  }

  return formatted
    .map((entry) => (entry.path ? `${entry.message} (path: ${entry.path})` : entry.message))
    .join('; ');
}

async function fetchExpoGraphqlEnvelope<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{
  response: Response;
  payload: ExpoGraphqlEnvelope<T> | null;
  rawText: string;
}> {
  const response = await fetch(EXPO_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  let rawText = '';
  if (typeof response.text === 'function') {
    rawText = await response.text().catch(() => '');
  } else if (typeof response.json === 'function') {
    const payload = await response.json().catch(() => null);
    rawText = payload == null ? '' : JSON.stringify(payload);
  }
  if (!trimToUndefined(rawText)) {
    return { response, payload: null, rawText };
  }

  try {
    return {
      response,
      payload: JSON.parse(rawText) as ExpoGraphqlEnvelope<T>,
      rawText,
    };
  } catch {
    if (!response.ok) {
      throw new Error(trimToUndefined(rawText) || `expo-graphql-${response.status}`);
    }
    throw new Error('expo-graphql-invalid-response');
  }
}

async function expoGraphqlRequest<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const { response, payload, rawText } = await fetchExpoGraphqlEnvelope<T>(token, query, variables);

  if (!response.ok) {
    const errorMessage =
      describeExpoGraphqlErrors(payload?.errors) ||
      trimToUndefined(rawText) ||
      `expo-graphql-${response.status}`;
    throw new Error(errorMessage);
  }

  if (payload?.errors?.length) {
    throw new Error(describeExpoGraphqlErrors(payload.errors) || 'expo-graphql-error');
  }

  if (payload?.data === undefined || payload.data === null) {
    throw new Error('expo-graphql-empty-response');
  }

  return payload.data;
}

function getRepoFullNameFromExpoNode(project: ExpoGraphqlProjectNode): string | undefined {
  const owner = project.githubRepository?.metadata?.githubRepoOwnerName?.trim();
  const repoName = project.githubRepository?.metadata?.githubRepoName?.trim();
  return owner && repoName ? `${owner}/${repoName}` : undefined;
}

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

export function getExpoProjectExecutionMode(
  project: Pick<
    ExpoProjectConfig,
    | 'mode'
    | 'source'
    | 'repoFullName'
    | 'workflowFile'
    | 'availableWorkflowFiles'
    | 'githubTokenRef'
    | 'sshTargetId'
    | 'projectPath'
  >,
  account?: Pick<ExpoAccountConfig, 'enabled' | 'tokenRef'>,
): ExpoProjectConfig['mode'] {
  if (project.mode === 'eas-workflow') {
    return 'eas-workflow';
  }

  const hostedWorkflowReady = canUseExpoHostedWorkflow(project, account);
  if (!hostedWorkflowReady) {
    return project.mode || 'eas-workflow';
  }

  if (project.source === 'account-sync') {
    return 'eas-workflow';
  }

  if (project.mode === 'github-workflow' && !project.githubTokenRef?.trim()) {
    return 'eas-workflow';
  }

  if (project.mode === 'direct-ssh' && (!project.sshTargetId || !project.projectPath?.trim())) {
    return 'eas-workflow';
  }

  return project.mode || 'eas-workflow';
}

export function getExpoAutomationSummary(
  project: Pick<
    ExpoProjectConfig,
    | 'mode'
    | 'source'
    | 'repoFullName'
    | 'workflowFile'
    | 'availableWorkflowFiles'
    | 'githubTokenRef'
    | 'sshTargetId'
    | 'projectPath'
    | 'workflowRef'
    | 'repoDefaultBranch'
    | 'platforms'
  >,
  account?: Pick<ExpoAccountConfig, 'enabled' | 'tokenRef'>,
): ExpoAutomationSummary {
  const mode = getExpoProjectExecutionMode(project, account);
  const repoLinked = Boolean(normalizeRepo(project.repoFullName));
  const workflowFile = selectWorkflowFileForAction(project);
  const recommendedBranch = getExpoRecommendedWorkflowBranch(project);
  const deployWorkflow =
    (project.platforms || []).includes('web') && !hasExactExpoDeployWorkflow(project)
      ? buildExpoDeployWorkflowTemplate(recommendedBranch)
      : undefined;

  if (mode === 'direct-ssh') {
    return {
      preferredFlow: 'direct-ssh-cli',
      autoTriggerOnPush: false,
      repoLinked,
      workflowFile,
      recommendedBranch,
      recommendedMonitoringTools: [],
      manualActionTools: [...EXPO_MANUAL_ACTION_TOOL_NAMES],
      recommendedFlow: [
        'This project is configured for direct SSH EAS CLI execution, not commit-triggered EAS Workflows.',
        'If you want the Expo-managed default, link the repo in Expo and add .eas/workflows/*.yml on the target branch.',
        'Otherwise run the configured SSH-backed action and inspect the command output directly.',
      ],
      deployWorkflow,
    };
  }

  if (mode === 'github-workflow') {
    return {
      preferredFlow: 'github-workflow-dispatch',
      autoTriggerOnPush: false,
      repoLinked,
      workflowFile,
      recommendedBranch,
      recommendedMonitoringTools: [...EXPO_MONITORING_TOOL_NAMES],
      manualActionTools: [...EXPO_MANUAL_ACTION_TOOL_NAMES],
      recommendedFlow: [
        'This project is configured around GitHub workflow dispatch or a non-Expo workflow file, not the default Expo-hosted commit-driven flow.',
        'If you want the default Expo-managed path, link the repo in Expo and add .eas/workflows/*.yml on the target branch.',
        'Until then, only use manual action tools when the user explicitly asks for a manual run.',
      ],
      deployWorkflow,
    };
  }

  return {
    preferredFlow: 'commit-driven-eas-workflow',
    autoTriggerOnPush: repoLinked && Boolean(workflowFile),
    repoLinked,
    workflowFile,
    recommendedBranch,
    recommendedMonitoringTools: [...EXPO_MONITORING_TOOL_NAMES],
    manualActionTools: [...EXPO_MANUAL_ACTION_TOOL_NAMES],
    recommendedFlow: [
      repoLinked
        ? 'Edit the linked repository or working branch with repository or workspace tools.'
        : 'Link the GitHub repository to the Expo project first so EAS Workflows can react to commits.',
      workflowFile
        ? `Keep ${workflowFile} on the target branch, then commit the required app changes.`
        : 'Add .eas/workflows/deploy.yml for EAS Hosting or another required .eas/workflows/*.yml file on the target branch before committing.',
      `Push a commit to ${recommendedBranch} or another branch matched by the workflow on.push trigger.`,
      `Monitor the automatically triggered run with ${EXPO_MONITORING_TOOL_NAMES.join(', ')}.`,
    ],
    deployWorkflow,
  };
}

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

async function fetchExpoProjectWorkflowsAsync(
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

async function findExpoProjectByFullNameAsync(
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

async function fetchExpoAccountProjectsAsync(
  account: ExpoAccountConfig,
  token: string,
): Promise<ExpoAccountProjectInfo[]> {
  const query = `
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
  `;

  const projects: ExpoAccountProjectInfo[] = [];
  let offset = 0;

  while (offset < EXPO_PROJECT_SYNC_PAGE_SIZE * 20) {
    const data = await expoGraphqlRequest<{
      account?: {
        byName?: {
          id?: string;
          apps?: ExpoGraphqlProjectNode[];
        } | null;
      };
    }>(token, query, {
      accountName: account.owner,
      offset,
      limit: EXPO_PROJECT_SYNC_PAGE_SIZE,
    });

    const page = data.account?.byName?.apps || [];
    projects.push(...page.map((project) => mapExpoGraphqlProject(project, account.id)));

    if (page.length < EXPO_PROJECT_SYNC_PAGE_SIZE) {
      break;
    }
    offset += page.length;
  }

  return enrichExpoProjectsWithAutomationAsync(token, projects);
}

function mergeSyncedExpoProjects(
  existingProjects: ExpoProjectConfig[],
  account: ExpoAccountConfig,
  discoveredProjects: ExpoAccountProjectInfo[],
  syncedAt: number,
): ExpoProjectConfig[] {
  const retainedProjects = existingProjects.filter((project) => project.accountId !== account.id);
  const existingAccountProjects = existingProjects.filter(
    (project) => project.accountId === account.id,
  );
  const matchedExistingIds = new Set<string>();

  const syncedProjects = discoveredProjects.map((discoveredProject) => {
    const matchedProject = existingAccountProjects.find((project) => {
      if (
        project.id === discoveredProject.projectId ||
        project.easProjectId === discoveredProject.projectId
      ) {
        return true;
      }
      return (
        normalizeExpoProjectRef(getExpoProjectFullName(project, account)) ===
        normalizeExpoProjectRef(discoveredProject.fullName)
      );
    });

    if (matchedProject) {
      matchedExistingIds.add(matchedProject.id);
    }

    const repoFullName = matchedProject?.repoFullName || discoveredProject.repoFullName;
    const availableWorkflowFiles =
      uniqueWorkflowFiles(discoveredProject.availableWorkflowFiles) ||
      matchedProject?.availableWorkflowFiles;
    const workflowFile =
      matchedProject?.workflowFile ||
      selectDefaultWorkflowFile(discoveredProject.availableWorkflowFiles);
    const mode = canUseExpoHostedWorkflow(
      {
        repoFullName,
        workflowFile,
        availableWorkflowFiles,
      },
      account,
    )
      ? 'eas-workflow'
      : matchedProject?.mode || 'eas-workflow';

    return {
      ...matchedProject,
      id: matchedProject?.id || discoveredProject.projectId,
      easProjectId: discoveredProject.projectId,
      name:
        discoveredProject.name ||
        matchedProject?.name ||
        `${discoveredProject.owner}/${discoveredProject.slug}`,
      accountId: account.id,
      owner: discoveredProject.owner,
      slug: discoveredProject.slug,
      source: 'account-sync' as const,
      lastSyncedAt: syncedAt,
      enabled: matchedProject?.enabled ?? true,
      mode,
      repoFullName,
      repoDefaultBranch: matchedProject?.repoDefaultBranch || discoveredProject.repoDefaultBranch,
      availableWorkflowFiles,
      workflowFile,
      workflowRef: matchedProject?.workflowRef,
      defaultBuildProfile: matchedProject?.defaultBuildProfile || 'production',
      defaultUpdateBranch: matchedProject?.defaultUpdateBranch || 'production',
      updateChannel: matchedProject?.updateChannel || 'production',
      platforms: matchedProject?.platforms?.length
        ? matchedProject.platforms
        : (['android', 'ios', 'web'] satisfies Array<'android' | 'ios' | 'web'>),
    };
  });

  const unmatchedProjects = existingAccountProjects.filter(
    (project) => !matchedExistingIds.has(project.id),
  );
  return [...retainedProjects, ...syncedProjects, ...unmatchedProjects];
}

export async function syncExpoAccountProjects(
  accountId: string,
): Promise<ExpoAccountProjectsSyncResult> {
  const settings = useSettingsStore.getState();
  const account = resolveExpoAccount(accountId, settings);
  const token = await resolveExpoAccountToken(account);
  const syncedAt = Date.now();

  try {
    const projects = await fetchExpoAccountProjectsAsync(account, token);
    useSettingsStore.setState((current) => ({
      expoAccounts: (current.expoAccounts || []).map((entry) =>
        entry.id === account.id
          ? {
              ...entry,
              lastProjectSyncAt: syncedAt,
              lastProjectSyncError: undefined,
              syncedProjectCount: projects.length,
            }
          : entry,
      ),
      expoProjects: mergeSyncedExpoProjects(
        current.expoProjects || [],
        account,
        projects,
        syncedAt,
      ),
    }));

    return {
      accountId: account.id,
      syncedAt,
      projectCount: projects.length,
      projects,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'expo-project-sync-failed';
    useSettingsStore.setState((current) => ({
      expoAccounts: (current.expoAccounts || []).map((entry) =>
        entry.id === account.id
          ? {
              ...entry,
              lastProjectSyncAt: syncedAt,
              lastProjectSyncError: message,
            }
          : entry,
      ),
    }));
    throw error;
  }
}

export async function syncAllExpoAccountProjects(
  accountIds?: string[],
): Promise<ExpoAccountProjectsSyncResult[]> {
  const accounts = getExpoAccounts().filter(
    (account) =>
      account.enabled && account.tokenRef && (!accountIds || accountIds.includes(account.id)),
  );
  const results = await Promise.allSettled(
    accounts.map((account) => syncExpoAccountProjects(account.id)),
  );
  return results
    .filter(
      (result): result is PromiseFulfilledResult<ExpoAccountProjectsSyncResult> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value);
}

export async function listExpoProjects(options?: {
  accountId?: string;
  refresh?: boolean;
}): Promise<ExpoProjectListing[]> {
  if (options?.refresh) {
    if (options.accountId) {
      await syncExpoAccountProjects(options.accountId);
    } else {
      await syncAllExpoAccountProjects();
    }
  }

  const settings = useSettingsStore.getState();
  const accountMap = new Map(getExpoAccounts(settings).map((account) => [account.id, account]));

  return (getExpoProjects(settings) || [])
    .filter((project) => !options?.accountId || project.accountId === options.accountId)
    .map((project) => {
      const account = accountMap.get(project.accountId);
      const readiness = getExpoProjectReadiness(project, account, settings);
      const mode = getExpoProjectExecutionMode(project, account);
      return {
        id: project.id,
        easProjectId: project.easProjectId,
        name: project.name,
        fullName: getExpoProjectFullName(project, account),
        owner: getExpoProjectDisplayOwner(project, account),
        slug: project.slug,
        accountId: project.accountId,
        accountName: account?.name,
        source: project.source,
        mode,
        repoFullName: project.repoFullName,
        availableWorkflowFiles: project.availableWorkflowFiles,
        lastSyncedAt: project.lastSyncedAt,
        readiness: {
          ...readiness,
          label: getExpoProjectReadinessLabel(readiness),
        },
      } satisfies ExpoProjectListing;
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export type ExpoProjectExecutionResolution =
  | {
      status: 'resolved';
      project: ExpoProjectListing;
      candidates: ExpoProjectListing[];
      reason:
        | 'project-ref'
        | 'repo-match'
        | 'single-launchable'
        | 'single-enabled-project'
        | 'single-candidate';
      synced: boolean;
    }
  | {
      status: 'ambiguous';
      candidates: ExpoProjectListing[];
      reason: 'multiple-launchable' | 'multiple-candidates';
      synced: boolean;
    }
  | {
      status: 'not_found';
      candidates: ExpoProjectListing[];
      reason: 'no-projects' | 'no-matching-project';
      synced: boolean;
    };

function normalizeRepoForComparison(value: string | undefined): string {
  return normalizeRepo(value)?.toLowerCase() ?? '';
}

function matchesExpoProjectRef(project: ExpoProjectListing, projectRef: string): boolean {
  const normalizedRef = normalizeExpoProjectRef(projectRef);
  if (!normalizedRef && !projectRef.trim()) {
    return false;
  }

  return (
    project.id === projectRef ||
    project.easProjectId === projectRef ||
    normalizeExpoProjectRef(project.fullName) === normalizedRef ||
    project.slug.toLowerCase() === projectRef.trim().toLowerCase()
  );
}

function chooseExpoProjectExecutionCandidate(
  projects: ExpoProjectListing[],
  options?: {
    projectRef?: string;
    repoFullName?: string;
  },
  synced = false,
): ExpoProjectExecutionResolution {
  const enabledProjects = projects.filter((project) => project.readiness.reason !== 'disabled');
  const requestedRef = trimToUndefined(options?.projectRef);
  if (requestedRef) {
    const matches = enabledProjects.filter((project) => matchesExpoProjectRef(project, requestedRef));
    if (matches.length === 1) {
      return {
        status: 'resolved',
        project: matches[0],
        candidates: matches,
        reason: 'project-ref',
        synced,
      };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', candidates: matches, reason: 'multiple-candidates', synced };
    }
    return {
      status: 'not_found',
      candidates: enabledProjects,
      reason: enabledProjects.length > 0 ? 'no-matching-project' : 'no-projects',
      synced,
    };
  }

  const repoFullName = normalizeRepoForComparison(options?.repoFullName);
  if (repoFullName) {
    const matches = enabledProjects.filter(
      (project) => normalizeRepoForComparison(project.repoFullName) === repoFullName,
    );
    if (matches.length === 1) {
      return {
        status: 'resolved',
        project: matches[0],
        candidates: matches,
        reason: 'repo-match',
        synced,
      };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', candidates: matches, reason: 'multiple-candidates', synced };
    }
  }

  const launchableProjects = enabledProjects.filter((project) => project.readiness.launchable);
  if (launchableProjects.length === 1) {
    return {
      status: 'resolved',
      project: launchableProjects[0],
      candidates: launchableProjects,
      reason: 'single-launchable',
      synced,
    };
  }
  if (launchableProjects.length > 1) {
    return {
      status: 'ambiguous',
      candidates: launchableProjects,
      reason: 'multiple-launchable',
      synced,
    };
  }

  if (enabledProjects.length === 1) {
    return {
      status: 'resolved',
      project: enabledProjects[0],
      candidates: enabledProjects,
      reason: 'single-enabled-project',
      synced,
    };
  }

  return enabledProjects.length > 1
    ? { status: 'ambiguous', candidates: enabledProjects, reason: 'multiple-candidates', synced }
    : { status: 'not_found', candidates: [], reason: 'no-projects', synced };
}

export async function resolveExpoProjectForExecutionTask(options?: {
  accountId?: string;
  projectRef?: string;
  repoFullName?: string;
  allowSync?: boolean;
}): Promise<ExpoProjectExecutionResolution> {
  const loadProjects = async (refresh: boolean) =>
    listExpoProjects({
      accountId: options?.accountId,
      refresh,
    });

  let projects = await loadProjects(false);
  let resolution = chooseExpoProjectExecutionCandidate(projects, options, false);
  if (resolution.status === 'resolved' || options?.allowSync === false) {
    return resolution;
  }

  const settings = useSettingsStore.getState();
  const enabledAccounts = getExpoAccounts(settings).filter(
    (account) =>
      account.enabled &&
      account.tokenRef &&
      (!options?.accountId || account.id === options.accountId),
  );
  if (enabledAccounts.length === 1) {
    projects = await loadProjects(true);
    resolution = chooseExpoProjectExecutionCandidate(projects, options, true);
  }

  return resolution;
}

export function getExpoProjectReadiness(
  project: ExpoProjectConfig,
  account?: ExpoAccountConfig,
  settings?: Pick<AppSettings, 'sshTargets'>,
): ExpoProjectReadiness {
  if (!project.enabled) {
    return { launchable: false, reason: 'disabled' };
  }
  if (!account?.enabled) {
    return { launchable: false, reason: 'missing-account' };
  }
  if (!getExpoProjectDisplayOwner(project, account).trim()) {
    return { launchable: false, reason: 'missing-owner' };
  }
  if (!getExpoProjectSlug(project)) {
    return { launchable: false, reason: 'missing-slug' };
  }
  const executionMode = getExpoProjectExecutionMode(project, account);

  if (executionMode === 'eas-workflow') {
    if (!account.tokenRef) {
      return { launchable: false, reason: 'missing-expo-token' };
    }
    if (!normalizeRepo(project.repoFullName)) {
      return { launchable: false, reason: 'missing-linked-repo' };
    }
    if (!selectWorkflowFileForAction(project)) {
      return { launchable: false, reason: 'missing-workflow-file' };
    }
    return { launchable: true, reason: 'ready' };
  }

  if (executionMode === 'direct-ssh') {
    if (!account.tokenRef) {
      return { launchable: false, reason: 'missing-expo-token' };
    }
    if (!project.sshTargetId) {
      return { launchable: false, reason: 'missing-ssh-target' };
    }
    const sshTarget = getSshTargets(settings).find(
      (target) => target.id === project.sshTargetId && target.enabled,
    );
    if (!sshTarget) {
      return { launchable: false, reason: 'missing-ssh-target' };
    }
    if (!project.projectPath?.trim()) {
      return { launchable: false, reason: 'missing-project-path' };
    }
    return { launchable: true, reason: 'ready' };
  }

  if (!normalizeRepo(project.repoFullName)) {
    return { launchable: false, reason: 'missing-linked-repo' };
  }
  if (!project.workflowFile?.trim()) {
    return { launchable: false, reason: 'missing-workflow-file' };
  }
  if (!project.githubTokenRef?.trim()) {
    return { launchable: false, reason: 'missing-github-token' };
  }
  return { launchable: true, reason: 'ready' };
}

export function getExpoProjectReadinessLabel(readiness: ExpoProjectReadiness): string {
  switch (readiness.reason) {
    case 'disabled':
      return i18n.t('remoteWork.disabledTarget');
    case 'missing-account':
      return i18n.t('remoteWork.expoReadinessMissingAccount');
    case 'missing-owner':
      return i18n.t('remoteWork.expoReadinessMissingOwner');
    case 'missing-slug':
      return i18n.t('remoteWork.expoReadinessMissingSlug');
    case 'missing-expo-token':
      return i18n.t('remoteWork.expoReadinessMissingExpoToken');
    case 'missing-linked-repo':
      return i18n.t('remoteWork.expoReadinessMissingLinkedRepo');
    case 'missing-ssh-target':
      return i18n.t('remoteWork.expoReadinessMissingSshTarget');
    case 'missing-project-path':
      return i18n.t('remoteWork.expoReadinessMissingProjectPath');
    case 'missing-workflow-file':
      return i18n.t('remoteWork.expoReadinessMissingWorkflowFile');
    case 'missing-github-token':
      return i18n.t('remoteWork.expoReadinessMissingGithubToken');
    case 'ready':
    default:
      return i18n.t('remoteWork.statusReady');
  }
}

function getExpoWorkflowToolUnavailableNote(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  settings: Pick<AppSettings, 'sshTargets'>,
): string | undefined {
  const readiness = getExpoProjectReadiness(project, account, settings);
  if (readiness.launchable) {
    return undefined;
  }
  return `Workflow tooling unavailable until this project is ready: ${getExpoProjectReadinessLabel(readiness)}.`;
}

function getHostedWorkflowUnavailableNote(
  appId: string | undefined,
  workflowFile: string | undefined,
): string | undefined {
  if (!workflowFile) {
    return 'Expo-hosted workflow tooling is unavailable until an automation workflow is configured or synced.';
  }
  if (!appId) {
    return 'Expo-hosted workflow tooling is unavailable until this project is synced to an EAS project id.';
  }
  return undefined;
}

export function resolveExpoAccount(
  accountId: string,
  settings?: Pick<AppSettings, 'expoAccounts'>,
): ExpoAccountConfig {
  const account = getExpoAccounts(settings).find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error('expo-account-not-found');
  }
  return account;
}

export function resolveExpoProject(
  projectId: string,
  settings?: Partial<Pick<AppSettings, 'expoProjects' | 'expoAccounts'>>,
): ExpoProjectConfig {
  const normalizedProjectRef = normalizeExpoProjectRef(projectId);
  const accountMap = new Map(getExpoAccounts(settings).map((entry) => [entry.id, entry]));
  const project = getExpoProjects(settings).find((entry) => {
    if (entry.id === projectId || entry.easProjectId === projectId) {
      return true;
    }

    const entrySlug = getExpoProjectSlug(entry);
    if (!entrySlug) {
      return false;
    }
    const entryFullName = normalizeExpoProjectRef(
      getExpoProjectFullName(entry, accountMap.get(entry.accountId)),
    );
    return Boolean(normalizedProjectRef) && entryFullName === normalizedProjectRef;
  });
  if (!project) {
    throw new Error('expo-project-not-found');
  }
  return project;
}

function collectExpoGraphqlProjectRefs(variables: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const addStringValue = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = trimToUndefined(value);
    if (trimmed) {
      refs.push(trimmed);
    }
  };
  const addSingleArrayValue = (value: unknown) => {
    if (!Array.isArray(value) || value.length !== 1) {
      return;
    }
    addStringValue(value[0]);
  };

  addStringValue(variables.projectId);
  addStringValue(variables.appId);
  addStringValue(variables.easProjectId);
  addStringValue(variables.experienceId);
  addStringValue(variables.fullName);
  addStringValue(variables.appFullName);
  addStringValue(variables.projectFullName);
  addStringValue(variables.experienceName);
  addStringValue(variables.appIdentifier);
  addSingleArrayValue(variables.projectIds);
  addSingleArrayValue(variables.appIds);

  const owner =
    typeof variables.owner === 'string'
      ? trimToUndefined(variables.owner)
      : typeof variables.accountName === 'string'
        ? trimToUndefined(variables.accountName)
        : undefined;
  const slug =
    typeof variables.slug === 'string'
      ? trimToUndefined(variables.slug)
      : typeof variables.projectSlug === 'string'
        ? trimToUndefined(variables.projectSlug)
        : typeof variables.appSlug === 'string'
          ? trimToUndefined(variables.appSlug)
          : undefined;

  if (owner && slug) {
    refs.push(`@${normalizeExpoOwner(owner)}/${slug}`);
  }

  return Array.from(
    new Set(refs.map((ref) => (ref.startsWith('@') ? normalizeExpoProjectRef(ref) : ref.trim()))),
  );
}

function tryResolveExpoProjectFromGraphqlVariables(
  settings: Partial<Pick<AppSettings, 'expoProjects' | 'expoAccounts'>>,
  variables: Record<string, unknown>,
): ExpoProjectConfig | undefined {
  const refs = collectExpoGraphqlProjectRefs(variables);
  for (const ref of refs) {
    try {
      return resolveExpoProject(ref, settings);
    } catch {
      continue;
    }
  }
  return undefined;
}

function tryResolveExpoAccountFromGraphqlVariables(
  settings: Partial<Pick<AppSettings, 'expoAccounts'>>,
  variables: Record<string, unknown>,
): ExpoAccountConfig | undefined {
  const accounts = getExpoAccounts(settings).filter((entry) => entry.enabled);
  const candidates = [variables.accountName, variables.owner, variables.ownerName]
    .map((value) => (typeof value === 'string' ? trimToUndefined(value) : undefined))
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const normalizedOwner = normalizeExpoOwner(candidate);
    const lowerCandidate = candidate.toLowerCase();
    const matches = accounts.filter(
      (account) =>
        normalizeExpoOwner(account.owner) === normalizedOwner ||
        trimToUndefined(account.name)?.toLowerCase() === lowerCandidate,
    );

    if (matches.length === 1) {
      return matches[0];
    }
  }

  return undefined;
}

export function resolveExpoProjectSshTarget(
  project: ExpoProjectConfig,
  settings?: Pick<AppSettings, 'sshTargets'>,
): SshTargetConfig {
  const target = getSshTargets(settings).find((entry) => entry.id === project.sshTargetId);
  if (!target) {
    throw new Error('expo-ssh-target-not-found');
  }
  return target;
}

function getDefaultPlatforms(project: ExpoProjectConfig): string[] {
  const platforms = project.platforms?.length ? project.platforms : ['android', 'ios', 'web'];
  return platforms;
}

function getExpoModeLabel(mode: ExpoProjectConfig['mode']): string {
  switch (mode) {
    case 'eas-workflow':
      return 'Expo workflow';
    case 'github-workflow':
      return 'GitHub workflow';
    case 'direct-ssh':
    default:
      return 'Direct EAS CLI';
  }
}

function getExpoWorkflowRunUrl(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  workflowRunId: string,
): string {
  return `https://expo.dev/accounts/${getExpoProjectDisplayOwner(project, account)}/projects/${getExpoProjectSlug(project) || 'project'}/workflows/${workflowRunId}`;
}

function normalizePublicUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getExpoProjectPublicUrls(project: ExpoProjectConfig): ExpoPublicUrl[] | undefined {
  const urls: ExpoPublicUrl[] = [];
  const webUrl = normalizePublicUrl(project.webUrl);
  const previewUrl = normalizePublicUrl(project.previewUrl);
  const customDomain = normalizePublicUrl(project.customDomain);

  if (webUrl) {
    urls.push({ label: 'web', url: webUrl });
  }
  if (previewUrl) {
    urls.push({ label: 'preview', url: previewUrl });
  }
  if (customDomain) {
    urls.push({ label: 'custom-domain', url: customDomain });
  }

  return urls.length ? urls : undefined;
}

function isExpoHostedWorkflowTerminal(status: string | undefined): boolean {
  if (!status) {
    return false;
  }
  return !['NEW', 'IN_PROGRESS', 'ACTION_REQUIRED'].includes(status);
}

function isWorkflowRunTerminal(
  mode: ExpoProjectConfig['mode'],
  status: string | undefined,
): boolean {
  if (!status) {
    return false;
  }
  if (mode === 'github-workflow') {
    return status === 'completed';
  }
  if (mode === 'eas-workflow') {
    return isExpoHostedWorkflowTerminal(status);
  }
  return true;
}

function isWorkflowRunFailure(
  mode: ExpoProjectConfig['mode'],
  status: string | undefined,
  conclusion: string | null | undefined,
): boolean {
  if (!status) {
    return false;
  }
  if (mode === 'github-workflow') {
    return status === 'completed' && Boolean(conclusion) && conclusion !== 'success';
  }
  if (mode === 'eas-workflow') {
    return isExpoHostedWorkflowTerminal(status) && !['SUCCESS', 'COMPLETED'].includes(status);
  }
  return false;
}

function getGithubRequestHeaders(token: string, headers?: HeadersInit): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    ...(headers || {}),
  };
}

function mapGitHubWorkflowRun(
  run: any,
): NonNullable<ExpoWorkflowRunInspectionResult['workflowRun']> {
  return {
    id: run.id,
    url: run.html_url,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at || null,
    updatedAt: run.updated_at || null,
    headBranch: run.head_branch || null,
    event: run.event || null,
  };
}

const WORKFLOW_LOG_ERROR_PATTERNS = [
  /(^|\s)(error|errors|fatal|exception|traceback)(\s|:|$)/i,
  /(^|\s)(failed|failure|failing)(\s|:|$)/i,
  /(^|\s)(assertionerror|typeerror|referenceerror|syntaxerror|module not found)(\s|:|$)/i,
  /(^|\s)(npm ERR!|yarn error|gradle.*failed|xcodebuild: error|command failed)(\s|:|$)/i,
];

const WINDOWS_1252_EXTENDED_CHARS = [
  '\u20AC',
  '\u0081',
  '\u201A',
  '\u0192',
  '\u201E',
  '\u2026',
  '\u2020',
  '\u2021',
  '\u02C6',
  '\u2030',
  '\u0160',
  '\u2039',
  '\u0152',
  '\u008D',
  '\u017D',
  '\u008F',
  '\u0090',
  '\u2018',
  '\u2019',
  '\u201C',
  '\u201D',
  '\u2022',
  '\u2013',
  '\u2014',
  '\u02DC',
  '\u2122',
  '\u0161',
  '\u203A',
  '\u0153',
  '\u009D',
  '\u017E',
  '\u0178',
];

type SupportedWorkflowTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
type SupportedWorkflowCompressionEncoding = 'brotli' | 'deflate';

function getResponseHeaderValue(
  response: { headers?: { get?: (name: string) => string | null } | null },
  headerName: string,
): string | undefined {
  const headers = response.headers;
  if (!headers || typeof headers.get !== 'function') {
    return undefined;
  }

  return trimToUndefined(headers.get(headerName));
}

function normalizeWorkflowTextEncoding(
  label?: string | null,
): SupportedWorkflowTextEncoding | undefined {
  const normalized = trimToUndefined(label)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (['utf-8', 'utf8'].includes(normalized)) {
    return 'utf-8';
  }

  if (['utf-16', 'utf16', 'utf-16le', 'utf16le'].includes(normalized)) {
    return 'utf-16le';
  }

  if (['utf-16be', 'utf16be'].includes(normalized)) {
    return 'utf-16be';
  }

  if (
    [
      'ascii',
      'cp1252',
      'iso-8859-1',
      'iso8859-1',
      'latin1',
      'latin-1',
      'us-ascii',
      'windows-1252',
    ].includes(normalized)
  ) {
    return 'windows-1252';
  }

  return undefined;
}

function extractCharsetFromContentType(
  contentType?: string,
): SupportedWorkflowTextEncoding | undefined {
  const normalized = trimToUndefined(contentType);
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  const charset = match?.[1] || match?.[2];
  return normalizeWorkflowTextEncoding(charset);
}

function detectWorkflowTextBom(bytes: Uint8Array): SupportedWorkflowTextEncoding | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return 'utf-16le';
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return 'utf-16be';
  }

  return undefined;
}

function stripWorkflowTextBom(
  bytes: Uint8Array,
  encoding?: SupportedWorkflowTextEncoding,
): Uint8Array {
  if (
    encoding === 'utf-8' &&
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return bytes.subarray(3);
  }

  if ((encoding === 'utf-16le' || encoding === 'utf-16be') && bytes.length >= 2) {
    const isLittleEndianBom = bytes[0] === 0xff && bytes[1] === 0xfe;
    const isBigEndianBom = bytes[0] === 0xfe && bytes[1] === 0xff;
    if (isLittleEndianBom || isBigEndianBom) {
      return bytes.subarray(2);
    }
  }

  return bytes;
}

function decodeUtf16WorkflowText(bytes: Uint8Array, littleEndian: boolean): string {
  const view = stripWorkflowTextBom(bytes, littleEndian ? 'utf-16le' : 'utf-16be');
  const evenLength = view.length - (view.length % 2);
  if (evenLength <= 0) {
    return '';
  }

  const codeUnits: number[] = [];
  for (let index = 0; index < evenLength; index += 2) {
    codeUnits.push(
      littleEndian ? view[index] | (view[index + 1] << 8) : (view[index] << 8) | view[index + 1],
    );
  }

  let text = '';
  for (let index = 0; index < codeUnits.length; index += 4096) {
    text += String.fromCharCode(...codeUnits.slice(index, index + 4096));
  }

  return text;
}

function decodeWindows1252WorkflowText(bytes: Uint8Array): string {
  const chars: string[] = [];
  for (const byte of bytes) {
    if (byte >= 0x80 && byte <= 0x9f) {
      chars.push(WINDOWS_1252_EXTENDED_CHARS[byte - 0x80]);
      continue;
    }

    chars.push(String.fromCharCode(byte));
  }

  return chars.join('');
}

function decodeUtf8WorkflowText(bytes: Uint8Array): string {
  const view = stripWorkflowTextBom(bytes, 'utf-8');
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(view);
  }

  return strFromU8(view);
}

function decodeWorkflowTextBytes(bytes: Uint8Array, contentType?: string): string {
  const bomEncoding = detectWorkflowTextBom(bytes);
  const hintedEncoding = bomEncoding || extractCharsetFromContentType(contentType) || 'utf-8';

  switch (hintedEncoding) {
    case 'utf-16le':
      return decodeUtf16WorkflowText(bytes, true);
    case 'utf-16be':
      return decodeUtf16WorkflowText(bytes, false);
    case 'windows-1252':
      return decodeWindows1252WorkflowText(bytes);
    case 'utf-8':
    default: {
      const utf8Text = decodeUtf8WorkflowText(bytes);
      if (
        !bomEncoding &&
        !extractCharsetFromContentType(contentType) &&
        utf8Text.includes('\uFFFD')
      ) {
        return decodeWindows1252WorkflowText(bytes);
      }
      return utf8Text;
    }
  }
}

function looksLikeDecodedWorkflowText(bytes: Uint8Array, contentType?: string): boolean {
  if (!bytes.length) {
    return false;
  }

  const sampleBytes = bytes.subarray(0, Math.min(bytes.length, 512));
  const sampleText = decodeWorkflowTextBytes(sampleBytes, contentType);
  const trimmed = sampleText.trim();
  if (!trimmed || sampleText.includes('\uFFFD')) {
    return false;
  }

  const visibleChars = Array.from(sampleText).filter((char) => {
    const code = char.charCodeAt(0);
    return code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20;
  }).length;
  const controlChars = Array.from(sampleText).length - visibleChars;

  if (visibleChars === 0 || controlChars > Math.max(2, Math.floor(sampleText.length / 20))) {
    return false;
  }

  return /^[\[{("A-Za-z0-9@._/-]/.test(trimmed);
}

function extractWorkflowCompressionEncodings(
  contentEncoding?: string,
): SupportedWorkflowCompressionEncoding[] {
  const normalized = trimToUndefined(contentEncoding)?.toLowerCase();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(',')
    .map((segment) => segment.trim())
    .map((segment) => {
      if (segment === 'br') {
        return 'brotli';
      }
      if (/(gzip|x-gzip|deflate)/.test(segment)) {
        return 'deflate';
      }
      return undefined;
    })
    .filter((encoding): encoding is SupportedWorkflowCompressionEncoding => Boolean(encoding));
}

function decompressWorkflowTextBytes(
  bytes: Uint8Array,
  contentEncoding?: string,
  contentType?: string,
): Uint8Array {
  const encodings = extractWorkflowCompressionEncodings(contentEncoding);

  if (!encodings.length) {
    if (!looksCompressed(bytes)) {
      return bytes;
    }

    try {
      return new Uint8Array(decompressSync(bytes));
    } catch {
      return bytes;
    }
  }

  let output = bytes;
  let decompressed = false;

  for (const encoding of [...encodings].reverse()) {
    if (looksLikeDecodedWorkflowText(output, contentType)) {
      return output;
    }

    try {
      output =
        encoding === 'brotli'
          ? Uint8Array.from(brotliJs.decompressArray(output))
          : new Uint8Array(decompressSync(output));
      decompressed = true;
    } catch {
      return decompressed ? output : bytes;
    }
  }

  return output;
}

function shouldAttemptWorkflowLogDecompression(
  bytes: Uint8Array,
  contentEncoding?: string,
): boolean {
  return extractWorkflowCompressionEncodings(contentEncoding).length > 0 || looksCompressed(bytes);
}

function normalizeLogToken(value: string | undefined | null): string {
  return (
    trimToUndefined(value)
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim() || ''
  );
}

export function excerptWorkflowLogText(text: string, maxChars = 5000): string {
  const cleaned = stripAnsiAndControlChars(text);
  const lines = cleaned.split(/\r?\n/);
  let focusIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (WORKFLOW_LOG_ERROR_PATTERNS.some((pattern) => pattern.test(lines[index]))) {
      focusIndex = index;
      break;
    }
  }

  const start = focusIndex >= 0 ? Math.max(0, focusIndex - 20) : Math.max(0, lines.length - 80);
  const end = focusIndex >= 0 ? Math.min(lines.length, focusIndex + 41) : lines.length;
  const excerpt = lines.slice(start, end).join('\n').trim();

  if (excerpt.length <= maxChars) {
    return excerpt;
  }

  return `${excerpt.slice(0, maxChars - 1).trimEnd()}…`;
}

function scoreGitHubFailureLog(
  path: string,
  text: string,
  failedJobs: Set<string>,
  failedSteps: Set<string>,
): number {
  const normalizedPath = normalizeLogToken(path);
  let score = 0;

  for (const failedJob of failedJobs) {
    if (failedJob && normalizedPath.includes(failedJob)) {
      score += 8;
    }
  }

  for (const failedStep of failedSteps) {
    if (failedStep && normalizedPath.includes(failedStep)) {
      score += 6;
    }
  }

  const errorMatches = WORKFLOW_LOG_ERROR_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
  score += errorMatches * 4;

  if (/\b(exit code|returned non-zero|command failed)\b/i.test(text)) {
    score += 3;
  }

  return score;
}

async function fetchGitHubWorkflowFailureLogs(
  repo: string,
  runId: string | number,
  token: string,
  jobs?: ExpoWorkflowJobStatus[],
): Promise<ExpoWorkflowFailureLog[] | undefined> {
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/logs`, {
    method: 'GET',
    headers: getGithubRequestHeaders(token),
  });

  if (!response.ok) {
    return undefined;
  }

  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return undefined;
  }

  const failedJobs = new Set(
    (jobs || [])
      .filter((job) => Boolean(job.conclusion && job.conclusion !== 'success'))
      .map((job) => normalizeLogToken(job.name))
      .filter(Boolean),
  );
  const failedSteps = new Set(
    (jobs || [])
      .flatMap((job) => job.steps || [])
      .filter((step) => Boolean(step.conclusion && step.conclusion !== 'success'))
      .map((step) => normalizeLogToken(step.name))
      .filter(Boolean),
  );

  const rankedLogs = Object.entries(archive)
    .filter(([path, bytes]) => /\.txt$/i.test(path) && bytes.length > 0)
    .map(([path, bytes]) => {
      const text = decodeWorkflowTextBytes(bytes);
      return {
        path,
        excerpt: excerptWorkflowLogText(text),
        score: scoreGitHubFailureLog(path, text, failedJobs, failedSteps),
      };
    })
    .filter((entry) => Boolean(entry.excerpt))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  const selected = rankedLogs.filter((entry) => entry.score > 0).slice(0, 3);
  const fallback = !selected.length && rankedLogs.length ? rankedLogs.slice(-1) : selected;

  if (!fallback.length) {
    return undefined;
  }

  return fallback.map((entry) => ({
    source: entry.path,
    excerpt: entry.excerpt,
  }));
}

function getExpoWorkflowDispatchInputs(
  project: ExpoProjectConfig,
  action: 'build' | 'update' | 'submit' | 'deploy-web',
  args: {
    platform?: 'android' | 'ios' | 'all';
    profile?: string;
    branch?: string;
    message?: string;
    alias?: string;
  },
): Record<string, unknown> {
  return {
    action,
    platform: args.platform || 'android',
    profile: args.profile || project.defaultBuildProfile || 'production',
    branch: args.branch || project.defaultUpdateBranch || 'production',
    message: args.message || `Triggered from Kavi for ${project.name}`,
    alias: args.alias || 'production',
  };
}

function normalizeExpoWorkflowGitRef(value: string | undefined): string | undefined {
  const normalized = trimToUndefined(value)
    ?.replace(/^refs\/heads\//i, '')
    .replace(/^heads\//i, '')
    .replace(/^origin\//i, '');
  return normalized || undefined;
}

function normalizeWorkflowConclusion(value?: string | null): string | undefined {
  const normalized = trimToUndefined(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (['success', 'succeeded', 'completed', 'pass', 'passed'].includes(normalized)) {
    return 'success';
  }
  if (['fail', 'failed', 'failure', 'error', 'errored'].includes(normalized)) {
    return 'failure';
  }
  if (['cancelled', 'canceled', 'skipped'].includes(normalized)) {
    return normalized;
  }
  return normalized;
}

function isFailureConclusion(value?: string | null): boolean {
  return normalizeWorkflowConclusion(value) === 'failure';
}

function isFailureStatus(value?: string | null): boolean {
  return ['FAILURE', 'FAILED', 'ERRORED', 'ERROR'].includes(
    trimToUndefined(value)?.toUpperCase() || '',
  );
}

function humanizeWorkflowPhase(value?: string | null): string | undefined {
  const normalized = trimToUndefined(value);
  if (!normalized) {
    return undefined;
  }
  return normalized
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function extractFailureLogsFromErrorEntries(
  entries:
    | Array<ExpoHostedWorkflowErrorEntry | { message?: string | null; errorCode?: string | null }>
    | undefined
    | null,
  fallbackSource: string,
): ExpoWorkflowFailureLog[] | undefined {
  const failureLogs = (entries || [])
    .map((entry) => {
      const source =
        trimToUndefined('title' in entry ? entry.title : undefined) ||
        trimToUndefined('errorCode' in entry ? entry.errorCode : undefined) ||
        fallbackSource;
      const excerpt = [
        trimToUndefined('title' in entry ? entry.title : undefined),
        trimToUndefined(entry.message),
      ]
        .filter(Boolean)
        .join('\n')
        .trim();
      if (!excerpt) {
        return null;
      }

      return { source, excerpt } satisfies ExpoWorkflowFailureLog;
    })
    .filter((entry): entry is ExpoWorkflowFailureLog => Boolean(entry));

  return failureLogs.length ? failureLogs : undefined;
}

function mergeFailureLogs(
  ...groups: Array<ExpoWorkflowFailureLog[] | undefined>
): ExpoWorkflowFailureLog[] | undefined {
  const merged: ExpoWorkflowFailureLog[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const entry of group || []) {
      const key = `${entry.source}\n${entry.excerpt}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(entry);
      if (merged.length >= 6) {
        return merged;
      }
    }
  }

  return merged.length ? merged : undefined;
}

/**
 * Detect if raw bytes are gzip/zlib/deflate compressed.
 * Gzip starts with magic bytes 0x1f 0x8b; zlib starts with 0x78.
 */
export function looksCompressed(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false;
  // Gzip magic: 0x1f 0x8b
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return true;
  // Zlib header: 0x78 (01/9c/da)
  if (bytes[0] === 0x78 && (bytes[1] === 0x01 || bytes[1] === 0x9c || bytes[1] === 0xda))
    return true;
  return false;
}

/** Strip ANSI escape sequences and common terminal control chars from log text. */
export function stripAnsiAndControlChars(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/**
 * Quick check whether a decoded string looks like readable log text rather than
 * garbled binary.  Used as a post-decompression sanity gate so that compressed
 * bytes that slip through (e.g. brotli-js fails on Hermes, or the platform
 * strips Content-Encoding but does not actually decompress) are caught before
 * being surfaced to the user.
 */
function looksLikeReadableLogText(text: string): boolean {
  if (!text || text.length < 4) return false;
  const sample = text.slice(0, 512);
  if (sample.includes('\uFFFD')) return false;
  const printable = Array.from(sample).filter((c) => {
    const code = c.charCodeAt(0);
    return code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20;
  }).length;
  return printable > sample.length * 0.8;
}

/**
 * Fetch a URL and return the response body as text, transparently handling
 * compressed responses that React Native's HTTP stack may not always decode
 * before exposing `arrayBuffer()`.
 *
 * The function applies a post-decode sanity check so that raw compressed bytes
 * are never returned as garbled text.  When the arrayBuffer path produces
 * unreadable output it falls back to re-decoding the buffer without
 * decompression (handles platforms that auto-decompress but leave the
 * Content-Encoding header intact) and ultimately to `response.text()`.
 */
async function fetchDecompressedText(url: string | undefined): Promise<string | undefined> {
  const normalizedUrl = trimToUndefined(url);
  if (!normalizedUrl) {
    return undefined;
  }

  const response = await fetch(normalizedUrl, {
    method: 'GET',
  });
  if (!response.ok) {
    return undefined;
  }

  try {
    const buffer = await response.arrayBuffer();
    const rawBytes: Uint8Array<ArrayBufferLike> = new Uint8Array(buffer);
    const contentType = getResponseHeaderValue(response, 'content-type');
    const contentEncoding = getResponseHeaderValue(response, 'content-encoding');

    // Path 1: Decompress if needed, then decode.
    if (shouldAttemptWorkflowLogDecompression(rawBytes, contentEncoding)) {
      const decompressed = decompressWorkflowTextBytes(rawBytes, contentEncoding, contentType);
      const text = decodeWorkflowTextBytes(decompressed, contentType);
      if (looksLikeReadableLogText(text)) {
        return trimToUndefined(text) || undefined;
      }

      // Path 2: Platform may have already decompressed the body but left
      // Content-Encoding intact.  Try decoding the raw bytes directly.
      const rawText = decodeWorkflowTextBytes(rawBytes, contentType);
      if (looksLikeReadableLogText(rawText)) {
        return trimToUndefined(rawText) || undefined;
      }
    } else {
      const text = decodeWorkflowTextBytes(rawBytes, contentType);
      if (looksLikeReadableLogText(text)) {
        return trimToUndefined(text) || undefined;
      }
    }
  } catch {
    // arrayBuffer path failed entirely — fall through to .text() below.
  }

  // Last resort: try standard .text() which benefits from platform-level
  // decompression (e.g. NSURLSession on iOS auto-decompresses Brotli).
  try {
    const text = await response.text();
    if (looksLikeReadableLogText(text)) {
      return trimToUndefined(text) || undefined;
    }
  } catch {
    // body already consumed or genuinely unreadable
  }

  return undefined;
}

async function fetchExpoBuildLogFilesByIdAsync(
  token: string,
  buildId: string,
): Promise<string[] | undefined> {
  const data = await expoGraphqlRequest<{
    builds: {
      byId: {
        id: string;
        logFiles?: string[] | null;
      };
    };
  }>(
    token,
    `
    query ExpoBuildLogFilesById($buildId: ID!) {
      builds {
        byId(buildId: $buildId) {
          id
          logFiles
        }
      }
    }
  `,
    { buildId },
  );

  return data.builds.byId.logFiles || undefined;
}

function getExpoHostedWorkflowBuildId(job: ExpoHostedWorkflowJobRecord): string | undefined {
  const outputBuildId =
    job.outputs && typeof job.outputs.build_id === 'string'
      ? trimToUndefined(job.outputs.build_id)
      : undefined;
  return outputBuildId || trimToUndefined(job.turtleBuild?.id);
}

async function fetchExpoHostedWorkflowJobRawLogsAsync(
  token: string,
  job: ExpoHostedWorkflowJobRecord,
): Promise<string | undefined> {
  const turtleLogUrl = trimToUndefined(job.turtleJobRun?.logFileUrls?.[0]);
  const turtleLogs = await fetchDecompressedText(turtleLogUrl);
  if (turtleLogs) {
    return turtleLogs;
  }

  const directBuildLogUrl = trimToUndefined(job.turtleBuild?.logFiles?.[0]);
  const directBuildLogs = await fetchDecompressedText(directBuildLogUrl);
  if (directBuildLogs) {
    return directBuildLogs;
  }

  const buildId = getExpoHostedWorkflowBuildId(job);
  if (!buildId) {
    return undefined;
  }

  const buildLogFiles = await fetchExpoBuildLogFilesByIdAsync(token, buildId).catch(
    () => undefined,
  );
  return fetchDecompressedText(buildLogFiles?.[0]);
}

function parseExpoHostedWorkflowLogs(rawLogs: string): ExpoHostedWorkflowLogGroup[] {
  const groups = new Map<string, ExpoHostedWorkflowLogGroup>();
  let groupIndex = 0;

  rawLogs.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) {
      return;
    }

    try {
      const parsed = JSON.parse(line) as {
        time?: string | null;
        msg?: string | null;
        message?: string | null;
        result?: string | null;
        marker?: string | null;
        err?: unknown;
        phase?: string | null;
        buildStepId?: string | null;
        buildStepDisplayName?: string | null;
      };

      const key =
        trimToUndefined(parsed.buildStepId) ||
        trimToUndefined(parsed.buildStepDisplayName) ||
        trimToUndefined(parsed.phase) ||
        `raw-${groupIndex}`;
      const label =
        trimToUndefined(parsed.buildStepDisplayName) ||
        trimToUndefined(parsed.buildStepId) ||
        humanizeWorkflowPhase(parsed.phase) ||
        'Workflow log';
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          logLines: [],
        });
        groupIndex += 1;
      }

      const group = groups.get(key)!;
      const time = trimToUndefined(parsed.time) || null;
      group.startedAt = group.startedAt || time;
      group.completedAt = time || group.completedAt || null;

      const conclusion = normalizeWorkflowConclusion(parsed.result);
      if (conclusion && /end-step|END_PHASE/i.test(trimToUndefined(parsed.marker) || '')) {
        group.conclusion = conclusion;
      }

      group.logLines.push({
        time,
        msg: trimToUndefined(parsed.msg) || trimToUndefined(parsed.message) || '',
        result: trimToUndefined(parsed.result) || null,
        marker: trimToUndefined(parsed.marker) || null,
        err: parsed.err,
      });
    } catch {
      // Expo returns JSONL here. Ignore any malformed lines the same way the CLI does.
    }
  });

  return Array.from(groups.values()).filter((group) => group.logLines.length > 0);
}

function scoreExpoHostedWorkflowLogGroup(
  job: ExpoHostedWorkflowJobRecord,
  group: ExpoHostedWorkflowLogGroup,
): number {
  const normalizedLabel = normalizeLogToken(group.label);
  const text = group.logLines
    .map((line) => [line.msg, line.err ? JSON.stringify(line.err) : ''].filter(Boolean).join('\n'))
    .join('\n');
  let score = 0;

  if (isFailureConclusion(group.conclusion)) {
    score += 12;
  }
  if (isFailureStatus(job.status)) {
    score += 4;
  }
  if (normalizeLogToken(job.type).includes('build')) {
    score += 3;
  }
  if (
    normalizedLabel.includes('install dependencies') ||
    normalizedLabel.includes('node modules')
  ) {
    score += 8;
  }
  if (
    normalizedLabel.includes('build') ||
    normalizedLabel.includes('gradle') ||
    normalizedLabel.includes('xcode')
  ) {
    score += 6;
  }
  if (normalizedLabel.includes('expo doctor') || normalizedLabel.includes('prebuild')) {
    score += 4;
  }
  if (group.logLines.some((line) => line.err)) {
    score += 4;
  }

  score +=
    WORKFLOW_LOG_ERROR_PATTERNS.reduce(
      (count, pattern) => count + (pattern.test(text) ? 1 : 0),
      0,
    ) * 4;
  return score;
}

function buildExpoHostedWorkflowGroupExcerpt(group: ExpoHostedWorkflowLogGroup): string {
  const text = group.logLines
    .map((line) => {
      const prefix = trimToUndefined(line.time);
      const errorPayload = line.err ? `\n${JSON.stringify(line.err)}` : '';
      return [prefix, line.msg].filter(Boolean).join(' ') + errorPayload;
    })
    .filter(Boolean)
    .join('\n');
  return excerptWorkflowLogText(text);
}

function buildExpoHostedWorkflowSteps(
  groups: ExpoHostedWorkflowLogGroup[],
): ExpoWorkflowJobStep[] | undefined {
  const steps = groups.map((group) => ({
    name: group.label,
    status: group.conclusion ? 'completed' : undefined,
    conclusion: group.conclusion,
    startedAt: group.startedAt || null,
    completedAt: group.completedAt || null,
  }));
  return steps.length ? steps : undefined;
}

function extractExpoHostedWorkflowJobFailureLogs(
  job: ExpoHostedWorkflowJobRecord,
  groups: ExpoHostedWorkflowLogGroup[],
  rawLogs?: string,
): ExpoWorkflowFailureLog[] | undefined {
  const rankedGroups = groups
    .map((group) => ({
      group,
      excerpt: buildExpoHostedWorkflowGroupExcerpt(group),
      score: scoreExpoHostedWorkflowLogGroup(job, group),
    }))
    .filter((entry) => Boolean(entry.excerpt))
    .sort(
      (left, right) =>
        right.score - left.score || left.group.label.localeCompare(right.group.label),
    );

  const selectedGroups = rankedGroups.filter((entry) => entry.score > 0).slice(0, 3);
  if (selectedGroups.length) {
    return selectedGroups.map((entry) => ({
      source: `${trimToUndefined(job.name) || 'Build'} / ${entry.group.label}`,
      excerpt: entry.excerpt,
    }));
  }

  const normalizedRawLogs = trimToUndefined(rawLogs);
  const fallbackExcerpt = normalizedRawLogs ? excerptWorkflowLogText(normalizedRawLogs) : undefined;
  if (!fallbackExcerpt) {
    return undefined;
  }

  return [
    {
      source: trimToUndefined(job.name) || 'Build',
      excerpt: fallbackExcerpt,
    },
  ];
}

async function inspectExpoHostedWorkflowJobAsync(
  token: string,
  job: ExpoHostedWorkflowJobRecord,
  options: { includeSteps: boolean; includeLogs: boolean },
): Promise<{ status: ExpoWorkflowJobStatus; failureLogs?: ExpoWorkflowFailureLog[] }> {
  const shouldFetchLogs = options.includeSteps || options.includeLogs;
  const rawLogs = shouldFetchLogs
    ? await fetchExpoHostedWorkflowJobRawLogsAsync(token, job).catch(() => undefined)
    : undefined;
  const groups = rawLogs ? parseExpoHostedWorkflowLogs(rawLogs) : [];
  const status: ExpoWorkflowJobStatus = {
    id: job.id,
    name: trimToUndefined(job.name) || trimToUndefined(job.key) || 'workflow-job',
    status: trimToUndefined(job.status) || null,
    conclusion: isFailureStatus(job.status)
      ? 'failure'
      : normalizeWorkflowConclusion(job.status) || null,
    startedAt: job.createdAt || null,
    completedAt: job.updatedAt || null,
    steps: options.includeSteps ? buildExpoHostedWorkflowSteps(groups) : undefined,
  };

  const failureLogs = options.includeLogs
    ? mergeFailureLogs(
        extractExpoHostedWorkflowJobFailureLogs(job, groups, rawLogs),
        extractFailureLogsFromErrorEntries(job.errors, status.name),
        extractFailureLogsFromErrorEntries(job.turtleJobRun?.errors, `${status.name} job error`),
        mergeFailureLogs(
          extractFailureLogsFromErrorEntries(
            job.turtleBuild?.error ? [job.turtleBuild.error] : undefined,
            `${status.name} build error`,
          ),
        ),
      )
    : undefined;

  return { status, failureLogs };
}

async function fetchExpoWorkflowRunWithJobsAsync(
  token: string,
  workflowRunId: string,
): Promise<ExpoHostedWorkflowRunRecord> {
  const data = await expoGraphqlRequest<{
    workflowRuns: {
      byId: ExpoHostedWorkflowRunRecord;
    };
  }>(
    token,
    `
    query WorkflowRunByIdWithJobs($workflowRunId: ID!) {
      workflowRuns {
        byId(workflowRunId: $workflowRunId) {
          id
          status
          createdAt
          updatedAt
          errors {
            title
            message
          }
          jobs {
            id
            key
            name
            status
            type
            outputs
            errors {
              title
              message
            }
            createdAt
            updatedAt
            turtleJobRun {
              id
              logFileUrls
              errors {
                errorCode
                message
              }
            }
            turtleBuild {
              id
              status
              logFiles
              error {
                errorCode
                message
                docsUrl
              }
            }
          }
        }
      }
    }
  `,
    { workflowRunId },
  );

  return data.workflowRuns.byId;
}

async function fetchExpoWorkflowRunDetailsAsync(
  token: string,
  workflowRunId: string,
  options: { includeJobs: boolean; includeLogs: boolean },
): Promise<{
  id: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  conclusion?: string | null;
  jobs?: ExpoWorkflowJobStatus[];
  failureLogs?: ExpoWorkflowFailureLog[];
}> {
  const run = await fetchExpoWorkflowRunWithJobsAsync(token, workflowRunId);
  const baseFailureLogs = extractFailureLogsFromErrorEntries(run.errors, 'expo-workflow-error');

  if (!options.includeJobs && !options.includeLogs) {
    const errorMessage = baseFailureLogs?.map((entry) => entry.excerpt).join('; ') || undefined;
    return {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt || null,
      updatedAt: run.updatedAt || null,
      conclusion: errorMessage || null,
      failureLogs: baseFailureLogs,
    };
  }

  const inspectedJobs = await Promise.all(
    (run.jobs || []).map((job) =>
      inspectExpoHostedWorkflowJobAsync(token, job, {
        includeSteps: options.includeJobs,
        includeLogs: options.includeLogs,
      }),
    ),
  );
  const failureLogs = mergeFailureLogs(
    baseFailureLogs,
    ...inspectedJobs.map((job) => job.failureLogs),
  );
  const errorMessage = failureLogs?.map((entry) => entry.excerpt).join('; ') || undefined;

  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt || null,
    updatedAt: run.updatedAt || null,
    conclusion: errorMessage || null,
    jobs: options.includeJobs ? inspectedJobs.map((job) => job.status) : undefined,
    failureLogs,
  };
}

function hasLikelyMissingDependencySignal(
  failureLogs: ExpoWorkflowFailureLog[] | undefined,
): boolean {
  const haystack = (failureLogs || [])
    .map((entry) => `${entry.source}\n${entry.excerpt}`)
    .join('\n');
  return /(cannot find module|module not found|unable to resolve module|node_modules|npm err!( code e404)? .*not found|yarn error.*not found|pnpm.*not found|package .* not found|could not resolve|cocoapods could not find compatible versions|pod install|gradle.*could not resolve)/i.test(
    haystack,
  );
}

function getExpoBuildFailureGuidance(
  failureLogs: ExpoWorkflowFailureLog[] | undefined,
  buildStageLogsIncluded: boolean,
): string | undefined {
  if (!failureLogs?.length) {
    return undefined;
  }

  const dependencyHint = hasLikelyMissingDependencySignal(failureLogs)
    ? 'The failure excerpts already point at missing or unresolved dependencies. Verify the package is declared and that the workflow installs dependencies before building.'
    : 'The most frequent Expo build failure is missing or stale dependencies. Verify the workflow ran eas/install_node_modules or the correct npm, yarn, or pnpm install step before the failing build stage.';

  return buildStageLogsIncluded
    ? `Build-stage failure excerpts are included inline. ${dependencyHint}`
    : `Failure excerpts are included inline. ${dependencyHint}`;
}

async function fetchExpoWorkflowRunByIdAsync(
  token: string,
  workflowRunId: string,
): Promise<{
  id: string;
  status: string;
  conclusion?: string | null;
  failureLogs?: ExpoWorkflowFailureLog[];
}> {
  const data = await expoGraphqlRequest<{
    workflowRuns: {
      byId: {
        id: string;
        status: string;
        errors?: Array<{ title?: string | null; message?: string | null }>;
      };
    };
  }>(
    token,
    `
    query WorkflowRunById($workflowRunId: ID!) {
      workflowRuns {
        byId(workflowRunId: $workflowRunId) {
          id
          status
          errors {
            title
            message
          }
        }
      }
    }
  `,
    { workflowRunId },
  );

  const run = data.workflowRuns.byId;
  const failureLogs = extractFailureLogsFromErrorEntries(run.errors, 'expo-workflow-error');
  const errorMessage = failureLogs?.map((entry) => entry.excerpt).join('; ') || undefined;
  return {
    id: run.id,
    status: run.status,
    conclusion: errorMessage || null,
    failureLogs,
  };
}

async function fetchExpoWorkflowRunsForFileAsync(
  token: string,
  appId: string,
  fileName: string,
  limit = 5,
): Promise<Array<{ id: string; status: string; conclusion?: string | null }>> {
  const data = await expoGraphqlRequest<{
    workflows: {
      byAppIdAndFileName?: {
        runs?: {
          edges?: Array<{
            node?: {
              id: string;
              status: string;
              errors?: Array<{ title?: string | null; message?: string | null }>;
            } | null;
          }>;
        } | null;
      } | null;
    };
  }>(
    token,
    `
    query WorkflowRunsForAppIdFileName($appId: ID!, $fileName: String!, $limit: Int!) {
      workflows {
        byAppIdAndFileName(appId: $appId, fileName: $fileName) {
          id
          runs: runsPaginated(first: $limit) {
            edges {
              node {
                id
                status
                errors {
                  title
                  message
                }
              }
            }
          }
        }
      }
    }
  `,
    { appId, fileName, limit },
  );

  return (data.workflows.byAppIdAndFileName?.runs?.edges || [])
    .map((edge) => edge.node)
    .filter(
      (
        node,
      ): node is {
        id: string;
        status: string;
        errors?: Array<{ title?: string | null; message?: string | null }>;
      } => Boolean(node),
    )
    .map((node) => ({
      id: node.id,
      status: node.status,
      conclusion:
        node.errors
          ?.map((entry) => entry.message || entry.title)
          .filter(Boolean)
          .join('; ') || null,
    }));
}

async function ensureExpoProjectCloudMetadataAsync(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  token: string,
): Promise<ExpoProjectConfig> {
  let nextProject = project;
  let patch: Partial<ExpoProjectConfig> | null = null;

  if (!project.easProjectId) {
    const fullName = getExpoProjectFullName(project, account);
    const remoteProject = await findExpoProjectByFullNameAsync(token, fullName);
    if (!remoteProject) {
      throw new Error('expo-project-not-found');
    }
    patch = {
      easProjectId: remoteProject.projectId,
      repoFullName: remoteProject.repoFullName || project.repoFullName,
      repoDefaultBranch: remoteProject.repoDefaultBranch || project.repoDefaultBranch,
      availableWorkflowFiles:
        uniqueWorkflowFiles(remoteProject.availableWorkflowFiles) || project.availableWorkflowFiles,
      workflowFile:
        project.workflowFile || selectDefaultWorkflowFile(remoteProject.availableWorkflowFiles),
    };
  }

  const appId = patch?.easProjectId || project.easProjectId;
  if (appId) {
    const workflows = await fetchExpoProjectWorkflowsAsync(token, appId);
    const availableWorkflowFiles = uniqueWorkflowFiles(
      workflows.map((workflow) => workflow.fileName),
    );
    const workflowFile = selectWorkflowFileForAction({
      workflowFile: patch?.workflowFile || project.workflowFile,
      availableWorkflowFiles,
    });
    patch = {
      ...patch,
      availableWorkflowFiles:
        availableWorkflowFiles || patch?.availableWorkflowFiles || project.availableWorkflowFiles,
      workflowFile,
    };
  }

  if (patch) {
    const mergedProject = { ...project, ...patch };
    const preferredMode = getExpoProjectExecutionMode(mergedProject, account);
    if (preferredMode !== mergedProject.mode) {
      patch = { ...patch, mode: preferredMode };
    }

    useSettingsStore.setState((current) => ({
      expoProjects: (current.expoProjects || []).map((entry) =>
        entry.id === project.id ? { ...entry, ...patch } : entry,
      ),
    }));
    nextProject = { ...project, ...patch };
  }

  return nextProject;
}

function buildDirectCommand(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  action: 'build' | 'update' | 'submit' | 'deploy-web',
  args: {
    platform?: 'android' | 'ios' | 'all';
    profile?: string;
    branch?: string;
    message?: string;
    alias?: string;
  },
  token: string,
): string {
  const owner = getExpoProjectDisplayOwner(project, account);
  const cwd = shellQuote(requireExpoProjectPath(project));
  const profile = args.profile || project.defaultBuildProfile || 'production';
  const branch = args.branch || project.defaultUpdateBranch || 'production';
  const platform = args.platform || 'android';
  const message = args.message?.trim() || `Triggered from Kavi for ${project.name}`;
  const alias = args.alias?.trim() || 'production';
  const slug = getExpoProjectSlug(project) || 'unknown-project';

  const parts = [
    `export EXPO_TOKEN=${shellQuote(token)}`,
    `export EXPO_NO_TELEMETRY=1`,
    `cd ${cwd}`,
    `npx --yes eas-cli@latest whoami --non-interactive`,
  ];

  if (action === 'build') {
    parts.push(
      `npx --yes eas-cli@latest build --platform ${platform} --profile ${shellQuote(profile)} --non-interactive`,
    );
  } else if (action === 'submit') {
    parts.push(
      `npx --yes eas-cli@latest submit --platform ${platform} --profile ${shellQuote(profile)} --non-interactive`,
    );
  } else if (action === 'update') {
    parts.push(
      `npx --yes eas-cli@latest update --branch ${shellQuote(branch)} --message ${shellQuote(message)} --non-interactive`,
    );
  } else {
    parts.push(
      `npx --yes eas-cli@latest hosting:deploy --environment production --alias ${shellQuote(alias)} --non-interactive`,
    );
  }

  parts.push(
    `printf '\nOwner: ${owner}\nSlug: ${slug}\nPlatforms: ${getDefaultPlatforms(project).join(', ')}\n'`,
  );
  return parts.join(' && ');
}

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

async function githubApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: getGithubRequestHeaders(token, init?.headers),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let msg = `github-${response.status}:${body.slice(0, 300)}`;
    if (response.status === 403 && /\/actions\//i.test(path)) {
      msg += ` — The GitHub token may be missing the 'Actions' permission. Update the token in GitHub Settings > Fine-grained tokens.`;
    }
    throw new Error(msg);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function fetchGitHubWorkflowJobs(
  repo: string,
  runId: string | number,
  token: string,
): Promise<ExpoWorkflowJobStatus[]> {
  const data = await githubApi<{ jobs?: Array<any> }>(
    `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
    token,
  );
  return (data.jobs || []).map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at || null,
    completedAt: job.completed_at || null,
    url: job.html_url || null,
    steps: Array.isArray(job.steps)
      ? job.steps.map((step: any) => ({
          number: step.number,
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
          startedAt: step.started_at || null,
          completedAt: step.completed_at || null,
        }))
      : undefined,
  }));
}

async function resolveGitHubWorkflowLogArchiveUrl(
  repo: string,
  runId: string | number,
  token: string,
): Promise<string | undefined> {
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/logs`, {
    method: 'GET',
    headers: getGithubRequestHeaders(token),
  });

  if (!response.ok) {
    return undefined;
  }

  return response.url || response.headers.get('location') || undefined;
}

async function findLatestWorkflowRun(
  repo: string,
  workflowFile: string,
  token: string,
  ref?: string,
  createdAfter?: number,
) {
  const query = new URLSearchParams();
  query.set('per_page', '10');
  query.set('event', 'workflow_dispatch');
  const normalizedRef = trimToUndefined(ref);
  if (normalizedRef) {
    query.set('branch', normalizedRef);
  }
  const data = await githubApi<{ workflow_runs: Array<any> }>(
    `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?${query.toString()}`,
    token,
  );
  return (data.workflow_runs || []).find(
    (run) => !createdAfter || Date.parse(run.created_at) >= createdAfter,
  );
}

async function findLatestWorkflowRunAcrossRefs(
  repo: string,
  workflowFile: string,
  token: string,
  refs: string[],
  createdAfter?: number,
) {
  let latestRun: any;

  for (const ref of Array.from(
    new Set(
      refs
        .map((value) => trimToUndefined(value))
        .filter((value): value is string => Boolean(value)),
    ),
  )) {
    const run = await findLatestWorkflowRun(repo, workflowFile, token, ref, createdAfter);
    if (!run) {
      continue;
    }

    if (!createdAfter) {
      return run;
    }

    if (!latestRun || Date.parse(run.created_at || '') > Date.parse(latestRun.created_at || '')) {
      latestRun = run;
    }
  }

  return latestRun;
}

async function validateExpoProjectExecution(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  settings: Pick<AppSettings, 'sshTargets'>,
): Promise<ExpoProjectCheck[]> {
  const readiness = getExpoProjectReadiness(project, account, settings);
  const checks: ExpoProjectCheck[] = [];

  if (!readiness.launchable) {
    return [{ stage: 'config', ok: false, message: getExpoProjectReadinessLabel(readiness) }];
  }

  checks.push({ stage: 'config', ok: true, message: 'Configuration ready' });

  const executionMode = getExpoProjectExecutionMode(project, account);

  if (executionMode === 'eas-workflow') {
    const token = await resolveExpoAccountToken(account);
    checks.push({ stage: 'secret', ok: true, message: 'Expo token available' });

    const hydratedProject = await ensureExpoProjectCloudMetadataAsync(project, account, token);
    const workflowFile = selectWorkflowFileForAction(hydratedProject);
    if (!workflowFile) {
      throw new Error('missing-workflow-file');
    }

    checks.push({
      stage: 'project',
      ok: true,
      message: `Linked repo ready · ${normalizeRepo(hydratedProject.repoFullName)}`,
    });
    checks.push({
      stage: 'workflow',
      ok: true,
      message: `Expo workflow ready · ${workflowFile} · push a commit to trigger runs`,
    });
    return checks;
  }

  if (executionMode === 'direct-ssh') {
    const token = await resolveExpoAccountToken(account);
    checks.push({ stage: 'secret', ok: true, message: 'Expo token available' });

    const sshTarget = resolveExpoProjectSshTarget(project, settings);
    const projectPath = requireExpoProjectPath(project);
    const command = [
      `export EXPO_TOKEN=${shellQuote(token)}`,
      `cd ${shellQuote(projectPath)}`,
      `test -f package.json`,
      `([ -f eas.json ] || [ -f app.json ] || [ -f app.config.js ] || [ -f app.config.ts ])`,
      `npx --yes eas-cli@latest whoami --non-interactive`,
    ].join(' && ');
    const output = await executeSshCommand(sshTarget, command);
    const firstLine =
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || 'EAS CLI ready';
    checks.push({ stage: 'project', ok: true, message: `Project path validated · ${projectPath}` });
    checks.push({ stage: 'ssh', ok: true, message: firstLine });
    return checks;
  }

  const githubToken = await resolveProjectGithubToken(project);
  checks.push({ stage: 'secret', ok: true, message: 'GitHub token available' });

  const repo = requireGitHubWorkflowRepo(project);
  const workflowFile = requireGitHubWorkflowFile(project);
  const workflow = await githubApi<{ path: string; state: string; name?: string }>(
    `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}`,
    githubToken,
  );
  checks.push({
    stage: 'workflow',
    ok: true,
    message: `Workflow reachable · ${workflow.name || workflow.path} (${workflow.state || 'active'})`,
  });
  return checks;
}

async function dispatchGitHubWorkflow(
  project: ExpoProjectConfig,
  action: 'build' | 'update' | 'submit' | 'deploy-web',
  githubToken: string,
  args: {
    platform?: 'android' | 'ios' | 'all';
    profile?: string;
    branch?: string;
    workflowRef?: string;
    message?: string;
    alias?: string;
    waitForCompletion?: boolean;
    waitTimeoutMs?: number;
  },
): Promise<ExpoCommandResult> {
  const repo = requireGitHubWorkflowRepo(project);
  const workflowFile = requireGitHubWorkflowFile(project);
  const refResolution = await resolveExpoProjectGitRefAsync(project, githubToken);
  const explicitWorkflowRef = normalizeExpoWorkflowGitRef(args.workflowRef);
  let ref = explicitWorkflowRef || refResolution.ref;
  const startedAt = Date.now();

  let dispatched = false;
  let lastDispatchError: unknown;
  for (const candidateRef of getExpoGitRefCandidates({
    workflowRef: ref,
    repoDefaultBranch: refResolution.repoDefaultBranch,
  })) {
    try {
      await githubApi(
        `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
        githubToken,
        {
          method: 'POST',
          body: JSON.stringify({
            ref: candidateRef,
            inputs: {
              action,
              platform: args.platform || 'android',
              profile: args.profile || project.defaultBuildProfile || 'production',
              branch: args.branch || project.defaultUpdateBranch || 'production',
              message: args.message || `Triggered from Kavi for ${project.name}`,
              alias: args.alias || 'production',
            },
          }),
        },
      );
      ref = candidateRef;
      dispatched = true;
      lastDispatchError = undefined;
      break;
    } catch (error) {
      lastDispatchError = error;
      const errMsg = error instanceof Error ? error.message : String(error);
      if (/github-403:/i.test(errMsg)) {
        break;
      }
      if (!/github-(404|422):/i.test(errMsg)) {
        throw error;
      }
    }
  }

  if (!dispatched) {
    const candidates = getExpoGitRefCandidates({
      workflowRef: ref,
      repoDefaultBranch: refResolution.repoDefaultBranch,
    });
    const is403 =
      lastDispatchError instanceof Error && /github-403:/i.test(lastDispatchError.message);
    const hint = is403
      ? `GitHub token lacks 'Actions' permission. Update the token in GitHub Settings > Fine-grained tokens to include Actions read/write access. Tried branches: ${candidates.join(', ')}.`
      : `Tried branches: ${candidates.join(', ')}. Set the correct branch in project settings (Workflow Ref), or ensure the workflow file exists on one of these branches.`;
    throw lastDispatchError instanceof Error
      ? new Error(`${lastDispatchError.message} — ${hint}`)
      : new Error(`GitHub workflow dispatch failed. ${hint}`);
  }

  let run = await findLatestWorkflowRun(repo, workflowFile, githubToken, ref, startedAt - 5000);
  const waitTimeoutMs = args.waitTimeoutMs || 3 * 60 * 1000;
  const deadline = Date.now() + waitTimeoutMs;

  while (!run && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    run = await findLatestWorkflowRun(repo, workflowFile, githubToken, ref, startedAt - 5000);
  }

  if (!run) {
    return { mode: 'github-workflow' };
  }

  if (args.waitForCompletion) {
    while (run.status !== 'completed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      run = await githubApi<any>(`/repos/${repo}/actions/runs/${run.id}`, githubToken);
    }
  }

  return {
    mode: 'github-workflow',
    workflowRun: {
      id: run.id,
      url: run.html_url,
      status: run.status,
      conclusion: run.conclusion,
    },
  };
}

async function dispatchExpoWorkflow(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  action: 'build' | 'update' | 'submit' | 'deploy-web',
  args: {
    platform?: 'android' | 'ios' | 'all';
    profile?: string;
    branch?: string;
    workflowRef?: string;
    message?: string;
    alias?: string;
    waitForCompletion?: boolean;
    waitTimeoutMs?: number;
  },
): Promise<ExpoCommandResult> {
  const token = await resolveExpoAccountToken(account);
  const hydratedProject = await ensureExpoProjectCloudMetadataAsync(project, account, token);
  const appId = hydratedProject.easProjectId;
  if (!appId) {
    throw new Error('expo-project-not-found');
  }

  const workflowFile = selectWorkflowFileForAction(hydratedProject, action);
  if (!workflowFile) {
    throw new Error('missing-workflow-file');
  }

  const githubToken = await tryResolveProjectGithubToken(hydratedProject);
  const refResolution = await resolveExpoProjectGitRefAsync(hydratedProject, githubToken);
  const explicitWorkflowRef = normalizeExpoWorkflowGitRef(args.workflowRef);
  const { workflowRevisionId, gitRef } = await resolveExpoWorkflowRevisionFromGitRefsAsync(
    token,
    appId,
    workflowFile,
    getExpoGitRefCandidates({
      workflowRef: explicitWorkflowRef || refResolution.ref,
      repoDefaultBranch: refResolution.repoDefaultBranch,
    }),
  );

  const workflowRunData = await expoGraphqlRequest<{
    workflowRun?: {
      createWorkflowRunFromGitRef?: {
        id?: string | null;
      } | null;
    };
  }>(
    token,
    `
    mutation CreateWorkflowRunFromGitRef($workflowRevisionId: ID!, $gitRef: String!, $inputs: JSONObject) {
      workflowRun {
        createWorkflowRunFromGitRef(workflowRevisionId: $workflowRevisionId, gitRef: $gitRef, inputs: $inputs) {
          id
        }
      }
    }
  `,
    {
      workflowRevisionId,
      gitRef,
      inputs: getExpoWorkflowDispatchInputs(hydratedProject, action, args),
    },
  );

  const workflowRunId = workflowRunData.workflowRun?.createWorkflowRunFromGitRef?.id;
  if (!workflowRunId) {
    throw new Error('expo-workflow-run-create-failed');
  }

  const runUrl = getExpoWorkflowRunUrl(hydratedProject, account, workflowRunId);
  let runStatus = 'NEW';
  let runConclusion: string | null | undefined;

  if (args.waitForCompletion) {
    const waitTimeoutMs = args.waitTimeoutMs || 3 * 60 * 1000;
    const deadline = Date.now() + waitTimeoutMs;
    while (Date.now() < deadline) {
      const run = await fetchExpoWorkflowRunByIdAsync(token, workflowRunId);
      runStatus = run.status;
      runConclusion = run.conclusion;
      if (!['NEW', 'IN_PROGRESS', 'ACTION_REQUIRED'].includes(run.status)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }

  return {
    mode: 'eas-workflow',
    workflowRun: {
      id: workflowRunId,
      url: runUrl,
      status: runStatus,
      conclusion: runConclusion,
    },
  };
}

function resolveExpoMonitoringContext(
  projectId?: string,
  accountId?: string,
  variables?: Record<string, unknown>,
): {
  project?: ExpoProjectConfig;
  account: ExpoAccountConfig;
} {
  const settings = useSettingsStore.getState();

  if (projectId) {
    const project = resolveExpoProject(projectId, settings);
    const account = resolveExpoAccount(project.accountId, settings);
    return { project, account };
  }

  if (accountId) {
    return { account: resolveExpoAccount(accountId, settings) };
  }

  if (variables) {
    const inferredProject = tryResolveExpoProjectFromGraphqlVariables(settings, variables);
    if (inferredProject) {
      return {
        project: inferredProject,
        account: resolveExpoAccount(inferredProject.accountId, settings),
      };
    }

    const inferredAccount = tryResolveExpoAccountFromGraphqlVariables(settings, variables);
    if (inferredAccount) {
      return { account: inferredAccount };
    }
  }

  const enabledAccounts = getExpoAccounts(settings).filter((entry) => entry.enabled);
  if (enabledAccounts.length === 1) {
    return { account: enabledAccounts[0] };
  }

  throw new Error(enabledAccounts.length > 1 ? 'expo-account-ambiguous' : 'expo-account-not-found');
}

export async function runExpoGraphqlQuery(args: {
  query: string;
  variables?: Record<string, unknown>;
  projectId?: string;
  accountId?: string;
}): Promise<{
  status: 'ok' | 'partial' | 'error';
  accountId?: string;
  projectId?: string;
  data?: unknown;
  error?: string;
  errorCode?: string;
  errors?: Array<{ message: string; path?: string; code?: string }>;
  guidance?: string;
}> {
  const normalizedQuery = trimToUndefined(args.query);
  const normalizedVariables =
    args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables)
      ? args.variables
      : {};

  if (!normalizedQuery) {
    return {
      status: 'error',
      error: 'GraphQL query is required.',
      errorCode: 'missing-query',
    };
  }

  const getGuidanceForError = (errorCode: string): string | undefined => {
    switch (errorCode) {
      case 'expo-account-ambiguous':
        return 'Pass projectId or accountId, or include variables like appId, fullName, or owner+slug so the Expo account can be resolved automatically.';
      case 'expo-account-not-found':
        return 'Link an Expo account first, or pass projectId/accountId so the GraphQL tool can resolve the correct token.';
      case 'expo-project-not-found':
        return 'Use expo_eas_list_projects first, then pass one of the returned project ids or fullName values.';
      case 'missing-expo-token':
        return 'Store a valid Expo token for the target account before using raw Expo GraphQL queries.';
      default:
        return undefined;
    }
  };

  let project: ExpoProjectConfig | undefined;
  let account: ExpoAccountConfig | undefined;

  try {
    const resolved = resolveExpoMonitoringContext(
      args.projectId,
      args.accountId,
      normalizedVariables,
    );
    project = resolved.project;
    account = resolved.account;
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : String(error);
    return {
      status: 'error',
      error: errorCode,
      errorCode,
      guidance: getGuidanceForError(errorCode),
    };
  }

  try {
    const token = await resolveExpoAccountToken(account);
    const { response, payload, rawText } = await fetchExpoGraphqlEnvelope<unknown>(
      token,
      normalizedQuery,
      normalizedVariables,
    );
    const errors = formatExpoGraphqlErrors(payload?.errors);
    const hasData = Boolean(payload) && Object.prototype.hasOwnProperty.call(payload, 'data');
    const errorMessage =
      describeExpoGraphqlErrors(payload?.errors) ||
      trimToUndefined(rawText) ||
      (!response.ok ? `expo-graphql-${response.status}` : undefined) ||
      'expo-graphql-empty-response';

    if (!response.ok) {
      return {
        status: 'error',
        accountId: account.id,
        projectId: project?.id,
        error: errorMessage,
        ...(errors.length > 0 ? { errors } : {}),
      };
    }

    if (errors.length > 0) {
      return {
        status: hasData ? 'partial' : 'error',
        accountId: account.id,
        projectId: project?.id,
        ...(hasData ? { data: payload?.data } : {}),
        error: errorMessage,
        errors,
      };
    }

    if (!hasData) {
      return {
        status: 'error',
        accountId: account.id,
        projectId: project?.id,
        error: 'expo-graphql-empty-response',
      };
    }

    return {
      status: 'ok',
      accountId: account.id,
      projectId: project?.id,
      data: payload?.data,
    };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : 'expo-graphql-request-failed';
    return {
      status: 'error',
      accountId: account.id,
      projectId: project?.id,
      error: errorCode,
      errorCode,
      guidance: getGuidanceForError(errorCode),
    };
  }
}

export async function listExpoWorkflowRuns(
  projectId: string,
  args: { limit?: number } = {},
): Promise<ExpoWorkflowRunListResult> {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProject(projectId, settings);
  const account = resolveExpoAccount(project.accountId, settings);
  const mode = getExpoProjectExecutionMode(project, account);
  const limit = Math.max(1, Math.min(args.limit || 5, 20));
  const publicUrls = getExpoProjectPublicUrls(project);
  const unavailableNote = getExpoWorkflowToolUnavailableNote(project, account, settings);

  if (unavailableNote) {
    return {
      status: 'unsupported',
      projectId: project.id,
      projectName: project.name,
      mode,
      runs: [],
      publicUrls,
      note: unavailableNote,
    };
  }

  if (mode === 'direct-ssh') {
    return {
      status: 'unsupported',
      projectId: project.id,
      projectName: project.name,
      mode,
      runs: [],
      publicUrls,
      note: 'Direct SSH mode runs EAS CLI synchronously on the linked host. There is no separate cloud workflow history to inspect here.',
    };
  }

  if (mode === 'github-workflow') {
    const githubToken = await resolveProjectGithubToken(project);
    const repo = requireGitHubWorkflowRepo(project);
    const workflowFile = requireGitHubWorkflowFile(project);
    const data = await githubApi<{ workflow_runs?: Array<any> }>(
      `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=${limit}`,
      githubToken,
    );

    return {
      status: 'ok',
      projectId: project.id,
      projectName: project.name,
      mode,
      runs: (data.workflow_runs || []).map((run) => mapGitHubWorkflowRun(run)),
      publicUrls,
      guidance:
        'Use this after pushing a commit to a branch that matches the workflow trigger. Inspect the latest run or pass workflowRunId to expo_eas_workflow_status / expo_eas_workflow_wait to follow the auto-triggered workflow.',
    };
  }

  const token = await resolveExpoAccountToken(account);
  const hydratedProject = await ensureExpoProjectCloudMetadataAsync(project, account, token);
  const appId = hydratedProject.easProjectId;
  const workflowFile = selectWorkflowFileForAction(hydratedProject);
  const hostedWorkflowUnavailableNote = getHostedWorkflowUnavailableNote(appId, workflowFile);

  if (hostedWorkflowUnavailableNote) {
    return {
      status: 'unsupported',
      projectId: hydratedProject.id,
      projectName: hydratedProject.name,
      mode,
      runs: [],
      publicUrls,
      note: hostedWorkflowUnavailableNote,
    };
  }

  if (!appId || !workflowFile) {
    throw new Error('unreachable-hosted-workflow-state');
  }

  const runs = await fetchExpoWorkflowRunsForFileAsync(token, appId, workflowFile, limit);

  return {
    status: 'ok',
    projectId: hydratedProject.id,
    projectName: hydratedProject.name,
    mode,
    runs: runs.map((run) => ({
      id: run.id,
      url: getExpoWorkflowRunUrl(hydratedProject, account, run.id),
      status: run.status,
      conclusion: run.conclusion,
    })),
    publicUrls,
    note: 'Expo-hosted workflow listing is normalized here. Use it after pushing a commit to the branch that owns the .eas/workflows file, then inspect or wait on the newest run.',
    guidance:
      'Use expo_eas_workflow_status with a workflowRunId to inspect exact job and step status, or expo_eas_workflow_wait to poll until completion. Use expo_eas_graphql only when you need schema-specific fields such as stages, artifacts, or raw log URLs.',
  };
}

export async function inspectExpoWorkflowRun(
  projectId: string,
  args: {
    workflowRunId?: string;
    includeJobs?: boolean;
    includeLogs?: boolean;
  } = {},
): Promise<ExpoWorkflowRunInspectionResult> {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProject(projectId, settings);
  const account = resolveExpoAccount(project.accountId, settings);
  const mode = getExpoProjectExecutionMode(project, account);
  const publicUrls = getExpoProjectPublicUrls(project);
  const unavailableNote = getExpoWorkflowToolUnavailableNote(project, account, settings);

  if (unavailableNote) {
    return {
      status: 'unsupported',
      projectId: project.id,
      projectName: project.name,
      mode,
      publicUrls,
      note: unavailableNote,
    };
  }

  if (mode === 'direct-ssh') {
    return {
      status: 'unsupported',
      projectId: project.id,
      projectName: project.name,
      mode,
      publicUrls,
      note: 'Direct SSH mode does not create a separate cloud workflow run. Inspect the original command output instead.',
    };
  }

  if (mode === 'github-workflow') {
    const githubToken = await resolveProjectGithubToken(project);
    const repo = requireGitHubWorkflowRepo(project);
    const workflowFile = requireGitHubWorkflowFile(project);
    let runId = trimToUndefined(args.workflowRunId);
    const shouldIncludeJobs = args.includeJobs !== false;
    const shouldIncludeLogs = args.includeLogs !== false;

    if (!runId) {
      const latestRun = await findLatestWorkflowRunAcrossRefs(
        repo,
        workflowFile,
        githubToken,
        getExpoGitRefCandidates({
          workflowRef: project.workflowRef,
          repoDefaultBranch: project.repoDefaultBranch,
        }),
      );
      runId = latestRun?.id ? String(latestRun.id) : undefined;
    }

    if (!runId) {
      return {
        status: 'not_found',
        projectId: project.id,
        projectName: project.name,
        mode,
        publicUrls,
        note: 'No workflow run was found for this project. Push a commit to the branch matched by the workflow trigger, then try again.',
      };
    }

    const run = await githubApi<any>(`/repos/${repo}/actions/runs/${runId}`, githubToken);
    const jobs = shouldIncludeJobs
      ? await fetchGitHubWorkflowJobs(repo, run.id, githubToken)
      : undefined;
    const logArchiveUrl = shouldIncludeLogs
      ? await resolveGitHubWorkflowLogArchiveUrl(repo, run.id, githubToken)
      : undefined;
    const failureLogs =
      shouldIncludeLogs && isWorkflowRunFailure('github-workflow', run.status, run.conclusion)
        ? await fetchGitHubWorkflowFailureLogs(repo, run.id, githubToken, jobs)
        : undefined;

    return {
      status: 'ok',
      projectId: project.id,
      projectName: project.name,
      mode,
      workflowRun: mapGitHubWorkflowRun(run),
      jobs,
      logArchiveUrl,
      failureLogs,
      publicUrls,
      guidance: failureLogs?.length
        ? 'Jobs, steps, and parsed failure log excerpts are included inline for agentic debugging. logArchiveUrl points to the full GitHub log archive when available.'
        : logArchiveUrl
          ? 'Jobs and steps are included inline. logArchiveUrl points to the GitHub log archive for the run.'
          : 'Jobs and steps are included inline. GitHub did not return a log archive URL for this run.',
    };
  }

  const token = await resolveExpoAccountToken(account);
  const hydratedProject = await ensureExpoProjectCloudMetadataAsync(project, account, token);
  const shouldIncludeJobs = args.includeJobs !== false;
  const shouldIncludeLogs = args.includeLogs !== false;
  let workflowRunId = trimToUndefined(args.workflowRunId);

  if (!workflowRunId) {
    const appId = hydratedProject.easProjectId;
    const workflowFile = selectWorkflowFileForAction(hydratedProject);
    const hostedWorkflowUnavailableNote = getHostedWorkflowUnavailableNote(appId, workflowFile);
    if (hostedWorkflowUnavailableNote) {
      return {
        status: 'unsupported',
        projectId: hydratedProject.id,
        projectName: hydratedProject.name,
        mode,
        publicUrls,
        note: hostedWorkflowUnavailableNote,
      };
    }

    if (!appId || !workflowFile) {
      throw new Error('unreachable-hosted-workflow-state');
    }

    const runs = await fetchExpoWorkflowRunsForFileAsync(token, appId, workflowFile, 1);
    workflowRunId = runs[0]?.id;
  }

  if (!workflowRunId) {
    return {
      status: 'not_found',
      projectId: hydratedProject.id,
      projectName: hydratedProject.name,
      mode,
      publicUrls,
      note: 'No Expo-hosted workflow run was found for this project. Push a commit to the branch matched by the workflow trigger, then try again.',
    };
  }

  const run = await fetchExpoWorkflowRunDetailsAsync(token, workflowRunId, {
    includeJobs: shouldIncludeJobs,
    includeLogs: shouldIncludeLogs,
  });
  const buildFailureGuidance = getExpoBuildFailureGuidance(
    run.failureLogs,
    Boolean(run.jobs?.length),
  );

  return {
    status: 'ok',
    projectId: hydratedProject.id,
    projectName: hydratedProject.name,
    mode,
    workflowRun: {
      id: run.id,
      url: getExpoWorkflowRunUrl(hydratedProject, account, run.id),
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.createdAt || null,
      updatedAt: run.updatedAt || null,
    },
    jobs: shouldIncludeJobs ? run.jobs : undefined,
    failureLogs: shouldIncludeLogs ? run.failureLogs : undefined,
    publicUrls,
    note:
      shouldIncludeLogs && run.failureLogs?.length
        ? 'Expo-hosted workflow status includes inline build-stage or failed-step excerpts when Expo exposed raw job logs, then falls back to GraphQL error diagnostics.'
        : 'Expo-hosted workflow status is available here. Use this to inspect the auto-triggered run from your latest commit. Enable includeLogs to fetch inline build-stage excerpts when Expo exposes raw job logs.',
    guidance:
      buildFailureGuidance ||
      'Use expo_eas_graphql only when you need schema-specific fields beyond the normalized run, job, step, and failure log data returned here.',
  };
}

export async function waitForExpoWorkflowRun(
  projectId: string,
  args: {
    workflowRunId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    includeJobs?: boolean;
    includeLogs?: boolean;
  } = {},
): Promise<ExpoWorkflowRunInspectionResult & { waitedMs: number; timedOut: boolean }> {
  const timeoutMs = Math.max(1000, Math.min(args.timeoutMs || 10 * 60 * 1000, 60 * 60 * 1000));
  const pollIntervalMs = Math.max(1000, Math.min(args.pollIntervalMs || 5000, 60000));
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;

  let snapshot = await inspectExpoWorkflowRun(projectId, args);
  while (
    snapshot.status === 'ok' &&
    snapshot.workflowRun &&
    !isWorkflowRunTerminal(snapshot.mode, snapshot.workflowRun.status) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    snapshot = await inspectExpoWorkflowRun(projectId, args);
  }

  return {
    ...snapshot,
    waitedMs: Date.now() - startedAt,
    timedOut: Boolean(
      snapshot.status === 'ok' &&
      snapshot.workflowRun &&
      !isWorkflowRunTerminal(snapshot.mode, snapshot.workflowRun.status),
    ),
  };
}

export async function createExpoProject(args: {
  accountId?: string;
  name: string;
  slug?: string;
}): Promise<ExpoProjectListing> {
  const settings = useSettingsStore.getState();
  const enabledAccounts = getExpoAccounts(settings).filter((account) => account.enabled);
  const account = args.accountId
    ? resolveExpoAccount(args.accountId, settings)
    : enabledAccounts.length === 1
      ? enabledAccounts[0]
      : null;

  if (!account) {
    throw new Error('expo-account-not-found');
  }

  const token = await resolveExpoAccountToken(account);
  const slug = slugifyExpoProjectName(args.slug || args.name);
  const fullName = `@${normalizeExpoOwner(account.owner)}/${slug}`;
  const existingProject = await findExpoProjectByFullNameAsync(token, fullName);

  if (!existingProject) {
    const remoteAccount = await fetchExpoRemoteAccountAsync(token, account.owner);
    await createExpoRemoteProjectAsync(token, remoteAccount.id, slug);
  }

  await syncExpoAccountProjects(account.id);
  const refreshedSettings = useSettingsStore.getState();
  const project = resolveExpoProject(fullName, refreshedSettings);
  const refreshedAccount = resolveExpoAccount(project.accountId, refreshedSettings);
  const readiness = getExpoProjectReadiness(project, refreshedAccount, refreshedSettings);

  return {
    id: project.id,
    easProjectId: project.easProjectId,
    name: project.name,
    fullName: getExpoProjectFullName(project, refreshedAccount),
    owner: getExpoProjectDisplayOwner(project, refreshedAccount),
    slug: project.slug,
    accountId: project.accountId,
    accountName: refreshedAccount.name,
    source: project.source,
    mode: project.mode,
    repoFullName: project.repoFullName,
    repoDefaultBranch: project.repoDefaultBranch,
    availableWorkflowFiles: project.availableWorkflowFiles,
    lastSyncedAt: project.lastSyncedAt,
    readiness: {
      ...readiness,
      label: getExpoProjectReadinessLabel(readiness),
    },
  };
}

export async function runExpoProjectAction(
  projectId: string,
  action: 'build' | 'update' | 'submit' | 'deploy-web',
  args: {
    platform?: 'android' | 'ios' | 'all';
    profile?: string;
    branch?: string;
    workflowRef?: string;
    message?: string;
    alias?: string;
    waitForCompletion?: boolean;
    waitTimeoutMs?: number;
  } = {},
): Promise<ExpoCommandResult> {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProject(projectId, settings);
  const account = resolveExpoAccount(project.accountId, settings);
  const executionMode = getExpoProjectExecutionMode(project, account);
  const readiness = getExpoProjectReadiness(project, account, settings);
  if (!readiness.launchable) {
    throw new Error(readiness.reason);
  }

  const preflightChecks = await validateExpoProjectExecution(project, account, settings);

  const jobSummary = `${project.name} ${action}`;
  const jobId = startRemoteJob({
    jobType: 'expo-job',
    targetId: project.id,
    providerId: account.id,
    status: 'running',
    requestedBy: 'agent',
    executionSurface: 'expo-eas',
    summary: jobSummary,
    progressText:
      executionMode === 'direct-ssh'
        ? 'Validated project and running EAS CLI over SSH'
        : executionMode === 'eas-workflow'
          ? 'Validated Expo workflow access and dispatching EAS workflow'
          : 'Validated workflow access and dispatching GitHub workflow',
  } as Omit<RemoteJobRecord, 'id' | 'createdAt' | 'updatedAt' | 'artifacts'>);

  for (const check of preflightChecks) {
    addRemoteArtifact(jobId, {
      kind: 'log-snippet',
      title: `Preflight · ${check.stage}`,
      value: `${check.ok ? 'OK' : 'FAIL'} · ${check.message}`,
    });
  }

  try {
    const result: ExpoCommandResult =
      executionMode === 'direct-ssh'
        ? await (async () => {
            const token = await resolveExpoAccountToken(account);
            const sshTarget = resolveExpoProjectSshTarget(project, settings);
            const command = buildDirectCommand(project, account, action, args, token);
            const output = await executeSshCommand(sshTarget, command);
            return { mode: 'direct-ssh', command, output };
          })()
        : executionMode === 'eas-workflow'
          ? await dispatchExpoWorkflow(project, account, action, args)
          : await (async () => {
              const githubToken = await resolveProjectGithubToken(project);
              return dispatchGitHubWorkflow(project, action, githubToken, args);
            })();

    const publicUrls = action === 'deploy-web' ? getExpoProjectPublicUrls(project) : undefined;
    const normalizedResult: ExpoCommandResult = {
      ...result,
      jobId,
      publicUrls,
      note:
        result.note ||
        (result.workflowRun && result.mode !== 'direct-ssh'
          ? 'This was a manual workflow dispatch. For GitHub-linked Expo projects, prefer repository changes plus .eas/workflows/*.yml on the target branch, then push a commit and monitor the auto-triggered run.'
          : undefined),
      guidance: result.workflowRun
        ? 'Use expo_eas_workflow_status for an exact snapshot of this run, or expo_eas_workflow_wait to poll until it reaches a terminal state. If the build fails, inspect failureLogs first; missing dependency installation is the most common Expo root cause.'
        : result.mode === 'direct-ssh'
          ? 'Direct SSH mode runs synchronously; inspect output for the final result.'
          : undefined,
    };

    updateRemoteJob(jobId, {
      status: normalizedResult.workflowRun
        ? !isWorkflowRunTerminal(normalizedResult.mode, normalizedResult.workflowRun.status)
          ? 'running'
          : isWorkflowRunFailure(
                normalizedResult.mode,
                normalizedResult.workflowRun.status,
                normalizedResult.workflowRun.conclusion,
              )
            ? 'failed'
            : 'completed'
        : 'completed',
      externalId: result.workflowRun?.id ? String(result.workflowRun.id) : undefined,
      progressText: normalizedResult.workflowRun
        ? `${normalizedResult.workflowRun.status}${normalizedResult.workflowRun.conclusion ? ` · ${normalizedResult.workflowRun.conclusion}` : ''}`
        : 'Completed',
    });

    if (normalizedResult.output?.trim()) {
      addRemoteArtifact(jobId, {
        kind: 'log-snippet',
        title: `${action} output`,
        value: normalizedResult.output.slice(0, 12000),
      });
    }
    if (normalizedResult.workflowRun?.url) {
      addRemoteArtifact(jobId, {
        kind: 'export-bundle',
        title: `${action} workflow run`,
        uri: normalizedResult.workflowRun.url,
        mimeType: 'text/uri-list',
      });
    }
    for (const publicUrl of publicUrls || []) {
      addRemoteArtifact(jobId, {
        kind: 'export-bundle',
        title: `${action} ${publicUrl.label}`,
        uri: publicUrl.url,
        mimeType: 'text/uri-list',
      });
    }

    return normalizedResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'expo-action-failed';
    updateRemoteJob(jobId, {
      status: 'failed',
      error: message,
      progressText: 'Failed',
    });
    throw error;
  }
}

export async function probeExpoProject(projectId: string): Promise<ExpoProjectProbeResult> {
  const settings = useSettingsStore.getState();
  const project = resolveExpoProject(projectId, settings);
  const account = resolveExpoAccount(project.accountId, settings);
  const executionMode = getExpoProjectExecutionMode(project, account);
  const readiness = getExpoProjectReadiness(project, account, settings);
  const checkedAt = Date.now();

  if (!readiness.launchable) {
    return {
      ok: false,
      message: getExpoProjectReadinessLabel(readiness),
      checkedAt,
      checks: [{ stage: 'config', ok: false, message: getExpoProjectReadinessLabel(readiness) }],
    };
  }

  try {
    const checks = await validateExpoProjectExecution(project, account, settings);
    if (executionMode === 'direct-ssh') {
      return {
        ok: true,
        message: checks[checks.length - 1]?.message || 'EAS CLI ready',
        checkedAt,
        checks,
      };
    }

    if (executionMode === 'eas-workflow') {
      const token = await resolveExpoAccountToken(account);
      const hydratedProject = await ensureExpoProjectCloudMetadataAsync(project, account, token);
      const workflowFile = selectWorkflowFileForAction(hydratedProject);
      const runs =
        hydratedProject.easProjectId && workflowFile
          ? await fetchExpoWorkflowRunsForFileAsync(
              token,
              hydratedProject.easProjectId,
              workflowFile,
              1,
            )
          : [];
      const latestRun = runs[0];

      return {
        ok: true,
        message: latestRun
          ? `Expo workflow ready · last run ${latestRun.status} · push the next commit to start a new run`
          : `Expo workflow ready · ${workflowFile} · push a commit to trigger runs`,
        checkedAt,
        checks,
        workflowRun: latestRun
          ? {
              id: latestRun.id,
              url: getExpoWorkflowRunUrl(hydratedProject, account, latestRun.id),
              status: latestRun.status,
              conclusion: latestRun.conclusion,
            }
          : undefined,
      };
    }

    const githubToken = await resolveProjectGithubToken(project);
    const refResolution = await resolveExpoProjectGitRefAsync(project, githubToken);
    const latestRun = await findLatestWorkflowRunAcrossRefs(
      requireGitHubWorkflowRepo(project),
      requireGitHubWorkflowFile(project),
      githubToken,
      getExpoGitRefCandidates({
        workflowRef: refResolution.ref,
        repoDefaultBranch: refResolution.repoDefaultBranch,
      }),
    );
    return {
      ok: true,
      message: latestRun
        ? `Workflow ready · last run ${latestRun.status}`
        : 'Workflow dispatch ready',
      checkedAt,
      checks,
      workflowRun: latestRun
        ? {
            id: latestRun.id,
            url: latestRun.html_url,
            status: latestRun.status,
            conclusion: latestRun.conclusion,
          }
        : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Expo project probe failed',
      checkedAt,
      checks: [],
    };
  }
}
