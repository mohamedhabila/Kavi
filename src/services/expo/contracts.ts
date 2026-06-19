import type { ExpoProjectConfig } from '../../types/remote';
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

export type {
  ExpoWorkflowInfo,
  ExpoHostedWorkflowErrorEntry,
  ExpoHostedWorkflowBuildRecord,
  ExpoHostedWorkflowJobRecord,
  ExpoHostedWorkflowRunRecord,
  ExpoHostedWorkflowLogLine,
  ExpoHostedWorkflowLogGroup,
  ExpoGraphqlProjectNode,
  ExpoGraphqlErrorEntry,
  ExpoGraphqlEnvelope,
};
